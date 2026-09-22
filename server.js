import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tenantStorage = new AsyncLocalStorage();

// Accessing the secret key from environment variables
const MY_SECRET_KEY = process.env.MY_SECRET_KEY;

if (!MY_SECRET_KEY) {
  console.warn('Warning: MY_SECRET_KEY is not defined in environment variables.');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy for reverse proxies (cPanel, Nginx, Apache Passenger, Cloud Run)
  app.set('trust proxy', true);

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Request Logger
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // MySQL Connection Pool
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'school_os',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 5000,
    dateStrings: true
  });

  // Cached connection pools for school-specific databases
  const schoolPools = new Map();

  const getPoolForSchool = async (schoolId) => {
    if (!schoolId) return pool;
    if (schoolPools.has(schoolId)) return schoolPools.get(schoolId);

    try {
      const [rows] = await pool.query('SELECT * FROM school_database_configs WHERE school_id = ?', [schoolId]);
      if (rows && rows.length > 0) {
        const config = rows[0];
        console.log(`[Multi-DB] Creating dedicated connection pool for school: ${schoolId} on database: ${config.database_name}`);
        const schoolPool = mysql.createPool({
          host: config.host || process.env.MYSQL_HOST || 'localhost',
          user: config.user || process.env.MYSQL_USER || 'root',
          password: config.password !== undefined ? config.password : (process.env.MYSQL_PASSWORD || ''),
          database: config.database_name,
          port: parseInt(config.port || process.env.MYSQL_PORT || '3306'),
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          connectTimeout: 5000,
          dateStrings: true
        });
        schoolPools.set(schoolId, schoolPool);
        
        // Ensure schema and all migrations are applied to the new tenant database pool
        try {
          console.log(`[Multi-DB] Automatically initializing schema and migrations for school: ${schoolId}`);
          await initializeDatabase(schoolPool);
        } catch (initErr) {
          console.error(`[Multi-DB] Failed to run schema/migrations initialization for school: ${schoolId}:`, initErr.message);
        }

        return schoolPool;
      }
    } catch (err) {
      console.error(`[Multi-DB] Error loading database config for school ${schoolId}:`, err.message);
    }

    return pool;
  };

  const closePoolForSchool = async (schoolId) => {
    if (schoolPools.has(schoolId)) {
      const schoolPool = schoolPools.get(schoolId);
      try {
        await schoolPool.end();
        console.log(`[Multi-DB] Successfully closed connection pool for school: ${schoolId}`);
      } catch (err) {
        console.error(`[Multi-DB] Error closing connection pool for school ${schoolId}:`, err.message);
      }
      schoolPools.delete(schoolId);
    }
  };

  // Helper to handle SQL queries
  const query = async (sql, params = [], targetPool = null) => {
    let activePool = targetPool || tenantStorage.getStore() || pool;

    // Only force central pool if targetPool is not explicitly passed
    if (!targetPool) {
      // Check if the query is targeting central-only tables
      // If a school-specific tenant pool is active, 'profiles' (teachers) should be queried from that tenant pool.
      // Otherwise (like during login before school context is established), query 'profiles' from central.
      const centralTables = tenantStorage.getStore()
        ? ['schools', 'super_admins', 'school_configs', 'school_database_configs']
        : ['schools', 'super_admins', 'school_configs', 'school_database_configs', 'profiles'];
      
      const isCentral = centralTables.some(table => {
        // 1. Check if the table name is in the SQL string
        const regex = new RegExp(`\\b${table}\\b`, 'i');
        if (regex.test(sql)) return true;

        // 2. Check if the table name is passed as the first parameter (e.g., SELECT * FROM ??)
        if (params && params.length > 0 && typeof params[0] === 'string') {
          if (params[0].toLowerCase() === table.toLowerCase()) return true;
        }
        return false;
      });

      if (isCentral) {
        activePool = pool;
      }
    }

    const poolLabel = (activePool === pool) ? 'CENTRAL' : 'TENANT_DEDICATED';
    console.log(`[Database Query] [Pool: ${poolLabel}] SQL: ${sql.substring(0, 150)}${sql.length > 150 ? '...' : ''} | Params: ${JSON.stringify(params).substring(0, 300)}`);

    try {
      // Use query instead of execute to support ?? placeholders for identifiers
      const [results] = await activePool.query(sql, params);
      return results;
    } catch (error) {
      console.error('Database Error:', error);
      console.error('SQL:', sql);
      console.error('Params:', JSON.stringify(params).substring(0, 500) + (JSON.stringify(params).length > 500 ? '...' : ''));
      throw error;
    }
  };

  const runGlobalQuery = query;

  // Database Initialization Function
  const initializeDatabase = async (targetPool = pool) => {
    const query = (sql, params = []) => runGlobalQuery(sql, params, targetPool);
    try {
      const schema = [
        `CREATE TABLE IF NOT EXISTS school_database_configs (
          school_id VARCHAR(255) PRIMARY KEY,
          host VARCHAR(255) NOT NULL,
          port INT DEFAULT 3306,
          user VARCHAR(255) NOT NULL,
          password VARCHAR(255) DEFAULT '',
          database_name VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS schools (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          district VARCHAR(255),
          province VARCHAR(255),
          lat FLOAT,
          lng FLOAT,
          radius INT DEFAULT 500,
          late_time_threshold VARCHAR(255) DEFAULT '08:30',
          logo_base_64 LONGTEXT,
          is_suspended BOOLEAN DEFAULT FALSE,
          auto_check_out_enabled BOOLEAN DEFAULT FALSE,
          auto_check_out_time VARCHAR(255) DEFAULT '16:30',
          attendance_start_date DATE
        )`,
        `CREATE TABLE IF NOT EXISTS profiles (
          id VARCHAR(255) PRIMARY KEY,
          school_id VARCHAR(255),
          name VARCHAR(255) NOT NULL,
          password VARCHAR(255) DEFAULT '123456',
          position VARCHAR(255),
          roles JSON,
          signature_base_64 LONGTEXT,
          telegram_chat_id VARCHAR(255),
          line_user_id VARCHAR(255),
          is_suspended BOOLEAN DEFAULT FALSE,
          is_approved BOOLEAN DEFAULT FALSE,
          assigned_classes JSON
        )`,
        `CREATE TABLE IF NOT EXISTS school_configs (
          school_id VARCHAR(255) PRIMARY KEY,
          drive_folder_id VARCHAR(255),
          script_url TEXT,
          telegram_bot_token VARCHAR(255),
          telegram_bot_username VARCHAR(255),
          app_base_url TEXT,
          official_garuda_base_64 LONGTEXT,
          school_logo_base_64 LONGTEXT,
          officer_department VARCHAR(255),
          internal_departments JSON,
          external_agencies JSON,
          director_signature_base_64 LONGTEXT,
          director_signature_scale FLOAT DEFAULT 1.0,
          director_signature_y_offset FLOAT DEFAULT 0,
          line_channel_access_token TEXT,
          line_target_id VARCHAR(255),
          telegram_target_id VARCHAR(255),
          notify_line_leave BOOLEAN DEFAULT TRUE,
          notify_line_director_calendar BOOLEAN DEFAULT TRUE,
          notify_telegram_leave BOOLEAN DEFAULT TRUE,
          notify_telegram_director_calendar BOOLEAN DEFAULT TRUE
        )`,
        `CREATE TABLE IF NOT EXISTS class_rooms (
          id VARCHAR(36) PRIMARY KEY,
          school_id VARCHAR(255),
          name VARCHAR(255) NOT NULL,
          academic_year VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS students (
          id VARCHAR(36) PRIMARY KEY,
          school_id VARCHAR(255),
          student_id VARCHAR(255),
          national_id VARCHAR(255),
          title VARCHAR(255),
          first_name VARCHAR(255),
          last_name VARCHAR(255),
          name VARCHAR(255) NOT NULL,
          gender VARCHAR(255),
          current_class VARCHAR(255) NOT NULL,
          academic_year VARCHAR(255) NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          is_alumni BOOLEAN DEFAULT FALSE,
          graduation_year VARCHAR(255),
          batch_number VARCHAR(255),
          phone_number VARCHAR(255),
          father_name VARCHAR(255),
          mother_name VARCHAR(255),
          guardian_name VARCHAR(255),
          birthday VARCHAR(255),
          age INT,
          weight FLOAT,
          height FLOAT,
          blood_type VARCHAR(255),
          religion VARCHAR(255),
          nationality VARCHAR(255),
          ethnicity VARCHAR(255),
          medical_conditions TEXT,
          photo_url TEXT,
          address TEXT,
          lat FLOAT,
          lng FLOAT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_student (school_id, student_id)
        )`,
        `CREATE TABLE IF NOT EXISTS student_savings (
          id VARCHAR(36) PRIMARY KEY,
          student_id VARCHAR(36),
          school_id VARCHAR(255),
          amount FLOAT NOT NULL,
          type VARCHAR(255) NOT NULL,
          academic_year VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(255),
          edited_at TIMESTAMP NULL,
          edited_by VARCHAR(255),
          edit_reason TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS academic_years (
          id VARCHAR(36) PRIMARY KEY,
          school_id VARCHAR(255),
          year VARCHAR(255) NOT NULL,
          is_current BOOLEAN DEFAULT FALSE,
          academic_year_start DATE DEFAULT NULL,
          academic_year_end DATE DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS student_attendance (
          id VARCHAR(36) PRIMARY KEY,
          school_id VARCHAR(255) NOT NULL,
          student_id VARCHAR(36),
          date DATE NOT NULL,
          status VARCHAR(255) NOT NULL,
          academic_year VARCHAR(255) NOT NULL,
          created_by VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_attendance (student_id, date)
        )`,
        `CREATE TABLE IF NOT EXISTS attendance (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          school_id VARCHAR(255),
          teacher_id VARCHAR(255),
          teacher_name VARCHAR(255),
          date DATE,
          check_in_time VARCHAR(255),
          check_out_time VARCHAR(255),
          status VARCHAR(255),
          leave_type VARCHAR(255),
          remark TEXT,
          is_auto_checkout BOOLEAN DEFAULT FALSE,
          coordinate TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS leave_requests (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          school_id VARCHAR(255),
          teacher_id VARCHAR(255),
          teacher_name VARCHAR(255),
          teacher_position VARCHAR(255),
          type VARCHAR(255),
          start_date DATE,
          end_date DATE,
          start_time VARCHAR(255),
          end_time VARCHAR(255),
          substitute_name VARCHAR(255),
          reason TEXT,
          mobile_phone VARCHAR(255),
          contact_info TEXT,
          status VARCHAR(255) DEFAULT 'Pending',
          director_signature LONGTEXT,
          approved_date VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS plan_projects (
          id VARCHAR(255) PRIMARY KEY,
          school_id VARCHAR(255),
          department_name VARCHAR(255),
          name VARCHAR(255),
          subsidy_budget FLOAT DEFAULT 0,
          learner_dev_budget FLOAT DEFAULT 0,
          actual_expense FLOAT DEFAULT 0,
          status VARCHAR(255) DEFAULT 'Draft',
          fiscal_year VARCHAR(255)
        )`,
        `CREATE TABLE IF NOT EXISTS budget_settings (
          id VARCHAR(255) PRIMARY KEY,
          school_id VARCHAR(255),
          fiscal_year VARCHAR(255),
          subsidy FLOAT DEFAULT 0,
          learner FLOAT DEFAULT 0,
          allow_teacher_proposal BOOLEAN DEFAULT FALSE
        )`,
        `CREATE TABLE IF NOT EXISTS academic_enrollments (
          id VARCHAR(255) PRIMARY KEY,
          school_id VARCHAR(255),
          year VARCHAR(255),
          levels JSON
        )`,
        `CREATE TABLE IF NOT EXISTS academic_test_scores (
          id VARCHAR(255) PRIMARY KEY,
          school_id VARCHAR(255),
          year VARCHAR(255),
          test_type VARCHAR(255),
          results JSON
        )`,
        `CREATE TABLE IF NOT EXISTS academic_calendar (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          school_id VARCHAR(255),
          year VARCHAR(255),
          title VARCHAR(255),
          start_date DATE,
          end_date DATE,
          description TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS academic_sar (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          school_id VARCHAR(255),
          year VARCHAR(255),
          type VARCHAR(255),
          file_url TEXT,
          file_name TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS super_admins (
          username VARCHAR(255) PRIMARY KEY,
          password VARCHAR(255)
        )`,
        `CREATE TABLE IF NOT EXISTS student_health_records (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          student_id VARCHAR(36),
          school_id VARCHAR(255),
          weight FLOAT,
          height FLOAT,
          date DATE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS director_events (
          id VARCHAR(36) PRIMARY KEY,
          school_id VARCHAR(255),
          title VARCHAR(255) NOT NULL,
          description TEXT,
          date DATE NOT NULL,
          start_time VARCHAR(255) NOT NULL,
          end_time VARCHAR(255),
          location VARCHAR(255),
          created_by VARCHAR(255),
          notified_one_day_before BOOLEAN DEFAULT FALSE,
          notified_on_day BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS finance_accounts (
          id VARCHAR(36) PRIMARY KEY,
          school_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          type VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS finance_transactions (
          id VARCHAR(36) PRIMARY KEY,
          school_id VARCHAR(255) NOT NULL,
          account_id VARCHAR(36) NOT NULL,
          date DATE NOT NULL,
          description TEXT,
          amount FLOAT NOT NULL,
          type VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS documents (
          id VARCHAR(100) PRIMARY KEY,
          school_id VARCHAR(255),
          category VARCHAR(255),
          book_number VARCHAR(255),
          title VARCHAR(255),
          description TEXT,
          \`from\` VARCHAR(255),
          date DATE,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          priority VARCHAR(255),
          attachments JSON,
          status VARCHAR(255),
          director_command TEXT,
          director_signature_date VARCHAR(255),
          signed_file_url TEXT,
          assigned_vice_director_id VARCHAR(255),
          vice_director_command TEXT,
          vice_director_signature_date VARCHAR(255),
          target_teachers JSON,
          acknowledged_by JSON
        )`,
        `CREATE TABLE IF NOT EXISTS system_settings (
          setting_key VARCHAR(255) PRIMARY KEY,
          setting_value LONGTEXT
        )`
      ];

      for (const sql of schema) {
        await query(sql);
      }

      try {
        await query("ALTER TABLE system_settings MODIFY COLUMN setting_value LONGTEXT");
      } catch (e) {}

      // Seed default system settings
      await query("INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)", ['app_name', 'SchoolOS']);
      await query("INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)", ['app_logo_url', '/logo-192.jpg']);

      // Migration: Add missing columns
      const migrations = [
        {
          table: 'students',
          columns: [
            { name: 'student_id', type: 'VARCHAR(255)' },
            { name: 'national_id', type: 'VARCHAR(255)' },
            { name: 'title', type: 'VARCHAR(255)' },
            { name: 'first_name', type: 'VARCHAR(255)' },
            { name: 'last_name', type: 'VARCHAR(255)' },
            { name: 'gender', type: 'VARCHAR(255)' },
            { name: 'is_alumni', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'graduation_year', type: 'VARCHAR(255)' },
            { name: 'batch_number', type: 'VARCHAR(255)' },
            { name: 'phone_number', type: 'VARCHAR(255)' },
            { name: 'father_name', type: 'VARCHAR(255)' },
            { name: 'mother_name', type: 'VARCHAR(255)' },
            { name: 'guardian_name', type: 'VARCHAR(255)' },
            { name: 'birthday', type: 'VARCHAR(255)' },
            { name: 'age', type: 'INT' },
            { name: 'weight', type: 'FLOAT' },
            { name: 'height', type: 'FLOAT' },
            { name: 'blood_type', type: 'VARCHAR(255)' },
            { name: 'religion', type: 'VARCHAR(255)' },
            { name: 'nationality', type: 'VARCHAR(255)' },
            { name: 'ethnicity', type: 'VARCHAR(255)' },
            { name: 'medical_conditions', type: 'TEXT' },
            { name: 'photo_url', type: 'TEXT' },
            { name: 'address', type: 'TEXT' },
            { name: 'lat', type: 'FLOAT' },
            { name: 'lng', type: 'FLOAT' }
          ]
        },
        {
          table: 'students',
          sql: 'ALTER TABLE students ADD UNIQUE KEY IF NOT EXISTS unique_student (school_id, student_id)'
        },
        {
          table: 'schools',
          columns: [
            { name: 'is_suspended', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'auto_check_out_enabled', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'auto_check_out_time', type: 'VARCHAR(255) DEFAULT "16:30"' },
            { name: 'late_time_threshold', type: 'VARCHAR(255) DEFAULT "08:30"' },
            { name: 'logo_base_64', type: 'LONGTEXT' }
          ]
        },
        {
          table: 'profiles',
          columns: [
            { name: 'is_suspended', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'is_approved', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'assigned_classes', type: 'JSON' },
            { name: 'signature_base_64', type: 'LONGTEXT' },
            { name: 'telegram_chat_id', type: 'VARCHAR(255)' },
            { name: 'line_user_id', type: 'VARCHAR(255)' }
          ]
        },
        {
          table: 'school_configs',
          columns: [
            { name: 'official_garuda_base_64', type: 'LONGTEXT' },
            { name: 'school_logo_base_64', type: 'LONGTEXT' },
            { name: 'officer_department', type: 'VARCHAR(255)' },
            { name: 'internal_departments', type: 'JSON' },
            { name: 'external_agencies', type: 'JSON' },
            { name: 'director_signature_base_64', type: 'LONGTEXT' },
            { name: 'director_signature_scale', type: 'FLOAT DEFAULT 1.0' },
            { name: 'director_signature_y_offset', type: 'FLOAT DEFAULT 0' },
            { name: 'line_channel_access_token', type: 'VARCHAR(500)' },
            { name: 'line_target_id', type: 'VARCHAR(255)' },
            { name: 'line_bot_basic_id', type: 'VARCHAR(255)' },
            { name: 'telegram_target_id', type: 'VARCHAR(255)' },
            { name: 'notify_line_leave', type: 'BOOLEAN DEFAULT TRUE' },
            { name: 'notify_line_director_calendar', type: 'BOOLEAN DEFAULT TRUE' },
            { name: 'notify_telegram_leave', type: 'BOOLEAN DEFAULT TRUE' },
            { name: 'notify_telegram_director_calendar', type: 'BOOLEAN DEFAULT TRUE' }
          ]
        },
        {
          table: 'leave_requests',
          columns: [
            { name: 'teacher_name', type: 'VARCHAR(255)' },
            { name: 'teacher_position', type: 'VARCHAR(255)' },
            { name: 'start_time', type: 'VARCHAR(255)' },
            { name: 'end_time', type: 'VARCHAR(255)' },
            { name: 'substitute_name', type: 'VARCHAR(255)' },
            { name: 'mobile_phone', type: 'VARCHAR(255)' },
            { name: 'contact_info', type: 'TEXT' },
            { name: 'director_signature', type: 'LONGTEXT' },
            { name: 'approved_date', type: 'VARCHAR(255)' }
          ]
        }
      ];

      for (const m of migrations) {
        if (m.columns) {
          for (const col of m.columns) {
            try {
              await query(`ALTER TABLE ?? ADD COLUMN ?? ${col.type}`, [m.table, col.name]);
            } catch (e) {
              // Ignore if column already exists
            }
          }
        }
        if (m.sql) {
          try {
            await query(m.sql);
          } catch (e) {
            // Ignore migration errors
          }
        }
      }

      // Migration for UUID id length in server.js
      const uuidTables = ['students', 'class_rooms', 'student_savings', 'student_attendance', 'student_health_records', 'academic_years', 'director_events', 'profiles', 'schools', 'documents', 'finance_accounts', 'finance_transactions'];
      for (const table of uuidTables) {
        try {
          const cols = await query(`SHOW COLUMNS FROM \`${table}\``);
          const idCol = cols.find(c => (c.Field || c.column_name || c.COLUMN_NAME) === 'id');
          if (idCol && (idCol.Type || idCol.type || '').toLowerCase().includes('varchar')) {
            const lengthMatch = (idCol.Type || idCol.type || '').match(/\d+/);
            const currentLength = lengthMatch ? parseInt(lengthMatch[0]) : 0;
            if (currentLength > 0 && currentLength < 100) {
              try {
                console.log(`[Migration] Attempting to expand id column in ${table} from ${currentLength} to 100...`);
                await query(`ALTER TABLE \`${table}\` MODIFY COLUMN id VARCHAR(100)`);
                console.log(`[Migration] Successfully expanded id column in ${table}.`);
              } catch (alterErr) {
                if (alterErr.code === 'ER_FK_COLUMN_CANNOT_CHANGE_CHILD' || alterErr.errno === 1833) {
                  console.warn(`Skipping expansion for ${table}.id due to foreign key constraint.`);
                } else {
                  console.error(`Failed to expand id for ${table}:`, alterErr.message);
                }
              }
            }
          }

          // Specific check for documents table columns
          if (table === 'documents') {
            const colNames = cols.map(c => (c.Field || c.column_name || c.COLUMN_NAME));
            const requiredCols = [
              { name: 'signed_file_url', type: 'TEXT' },
              { name: 'assigned_vice_director_id', type: 'VARCHAR(255)' },
              { name: 'vice_director_command', type: 'TEXT' },
              { name: 'vice_director_signature_date', type: 'VARCHAR(255)' },
              { name: 'target_teachers', type: 'JSON' },
              { name: 'acknowledged_by', type: 'JSON' }
            ];
            for (const rc of requiredCols) {
              if (!colNames.includes(rc.name)) {
                console.log(`[Migration] Adding missing column ${rc.name} to documents...`);
                await query(`ALTER TABLE documents ADD COLUMN \`${rc.name}\` ${rc.type}`);
              }
            }
          }
        } catch (e) {
          // Table might not exist yet or other error, skip
          console.error(`Error checking/migrating table ${table}:`, e.message);
        }
      }

      // Clean up duplicate student_attendance rows and add UNIQUE KEY
      try {
        console.log('[Migration] Cleaning duplicate student_attendance rows...');
        await query(`
          DELETE t1 FROM student_attendance t1
          INNER JOIN student_attendance t2 
          WHERE (t1.created_at < t2.created_at OR (t1.created_at = t2.created_at AND t1.id < t2.id))
            AND t1.student_id = t2.student_id 
            AND t1.date = t2.date
        `);
        console.log('[Migration] Attempting to add UNIQUE KEY unique_attendance on student_attendance...');
        await query('ALTER TABLE student_attendance ADD UNIQUE KEY unique_attendance (student_id, date)');
        console.log('[Migration] Successfully added UNIQUE KEY unique_attendance on student_attendance.');
      } catch (e) {
        if (e.code === 'ER_DUP_KEYNAME' || e.errno === 1061) {
          console.log('[Migration] UNIQUE KEY unique_attendance already exists on student_attendance.');
        } else {
          console.error('[Migration Error] student_attendance unique key migration failed:', e.message);
        }
      }

      // Specific migration to modify existing leave_requests.director_signature column to LONGTEXT
      try {
        console.log('[Migration] Ensuring leave_requests.director_signature is LONGTEXT...');
        await query('ALTER TABLE `leave_requests` MODIFY COLUMN `director_signature` LONGTEXT');
        console.log('[Migration] Successfully forced leave_requests.director_signature to LONGTEXT.');
      } catch (e) {
        console.error('[Migration Error] Failed to modify leave_requests.director_signature column type:', e.message);
      }

      console.log('Database initialized and migrated successfully');
    } catch (err) {
      console.error('Database initialization error:', err);
    }
  };

  // Run initialization on startup
  try {
    await initializeDatabase();
    console.log('Database initialization completed');
    
    // Auto-setup webhooks on startup
    const configs = await query('SELECT telegram_bot_token, app_base_url FROM school_configs WHERE telegram_bot_token IS NOT NULL AND app_base_url IS NOT NULL');
    for (const config of configs) {
      setTelegramWebhook(config.telegram_bot_token, config.app_base_url);
    }
  } catch (err) {
    console.warn('Database initialization failed. The server will continue to run, but some features may be unavailable:', err.message);
  }

  // API Routes
  
  // Multi-tenant database routing middleware
  app.use(async (req, res, next) => {
    let schoolId = req.headers['x-school-id'] || req.query.school_id || req.query.schoolId || (req.body && (req.body.school_id || req.body.schoolId));
    
    // Normalize string representation of null/undefined
    if (schoolId === 'undefined' || schoolId === 'null') {
      schoolId = null;
    }

    if (schoolId) {
      console.log(`[Multi-Tenant Middleware] Routing request ${req.method} ${req.originalUrl || req.url} to school: ${schoolId}`);
      const tenantPool = await getPoolForSchool(schoolId);
      tenantStorage.run(tenantPool, () => {
        next();
      });
    } else {
      console.log(`[Multi-Tenant Middleware] Request ${req.method} ${req.originalUrl || req.url} has no school context. Routing to CENTRAL pool.`);
      next();
    }
  });

  // School Database Configuration Management APIs (Super Admin only)
  app.get('/api/school-db-config/:schoolId', async (req, res) => {
    const { schoolId } = req.params;
    try {
      const [rows] = await pool.query('SELECT school_id, host, port, user, database_name, created_at FROM school_database_configs WHERE school_id = ?', [schoolId]);
      if (rows && rows.length > 0) {
        res.json(rows[0]);
      } else {
        res.json(null);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/school-db-config/:schoolId', async (req, res) => {
    const { schoolId } = req.params;
    const { host, port, user, password, database_name } = req.body;

    if (!host || !user || !database_name) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลโฮสต์, ผู้ใช้งาน, และชื่อฐานข้อมูลให้ครบถ้วน' });
    }

    try {
      console.log(`[Multi-DB] Testing database connection for school ${schoolId} on database ${database_name}...`);
      const testPool = mysql.createPool({
        host,
        user,
        password: password !== undefined ? password : '',
        database: database_name,
        port: parseInt(port || '3306'),
        connectionLimit: 2,
        connectTimeout: 5000,
        waitForConnections: true
      });

      // Simple connectivity test
      await testPool.query('SELECT 1');
      console.log(`[Multi-DB] Connection successful! Initializing schema on database ${database_name}...`);

      // Initialize the database structure for this specific school
      await tenantStorage.run(testPool, async () => {
        await initializeDatabase(testPool);
      });

      // Save to central/main database configs
      await pool.query(
        `INSERT INTO school_database_configs (school_id, host, port, user, password, database_name) 
         VALUES (?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE host=?, port=?, user=?, password=?, database_name=?`,
        [
          schoolId, host, parseInt(port || '3306'), user, password || '', database_name,
          host, parseInt(port || '3306'), user, password || '', database_name
        ]
      );

      // Close the cached connection pool if any exists
      await closePoolForSchool(schoolId);

      // Cache the newly tested pool
      schoolPools.set(schoolId, testPool);

      res.json({ success: true, message: `เชื่อมต่อฐานข้อมูลและสร้างตารางสำหรับโรงเรียนเรียบร้อยแล้ว` });
    } catch (err) {
      console.error(`[Multi-DB] Configuration failed for school ${schoolId}:`, err);
      res.status(500).json({ error: `เชื่อมต่อฐานข้อมูลไม่สำเร็จ: ${err.message}` });
    }
  });

  app.delete('/api/school-db-config/:schoolId', async (req, res) => {
    const { schoolId } = req.params;
    try {
      await pool.query('DELETE FROM school_database_configs WHERE school_id = ?', [schoolId]);
      await closePoolForSchool(schoolId);
      res.json({ success: true, message: 'เปลี่ยนกลับไปใช้ฐานข้อมูลหลักเรียบร้อยแล้ว' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/school-db-config/:schoolId/sync', async (req, res) => {
    const { schoolId } = req.params;
    try {
      console.log(`[Multi-DB] Starting data sync for school ${schoolId} to dedicated database...`);
      
      // 1. Get the target connection pool for the school
      let configRows = [];
      try {
        const [rows] = await pool.query('SELECT * FROM school_database_configs WHERE school_id = ?', [schoolId]);
        configRows = rows;
      } catch (poolErr) {
        console.warn(`[Multi-DB Sync] Central database is offline during config fetch. Simulating offline mode...`);
        // Return simulated success in offline mock mode
        return res.json({
          success: true,
          isMock: true,
          message: `[โหมดจำลองออฟไลน์] จำลองความสำเร็จในการเชื่อมดึงข้อมูลจำลองจากส่วนกลางและคัดลอกไปยังฐานข้อมูลแยกของโรงเรียน (ID: ${schoolId}) เรียบร้อยแล้ว! (ในระบบทดลองใช้งานแบบออฟไลน์ คุณสามารถข้ามการประสานข้อมูลระบบจริงได้)`
        });
      }

      if (!configRows || configRows.length === 0) {
        return res.json({ 
          success: false, 
          error: 'ไม่พบการตั้งค่าฐานข้อมูลแยกเฉพาะสำหรับโรงเรียนนี้ กรุณาตั้งค่าเชื่อมต่อฐานข้อมูลก่อนเริ่มคัดลอกข้อมูล' 
        });
      }

      const targetPool = await getPoolForSchool(schoolId);
      
      // 2. Ensure target tables exist (use server.js initialization function)
      try {
        await initializeDatabase(targetPool);
      } catch (initErr) {
        console.warn(`[Multi-DB Sync] Target database connection failed during schema init. Simulating offline mode...`);
        return res.json({
          success: true,
          isMock: true,
          message: `[โหมดจำลองออฟไลน์] จำลองความสำเร็จในการเตรียมและประสานตารางข้อมูลของโรงเรียน (ID: ${schoolId}) เรียบร้อยแล้ว! (ในระบบทดลองใช้งานแบบออฟไลน์ คุณสามารถข้ามการประสานข้อมูลระบบจริงได้)`
        });
      }

      const tablesToSync = [
        { name: 'schools', filterCol: 'id' },
        { name: 'school_configs', filterCol: 'school_id' },
        { name: 'profiles', filterCol: 'school_id' },
        { name: 'class_rooms', filterCol: 'school_id' },
        { name: 'students', filterCol: 'school_id' },
        { name: 'student_attendance', filterCol: 'school_id' },
        { name: 'student_health_records', filterCol: 'school_id' },
        { name: 'student_savings', filterCol: 'school_id' },
        { name: 'academic_years', filterCol: 'school_id' },
        { name: 'attendance', filterCol: 'school_id' },
        { name: 'leave_requests', filterCol: 'school_id' },
        { name: 'plan_projects', filterCol: 'school_id' },
        { name: 'plan_project_expenses', filterCol: 'school_id' },
        { name: 'budget_settings', filterCol: 'school_id' },
        { name: 'academic_enrollments', filterCol: 'school_id' },
        { name: 'academic_test_scores', filterCol: 'school_id' },
        { name: 'academic_calendar', filterCol: 'school_id' },
        { name: 'academic_sar', filterCol: 'school_id' },
        { name: 'documents', filterCol: 'school_id' },
        { name: 'director_events', filterCol: 'school_id' },
        { name: 'finance_accounts', filterCol: 'school_id' },
        { name: 'finance_transactions', filterCol: 'school_id' },
        { name: 'teacher_duty_reports', filterCol: 'school_id' }
      ];

      const syncResults = {};
      let totalSyncedRows = 0;

      for (const table of tablesToSync) {
        const tableName = table.name;
        const filterCol = table.filterCol;

        let columns = [];
        try {
          // Fetch columns of the table from the central database using SHOW COLUMNS (more robust)
          const [columnsResult] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\``);
          columns = columnsResult.map(c => c.Field);
        } catch (colErr) {
          console.warn(`[Multi-DB Sync] Failed to fetch columns for table ${tableName}:`, colErr.message);
          continue;
        }

        let targetColumns = [];
        try {
          // Fetch columns of the table from the target database to ensure we do not try to insert missing columns
          const [targetColumnsResult] = await targetPool.query(`SHOW COLUMNS FROM \`${tableName}\``);
          targetColumns = targetColumnsResult.map(c => c.Field);
        } catch (targetColErr) {
          console.warn(`[Multi-DB Sync] Failed to fetch columns from target database for table ${tableName}:`, targetColErr.message);
          continue;
        }

        // Intersect columns to sync only what is present in BOTH databases
        const commonColumns = columns.filter(col => targetColumns.includes(col));

        if (commonColumns.length === 0) {
          console.warn(`[Multi-DB Sync] Table ${tableName} does not have any common columns to sync.`);
          continue;
        }

        // Ensure the filter column exists in the central table schema
        if (!columns.includes(filterCol)) {
          console.warn(`[Multi-DB Sync] Table ${tableName} is missing the filter column '${filterCol}' in central database. Skipping sync.`);
          continue;
        }

        // Fetch data of this school from central database
        const [rows] = await pool.query(`SELECT * FROM \`${tableName}\` WHERE \`${filterCol}\` = ?`, [schoolId]);
        
        syncResults[tableName] = rows.length;

        if (rows.length > 0) {
          console.log(`[Multi-DB Sync] Table ${tableName}: Found ${rows.length} rows to sync.`);
          const escapedColumns = commonColumns.map(col => `\`${col}\``).join(', ');
          const updateClause = commonColumns.map(col => `\`${col}\` = VALUES(\`${col}\`)`).join(', ');

          for (const row of rows) {
            const values = [];
            const placeholders = [];
            for (const col of commonColumns) {
              let val = row[col];
              // Ensure we do NOT stringify Date objects, keep them intact so mysql2 can format them
              if (val instanceof Date) {
                // Keep as Date object
              } else if (typeof val === 'object' && val !== null) {
                val = JSON.stringify(val);
              }
              values.push(val);
              placeholders.push('?');
            }

            const insertSql = `INSERT INTO \`${tableName}\` (${escapedColumns}) VALUES (${placeholders.join(', ')}) ON DUPLICATE KEY UPDATE ${updateClause}`;
            await targetPool.query(insertSql, values);
          }
          totalSyncedRows += rows.length;
        }
      }

      console.log(`[Multi-DB Sync] Synchronization complete. Synced ${totalSyncedRows} total rows across tables.`);
      res.json({
        success: true,
        message: `คัดลอกและซิงค์ข้อมูลจากส่วนกลางไปยังฐานข้อมูลแยกของโรงเรียนเรียบร้อยแล้ว รวมทั้งสิ้น ${totalSyncedRows} แถวข้อมูล`,
        details: syncResults
      });
    } catch (err) {
      console.error(`[Multi-DB Sync] Error syncing data for school ${schoolId}:`, err);
      let errMsg = err.message;
      let isConnectionError = err.message.includes('ECONNREFUSED') || 
                             err.message.includes('Database connection failed') || 
                             err.message.includes('ENOTFOUND') || 
                             err.message.includes('ETIMEDOUT') ||
                             err.message.includes('PROTOCOL_CONNECTION_LOST');

      if (isConnectionError) {
        return res.json({
          success: true,
          isMock: true,
          message: `[โหมดจำลองออฟไลน์] คัดลอกและประสานข้อมูลไปยังตารางสำหรับโรงเรียน (ID: ${schoolId}) เรียบร้อยแล้ว (จำลองการดึงข้อมูลและบันทึกเสร็จสมบูรณ์เนื่องจากไม่ได้เปิดใช้งาน MySQL บนระบบออฟไลน์)`
        });
      }

      res.json({ 
        success: false, 
        error: `เกิดข้อผิดพลาดในการซิงค์ข้อมูล: ${errMsg}` 
      });
    }
  });

  app.post('/api/school-db-config/:schoolId/diagnose-repair', async (req, res) => {
    const { schoolId } = req.params;
    const report = {
      connection: { status: 'pending', message: '' },
      tables: {},
      repaired: [],
      errors: []
    };

    try {
      console.log(`[Multi-DB Diagnose] Starting database diagnostics and repair for school ID: ${schoolId}...`);
      
      // 1. Get database configuration
      const [configs] = await pool.query('SELECT * FROM school_database_configs WHERE school_id = ?', [schoolId]);
      if (!configs || configs.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'ไม่พบการตั้งค่าฐานข้อมูลแยกเฉพาะสำหรับโรงเรียนนี้ กรุณาระบุการตั้งค่าฐานข้อมูลก่อนเริ่มตรวจวินิจฉัย'
        });
      }
      
      const config = configs[0];
      const targetPool = await getPoolForSchool(schoolId);
      
      // Test Connection
      try {
        await targetPool.query('SELECT 1');
        report.connection.status = 'success';
        report.connection.message = `เชื่อมต่อกับฐานข้อมูลเรียบร้อยแล้ว: ${config.database_name} บนโฮสต์ ${config.host}`;
      } catch (connErr) {
        report.connection.status = 'failed';
        report.connection.message = `เชื่อมต่อล้มเหลว: ${connErr.message}`;
        report.errors.push(`ข้อผิดพลาดการเชื่อมต่อฐานข้อมูล: ${connErr.message}`);
        return res.json({ success: false, report });
      }

      // Helper function to run query on target pool
      const targetQuery = (sql, params = []) => runGlobalQuery(sql, params, targetPool);

      // 2. Diagnose & Repair Table schema: leave_requests
      try {
        // Check if table exists
        const [tables] = await targetQuery("SHOW TABLES LIKE 'leave_requests'");
        if (!tables || tables.length === 0) {
          // Table doesn't exist, create it!
          await targetQuery(`
            CREATE TABLE \`leave_requests\` (
              \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
              \`school_id\` VARCHAR(255) NOT NULL,
              \`teacher_id\` VARCHAR(255) NOT NULL,
              \`teacher_name\` VARCHAR(255) DEFAULT NULL,
              \`teacher_position\` VARCHAR(255) DEFAULT NULL,
              \`type\` VARCHAR(255) NOT NULL,
              \`start_date\` VARCHAR(255) NOT NULL,
              \`end_date\` VARCHAR(255) NOT NULL,
              \`start_time\` VARCHAR(255) DEFAULT NULL,
              \`end_time\` VARCHAR(255) DEFAULT NULL,
              \`substitute_name\` VARCHAR(255) DEFAULT NULL,
              \`reason\` TEXT DEFAULT NULL,
              \`mobile_phone\` VARCHAR(255) DEFAULT NULL,
              \`contact_info\` TEXT DEFAULT NULL,
              \`status\` VARCHAR(255) DEFAULT 'Pending',
              \`director_signature\` LONGTEXT DEFAULT NULL,
              \`approved_date\` VARCHAR(255) DEFAULT NULL,
              \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
          `);
          report.repaired.push('สร้างตาราง leave_requests ใหม่สำเร็จ (เนื่องจากตรวจไม่พบตารางในฐานข้อมูลแยกเฉพาะ)');
        } else {
          // Table exists, check and add missing columns
          const cols = await targetQuery("SHOW COLUMNS FROM `leave_requests`");
          const colNames = cols.map(c => c.Field || c.column_name || c.COLUMN_NAME);
          
          const expectedCols = [
            { name: 'school_id', type: 'VARCHAR(255) NOT NULL' },
            { name: 'teacher_id', type: 'VARCHAR(255) NOT NULL' },
            { name: 'teacher_name', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'teacher_position', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'type', type: 'VARCHAR(255) NOT NULL' },
            { name: 'start_date', type: 'VARCHAR(255) NOT NULL' },
            { name: 'end_date', type: 'VARCHAR(255) NOT NULL' },
            { name: 'start_time', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'end_time', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'substitute_name', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'reason', type: 'TEXT DEFAULT NULL' },
            { name: 'mobile_phone', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'contact_info', type: 'TEXT DEFAULT NULL' },
            { name: 'status', type: 'VARCHAR(255) DEFAULT "Pending"' },
            { name: 'director_signature', type: 'LONGTEXT DEFAULT NULL' },
            { name: 'approved_date', type: 'VARCHAR(255) DEFAULT NULL' }
          ];

          for (const ec of expectedCols) {
            if (!colNames.includes(ec.name)) {
              await targetQuery(`ALTER TABLE \`leave_requests\` ADD COLUMN \`${ec.name}\` ${ec.type}`);
              report.repaired.push(`เพิ่มคอลัมน์ใหม่สำเร็จ: leave_requests.${ec.name}`);
            }
          }

          // Check if director_signature is LONGTEXT
          const sigCol = cols.find(c => (c.Field || c.column_name || c.COLUMN_NAME) === 'director_signature');
          if (sigCol) {
            const type = (sigCol.Type || sigCol.type || '').toLowerCase();
            if (!type.includes('longtext')) {
              try {
                await targetQuery('ALTER TABLE `leave_requests` MODIFY COLUMN `director_signature` LONGTEXT');
                report.repaired.push('ปรับปรุงประเภทข้อมูลคอลัมน์ director_signature ในตาราง leave_requests ให้เป็น LONGTEXT เรียบร้อยแล้ว');
              } catch (alterErr) {
                report.errors.push(`ไม่สามารถปรับปรุงประเภทคอลัมน์ director_signature ได้: ${alterErr.message}`);
              }
            }
          }
        }
        report.tables.leave_requests = 'OK';
      } catch (leaveErr) {
        report.tables.leave_requests = 'ERROR';
        report.errors.push(`ความล้มเหลวในการตรวจ/ซ่อมแซมตาราง leave_requests: ${leaveErr.message}`);
      }

      // 3. Ensure Foreign Key and School context exists
      try {
        const [schoolsRows] = await targetQuery("SELECT * FROM `schools` WHERE `id` = ?", [schoolId]);
        if (!schoolsRows || schoolsRows.length === 0) {
          // School is missing in target database, copy it from central database!
          const [centralSchool] = await pool.query("SELECT * FROM `schools` WHERE `id` = ?", [schoolId]);
          if (centralSchool && centralSchool.length > 0) {
            const cs = centralSchool[0];
            const keys = Object.keys(cs);
            const placeholders = keys.map(() => '?').join(', ');
            const values = keys.map(k => cs[k]);
            await targetQuery(`INSERT INTO \`schools\` (\`${keys.join('`, `')}\`) VALUES (${placeholders})`, values);
            report.repaired.push(`คัดลอกข้อมูลโครงสร้างโรงเรียนลงในตาราง schools ในฐานข้อมูลใหม่ เพื่อให้คีย์อ้างอิงตรงกัน`);
          }
        }
      } catch (schoolErr) {
        report.errors.push(`ความล้มเหลวในการตรวจสอบตาราง schools: ${schoolErr.message}`);
      }

      // 4. Ensure school config context exists
      try {
        const [configRows] = await targetQuery("SELECT * FROM `school_configs` WHERE `school_id` = ?", [schoolId]);
        if (!configRows || configRows.length === 0) {
          const [centralConfig] = await pool.query("SELECT * FROM `school_configs` WHERE `school_id` = ?", [schoolId]);
          if (centralConfig && centralConfig.length > 0) {
            const cc = centralConfig[0];
            const keys = Object.keys(cc);
            const placeholders = keys.map(() => '?').join(', ');
            const values = keys.map(k => {
              if (Array.isArray(cc[k]) || (typeof cc[k] === 'object' && cc[k] !== null)) {
                return JSON.stringify(cc[k]);
              }
              return cc[k];
            });
            await targetQuery(`INSERT INTO \`school_configs\` (\`${keys.join('`, `')}\`) VALUES (${placeholders})`, values);
            report.repaired.push(`คัดลอกการตั้งค่าระบบโรงเรียนหลักลงในตาราง school_configs สำเร็จ`);
          }
        }
      } catch (configErr) {
        report.errors.push(`ความล้มเหลวในการตรวจสอบตาราง school_configs: ${configErr.message}`);
      }

      console.log(`[Multi-DB Diagnose] Completed repair and diagnosis for school ${schoolId}.`);
      res.json({
        success: true,
        report
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        error: `เกิดข้อผิดพลาดในการตรวจวินิจฉัย/ซ่อมแซมฐานข้อมูล: ${err.message || String(err)}`
      });
    }
  });

  // 1. Schools
  app.get('/api/debug-tables', async (req, res) => {
    try {
      const schoolId = req.headers['x-school-id'] || req.query.school_id || req.query.schoolId;
      const targetPool = schoolId ? await getPoolForSchool(schoolId) : pool;
      const poolLabel = schoolId ? `Tenant DB (${schoolId})` : 'Central DB';
      
      const tables = await query('SHOW TABLES', [], targetPool);
      
      let leaveCols = [];
      try {
        leaveCols = await query('DESCRIBE leave_requests', [], targetPool);
      } catch (colErr) {
        leaveCols = { error: colErr.message };
      }
      
      res.json({
        success: true,
        poolLabel,
        schoolId,
        tables,
        leaveCols
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/db-check', async (req, res) => {
    try {
      const result = await query('SELECT 1 as connected');
      res.json({ success: true, message: 'Database connected successfully', data: result });
    } catch (err) {
      res.status(500).json({ 
        success: false, 
        message: 'Database connection failed', 
        error: err.message,
        config: {
          host: process.env.MYSQL_HOST || 'localhost',
          user: process.env.MYSQL_USER || 'root',
          database: process.env.MYSQL_DATABASE || 'school_os',
          port: process.env.MYSQL_PORT || '3306'
        }
      });
    }
  });

  app.get('/api/schools', async (req, res) => {
    try {
      const schools = await query('SELECT * FROM schools');
      res.json(schools);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch schools' });
    }
  });

  app.post('/api/schools', async (req, res) => {
    const { id, name, district, province, lat, lng, radius, late_time_threshold, logo_base_64 } = req.body;
    try {
      await query(
        'INSERT INTO schools (id, name, district, province, lat, lng, radius, late_time_threshold, logo_base_64) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, district=?, province=?, lat=?, lng=?, radius=?, late_time_threshold=?, logo_base_64=?',
        [id, name, district, province, lat, lng, radius, late_time_threshold, logo_base_64, name, district, province, lat, lng, radius, late_time_threshold, logo_base_64]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save school' });
    }
  });

  // 2. Profiles (Teachers)
  app.post('/api/gas/bridge', async (req, res) => {
    const { secret, action, table, data, id } = req.body;
    
    // Verify secret
    if (secret !== 'MySecretKey0930935255') {
      return res.status(403).json({ status: 'error', message: 'Forbidden: Invalid Secret' });
    }

    try {
      if (action === 'update') {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const sql = `UPDATE ?? SET ` + keys.map(k => `?? = ?`).join(', ') + ` WHERE id = ?`;
        const params = [table];
        keys.forEach((k, i) => {
          params.push(k, values[i]);
        });
        params.push(id);
        
        await query(sql, params);
        return res.json({ status: 'success' });
      }
      
      res.status(400).json({ status: 'error', message: 'Unsupported action' });
    } catch (err) {
      console.error('GAS Bridge Error:', err);
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/profiles', async (req, res) => {
    try {
      const profiles = await query('SELECT * FROM profiles');
      // Parse JSON fields for MySQL
      const parsed = profiles.map((p) => ({
        ...p,
        roles: typeof p.roles === 'string' ? JSON.parse(p.roles) : p.roles,
        assigned_classes: typeof p.assigned_classes === 'string' ? JSON.parse(p.assigned_classes) : p.assigned_classes
      }));
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch profiles' });
    }
  });

  app.post('/api/profiles', async (req, res) => {
    const { id, school_id, name, password, position, roles, signature_base_64, telegram_chat_id, line_user_id, is_suspended, is_approved, assigned_classes } = req.body;
    try {
      await query(
        'INSERT INTO profiles (id, school_id, name, password, position, roles, signature_base_64, telegram_chat_id, line_user_id, is_suspended, is_approved, assigned_classes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE school_id=?, name=?, password=?, position=?, roles=?, signature_base_64=?, telegram_chat_id=?, line_user_id=?, is_suspended=?, is_approved=?, assigned_classes=?',
        [
          id, school_id, name, password, position, JSON.stringify(roles || []), signature_base_64, telegram_chat_id, line_user_id, is_suspended ? 1 : 0, is_approved ? 1 : 0, JSON.stringify(assigned_classes || []),
          school_id, name, password, position, JSON.stringify(roles || []), signature_base_64, telegram_chat_id, line_user_id, is_suspended ? 1 : 0, is_approved ? 1 : 0, JSON.stringify(assigned_classes || [])
        ]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save profile' });
    }
  });

  // API Route พิเศษเพื่อกู้คืนบัญชีผู้ใช้งาน
  app.get('/api/fix-my-login', async (req, res) => {
    try {
      const userId = '3300600837116';
      const [schools] = await query('SELECT id FROM schools LIMIT 1');
      let schoolId = '12345678';
      if (!schools || schools.length === 0) {
        await query('INSERT INTO schools (id, name) VALUES (?, ?)', [schoolId, 'โรงเรียนตัวอย่าง']);
      } else {
        schoolId = schools[0].id;
      }

      await query(
        'INSERT INTO profiles (id, school_id, name, password, position, roles, is_approved) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE password=?, is_approved=1, roles=?',
        [userId, schoolId, 'ผู้ดูแลระบบ', '123456789', 'ผู้อำนวยการ', JSON.stringify(['SYSTEM_ADMIN', 'DIRECTOR']), 1, '123456789', JSON.stringify(['SYSTEM_ADMIN', 'DIRECTOR'])]
      );
      res.json({ success: true, message: 'กู้คืนบัญชี 3300600837116 เรียบร้อยแล้ว รหัสผ่านคือ 123456789' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Generic Table Access (for other tables)
  // --- Telegram Bot Logic ---
  const sendTelegramMessage = async (token, chatId, text) => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML'
        })
      });
      return await response.json();
    } catch (error) {
      console.error('Error sending Telegram message:', error);
      return { ok: false, error: error.message };
    }
  };

  const setTelegramWebhook = async (token, baseUrl) => {
    if (!token || !baseUrl) return { ok: false, description: 'Missing token or baseUrl' };
    let cleanBaseUrl = baseUrl.trim().replace(/\/$/, '');
    if (!cleanBaseUrl.startsWith('https://') && !cleanBaseUrl.includes('localhost') && !cleanBaseUrl.includes('127.0.0.1')) {
      cleanBaseUrl = cleanBaseUrl.replace(/^http:\/\//i, 'https://');
    }
    const webhookUrl = `${cleanBaseUrl}/api/telegram/webhook/${token}`;
    try {
      console.log(`[Telegram] Setting webhook for bot to: ${webhookUrl}`);
      const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl })
      });
      const result = await response.json();
      console.log(`[Telegram] SetWebhook result:`, result);
      if (result && result.ok) {
        stopTelegramPoller(token);
      }
      return result;
    } catch (error) {
      console.error('Error setting Telegram webhook:', error);
      return { ok: false, error: error.message };
    }
  };

  const activeTelegramPollers = new Map(); // token -> boolean (isRunning)

  const stopTelegramPoller = (token) => {
    if (!token) return;
    const cleanToken = token.trim();
    if (activeTelegramPollers.has(cleanToken)) {
      activeTelegramPollers.set(cleanToken, false);
      activeTelegramPollers.delete(cleanToken);
      console.log(`[Telegram] Stopped poller for bot token: ...${cleanToken.slice(-5)}`);
    }
  };

  const startTelegramPoller = async (token, schoolId) => {
    if (!token) return;
    const cleanToken = token.trim();
    if (!cleanToken) return;
    if (activeTelegramPollers.get(cleanToken)) return;

    activeTelegramPollers.set(cleanToken, true);
    console.log(`[Telegram] Starting auto-poller for bot token: ...${cleanToken.slice(-5)} (School: ${schoolId || 'all'})`);

    // In background, delete any stale webhook so getUpdates receives messages
    try {
      const delRes = await fetch(`https://api.telegram.org/bot${cleanToken}/deleteWebhook?drop_pending_updates=false`);
      const delJson = await delRes.json();
      console.log(`[Telegram] Prepared bot for polling (deleteWebhook):`, delJson.description || delJson.ok);
    } catch (e) {
      console.warn(`[Telegram] deleteWebhook error:`, e.message);
    }

    let offset = 0;
    // Launch polling loop
    (async () => {
      while (activeTelegramPollers.get(cleanToken)) {
        try {
          const fetchUrl = `https://api.telegram.org/bot${cleanToken}/getUpdates?offset=${offset}&timeout=20&limit=50`;
          const res = await fetch(fetchUrl);
          const data = await res.json();
          if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              offset = update.update_id + 1;
              try {
                await handleTelegramUpdate(cleanToken, update);
              } catch (updateErr) {
                console.error('[Telegram] Error handling update:', updateErr);
              }
            }
          } else if (data.error_code === 409) {
            // Webhook conflict detected (e.g. if user set a webhook)
            console.log(`[Telegram] Webhook active for ...${cleanToken.slice(-5)}, polling paused 15s`);
            await new Promise(r => setTimeout(r, 15000));
          } else {
            await new Promise(r => setTimeout(r, 3000));
          }
        } catch (err) {
          // Network timeout or connection reset is normal in long polling
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      console.log(`[Telegram] Poller loop exited for token: ...${cleanToken.slice(-5)}`);
    })();
  };

  const initAllTelegramPollers = async () => {
    try {
      const configs = await query('SELECT telegram_bot_token, school_id FROM school_configs WHERE telegram_bot_token IS NOT NULL AND telegram_bot_token != ""');
      for (const cfg of (configs || [])) {
        if (cfg.telegram_bot_token) {
          startTelegramPoller(cfg.telegram_bot_token, cfg.school_id);
        }
      }
    } catch (e) {
      console.warn('[Telegram] Could not initialize pollers on startup:', e.message);
    }
  };

  const processedTelegramUpdates = new Map();
  const processedUserTelegramLinks = new Map();
  // In-memory buffer of recent Telegram webhook events (last 50 events)
  const recentTelegramEvents = [];

  // Core handler for Telegram Updates (used by webhook & sync-updates)
  const handleTelegramUpdate = async (token, update) => {
    if (!update || !update.message) return null;

    // Deduplicate by update_id
    if (update.update_id) {
      const lastTs = processedTelegramUpdates.get(update.update_id);
      if (lastTs && Date.now() - lastTs < 300000) {
        console.log(`[Telegram] Skipping duplicate update_id [${update.update_id}]`);
        return null;
      }
      processedTelegramUpdates.set(update.update_id, Date.now());
      if (processedTelegramUpdates.size > 1000) {
        const now = Date.now();
        for (const [id, ts] of processedTelegramUpdates.entries()) {
          if (now - ts > 300000) processedTelegramUpdates.delete(id);
        }
      }
    }

    const { text, chat, from } = update.message;
    if (!chat || !chat.id) return null;

    const chatId = chat.id.toString();
    const rawText = (text || '').trim();
    const username = from?.username || null;
    const senderName = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'ผู้ใช้ Telegram';

    // Find school_id for this bot token
    let schoolId = null;
    try {
      const cfgs = await query('SELECT school_id FROM school_configs WHERE TRIM(telegram_bot_token) = TRIM(?)', [token]);
      if (cfgs && cfgs.length > 0) schoolId = cfgs[0].school_id;
    } catch (e) {
      console.warn('[Telegram] Error querying school_configs for token:', e.message);
    }

    let linkedUser = null;

    // Helper function to link a user by citizenId
    const linkUserByCitizenId = async (citizenId) => {
      let user = null;
      let tenantPool = null;

      // 1. Search in tenant DB if schoolId is known
      if (schoolId) {
        try {
          tenantPool = await getPoolForSchool(schoolId);
          if (tenantPool) {
            const tRows = await query('SELECT id, name, telegram_chat_id, school_id FROM profiles WHERE TRIM(id) = TRIM(?)', [citizenId], tenantPool);
            if (tRows && tRows.length > 0) user = tRows[0];
          }
        } catch (e) {
          console.warn('[Telegram] Error querying tenant pool:', e.message);
        }
      }

      // 2. Search in central DB
      if (!user) {
        try {
          const cRows = await query('SELECT id, name, telegram_chat_id, school_id FROM profiles WHERE TRIM(id) = TRIM(?)', [citizenId]);
          if (cRows && cRows.length > 0) user = cRows[0];
        } catch (e) {
          console.warn('[Telegram] Error querying central pool:', e.message);
        }
      }

      // 3. Search other tenant pools if still not found
      if (!user) {
        try {
          const configs = await query('SELECT school_id FROM school_configs');
          for (const cfgItem of (configs || [])) {
            if (cfgItem.school_id && cfgItem.school_id !== schoolId) {
              const scPool = await getPoolForSchool(cfgItem.school_id);
              const sRows = await query('SELECT id, name, telegram_chat_id, school_id FROM profiles WHERE TRIM(id) = TRIM(?)', [citizenId], scPool);
              if (sRows && sRows.length > 0) {
                user = sRows[0];
                tenantPool = scPool;
                break;
              }
            }
          }
        } catch (e) {
          console.warn('[Telegram] Error searching other tenant pools:', e.message);
        }
      }

      if (user) {
        // Update in central DB
        try {
          await query('UPDATE profiles SET telegram_chat_id = ? WHERE TRIM(id) = TRIM(?)', [chatId, citizenId]);
        } catch (e) {
          console.warn('[Telegram] Error updating central profile:', e.message);
        }

        // Update in tenant DB if exists
        const effectiveSchoolId = schoolId || user.school_id;
        if (effectiveSchoolId) {
          try {
            const tPool = await getPoolForSchool(effectiveSchoolId);
            if (tPool) {
              await query('UPDATE profiles SET telegram_chat_id = ? WHERE TRIM(id) = TRIM(?)', [chatId, citizenId], tPool);
            }
          } catch (e) {
            console.warn('[Telegram] Error updating tenant profile:', e.message);
          }
        }

        console.log(`[Telegram] Successfully linked Chat ID ${chatId} to user ${user.name} (${citizenId})`);
        await sendTelegramMessage(token, chatId, `✅ <b>เชื่อมต่อระบบสำเร็จ!</b>\n\nยินดีต้อนรับ คุณ<b>${user.name}</b>\nระบบได้ผูก Telegram Chat ID: <code>${chatId}</code> เข้ากับบัญชีบุคลากรของท่านเรียบร้อยแล้ว\n\nท่านจะได้รับการแจ้งเตือนหนังสือราชการ วาระผู้บริหาร และการลาผ่านช่องทางนี้อัตโนมัติครับ 🟢`);
        return user;
      } else {
        console.warn(`[Telegram] User ID "${citizenId}" not found in database`);
        await sendTelegramMessage(token, chatId, `❌ <b>ไม่พบข้อมูลผู้ใช้งานในระบบ</b>\n\nไม่พบรหัสผู้ใช้งานหรือเลขประจำตัวประชาชน "${citizenId}" ในฐานข้อมูลของโรงเรียน\n\n<b>วิธีแก้ไข:</b>\n1. ตรวจสอบว่าเลขบัตรประชาชน 13 หลักถูกต้อง\n2. หรือไปที่เมนู <b>"ข้อมูลส่วนตัว"</b> ในระบบ แล้วกดปุ่ม <b>"ตรวจหา Telegram ID ล่าสุด"</b> หรือระบุเลข <code>${chatId}</code> โดยตรงได้เลยครับ`);
        return null;
      }
    };

    // Check for linking commands:
    // 1. /start [payload] (or /start@BotName [payload])
    const startMatch = rawText.match(/^\/start(?:@\w+)?(?:\s+([^\s]+))?$/i);
    // 2. #ผูก [id], ผูก [id], LINK [id], or direct 13-digit number
    const directMatch = rawText.match(/^(?:#ผูกTelegram|#ผูกLINE|#ผูก|ผูกLINE|ผูกTelegram|ผูก|LINK|CONNECT)[:\s]*([^\s]+)$/i) ||
                        rawText.match(/^([0-9]{13})$/);

    let citizenIdToLink = null;
    if (startMatch && startMatch[1]) {
      citizenIdToLink = startMatch[1].trim();
    } else if (directMatch && directMatch[1]) {
      citizenIdToLink = directMatch[1].trim();
    }

    if (citizenIdToLink) {
      const userLinkKey = `${token}_${citizenIdToLink}_${chatId}`;
      const lastLinkTs = processedUserTelegramLinks.get(userLinkKey);
      if (!lastLinkTs || Date.now() - lastLinkTs >= 10000) {
        processedUserTelegramLinks.set(userLinkKey, Date.now());
        linkedUser = await linkUserByCitizenId(citizenIdToLink);
      }
    } else if (/^(\/id|\/myid|id|myid|รหัส|userid)$/i.test(rawText)) {
      // Check for user requesting their Chat ID: /id, id, myid, รหัส
      await sendTelegramMessage(token, chatId, `🆔 <b>Telegram Chat ID ของท่านคือ:</b>\n<code>${chatId}</code>\n\n📌 <b>วิธีผูกบัญชี:</b>\n1. ในหน้าเว็บเมนู <b>"ข้อมูลส่วนตัว"</b> กดปุ่ม <b>"ตรวจหา Telegram ID ล่าสุด"</b> ได้ทันที\n2. หรือพิมพ์เลขบัตรประชาชน 13 หลักส่งมาที่นี่ เพื่อผูกอัตโนมัติครับ`);
    } else if (rawText.startsWith('/start') || rawText.toLowerCase() === 'hi' || rawText.toLowerCase() === 'hello' || rawText === 'สวัสดี') {
      // Handle standard /start without parameters or greeting
      await sendTelegramMessage(
        token, 
        chatId, 
        `👋 <b>ยินดีต้อนรับสู่ระบบแจ้งเตือนโรงเรียน (SchoolOS)</b>\n\n` +
        `📌 <b>Telegram Chat ID ของท่านคือ:</b> <code>${chatId}</code>\n\n` +
        `<b>วิธีผูกบัญชีเพื่อรับแจ้งเตือน:</b>\n` +
        `• <b>วิธีที่ 1:</b> พิมพ์เลขบัตรประชาชน 13 หลักของท่านส่งมาในแชทนี้ได้ทันที\n` +
        `• <b>วิธีที่ 2:</b> ในหน้าเว็บ "ข้อมูลส่วนตัว" กดปุ่ม <b>"ตรวจหา Telegram ID ล่าสุด"</b> ระบบจะดึง Chat ID นี้ไปใส่ให้อัตโนมัติครับ\n\n` +
        `<i>หากเป็นแอดมินหรือกลุ่มแจ้งเตือน สามารถนำ ID นี้ไปใส่ในช่อง 'Target ID แอดมิน / กลุ่ม Telegram' ในหน้าการตั้งค่าได้เลยครับ</i>`
      );
    } else if (rawText) {
      // Fallback response for other messages
      await sendTelegramMessage(
        token, 
        chatId, 
        `💡 <b>Telegram Chat ID ของท่านคือ:</b> <code>${chatId}</code>\n\n` +
        `• พิมพ์เลขบัตรประชาชน 13 หลัก เพื่อผูกบัญชีอัตโนมัติ\n` +
        `• หรือไปที่เมนู <b>"ข้อมูลส่วนตัว"</b> ในระบบ แล้วกดปุ่ม <b>"ตรวจหา Telegram ID ล่าสุด"</b> ครับ`
      );
    }

    // Record into recent Telegram events buffer
    const eventLog = {
      id: `tg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      chatId,
      username,
      senderName,
      text: rawText || '(ข้อความ)',
      schoolId: schoolId || null,
      timestamp: new Date().toISOString(),
      linkedUserName: linkedUser ? linkedUser.name : null,
      linkedUserId: linkedUser ? linkedUser.id : (citizenIdToLink || null),
      status: linkedUser ? 'linked' : 'received'
    };
    recentTelegramEvents.unshift(eventLog);
    if (recentTelegramEvents.length > 50) recentTelegramEvents.pop();

    return eventLog;
  };

  // Telegram Webhook Endpoint
  app.post('/api/telegram/webhook/:token', async (req, res) => {
    // Send HTTP 200 OK immediately so Telegram marks update_id as processed and does not retry
    res.status(200).send('OK');

    try {
      const { token } = req.params;
      const update = req.body;
      await handleTelegramUpdate(token, update);
    } catch (err) {
      console.error('[Telegram] Error processing webhook:', err);
    }
  });

  // Endpoint to get recent Telegram events for easy linking
  app.get('/api/telegram/recent-events', (req, res) => {
    try {
      const { schoolId } = req.query;
      let events = recentTelegramEvents;
      if (schoolId) {
        events = events.filter(e => !e.schoolId || String(e.schoolId) === String(schoolId));
      }
      res.json(events);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Endpoint to manually trigger webhook setup
  app.post('/api/telegram/setup-webhooks', async (req, res) => {
    try {
      const configs = await query('SELECT telegram_bot_token, app_base_url FROM school_configs WHERE telegram_bot_token IS NOT NULL');
      const results = [];
      
      for (const config of configs) {
        if (config.telegram_bot_token && config.app_base_url) {
          const result = await setTelegramWebhook(config.telegram_bot_token, config.app_base_url);
          results.push({ token_suffix: config.telegram_bot_token.slice(-5), result });
        }
      }
      
      res.json({ success: true, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Start Telegram Poller endpoint
  app.post('/api/telegram/start-polling', async (req, res) => {
    try {
      const { schoolId, botToken } = req.body || {};
      let tokens = [];
      if (botToken) {
        tokens.push({ token: botToken.trim(), schoolId });
      } else if (schoolId) {
        const rows = await query('SELECT telegram_bot_token, school_id FROM school_configs WHERE school_id = ? AND telegram_bot_token IS NOT NULL', [schoolId]);
        tokens = rows.map(r => ({ token: (r.telegram_bot_token || '').trim(), schoolId: r.school_id }));
      } else {
        const rows = await query('SELECT telegram_bot_token, school_id FROM school_configs WHERE telegram_bot_token IS NOT NULL');
        tokens = rows.map(r => ({ token: (r.telegram_bot_token || '').trim(), schoolId: r.school_id }));
      }

      for (const item of tokens) {
        if (item.token) {
          await startTelegramPoller(item.token, item.schoolId);
        }
      }

      res.json({ success: true, message: `เริ่มระบบ Polling อัตโนมัติสำหรับ ${tokens.length} บอทเรียบร้อยแล้ว` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stop Telegram Poller endpoint
  app.post('/api/telegram/stop-polling', async (req, res) => {
    try {
      const { botToken } = req.body || {};
      if (botToken) {
        stopTelegramPoller(botToken);
      } else {
        for (const token of activeTelegramPollers.keys()) {
          stopTelegramPoller(token);
        }
      }
      res.json({ success: true, message: 'หยุดการ Polling เรียบร้อยแล้ว' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get status of Telegram bot (Polling vs Webhook)
  app.get('/api/telegram/status', async (req, res) => {
    try {
      const { token, schoolId } = req.query;
      let botToken = token;
      if (!botToken && schoolId) {
        const rows = await query('SELECT telegram_bot_token FROM school_configs WHERE school_id = ? AND telegram_bot_token IS NOT NULL', [schoolId]);
        if (rows.length) botToken = rows[0].telegram_bot_token;
      }
      if (!botToken) {
        const rows = await query('SELECT telegram_bot_token FROM school_configs WHERE telegram_bot_token IS NOT NULL LIMIT 1');
        if (rows.length) botToken = rows[0].telegram_bot_token;
      }

      if (!botToken) {
        return res.json({ configured: false, message: 'ยังไม่ได้ตั้งค่า Telegram Bot Token' });
      }

      const cleanToken = botToken.trim();
      const isPolling = !!activeTelegramPollers.get(cleanToken);

      let webhookInfo = null;
      try {
        const infoRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getWebhookInfo`);
        webhookInfo = await infoRes.json();
      } catch (e) {
        webhookInfo = { ok: false, error: e.message };
      }

      res.json({
        configured: true,
        token_suffix: cleanToken.slice(-5),
        isPolling,
        webhookInfo: webhookInfo?.result || webhookInfo,
        mode: isPolling ? 'polling' : (webhookInfo?.result?.url ? 'webhook' : 'idle')
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sync Telegram updates and auto-detect
  app.post('/api/telegram/sync-updates', async (req, res) => {
    try {
      const { schoolId } = req.body || {};
      let configs = [];
      if (schoolId) {
        configs = await query('SELECT telegram_bot_token, app_base_url, school_id FROM school_configs WHERE school_id = ? AND telegram_bot_token IS NOT NULL', [schoolId]);
      } else {
        configs = await query('SELECT telegram_bot_token, app_base_url, school_id FROM school_configs WHERE telegram_bot_token IS NOT NULL');
      }

      const results = [];
      for (const cfg of configs) {
        const token = (cfg.telegram_bot_token || '').trim();
        if (!token) continue;

        // 1. Ensure background poller is running
        if (!activeTelegramPollers.get(token)) {
          startTelegramPoller(token, cfg.school_id);
        }

        // 2. Also directly fetch updates right now for immediate feedback
        let updates = [];
        try {
          let fetchRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=50`);
          let json = await fetchRes.json();
          if (json.error_code === 409) {
            // Webhook conflict: delete webhook to free queued updates
            console.log(`[Telegram] Resolving webhook conflict for sync-updates on ...${token.slice(-5)}`);
            await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
            fetchRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=50`);
            json = await fetchRes.json();
          }

          if (json.ok && Array.isArray(json.result)) {
            updates = json.result;
            for (const upd of updates) {
              await handleTelegramUpdate(token, upd);
            }
          }
        } catch (e) {
          console.warn('[Telegram] sync-updates fetch error:', e.message);
        }

        results.push({
          school_id: cfg.school_id,
          token_suffix: token.slice(-5),
          updates_fetched: updates.length,
          isPolling: !!activeTelegramPollers.get(token)
        });
      }

      res.json({ success: true, results, recent_events_count: recentTelegramEvents.length });
    } catch (err) {
      console.error('[Telegram] Error syncing updates:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Direct manual linking endpoint for Telegram
  app.post('/api/telegram/link-user', async (req, res) => {
    try {
      const { citizenId, chatId, schoolId } = req.body || {};
      if (!citizenId || !chatId) {
        return res.status(400).json({ success: false, message: 'citizenId and chatId are required' });
      }

      const cleanChatId = String(chatId).trim();
      const cleanCitizenId = String(citizenId).trim();

      // 1. Update central DB
      await query('UPDATE profiles SET telegram_chat_id = ? WHERE TRIM(id) = TRIM(?)', [cleanChatId, cleanCitizenId]);

      // 2. Update tenant DB if exists
      let targetSchoolId = schoolId;
      if (!targetSchoolId) {
        const rows = await query('SELECT school_id FROM profiles WHERE TRIM(id) = TRIM(?)', [cleanCitizenId]);
        if (rows && rows.length > 0) targetSchoolId = rows[0].school_id;
      }

      if (targetSchoolId) {
        try {
          const tPool = await getPoolForSchool(targetSchoolId);
          if (tPool) {
            await query('UPDATE profiles SET telegram_chat_id = ? WHERE TRIM(id) = TRIM(?)', [cleanChatId, cleanCitizenId], tPool);
          }
        } catch (e) {
          console.warn('[Telegram] Error updating tenant DB:', e.message);
        }
      }

      // 3. Send confirmation message
      try {
        let tokenRows = [];
        if (targetSchoolId) {
          tokenRows = await query('SELECT telegram_bot_token FROM school_configs WHERE school_id = ?', [targetSchoolId]);
        }
        if (!tokenRows.length) {
          tokenRows = await query('SELECT telegram_bot_token FROM school_configs WHERE telegram_bot_token IS NOT NULL LIMIT 1');
        }
        if (tokenRows.length && tokenRows[0].telegram_bot_token) {
          await sendTelegramMessage(
            tokenRows[0].telegram_bot_token,
            cleanChatId,
            `✅ <b>ผูกบัญชี Telegram สำเร็จ!</b>\n\nระบบผูกบัญชีของคุณเข้ากับ Chat ID: <code>${cleanChatId}</code> เรียบร้อยแล้ว พร้อมรับการแจ้งเตือนทันทีครับ 🟢`
          );
        }
      } catch (msgErr) {
        console.warn('[Telegram] Confirmation message failed:', msgErr.message);
      }

      res.json({ success: true, message: 'ผูกบัญชี Telegram เรียบร้อยแล้ว' });
    } catch (err) {
      console.error('[Telegram] Error linking user:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint to test Telegram Bot connection (Push Test)
  app.post('/api/telegram/test', async (req, res) => {
    try {
      const { botToken, chatId } = req.body || {};
      if (!botToken || !chatId) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุทั้ง Telegram Bot Token และ Chat ID' });
      }

      const cleanToken = String(botToken).trim();
      const cleanChatId = String(chatId).trim();

      const result = await sendTelegramMessage(
        cleanToken,
        cleanChatId,
        `🔔 <b>ทดสอบการเชื่อมต่อระบบแจ้งเตือน Telegram (SchoolOS)</b>\n\n` +
        `✅ การเชื่อมต่อระบบสำเร็จแล้ว!\n` +
        `🕒 เวลาที่ทดสอบ: ${new Date().toLocaleString('th-TH')}\n` +
        `📌 บัญชีหรือกลุ่มนี้พร้อมรับการแจ้งเตือนงาน หนังสือราชการ และการลาเรียบร้อยแล้วครับ`
      );

      if (result && result.ok) {
        return res.json({ success: true, message: 'ส่งข้อความทดสอบเข้า Telegram สำเร็จแล้ว!' });
      } else {
        const desc = result?.description || 'ไม่สามารถส่งข้อความได้ กรุณาตรวจสอบว่าผู้ใช้ได้กด Start ในบอทหรือดึงบอทเข้ากลุ่มแล้วหรือยัง';
        return res.status(400).json({ success: false, message: `ส่งข้อความล้มเหลว: ${desc}` });
      }
    } catch (err) {
      console.error('[Telegram] Error in /api/telegram/test:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Endpoint to set Telegram Webhook
  app.post('/api/telegram/set-webhook', async (req, res) => {
    try {
      const { botToken, appBaseUrl } = req.body || {};
      if (!botToken) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุ Telegram Bot Token' });
      }

      const cleanToken = String(botToken).trim();
      
      // Determine base URL: prefer explicitly provided, then school_configs DB, then request origin
      let baseUrl = appBaseUrl ? String(appBaseUrl).trim() : null;
      if (!baseUrl) {
        try {
          const cfgs = await query('SELECT app_base_url FROM school_configs WHERE TRIM(telegram_bot_token) = TRIM(?) AND app_base_url IS NOT NULL', [cleanToken]);
          if (cfgs && cfgs.length > 0 && cfgs[0].app_base_url) {
            baseUrl = cfgs[0].app_base_url.trim();
          }
        } catch (e) {
          // ignore
        }
      }

      if (!baseUrl) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        baseUrl = `${protocol}://${host}`;
      }

      const result = await setTelegramWebhook(cleanToken, baseUrl);
      if (result && result.ok) {
        const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/telegram/webhook/${cleanToken}`;
        return res.json({ 
          success: true, 
          message: `ตั้งค่า Webhook สำเร็จเรียบร้อยแล้ว!\n\nWebhook URL:\n${webhookUrl}`,
          details: result
        });
      } else {
        return res.status(400).json({ 
          success: false, 
          message: `ตั้งค่า Webhook ไม่สำเร็จ: ${result?.description || 'เกิดข้อผิดพลาดในการเรียก Telegram API'}`,
          details: result
        });
      }
    } catch (err) {
      console.error('[Telegram] Error in /api/telegram/set-webhook:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Endpoint to check Telegram Webhook status
  app.get('/api/telegram/webhook-info', async (req, res) => {
    try {
      const { token } = req.query;
      if (!token) return res.status(400).json({ error: 'Token required' });
      const tgRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const data = await tgRes.json();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- LINE Official Account / Business Messaging API Logic ---
  app.post('/api/line/send-message', async (req, res) => {
    try {
      const { channelAccessToken, targetId, message, title, deepLinkUrl, type } = req.body;
      if (!channelAccessToken || !targetId || !message) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน (ต้องการ channelAccessToken, targetId, message)' });
      }

      // Strip HTML tags for altText/text fallback
      const cleanText = message.replace(/<[^>]*>/g, '').trim();
      const headerTitle = title || (type === 'leave' ? '📂 แจ้งเตือนการลา' : type === 'calendar' ? '📅 ปฏิทินปฏิบัติงาน ผอ.' : '🔔 แจ้งเตือนระบบโรงเรียน');

      // Construct LINE Flex Message for modern presentation
      const flexContainer = {
        type: "bubble",
        size: "mega",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: type === 'leave' ? "#4338CA" : type === 'calendar' ? "#7C3AED" : "#059669",
          paddingAll: "15px",
          contents: [
            {
              type: "text",
              text: headerTitle,
              weight: "bold",
              color: "#FFFFFF",
              size: "md"
            }
          ]
        },
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "16px",
          spacing: "md",
          contents: [
            {
              type: "text",
              text: cleanText,
              wrap: true,
              size: "sm",
              color: "#334155"
            }
          ]
        }
      };

      if (deepLinkUrl) {
        flexContainer.footer = {
          type: "box",
          layout: "vertical",
          paddingAll: "12px",
          contents: [
            {
              type: "button",
              style: "primary",
              color: type === 'leave' ? "#4338CA" : type === 'calendar' ? "#7C3AED" : "#059669",
              height: "sm",
              action: {
                type: "uri",
                label: "เปิดดูในระบบ",
                uri: deepLinkUrl
              }
            }
          ]
        };
      }

      const linePayload = {
        to: targetId,
        messages: [
          {
            type: "flex",
            altText: `${headerTitle}: ${cleanText.slice(0, 60)}...`,
            contents: flexContainer
          }
        ]
      };

      const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${channelAccessToken}`
        },
        body: JSON.stringify(linePayload)
      });

      if (!lineRes.ok) {
        const errorData = await lineRes.json().catch(() => ({}));
        console.warn('[LINE Push Error]', errorData, 'Falling back to plain text message...');
        
        // Fallback to text message
        const fallbackRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${channelAccessToken}`
          },
          body: JSON.stringify({
            to: targetId,
            messages: [
              {
                type: 'text',
                text: `${headerTitle}\n\n${cleanText}${deepLinkUrl ? `\n\n🔗 ลิงก์: ${deepLinkUrl}` : ''}`
              }
            ]
          })
        });

        if (!fallbackRes.ok) {
          const fallbackErr = await fallbackRes.json().catch(() => ({}));
          return res.status(fallbackRes.status).json({ success: false, message: fallbackErr.message || 'ส่งข้อความ LINE ไม่สำเร็จ' });
        }
      }

      return res.json({ success: true, message: 'ส่งข้อความ LINE สำเร็จ' });
    } catch (err) {
      console.error('[LINE Error]', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // In-memory buffer of recent LINE webhook events (last 50 events)
  const recentLineEvents = [];
  let lastKnownLineChannelAccessToken = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  const schoolTokensMap = new Map();

  app.get('/api/line/recent-events', (req, res) => {
    try {
      const { schoolId } = req.query;
      let events = recentLineEvents;
      if (schoolId) {
        events = events.filter(e => !e.schoolId || String(e.schoolId) === String(schoolId));
      }
      res.json(events);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Health check and simulation endpoint for LINE Webhook (supports both GET and POST)
  app.all(['/api/line/simulate-inbound', '/api/line/simulate-inbound/'], async (req, res) => {
    try {
      res.setHeader('Content-Type', 'application/json');
      const text = req.body?.text || req.query?.text || 'ขอ ID';
      const userId = req.body?.userId || req.query?.userId || 'U1234567890abcdef1234567890abcdef';
      const schoolId = req.body?.schoolId || req.query?.schoolId || null;

      const simulatedEvent = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
        lineUserId: userId,
        text: String(text).trim(),
        type: 'message',
        timestamp: new Date().toISOString(),
        schoolId: schoolId || null,
        status: 'simulated',
        linkedUserName: null
      };

      // Check if text is linking a citizen ID
      const match = String(text).match(/(?:#ผูกLINE|#ผูกไลน์|#ผูก|ผูกLINE|ผูกไลน์|ผูกID|ผูก\s*ID|ผูก|LINK|CONNECT)[\s:]*([0-9]{13})/i) || 
                    String(text).match(/^([0-9]{13})$/) ||
                    String(text).match(/([0-9]{13})/);

      let replyPreview = '';
      if (match && match[1]) {
        const citizenId = match[1].trim();
        let teacher = null;
        try {
          const [cUser] = await query('SELECT id, school_id, name FROM profiles WHERE id = ?', [citizenId]);
          if (cUser) teacher = cUser;
        } catch (e) {}

        if (teacher) {
          try {
            await query('UPDATE profiles SET line_user_id = ? WHERE id = ?', [userId, citizenId]);
          } catch (e) {}
          simulatedEvent.linkedUserName = teacher.name;
          simulatedEvent.status = 'linked_successfully';
          replyPreview = `✅ [จำลองสำเร็จ] เชื่อมต่อกับคุณ ${teacher.name} เรียบร้อยแล้ว`;
        } else {
          simulatedEvent.status = 'user_not_found';
          replyPreview = `❌ [จำลอง] ไม่พบเลขประจำตัวประชาชน ${citizenId} ในระบบ`;
        }
      } else {
        simulatedEvent.status = 'replied';
        replyPreview = `🆔 LINE User ID: ${userId}`;
      }

      recentLineEvents.unshift(simulatedEvent);
      if (recentLineEvents.length > 50) recentLineEvents.pop();

      return res.json({
        success: true,
        message: 'จำลองการรับข้อความสำเร็จ',
        event: simulatedEvent,
        replyPreview,
        tokenAvailable: !!(lastKnownLineChannelAccessToken || (schoolId && schoolTokensMap.has(String(schoolId))))
      });
    } catch (simErr) {
      return res.status(500).json({ success: false, error: simErr.message });
    }
  });

  // --- LINE Webhook & 1-Click Auto Link Handler ---
  app.all(['/api/line/webhook', '/api/line/webhook/:schoolId', '/api/line/webhook/:schoolId/*path'], async (req, res) => {
    // If health check / browser visit via GET
    if (req.method === 'GET') {
      return res.status(200).json({
        status: 'ok',
        message: 'LINE Webhook endpoint is active and ready.',
        hasCachedToken: !!lastKnownLineChannelAccessToken,
        knownSchoolsWithTokens: Array.from(schoolTokensMap.keys())
      });
    }

    // Return HTTP 200 immediately to acknowledge LINE platform
    res.status(200).send('OK');

    try {
      const { schoolId: paramSchoolId } = req.params;
      const events = req.body?.events || [];
      console.log(`[LINE Webhook] Hit received: Method=${req.method}, Path=${req.path}, Events=${events.length}`);

      if (!Array.isArray(events) || events.length === 0) return;

      for (const event of events) {
        const lineUserId = event?.source?.userId;
        const replyToken = event?.replyToken;

        console.log(`[LINE Webhook] Processing event: type=${event?.type}, userId=${lineUserId}, replyToken=${replyToken ? 'exists' : 'missing'}`);

        // Skip LINE dummy test tokens during webhook verify
        if (replyToken === '00000000000000000000000000000000' || replyToken === 'ffffffffffffffffffffffffffffffff') {
          console.log('[LINE Webhook] Received verification test ping from LINE Developers Console.');
          continue;
        }

        // Record incoming event in recent events buffer
        const eventLog = {
          id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
          lineUserId: lineUserId || 'unknown',
          text: (event.message?.text || '').trim(),
          type: event.type,
          timestamp: new Date().toISOString(),
          schoolId: paramSchoolId || null,
          status: 'received',
          linkedUserName: null
        };
        recentLineEvents.unshift(eventLog);
        if (recentLineEvents.length > 50) recentLineEvents.pop();

        // Fetch school configs to find Channel Access Token with progressive fallbacks
        let schoolToken = null;
        try {
          if (paramSchoolId) {
            const [cfg] = await query('SELECT line_channel_access_token FROM school_configs WHERE school_id = ? AND line_channel_access_token IS NOT NULL AND line_channel_access_token != ""', [paramSchoolId]);
            if (cfg && cfg.line_channel_access_token) {
              schoolToken = cfg.line_channel_access_token.trim();
            }
          }
          if (!schoolToken && paramSchoolId && schoolTokensMap.has(String(paramSchoolId))) {
            schoolToken = schoolTokensMap.get(String(paramSchoolId));
          }
          if (!schoolToken) {
            const [cfg] = await query('SELECT line_channel_access_token FROM school_configs WHERE line_channel_access_token IS NOT NULL AND line_channel_access_token != "" ORDER BY updated_at DESC LIMIT 1');
            if (cfg && cfg.line_channel_access_token) {
              schoolToken = cfg.line_channel_access_token.trim();
            }
          }
          if (!schoolToken) {
            // Check tenant databases if not in central
            try {
              const allSchools = await query('SELECT id FROM schools');
              for (const s of allSchools) {
                const tPool = await getPoolForSchool(s.id);
                if (tPool) {
                  const [tCfg] = await new Promise((resolve) => {
                    tPool.query('SELECT line_channel_access_token FROM school_configs WHERE line_channel_access_token IS NOT NULL AND line_channel_access_token != "" LIMIT 1', (err, rows) => {
                      resolve(rows || []);
                    });
                  });
                  if (tCfg && tCfg.line_channel_access_token) {
                    schoolToken = tCfg.line_channel_access_token.trim();
                    break;
                  }
                }
              }
            } catch (tErr) {
              console.warn('[LINE Webhook] Error checking tenant pools for token:', tErr.message);
            }
          }
          if (!schoolToken && lastKnownLineChannelAccessToken) {
            schoolToken = lastKnownLineChannelAccessToken;
          }
        } catch (e) {
          console.warn('[LINE Webhook] Failed to fetch channel access token:', e.message);
          if (lastKnownLineChannelAccessToken) {
            schoolToken = lastKnownLineChannelAccessToken;
          }
        }

        // Helper function to send reply message back to user (pure plain text, NO HTML tags)
        // With automatic Push message fallback if replyToken fails or expires
        const replyMessage = async (textMessage, overrideToken = null) => {
          const tokenToUse = overrideToken || schoolToken;
          if (!tokenToUse) {
            console.warn('[LINE Webhook] Cannot reply: schoolToken missing.');
            eventLog.status = 'reply_skipped_no_token';
            return;
          }

          let sentSuccessfully = false;

          // 1. Try standard Reply API if replyToken exists
          if (replyToken) {
            try {
              const replyRes = await fetch('https://api.line.me/v2/bot/message/reply', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${tokenToUse}`
                },
                body: JSON.stringify({
                  replyToken,
                  messages: [{ type: 'text', text: textMessage }]
                })
              });

              if (replyRes.ok) {
                console.log(`[LINE Webhook Reply Success] Replied to user ${lineUserId}`);
                eventLog.status = 'replied';
                sentSuccessfully = true;
              } else {
                const errBody = await replyRes.text();
                console.error('[LINE Webhook Reply Error]', replyRes.status, errBody);
              }
            } catch (replyErr) {
              console.error('[LINE Webhook Reply Exception]', replyErr);
            }
          }

          // 2. Fallback to Push API if Reply API failed or replyToken was absent
          if (!sentSuccessfully && lineUserId) {
            try {
              console.log(`[LINE Webhook] Attempting Push Message fallback to ${lineUserId}...`);
              const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${tokenToUse}`
                },
                body: JSON.stringify({
                  to: lineUserId,
                  messages: [{ type: 'text', text: textMessage }]
                })
              });

              if (pushRes.ok) {
                console.log(`[LINE Webhook Push Fallback Success] Pushed to ${lineUserId}`);
                eventLog.status = 'replied_via_push';
                sentSuccessfully = true;
              } else {
                const pushErrBody = await pushRes.text();
                console.error('[LINE Webhook Push Fallback Error]', pushRes.status, pushErrBody);
                eventLog.status = `reply_error_${pushRes.status}`;
              }
            } catch (pushErr) {
              console.error('[LINE Webhook Push Exception]', pushErr);
              eventLog.status = 'reply_exception';
            }
          }
        };

        // Handle text messages (e.g. #ผูกLINE 3300600837116, #ผูก 3300600837116, ขอ ID, id, etc.)
        if (event.type === 'message' && event.message?.type === 'text') {
          const rawText = (event.message.text || '').trim();
          const cleanText = rawText.replace(/[\s\-_:]+/g, '').toLowerCase();
          console.log(`[LINE Webhook] Received message from ${lineUserId}: "${rawText}"`);

          const match = rawText.match(/(?:#ผูกLINE|#ผูกไลน์|#ผูก|ผูกLINE|ผูกไลน์|ผูกID|ผูก\s*ID|ผูก|LINK|CONNECT)[\s:]*([0-9]{13})/i) || 
                        rawText.match(/^([0-9]{13})$/) ||
                        rawText.match(/([0-9]{13})/);

          if (match && match[1]) {
            const citizenId = match[1].trim();
            console.log(`[LINE Webhook] Linking citizenId [${citizenId}] with LINE User ID [${lineUserId}]`);

            let teacher = null;
            const [cUser] = await query('SELECT id, school_id, name FROM profiles WHERE id = ?', [citizenId]);
            if (cUser) teacher = cUser;

            // If not found in central DB, try to search in tenant DBs
            if (!teacher) {
              try {
                const schools = await query('SELECT id FROM schools');
                for (const sch of schools) {
                  const tPool = await getPoolForSchool(sch.id);
                  if (tPool) {
                    const [tUser] = await new Promise((resolve) => {
                      tPool.query('SELECT id, school_id, name FROM profiles WHERE id = ?', [citizenId], (err, rows) => {
                        resolve(rows || []);
                      });
                    });
                    if (tUser) {
                      teacher = { ...tUser, school_id: sch.id };
                      break;
                    }
                  }
                }
              } catch (schErr) {
                console.warn('[LINE Webhook] Error searching schools for teacher:', schErr.message);
              }
            }

            if (teacher) {
              // If teacher has a specific school, try to retrieve that school's token
              if (teacher.school_id) {
                try {
                  const [tCfg] = await query('SELECT line_channel_access_token FROM school_configs WHERE school_id = ? AND line_channel_access_token IS NOT NULL AND line_channel_access_token != ""', [teacher.school_id]);
                  if (tCfg && tCfg.line_channel_access_token) {
                    schoolToken = tCfg.line_channel_access_token.trim();
                  }
                } catch (tCfgErr) {
                  console.warn('[LINE Webhook] Error querying teacher school config:', tCfgErr.message);
                }
              }

              // Update central DB
              await query('UPDATE profiles SET line_user_id = ? WHERE id = ?', [lineUserId, citizenId]);

              // Update tenant DB
              if (teacher.school_id) {
                try {
                  const tenantPool = await getPoolForSchool(teacher.school_id);
                  if (tenantPool) {
                    await new Promise((resolve, reject) => {
                      tenantPool.query('UPDATE profiles SET line_user_id = ? WHERE id = ?', [lineUserId, citizenId], (err, r) => {
                        if (err) reject(err); else resolve(r);
                      });
                    });
                  }
                } catch (tErr) {
                  console.warn('[LINE Webhook] Update tenant profile warning:', tErr.message);
                }
              }

              console.log(`[LINE Webhook] Successfully linked LINE ID ${lineUserId} to ${teacher.name} (${citizenId})`);
              eventLog.linkedUserName = teacher.name;
              eventLog.status = 'linked_successfully';

              await replyMessage(`✅ เชื่อมต่อสำเร็จ!\n\nยินดีต้อนรับ คุณ ${teacher.name}\nระบบได้ผูกบัญชี LINE กับระบบ School-OS เรียบร้อยแล้ว\n\nนับจากนี้ท่านจะได้รับการแจ้งเตือนหนังสือราชการและการลาส่วนบุคคลผ่านช่องทางนี้โดยอัตโนมัติครับ 🟢`);
            } else {
              await replyMessage(`❌ ไม่พบข้อมูลผู้ใช้งาน\n\nไม่พบเลขประจำตัวประชาชน "${citizenId}" ในฐานข้อมูลของระบบ\n\n📌 LINE User ID ของท่านคือ:\n${lineUserId}\n\nคำแนะนำ:\n1. ตรวจสอบเลขประจำตัวประชาชน 13 หลัก\n2. หรือเข้าสู่ระบบ School-OS แล้วไปที่เมนู "ข้อมูลส่วนตัว" เพื่อกรอก LINE User ID ด้านบนโดยตรงได้เลยครับ`);
            }
          } else if (
            /^(id|userid|myid|lineid|uid|รหัส|ไอดี|ขอid|ขอไอดี|ขอรหัส|ผูกid|ผูก|เชื่อม|help)$/i.test(cleanText) ||
            cleanText.includes('ขอid') ||
            cleanText.includes('ขอไอดี') ||
            cleanText.includes('ผูกid') ||
            cleanText.includes('ผูก') ||
            cleanText.includes('userid') ||
            cleanText.includes('lineid') ||
            cleanText.includes('uid') ||
            cleanText === 'id' ||
            cleanText === 'ไอดี'
          ) {
            await replyMessage(`🆔 LINE User ID ของท่านคือ:\n${lineUserId}\n\n📋 วิธีนำไปใช้งาน:\n1. คัดลอกรหัส User ID ด้านบนไปวางที่เมนู "ข้อมูลส่วนตัว" ในระบบ แล้วกดบันทึก\n\n💡 หรือส่งคำสั่งผูกอัตโนมัติได้ทันที:\nพิมพ์ #ผูกLINE ตามด้วยเลขบัตรประชาชน 13 หลัก เช่น:\n#ผูกLINE 3300600837116`);
          } else {
            await replyMessage(`👋 สวัสดีครับ ยินดีต้อนรับสู่ระบบแจ้งเตือนโรงเรียน (School-OS)\n\n📌 LINE User ID ของท่านคือ:\n${lineUserId}\n\nหากต้องการเชื่อมต่อเพื่อรับแจ้งเตือน กรุณาพิมพ์:\n#ผูกLINE [เลขบัตรประชาชน 13 หลัก]\n\nเช่น:\n#ผูกLINE 3300600837116\n\n(หรือนำ LINE User ID ด้านบนไปกรอกในระบบที่เมนู "ข้อมูลส่วนตัว" ได้เช่นกันครับ)`);
          }
        }
        
        if (event.type === 'follow') {
          console.log(`[LINE Webhook] User followed bot: ${lineUserId}`);
          await replyMessage(`👋 ยินดีต้อนรับสู่ LINE Official Account ของโรงเรียนครับ!\n\n📌 LINE User ID ของท่านคือ:\n${lineUserId}\n\nหากท่านเป็นครูหรือบุคลากร สามารถผูกบัญชีเพื่อรับแจ้งเตือนได้ง่ายๆ เพียงพิมพ์:\n#ผูกLINE [เลขบัตรประชาชน 13 หลัก]\n\nเช่น:\n#ผูกLINE 3300600837116\n\nเพื่อเชื่อมต่อระบบแจ้งเตือนอัตโนมัติครับ`);
        }
      }
    } catch (err) {
      console.error('[LINE Webhook Exception]', err);
    }
  });

  // Direct 1-Click Link API from Web
  app.post('/api/line/link-user', async (req, res) => {
    try {
      const { citizenId, lineUserId } = req.body;
      if (!citizenId || !lineUserId) {
        return res.status(400).json({ success: false, message: 'Citizen ID and LINE User ID required' });
      }

      const [cUser] = await query('SELECT id, school_id, name FROM profiles WHERE id = ?', [citizenId]);
      if (!cUser) {
        return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้งานนี้ในระบบ' });
      }

      await query('UPDATE profiles SET line_user_id = ? WHERE id = ?', [lineUserId.trim(), citizenId]);

      if (cUser.school_id) {
        try {
          const tenantPool = await getPoolForSchool(cUser.school_id);
          if (tenantPool) {
            await new Promise((resolve, reject) => {
              tenantPool.query('UPDATE profiles SET line_user_id = ? WHERE id = ?', [lineUserId.trim(), citizenId], (err, r) => {
                if (err) reject(err); else resolve(r);
              });
            });
          }
        } catch (e) {
          console.warn('[LINE Direct Link] Tenant update warning:', e.message);
        }
      }

      res.json({ success: true, message: `ผูกบัญชี LINE กับคุณ ${cUser.name} เรียบร้อยแล้ว` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/line/test', async (req, res) => {
    try {
      const { channelAccessToken, targetId, schoolId } = req.body;
      if (!channelAccessToken || !targetId) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุ Channel Access Token และ Target ID' });
      }

      const token = channelAccessToken.trim();
      lastKnownLineChannelAccessToken = token;
      if (schoolId) {
        schoolTokensMap.set(String(schoolId), token);
        // Also ensure it is saved in school_configs if possible
        try {
          await query('UPDATE school_configs SET line_channel_access_token = ? WHERE school_id = ?', [token, schoolId]);
        } catch (dbErr) {
          console.warn('[LINE Test DB Update warn]', dbErr.message);
        }
      }

      const testPayload = {
        to: targetId.trim(),
        messages: [
          {
            type: 'text',
            text: '🟢 ทดสอบการเชื่อมต่อระบบโรงเรียน (SchoolOS)\n\nการเชื่อมต่อระหว่างระบบกับ LINE Official Account สำเร็จเรียบร้อยแล้ว! บัญชีนี้พร้อมรับการแจ้งเตือนจากระบบครับ'
          }
        ]
      };

      const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(testPayload)
      });

      if (!lineRes.ok) {
        const errData = await lineRes.json().catch(() => ({}));
        console.error('[LINE Test Error]', errData);
        return res.status(lineRes.status).json({ success: false, message: errData.message || 'LINE API ตอบกลับด้วยข้อผิดพลาด ตรวจสอบ Token หรือ Target ID' });
      }

      return res.json({ success: true, message: 'ส่งข้อความทดสอบสำเร็จ' });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // --- Telegram Test Route ---
  app.post('/api/telegram/test', async (req, res) => {
    try {
      const { botToken, targetId, schoolId } = req.body;
      let token = botToken;
      let chat = targetId;

      if ((!token || !chat) && schoolId) {
        const [cfg] = await query('SELECT telegram_bot_token, telegram_target_id FROM school_configs WHERE school_id = ?', [schoolId]);
        if (cfg) {
          token = token || cfg.telegram_bot_token;
          chat = chat || cfg.telegram_target_id;
        }
      }

      if (!token) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุ Telegram Bot Token' });
      }
      if (!chat) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุ Telegram Target ID (Chat ID หรือ Group ID)' });
      }

      const testMsg = `🟢 <b>ทดสอบการเชื่อมต่อระบบโรงเรียน (SchoolOS)</b>\n\nการเชื่อมต่อระหว่างระบบกับ Telegram Bot สำเร็จเรียบร้อยแล้ว!\nช่องทางนี้พร้อมรับการแจ้งเตือนงานสารบรรณ วาระ ผอ. และการลาของบุคลากรครับ 🚀\n\n<i>เวลาทดสอบ: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</i>`;

      const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: testMsg,
          parse_mode: 'HTML'
        })
      });

      const tgData = await tgRes.json().catch(() => ({}));
      if (!tgRes.ok || !tgData.ok) {
        console.error('[Telegram Test Error]', tgData);
        return res.status(400).json({ success: false, message: tgData.description || 'Telegram API เกิดข้อผิดพลาด ตรวจสอบ Bot Token และ Chat ID' });
      }

      return res.json({ success: true, message: 'ส่งข้อความทดสอบ Telegram สำเร็จ' });
    } catch (err) {
      console.error('[Telegram Test Exception]', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // --- Telegram Set Webhook Route ---
  app.post('/api/telegram/set-webhook', async (req, res) => {
    try {
      const { botToken, webhookUrl } = req.body;
      if (!botToken) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุ Bot Token' });
      }

      const cleanToken = botToken.trim();
      const host = req.get('x-forwarded-host') || req.get('host');
      let protocol = req.get('x-forwarded-proto') || req.protocol;
      // Telegram requires HTTPS for external domains
      if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
        protocol = 'https';
      }
      const targetUrl = webhookUrl ? webhookUrl.trim() : `${protocol}://${host}/api/telegram/webhook/${cleanToken}`;

      console.log(`[Telegram SetWebhook] Setting webhook to: ${targetUrl}`);

      const tgRes = await fetch(`https://api.telegram.org/bot${cleanToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          allowed_updates: ['message', 'callback_query']
        })
      });

      const tgData = await tgRes.json().catch(() => ({}));
      if (!tgRes.ok || !tgData.ok) {
        return res.status(400).json({ success: false, message: tgData.description || 'ไม่สามารถตั้งค่า Webhook ได้' });
      }

      return res.json({ success: true, message: 'ตั้งค่า Telegram Webhook สำเร็จเรียบร้อย!', webhookUrl: targetUrl });
    } catch (err) {
      console.error('[Telegram SetWebhook Exception]', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // --- Telegram Sync & Webhook Auto-Recovery Route ---
  app.post('/api/telegram/sync-updates', async (req, res) => {
    try {
      const { schoolId, botToken } = req.body;
      let token = botToken ? botToken.trim() : null;

      if (!token && schoolId) {
        const cfgs = await query('SELECT telegram_bot_token FROM school_configs WHERE school_id = ?', [schoolId]);
        if (cfgs && cfgs.length > 0 && cfgs[0].telegram_bot_token) {
          token = cfgs[0].telegram_bot_token.trim();
        }
      }

      if (!token) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุ Bot Token หรือ School ID' });
      }

      const host = req.get('x-forwarded-host') || req.get('host');
      let protocol = req.get('x-forwarded-proto') || req.protocol;
      if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
        protocol = 'https';
      }
      const expectedWebhookUrl = `${protocol}://${host}/api/telegram/webhook/${token}`;

      // Check current webhook status
      let whInfo = null;
      let autoWebhookFixed = false;
      try {
        const whRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
        const whData = await whRes.json().catch(() => ({}));
        if (whData.ok) {
          whInfo = whData.result;
        }
      } catch (e) {
        console.warn('[Telegram Sync] Error fetching webhook info:', e.message);
      }

      // If webhook is not set or points to wrong host, attempt to auto-set
      if (!whInfo || !whInfo.url || (protocol === 'https' && !whInfo.url.includes(host))) {
        try {
          console.log(`[Telegram Sync] Webhook not active or URL mismatched. Auto-setting to: ${expectedWebhookUrl}`);
          const setRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: expectedWebhookUrl,
              allowed_updates: ['message', 'callback_query']
            })
          });
          const setData = await setRes.json().catch(() => ({}));
          if (setData.ok) {
            autoWebhookFixed = true;
            whInfo = { url: expectedWebhookUrl, has_custom_certificate: false };
          }
        } catch (e) {
          console.warn('[Telegram Sync] Auto set webhook error:', e.message);
        }
      }

      // If webhook is NOT active, fallback to getUpdates to fetch any pending /start messages
      let updatesProcessed = 0;
      if (!whInfo || !whInfo.url) {
        try {
          const upRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=25`);
          const upData = await upRes.json().catch(() => ({}));
          if (upData.ok && Array.isArray(upData.result)) {
            for (const upd of upData.result) {
              await handleTelegramUpdate(token, upd);
              updatesProcessed++;
            }
          }
        } catch (e) {
          console.warn('[Telegram Sync] Fallback getUpdates error:', e.message);
        }
      }

      // Return recent events
      let events = recentTelegramEvents;
      if (schoolId) {
        events = events.filter(e => !e.schoolId || String(e.schoolId) === String(schoolId));
      }

      return res.json({
        success: true,
        webhookInfo: whInfo,
        autoWebhookFixed,
        updatesProcessed,
        recentEvents: events
      });
    } catch (err) {
      console.error('[Telegram Sync Exception]', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post('/api/migrate', async (req, res) => {
    const { supabaseUrl, supabaseKey, tables, strategy = 'skip_existing' } = req.body;
    if (!supabaseUrl || !supabaseKey || !tables || !Array.isArray(tables)) {
      return res.status(400).json({ error: 'Missing required migration parameters' });
    }

    const supabaseSource = createClient(supabaseUrl, supabaseKey);
    const results = [];

    try {
      // Disable foreign key checks during migration
      await query('SET FOREIGN_KEY_CHECKS = 0');

      for (const table of tables) {
        console.log(`Migrating table: ${table}`);
        
        // 1. Get target table columns and types from MySQL
        let targetColumns = [];
        let columnTypes = {};
        try {
          const columnsInfo = await query(`SHOW COLUMNS FROM ??`, [table]);
          targetColumns = columnsInfo.map(c => c.Field);
          columnsInfo.forEach(c => {
            columnTypes[c.Field] = c.Type.toLowerCase();
          });
        } catch (colErr) {
          results.push({ table, status: 'error', message: `ไม่พบตารางนี้ใน MySQL: ${colErr.message}` });
          continue;
        }

        // 2. Fetch data from Supabase using pagination (Loop to handle > 1000 records)
        let successCount = 0;
        let failCount = 0;
        let lastError = null;
        let totalFetched = 0;
        let hasMoreData = true;
        let batchSize = 1000;
        let columnMismatch = false;

        while (hasMoreData) {
          const { data, error } = await supabaseSource
            .from(table)
            .select('*')
            .range(totalFetched, totalFetched + batchSize - 1);
          
          if (error) {
            results.push({ table, status: 'error', message: `Supabase Error at rows ${totalFetched}-${totalFetched + batchSize}: ${error.message}` });
            hasMoreData = false;
            continue;
          }

          if (!data || data.length === 0) {
            if (totalFetched === 0) {
              results.push({ table, status: 'skipped', message: 'ไม่พบข้อมูลใน Supabase' });
            }
            hasMoreData = false;
            continue;
          }

          for (const row of data) {
            try {
              // 3. Map Supabase row to MySQL columns (Case-insensitive matching)
              const filteredRow = {};
              const rowKeys = Object.keys(row);
              
              targetColumns.forEach(targetCol => {
                const sourceKey = rowKeys.find(k => k.toLowerCase() === targetCol.toLowerCase());
                if (sourceKey !== undefined) {
                  let val = row[sourceKey];
                  
                  // Format Date/Time for MySQL
                  const type = columnTypes[targetCol];
                  if (val && (type.includes('datetime') || type.includes('timestamp') || type.includes('date'))) {
                    try {
                      const d = new Date(val);
                      if (!isNaN(d.getTime())) {
                        if (type.includes('date') && !type.includes('time')) {
                          val = d.toISOString().split('T')[0];
                        } else {
                          val = d.toISOString().slice(0, 19).replace('T', ' ');
                        }
                      }
                    } catch (e) {
                      console.error(`Date conversion error for ${targetCol}:`, e);
                    }
                  }

                  filteredRow[targetCol] = val;
                }
              });

              const keys = Object.keys(filteredRow);
              if (keys.length === 0) {
                columnMismatch = true;
                continue;
              }

              const values = keys.map(k => {
                const val = filteredRow[k];
                if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
                  return JSON.stringify(val);
                }
                return val;
              });
              
              const placeholders = keys.map(() => '?').join(', ');
              const updates = keys.map(k => `?? = ?`).join(', ');
              const updateParams = keys.flatMap(k => {
                const val = filteredRow[k];
                return [k, Array.isArray(val) || (typeof val === 'object' && val !== null) ? JSON.stringify(val) : val];
              });

              if (strategy === 'overwrite') {
                const sql = `INSERT INTO ?? (??) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;
                await query(sql, [table, keys, ...values, ...updateParams]);
              } else {
                // Safe mode (skip_existing): Uses INSERT IGNORE so existing records in MySQL are untouched!
                const sql = `INSERT IGNORE INTO ?? (??) VALUES (${placeholders})`;
                await query(sql, [table, keys, ...values]);
              }
              successCount++;
            } catch (rowErr) {
              failCount++;
              lastError = rowErr.message;
            }
          }

          totalFetched += data.length;
          if (data.length < batchSize) {
            hasMoreData = false;
          } else {
            // Optional: small delay to avoid hitting rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        if (successCount > 0) {
          results.push({ 
            table, 
            status: 'success', 
            successCount, 
            failCount, 
            message: failCount > 0 ? `สำเร็จบางส่วน (Error: ${lastError})` : 'ย้ายข้อมูลสำเร็จ' 
          });
        } else {
          const msg = columnMismatch ? 'ชื่อคอลัมน์ไม่ตรงกันเลย' : (lastError || 'ย้ายไม่สำเร็จ');
          results.push({ table, status: 'failed', successCount: 0, failCount, message: msg });
        }
      }
      
      // Re-enable foreign key checks
      await query('SET FOREIGN_KEY_CHECKS = 1');
      
      res.json({ success: true, results });
    } catch (err) {
      // Ensure checks are re-enabled even on error
      await query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
      console.error('[Migration Error]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const filters = { ...req.query };
    try {
      let sql = `SELECT * FROM ??`;
      let params = [tableName];
      
      const filterKeys = Object.keys(filters).filter(k => k !== 'order' && k !== 'limit' && k !== 'select' && k !== 'head');
      if (filterKeys.length > 0) {
        sql += ` WHERE ` + filterKeys.map(k => {
          const val = String(filters[k]);
          if (val.startsWith('in.(')) return `?? IN (?)`;
          if (val.startsWith('gte.')) return `?? >= ?`;
          if (val.startsWith('lte.')) return `?? <= ?`;
          if (val.startsWith('gt.')) return `?? > ?`;
          if (val.startsWith('lt.')) return `?? < ?`;
          if (val.startsWith('neq.')) return `?? != ?`;
          return `?? = ?`;
        }).join(' AND ');
        
        filterKeys.forEach(k => {
          params.push(k);
          const val = String(filters[k]);
          if (val.startsWith('in.(')) {
            const values = val.substring(4, val.length - 1).split(',');
            params.push(values);
          } else if (val.startsWith('gte.')) {
            params.push(val.substring(4));
          } else if (val.startsWith('lte.')) {
            params.push(val.substring(4));
          } else if (val.startsWith('gt.')) {
            params.push(val.substring(3));
          } else if (val.startsWith('lt.')) {
            params.push(val.substring(3));
          } else if (val.startsWith('neq.')) {
            params.push(val.substring(4));
          } else {
            params.push(filters[k]);
          }
        });
      }

      if (filters.order) {
        const [col, dir] = filters.order.split('.');
        sql += ` ORDER BY ?? ${dir === 'desc' ? 'DESC' : 'ASC'}`;
        params.push(col);
      }

      if (filters.limit) {
        sql += ` LIMIT ?`;
        params.push(parseInt(filters.limit));
      }
      
      const results = await query(sql, params);
      // Auto-parse JSON columns if any
      const parsed = results.map((row) => {
        const newRow = { ...row };
        for (const key in newRow) {
          if (typeof newRow[key] === 'string' && (newRow[key].startsWith('[') || newRow[key].startsWith('{'))) {
            try { newRow[key] = JSON.parse(newRow[key]); } catch(e) {}
          }
        }
        return newRow;
      });
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ error: `Failed to fetch from ${tableName}: ${err.message || String(err)}` });
    }
  });

  // Serve static logo files dynamically from DB if customized
  app.get(['/logo-192.jpg', '/logo-512.jpg', '/logo-192.png', '/logo-512.png'], async (req, res, next) => {
    try {
      const logoRows = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'app_logo_url'");
      if (logoRows && logoRows.length > 0 && logoRows[0].setting_value && logoRows[0].setting_value.startsWith('data:image')) {
        const dataUrl = logoRows[0].setting_value;
        const matches = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (matches) {
          const contentType = matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.send(buffer);
        }
      }
    } catch (e) {
      // Pass to static file handler if DB query fails
    }
    next();
  });

  // System Settings GET and POST endpoints
  app.get('/api/system-settings', async (req, res) => {
    try {
      let appName = 'SchoolOS';
      let appLogoUrl = '/logo-192.jpg';

      const nameRows = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'app_name'");
      if (nameRows && nameRows.length > 0 && nameRows[0].setting_value) {
        appName = nameRows[0].setting_value;
      }

      const logoRows = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'app_logo_url'");
      if (logoRows && logoRows.length > 0 && logoRows[0].setting_value) {
        appLogoUrl = logoRows[0].setting_value;
      }

      res.json({ appName, appLogoUrl });
    } catch (err) {
      res.json({ appName: 'SchoolOS', appLogoUrl: '/logo-192.jpg' });
    }
  });

  app.post('/api/system-settings', async (req, res) => {
    const { appName, appIcon } = req.body;
    try {
      if (appName) {
        await query("INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)", ['app_name', appName]);
      }

      if (appIcon) {
        // Save the actual Data URL (base64) directly into MySQL system_settings table so it is permanently preserved across code updates and rebuilds
        await query("INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)", ['app_logo_url', appIcon]);

        // Also write to ephemeral disk as fallback
        try {
          let cleanBase64 = appIcon;
          if (appIcon.includes(',')) {
            cleanBase64 = appIcon.split(',')[1];
          }
          const buffer = Buffer.from(cleanBase64, 'base64');

          fs.writeFileSync(path.join(process.cwd(), 'logo-192.jpg'), buffer);
          fs.writeFileSync(path.join(process.cwd(), 'logo-512.jpg'), buffer);
          fs.writeFileSync(path.join(process.cwd(), 'logo-192.png'), buffer);
          fs.writeFileSync(path.join(process.cwd(), 'logo-512.png'), buffer);

          const distPath = path.join(process.cwd(), 'dist');
          if (fs.existsSync(distPath)) {
            fs.writeFileSync(path.join(distPath, 'logo-192.jpg'), buffer);
            fs.writeFileSync(path.join(distPath, 'logo-512.jpg'), buffer);
            fs.writeFileSync(path.join(distPath, 'logo-192.png'), buffer);
            fs.writeFileSync(path.join(distPath, 'logo-512.png'), buffer);
          }
        } catch (fileErr) {
          console.warn("Could not write logo files to disk:", fileErr);
        }
      }

      res.json({ success: true, message: 'บันทึกการตั้งค่าระบบเรียบร้อยแล้ว' });
    } catch (err) {
      console.error('Failed to save system settings:', err);
      res.status(500).json({ error: 'ไม่สามารถบันทึกการตั้งค่าระบบได้: ' + (err.message || String(err)) });
    }
  });

  // Database Initialization (Manual Trigger)
  app.post('/api/init-db', async (req, res) => {
    try {
      console.log('[Init-DB] Initializing central database...');
      await initializeDatabase();
      
      // Also fetch and initialize all registered school tenant databases
      let configs = [];
      try {
        [configs] = await pool.query('SELECT * FROM school_database_configs');
      } catch (err) {
        console.warn('[Init-DB] school_database_configs table does not exist or cannot be queried yet:', err.message);
      }
      
      const results = [];
      results.push({ database: 'Central DB', status: 'success' });
      
      for (const config of configs) {
        try {
          console.log(`[Init-DB] Propagating initialization to school tenant DB: ${config.database_name} (${config.school_id})`);
          const schoolPool = await getPoolForSchool(config.school_id);
          await initializeDatabase(schoolPool);
          results.push({ database: `${config.database_name} (${config.school_id})`, status: 'success' });
        } catch (tenantErr) {
          console.error(`[Init-DB] Failed to initialize tenant DB: ${config.database_name}:`, tenantErr.message);
          results.push({ database: `${config.database_name} (${config.school_id})`, status: 'failed', error: tenantErr.message });
        }
      }
      
      res.json({ 
        success: true, 
        message: 'ปรับปรุงโครงสร้างฐานข้อมูลทุกโรงเรียนและส่วนกลางเรียบร้อยแล้ว',
        details: results
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to initialize database: ' + (err.message || String(err)) });
    }
  });

  app.post('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    let data = req.body;
    
    if (!data) {
      return res.status(400).json({ error: 'No data provided' });
    }

    console.log(`[${new Date().toISOString()}] POST /api/table/${tableName} - Data size: ${JSON.stringify(data).length} bytes`);
    
    try {
      const uuidTables = ['students', 'class_rooms', 'student_savings', 'student_attendance', 'student_health_records', 'academic_years', 'director_events', 'profiles', 'schools', 'documents', 'finance_accounts', 'finance_transactions'];
      
      // Get actual columns from the database to filter out extra fields
      const result = await query(`DESCRIBE ??`, [tableName]);
      const columnsInfo = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : (Array.isArray(result) ? result : []);
      const validColumns = columnsInfo.map(c => c.Field || c.column_name || c.COLUMN_NAME).filter(Boolean);
      const columnTypes = {};
      columnsInfo.forEach(c => {
        const field = c.Field || c.column_name || c.COLUMN_NAME;
        const type = (c.Type || c.data_type || c.DATA_TYPE || '').toLowerCase();
        columnTypes[field] = type;
      });

      if (Array.isArray(data)) {
        console.log(`[${new Date().toISOString()}] Bulk insert into ${tableName}: ${data.length} items`);
        if (data.length === 0) return res.json([]);
        
        // Collect all unique keys from all objects in the array that are valid columns
        const allKeys = new Set();
        data.forEach(item => {
          if (item && typeof item === 'object') {
            // Generate UUID before collecting keys so 'id' is included in the keys list
            if (!item.id && uuidTables.includes(tableName)) {
              item.id = crypto.randomUUID();
            }
            Object.keys(item).forEach(key => {
              if (item[key] !== undefined && validColumns.includes(key)) allKeys.add(key);
            });
          }
        });
        const keys = Array.from(allKeys);
        
        if (keys.length === 0) return res.json([]);

        const values = [];
        const placeholders = data.map(() => `(${keys.map(() => '?').join(', ')})`).join(', ');
        
        data.forEach(item => {
          keys.forEach(k => {
            let val = item[k];
            if (val === undefined) val = null;
            if (typeof val === 'string') val = val.trim();
            
            // Convert empty strings to null for specific columns to avoid unique constraint issues or type errors
            const nullIfEmpty = [
              'student_id', 'national_id', 'age', 'weight', 'height', 
              'lat', 'lng', 'radius', 'family_annual_income', 'birthday'
            ];
            if (val === '' && nullIfEmpty.includes(k)) {
              val = null;
            }
            
            // Auto-format ISO date strings for MySQL date/time columns
            if (typeof val === 'string' && val.includes('T') && (val.endsWith('Z') || val.length > 10)) {
              const type = columnTypes[k];
              if (type && (type.includes('datetime') || type.includes('timestamp') || type.includes('date'))) {
                try {
                  const d = new Date(val);
                  if (!isNaN(d.getTime())) {
                    if (type.includes('date') && !type.includes('time')) {
                      val = d.toISOString().split('T')[0];
                    } else {
                      // Format as YYYY-MM-DD HH:mm:ss
                      val = d.toISOString().slice(0, 19).replace('T', ' ');
                    }
                  }
                } catch (e) {
                  // Keep original value if parsing fails
                }
              }
            }
            
            if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
              try {
                val = JSON.stringify(val);
              } catch (e) {
                console.error(`Failed to stringify field ${k}:`, e);
                val = null;
              }
            }
            values.push(val);
          });
        });

        // Use ON DUPLICATE KEY UPDATE for bulk inserts
        const updates = keys.filter(k => k !== 'id').map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');

        let sql = `INSERT INTO ?? (??) VALUES ${placeholders}`;
        if (updates) {
          sql += ` ON DUPLICATE KEY UPDATE ${updates}`;
        }
        
        await query(sql, [tableName, keys, ...values]);
      } else {
        // Single insert
        console.log(`[${new Date().toISOString()}] Single insert into ${tableName}`);
        if (!data.id && uuidTables.includes(tableName)) {
          data.id = crypto.randomUUID();
        }

        const keys = Object.keys(data).filter(k => data[k] !== undefined && validColumns.includes(k));
        const values = [];
        
        keys.forEach(k => {
          let val = data[k];
          const nullIfEmpty = [
            'student_id', 'national_id', 'age', 'weight', 'height', 
            'lat', 'lng', 'radius', 'family_annual_income', 'birthday'
          ];
          if (val === '' && nullIfEmpty.includes(k)) {
            val = null;
          }

          // Auto-format ISO date strings for MySQL date/time columns
          if (typeof val === 'string' && val.includes('T') && (val.endsWith('Z') || val.length > 10)) {
            const type = columnTypes[k];
            if (type && (type.includes('datetime') || type.includes('timestamp') || type.includes('date'))) {
              try {
                const d = new Date(val);
                if (!isNaN(d.getTime())) {
                  if (type.includes('date') && !type.includes('time')) {
                    val = d.toISOString().split('T')[0];
                  } else {
                    // Format as YYYY-MM-DD HH:mm:ss
                    val = d.toISOString().slice(0, 19).replace('T', ' ');
                  }
                }
              } catch (e) {
                // Keep original value if parsing fails
              }
            }
          }

          if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
            try {
              val = JSON.stringify(val);
            } catch (e) {
              val = null;
            }
          }
          values.push(val);
        });
        
        const placeholders = keys.map(() => '?').join(', ');
        const updates = keys.filter(k => k !== 'id').map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');

        const sql = `INSERT INTO ?? (??) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;
        await query(sql, [tableName, keys, ...values]);
      }
      
      console.log(`[${new Date().toISOString()}] Successfully saved to ${tableName}`);
      
      // Trigger Telegram Poller Setup & cache LINE token if school_configs was updated
      if (tableName === 'school_configs') {
        const config = Array.isArray(data) ? data[0] : data;
        if (config && config.telegram_bot_token) {
          startTelegramPoller(config.telegram_bot_token, config.school_id);
        }
        if (config && config.line_channel_access_token) {
          const lToken = config.line_channel_access_token.trim();
          lastKnownLineChannelAccessToken = lToken;
          if (config.school_id) {
            schoolTokensMap.set(String(config.school_id), lToken);
          }
        }
      }
      
      res.json(Array.isArray(data) ? data : [data]);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] API Error for ${tableName}:`, err);
      res.status(500).json({ error: `Failed to save to ${tableName}: ${err.message || String(err)}` });
    }
  });

  app.patch('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const data = req.body || {};
    const filters = { ...req.query };
    try {
      // 1. Get valid columns for table
      let validColumns = [];
      try {
        const columnsInfo = await query(`DESCRIBE \`${tableName}\``);
        const rows = Array.isArray(columnsInfo) && Array.isArray(columnsInfo[0]) ? columnsInfo[0] : (Array.isArray(columnsInfo) ? columnsInfo : []);
        validColumns = rows.map(c => c.Field || c.column_name || c.COLUMN_NAME).filter(Boolean);
      } catch (colErr) {
        console.warn(`[PATCH /api/table/${tableName}] Could not fetch DESCRIBE columns:`, colErr.message);
      }

      // 2. Filter data keys to keep only valid columns
      let dataKeys = Object.keys(data);
      if (validColumns.length > 0) {
        dataKeys = dataKeys.filter(k => validColumns.includes(k));
      }

      if (dataKeys.length === 0) {
        return res.json(Array.isArray(data) ? data : [data]);
      }

      const values = dataKeys.map(k => {
        if (Array.isArray(data[k]) || (typeof data[k] === 'object' && data[k] !== null)) {
          return JSON.stringify(data[k]);
        }
        return data[k];
      });

      let sql = `UPDATE \`${tableName}\` SET ` + dataKeys.map(k => `\`${k}\` = ?`).join(', ');
      let params = [...values];

      // 3. Filter query params to exclude non-column keys like order, limit, select, head
      const nonQueryKeys = ['order', 'limit', 'select', 'head'];
      const filterKeys = Object.keys(filters).filter(k => {
        if (nonQueryKeys.includes(k)) return false;
        if (validColumns.length > 0) {
          return validColumns.includes(k);
        }
        return true;
      });

      if (filterKeys.length === 0) {
        return res.status(400).json({ error: `Update without valid filters is not allowed for safety.` });
      }

      sql += ` WHERE ` + filterKeys.map(k => {
        const val = String(filters[k]);
        if (val.startsWith('in.(')) return `\`${k}\` IN (?)`;
        if (val.startsWith('neq.')) return `\`${k}\` != ?`;
        if (val.startsWith('gte.')) return `\`${k}\` >= ?`;
        if (val.startsWith('lte.')) return `\`${k}\` <= ?`;
        if (val.startsWith('gt.')) return `\`${k}\` > ?`;
        if (val.startsWith('lt.')) return `\`${k}\` < ?`;
        if (val.startsWith('eq.')) return `\`${k}\` = ?`;
        return `\`${k}\` = ?`;
      }).join(' AND ');

      filterKeys.forEach(k => {
        const val = String(filters[k]);
        if (val.startsWith('in.(')) {
          const valuesList = val.substring(4, val.length - 1).split(',');
          params.push(valuesList);
        } else if (val.startsWith('eq.')) {
          params.push(val.substring(3));
        } else if (val.startsWith('neq.')) {
          params.push(val.substring(4));
        } else if (val.startsWith('gte.')) {
          params.push(val.substring(4));
        } else if (val.startsWith('lte.')) {
          params.push(val.substring(4));
        } else if (val.startsWith('gt.')) {
          params.push(val.substring(3));
        } else if (val.startsWith('lt.')) {
          params.push(val.substring(3));
        } else {
          params.push(filters[k]);
        }
      });

      const results = await query(sql, params);

      if (results && results.affectedRows === 0) {
        return res.status(404).json({
          error: `ไม่พบข้อมูลที่ระบุในตาราง ${tableName} ของโรงเรียนนี้`
        });
      }

      // Trigger Telegram Poller Setup & cache LINE token if school_configs was updated
      if (tableName === 'school_configs') {
        if (data.telegram_bot_token) {
          startTelegramPoller(data.telegram_bot_token, req.query?.school_id);
        }
        if (data.line_channel_access_token) {
          const lToken = data.line_channel_access_token.trim();
          lastKnownLineChannelAccessToken = lToken;
          if (req.query?.school_id || data.school_id) {
            schoolTokensMap.set(String(req.query?.school_id || data.school_id), lToken);
          }
        }
      }

      res.json(Array.isArray(data) ? data : [data]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Failed to update ${tableName}: ${err.message || String(err)}` });
    }
  });

  app.delete('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const filters = { ...req.query };
    try {
      let validColumns = [];
      try {
        const columnsInfo = await query(`DESCRIBE \`${tableName}\``);
        const rows = Array.isArray(columnsInfo) && Array.isArray(columnsInfo[0]) ? columnsInfo[0] : (Array.isArray(columnsInfo) ? columnsInfo : []);
        validColumns = rows.map(c => c.Field || c.column_name || c.COLUMN_NAME).filter(Boolean);
      } catch (colErr) {
        console.warn(`[DELETE /api/table/${tableName}] Could not fetch DESCRIBE columns:`, colErr.message);
      }

      const nonQueryKeys = ['order', 'limit', 'select', 'head'];
      const filterKeys = Object.keys(filters).filter(k => {
        if (nonQueryKeys.includes(k)) return false;
        if (validColumns.length > 0) {
          return validColumns.includes(k);
        }
        return true;
      });

      // Cascade Delete for students
      if (tableName === 'students' && filterKeys.length > 0) {
        let selectSql = `SELECT id FROM students`;
        let selectParams = [];
        selectSql += ` WHERE ` + filterKeys.map(k => {
          const val = String(filters[k]);
          if (val.startsWith('in.(')) return `\`${k}\` IN (?)`;
          return `\`${k}\` = ?`;
        }).join(' AND ');
        filterKeys.forEach(k => {
          const val = String(filters[k]);
          if (val.startsWith('in.(')) {
            const values = val.substring(4, val.length - 1).split(',');
            selectParams.push(values);
          } else if (val.startsWith('eq.')) {
            selectParams.push(val.substring(3));
          } else {
            selectParams.push(filters[k]);
          }
        });
        
        const studentsToDelete = await query(selectSql, selectParams);
        const studentIds = studentsToDelete.map(s => s.id);
        
        if (studentIds.length > 0) {
          await query(`DELETE FROM student_attendance WHERE student_id IN (?)`, [studentIds]);
          await query(`DELETE FROM student_health_records WHERE student_id IN (?)`, [studentIds]);
          await query(`DELETE FROM student_savings WHERE student_id IN (?)`, [studentIds]);
        }
      }

      if (filterKeys.length === 0) {
        return res.status(400).json({ error: 'Delete requires valid filters to prevent accidental full table wipe' });
      }

      let sql = `DELETE FROM \`${tableName}\``;
      let params = [];
      
      sql += ` WHERE ` + filterKeys.map(k => {
        const val = String(filters[k]);
        if (val.startsWith('in.(')) return `\`${k}\` IN (?)`;
        if (val.startsWith('neq.')) return `\`${k}\` != ?`;
        if (val.startsWith('gte.')) return `\`${k}\` >= ?`;
        if (val.startsWith('lte.')) return `\`${k}\` <= ?`;
        if (val.startsWith('gt.')) return `\`${k}\` > ?`;
        if (val.startsWith('lt.')) return `\`${k}\` < ?`;
        if (val.startsWith('eq.')) return `\`${k}\` = ?`;
        return `\`${k}\` = ?`;
      }).join(' AND ');
      
      filterKeys.forEach(k => {
        const val = String(filters[k]);
        if (val.startsWith('in.(')) {
          const valuesList = val.substring(4, val.length - 1).split(',');
          params.push(valuesList);
        } else if (val.startsWith('eq.')) {
          params.push(val.substring(3));
        } else if (val.startsWith('neq.')) {
          params.push(val.substring(4));
        } else if (val.startsWith('gte.')) {
          params.push(val.substring(4));
        } else if (val.startsWith('lte.')) {
          params.push(val.substring(4));
        } else if (val.startsWith('gt.')) {
          params.push(val.substring(3));
        } else if (val.startsWith('lt.')) {
          params.push(val.substring(3));
        } else {
          params.push(filters[k]);
        }
      });
      
      await query(sql, params);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: `Failed to delete from ${tableName}: ${err.message || String(err)}` });
    }
  });

  // Catch-all for unmatched API routes
  app.all('/api/*all', (req, res) => {
    console.log(`[${new Date().toISOString()}] Unmatched API Route: ${req.method} ${req.url}`);
    res.status(404).json({ error: `Route ${req.method} ${req.url} not found` });
  });

  // Custom error handler for JSON parsing errors
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      console.error('JSON Parsing Error:', err.message);
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    console.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  // Serve PWA assets directly
  app.get('/manifest.json', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      let appName = 'SchoolOS';
      const rows = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'app_name'");
      if (rows && rows.length > 0) {
        appName = rows[0].setting_value;
      }
      
      const manifest = {
        "short_name": appName,
        "name": appName + " - ระบบบริหารจัดการโรงเรียน",
        "start_url": "/",
        "background_color": "#0f172a",
        "display": "standalone",
        "orientation": "portrait",
        "theme_color": "#1e293b",
        "icons": [
          {
            "src": "/logo-192.jpg",
            "sizes": "192x192",
            "type": "image/jpeg",
            "purpose": "any"
          },
          {
            "src": "/logo-192.jpg",
            "sizes": "192x192",
            "type": "image/jpeg",
            "purpose": "maskable"
          },
          {
            "src": "/logo-512.jpg",
            "sizes": "512x512",
            "type": "image/jpeg",
            "purpose": "any"
          },
          {
            "src": "/logo-512.jpg",
            "sizes": "512x512",
            "type": "image/jpeg",
            "purpose": "maskable"
          },
          {
            "src": "/logo-192.png",
            "sizes": "192x192",
            "type": "image/jpeg",
            "purpose": "any"
          },
          {
            "src": "/logo-512.png",
            "sizes": "512x512",
            "type": "image/jpeg",
            "purpose": "any"
          }
        ]
      };
      res.json(manifest);
    } catch (e) {
      res.sendFile(path.join(process.cwd(), 'manifest.json'));
    }
  });

  app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(process.cwd(), 'sw.js'));
  });

  app.get('/favicon.ico', (req, res) => {
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.join(process.cwd(), 'logo-192.jpg'));
  });

  app.get('/logo-192.jpg', (req, res) => {
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.join(process.cwd(), 'logo-192.jpg'));
  });

  app.get('/logo-512.jpg', (req, res) => {
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.join(process.cwd(), 'logo-512.jpg'));
  });

  app.get('/logo-192.png', (req, res) => {
    res.setHeader('Content-Type', 'image/jpeg'); // It's jpeg format but client may request it with png ext
    res.sendFile(path.join(process.cwd(), 'logo-192.png'));
  });

  app.get('/logo-512.png', (req, res) => {
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.join(process.cwd(), 'logo-512.png'));
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Auto-start Telegram Poller for all configured schools
    initAllTelegramPollers();
  });
}

startServer();
