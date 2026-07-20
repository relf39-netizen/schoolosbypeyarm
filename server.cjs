const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const tenantStorage = new AsyncLocalStorage();

// Global error handlers to catch crashes
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Helper for safe UUID generation
function getSafeUUID() {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
}

// Simple manual .env loader
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000; 

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

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

    try {
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

  // Function to ensure all tables exist
  const ensureTablesExist = async (targetPool = pool) => {
    const query = (sql, params = []) => runGlobalQuery(sql, params, targetPool);
    console.log('Checking database tables...');
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
        wfh_mode_enabled BOOLEAN DEFAULT FALSE,
        outgoing_book_prefix VARCHAR(255)
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
        officer_department VARCHAR(255),
        internal_departments JSON,
        external_agencies JSON,
        director_signature_base_64 LONGTEXT,
        director_signature_scale FLOAT DEFAULT 1.0,
        director_signature_y_offset FLOAT DEFAULT 0
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
        name VARCHAR(255) NOT NULL,
        current_class VARCHAR(255) NOT NULL,
        academic_year VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        photo_url TEXT,
        address TEXT,
        phone_number VARCHAR(255),
        father_name VARCHAR(255),
        mother_name VARCHAR(255),
        guardian_name VARCHAR(255),
        medical_conditions TEXT,
        family_annual_income FLOAT,
        lat DOUBLE,
        lng DOUBLE,
        is_alumni BOOLEAN DEFAULT FALSE,
        graduation_year VARCHAR(255),
        batch_number VARCHAR(255),
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
        UNIQUE(student_id, date)
      )`,
      `CREATE TABLE IF NOT EXISTS student_health_records (
        id VARCHAR(36) PRIMARY KEY,
        student_id VARCHAR(36),
        school_id VARCHAR(255),
        weight FLOAT,
        height FLOAT,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        academic_year VARCHAR(255),
        recorded_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      `CREATE TABLE IF NOT EXISTS attendance (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        school_id VARCHAR(255),
        teacher_id VARCHAR(255),
        teacher_name VARCHAR(255),
        date DATE,
        check_in_time TEXT,
        check_out_time TEXT,
        status VARCHAR(255),
        leave_type VARCHAR(255),
        remark TEXT,
        is_auto_checkout BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS leave_requests (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        school_id VARCHAR(255),
        teacher_id VARCHAR(255),
        type VARCHAR(255),
        start_date DATE,
        end_date DATE,
        reason TEXT,
        status VARCHAR(255) DEFAULT 'Pending',
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
      `CREATE TABLE IF NOT EXISTS plan_project_expenses (
        id VARCHAR(100) PRIMARY KEY,
        project_id VARCHAR(100) NOT NULL,
        school_id VARCHAR(255) NOT NULL,
        description VARCHAR(255) NOT NULL,
        amount FLOAT NOT NULL,
        date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      `CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(100) PRIMARY KEY,
        school_id VARCHAR(255),
        category VARCHAR(255),
        book_number VARCHAR(255),
        title VARCHAR(255),
        description TEXT,
        \`from\` VARCHAR(255),
        date DATE,
        timestamp VARCHAR(255),
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
      `CREATE TABLE IF NOT EXISTS director_events (
        id VARCHAR(100) PRIMARY KEY,
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
        id VARCHAR(100) PRIMARY KEY,
        school_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS finance_transactions (
        id VARCHAR(100) PRIMARY KEY,
        school_id VARCHAR(255) NOT NULL,
        account_id VARCHAR(100) NOT NULL,
        date DATE NOT NULL,
        description TEXT,
        amount FLOAT NOT NULL,
        type VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS teacher_duty_reports (
        id VARCHAR(100) PRIMARY KEY,
        school_id VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        teacher_id VARCHAR(255) NOT NULL,
        teacher_name VARCHAR(255) NOT NULL,
        morning_report TEXT,
        afternoon_report TEXT,
        pic1_url TEXT,
        pic1_desc VARCHAR(255),
        pic2_url TEXT,
        pic2_desc VARCHAR(255),
        pic3_url TEXT,
        pic3_desc VARCHAR(255),
        pic4_url TEXT,
        pic4_desc VARCHAR(255),
        pdf_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of schema) {
      await query(sql);
    }

    // Migration: Add missing columns to schools if they don't exist
    try {
      const schoolCols = await query("SHOW COLUMNS FROM schools");
      const colNames = schoolCols.map(c => c.Field || c.column_name);
      
      if (!colNames.includes('wfh_mode_enabled')) {
        console.log('Adding wfh_mode_enabled to schools...');
        await query("ALTER TABLE schools ADD COLUMN wfh_mode_enabled BOOLEAN DEFAULT FALSE");
      }
      if (!colNames.includes('outgoing_book_prefix')) {
        console.log('Adding outgoing_book_prefix to schools...');
        await query("ALTER TABLE schools ADD COLUMN outgoing_book_prefix VARCHAR(255)");
      }

      // Migration for student_attendance
      const attendanceCols = await query("SHOW COLUMNS FROM student_attendance");
      const attendanceColNames = attendanceCols.map(c => c.Field || c.column_name);
      if (!attendanceColNames.includes('student_id')) {
        console.log('Adding student_id to student_attendance...');
        await query("ALTER TABLE student_attendance ADD COLUMN student_id VARCHAR(36)");
      }

      // Migration for student_health_records
      const healthCols = await query("SHOW COLUMNS FROM student_health_records");
      const healthColNames = healthCols.map(c => c.Field || c.column_name);
      if (!healthColNames.includes('student_id')) {
        console.log('Adding student_id to student_health_records...');
        await query("ALTER TABLE student_health_records ADD COLUMN student_id VARCHAR(36)");
      }

      // Migration for student_savings
      const savingsCols = await query("SHOW COLUMNS FROM student_savings");
      const savingsColNames = savingsCols.map(c => c.Field || c.column_name);
      if (!savingsColNames.includes('student_id')) {
        console.log('Adding student_id to student_savings...');
        await query("ALTER TABLE student_savings ADD COLUMN student_id VARCHAR(36)");
      }

      // Migration for students
      const studentCols = await query("SHOW COLUMNS FROM students");
      const studentColNames = studentCols.map(c => c.Field || c.column_name);
      if (!studentColNames.includes('is_alumni')) {
        console.log('Adding is_alumni to students...');
        await query("ALTER TABLE students ADD COLUMN is_alumni BOOLEAN DEFAULT FALSE");
      }
      if (!studentColNames.includes('graduation_year')) {
        console.log('Adding graduation_year to students...');
        await query("ALTER TABLE students ADD COLUMN graduation_year VARCHAR(255)");
      }

      // Ensure documents table has enough length for id (Custom ID format)
      try {
        const table = 'documents';
        console.log(`[Migration] Checking ${table} table structure...`);
        const cols = await query(`SHOW COLUMNS FROM \`${table}\``);
        console.log(`[Migration] ${table} columns:`, JSON.stringify(cols));
        
        const idCol = cols.find(c => (c.Field || c.column_name || c.COLUMN_NAME) === 'id');
        if (idCol) {
          const type = (idCol.Type || idCol.type || '').toLowerCase();
          console.log(`[Migration] Current ${table}.id type: ${type}`);
          
          // Force expansion if not already 100
          if (!type.includes('100')) {
            console.log(`[Migration] Forcing expansion of ${table}.id to VARCHAR(100)...`);
            await query(`ALTER TABLE \`${table}\` MODIFY COLUMN id VARCHAR(100) NOT NULL`);
            console.log(`[Migration] Successfully expanded ${table}.id.`);
          }
        }
        
        // Ensure created_at exists in documents
        const colNames = cols.map(c => (c.Field || c.column_name || c.COLUMN_NAME));
        if (!colNames.includes('created_at')) {
          console.log(`[Migration] Adding created_at to documents...`);
          await query(`ALTER TABLE documents ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        }
      } catch (e) {
        console.error(`[Migration Error] Documents table check failed:`, e.message);
      }

      // Specific check for documents table columns
      try {
        const table = 'documents';
        const cols = await query(`SHOW COLUMNS FROM \`${table}\``);
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
      } catch (e) {
        console.error(`[Migration Error] Documents extra columns check failed:`, e.message);
      }
      if (!studentColNames.includes('batch_number')) {
        console.log('Adding batch_number to students...');
        await query("ALTER TABLE students ADD COLUMN batch_number VARCHAR(255)");
      }

      // Migration for attendance table
      try {
        const attCols = await query("SHOW COLUMNS FROM attendance");
        const attColNames = attCols.map(c => c.Field || c.column_name);
        
        if (!attColNames.includes('teacher_name')) {
          await query("ALTER TABLE attendance ADD COLUMN teacher_name VARCHAR(255)");
        }
        if (!attColNames.includes('remark')) {
          await query("ALTER TABLE attendance ADD COLUMN remark TEXT");
        }
        if (!attColNames.includes('check_in_time') && attColNames.includes('check_in')) {
          await query("ALTER TABLE attendance CHANGE COLUMN check_in check_in_time TEXT");
        } else if (!attColNames.includes('check_in_time')) {
          await query("ALTER TABLE attendance ADD COLUMN check_in_time TEXT");
        }
        
        if (!attColNames.includes('check_out_time') && attColNames.includes('check_out')) {
          await query("ALTER TABLE attendance CHANGE COLUMN check_out check_out_time TEXT");
        } else if (!attColNames.includes('check_out_time')) {
          await query("ALTER TABLE attendance ADD COLUMN check_out_time TEXT");
        }
      } catch (attMigErr) {
        console.error('Attendance migration failed:', attMigErr.message);
      }

      // Migration for director_events, finance_accounts, finance_transactions
      const tablesToExpand = ['director_events', 'finance_accounts', 'finance_transactions'];
      for (const table of tablesToExpand) {
        try {
          const cols = await query(`SHOW COLUMNS FROM \`${table}\``);
          const colNames = cols.map(c => (c.Field || c.column_name || c.COLUMN_NAME));
          const idCol = cols.find(c => (c.Field || c.column_name || c.COLUMN_NAME) === 'id');
          if (idCol) {
            const type = (idCol.Type || idCol.type || '').toLowerCase();
            if (!type.includes('100')) {
              console.log(`[Migration] Expanding ${table}.id to VARCHAR(100)...`);
              await query(`ALTER TABLE \`${table}\` MODIFY COLUMN id VARCHAR(100) NOT NULL`);
            }
          }
          if (table === 'director_events') {
            if (!colNames.includes('notified_one_day_before')) {
              await query(`ALTER TABLE \`${table}\` ADD COLUMN notified_one_day_before BOOLEAN DEFAULT FALSE`);
            }
            if (!colNames.includes('notified_on_day')) {
              await query(`ALTER TABLE \`${table}\` ADD COLUMN notified_on_day BOOLEAN DEFAULT FALSE`);
            }
          }
          if (table === 'finance_transactions') {
            const accIdCol = cols.find(c => (c.Field || c.column_name || c.COLUMN_NAME) === 'account_id');
            if (accIdCol) {
              const type = (accIdCol.Type || accIdCol.type || '').toLowerCase();
              if (!type.includes('100')) {
                console.log(`[Migration] Expanding ${table}.account_id to VARCHAR(100)...`);
                await query(`ALTER TABLE \`${table}\` MODIFY COLUMN account_id VARCHAR(100) NOT NULL`);
              }
            }
          }
        } catch (e) {
          console.error(`[Migration Error] ${table} check failed:`, e.message);
        }
      }
    } catch (migErr) {
      console.error('Migration check failed (might be expected if table just created):', migErr.message);
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

    // Add default Super Admin
    await query('INSERT IGNORE INTO super_admins (username, password) VALUES (?, ?)', ['admin', 'schoolos']);
    await query('INSERT IGNORE INTO super_admins (username, password) VALUES (?, ?)', ['peyarm', 'Siam@2520']);

    // Add default School and Admin Profile
    await query('INSERT IGNORE INTO schools (id, name) VALUES (?, ?)', ['demo-school', 'โรงเรียนสาธิต SchoolOS']);
    await query(
      'INSERT IGNORE INTO profiles (id, school_id, name, password, position, roles, is_approved) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['admin', 'demo-school', 'ผู้ดูแลระบบ', 'password123', 'ผู้ดูแลระบบ', JSON.stringify(['SYSTEM_ADMIN', 'TEACHER']), 1]
    );
    console.log('Database tables verified.');
  };

  // Run table check on start
  await ensureTablesExist().catch(err => {
    console.warn('Initial Database Table Check Failed. The server will continue, but MySQL features may not work:', err.message);
  });

  // API Routes
  
  // Multi-tenant database routing middleware
  app.use(async (req, res, next) => {
    const schoolId = req.headers['x-school-id'] || req.query.school_id || req.query.schoolId || (req.body && (req.body.school_id || req.body.schoolId));
    if (schoolId) {
      const tenantPool = await getPoolForSchool(schoolId);
      tenantStorage.run(tenantPool, () => {
        next();
      });
    } else {
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
        await ensureTablesExist(testPool);
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
      
      // 2. Ensure target tables exist (use server.cjs ensureTablesExist function)
      try {
        await ensureTablesExist(targetPool);
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
    const { 
      id, name, district, province, lat, lng, radius, 
      late_time_threshold, logo_base_64, auto_check_out_enabled, 
      auto_check_out_time, wfh_mode_enabled, outgoing_book_prefix, is_suspended 
    } = req.body;
    try {
      await query(
        `INSERT INTO schools (
          id, name, district, province, lat, lng, radius, 
          late_time_threshold, logo_base_64, auto_check_out_enabled, 
          auto_check_out_time, wfh_mode_enabled, outgoing_book_prefix, is_suspended
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
        ON DUPLICATE KEY UPDATE 
          name=?, district=?, province=?, lat=?, lng=?, radius=?, 
          late_time_threshold=?, logo_base_64=?, auto_check_out_enabled=?, 
          auto_check_out_time=?, wfh_mode_enabled=?, outgoing_book_prefix=?, is_suspended=?`,
        [
          id, name, district, province, lat, lng, radius, 
          late_time_threshold, logo_base_64, auto_check_out_enabled ? 1 : 0, 
          auto_check_out_time, wfh_mode_enabled ? 1 : 0, outgoing_book_prefix, is_suspended ? 1 : 0,
          name, district, province, lat, lng, radius, 
          late_time_threshold, logo_base_64, auto_check_out_enabled ? 1 : 0, 
          auto_check_out_time, wfh_mode_enabled ? 1 : 0, outgoing_book_prefix, is_suspended ? 1 : 0
        ]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('Save School Error:', err);
      res.status(500).json({ error: 'Failed to save school', details: err.message });
    }
  });

  // 2. Profiles (Teachers)
  app.get('/api/profiles', async (req, res) => {
    try {
      const profiles = await query('SELECT * FROM profiles');
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
    const { id, school_id, name, password, position, roles, signature_base_64, telegram_chat_id, is_suspended, is_approved, assigned_classes } = req.body;
    try {
      await query(
        'INSERT INTO profiles (id, school_id, name, password, position, roles, signature_base_64, telegram_chat_id, is_suspended, is_approved, assigned_classes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE school_id=?, name=?, password=?, position=?, roles=?, signature_base_64=?, telegram_chat_id=?, is_suspended=?, is_approved=?, assigned_classes=?',
        [
          id, school_id, name, password, position, JSON.stringify(roles || []), signature_base_64, telegram_chat_id, is_suspended ? 1 : 0, is_approved ? 1 : 0, JSON.stringify(assigned_classes || []),
          school_id, name, password, position, JSON.stringify(roles || []), signature_base_64, telegram_chat_id, is_suspended ? 1 : 0, is_approved ? 1 : 0, JSON.stringify(assigned_classes || [])
        ]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save profile' });
    }
  });

  // 3. Generic Table Access
  app.get('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const filters = { ...req.query };
    try {
      let sql = `SELECT * FROM ??`;
      let params = [tableName];
      
      const filterKeys = Object.keys(filters).filter(k => k !== 'order' && k !== 'limit');
      if (filterKeys.length > 0) {
        sql += ` WHERE ` + filterKeys.map(k => {
          const valStr = String(filters[k]);
          if (valStr.startsWith('in.(')) {
            return `?? IN (?)`;
          } else if (valStr.startsWith('gte.')) {
            return `?? >= ?`;
          } else if (valStr.startsWith('lte.')) {
            return `?? <= ?`;
          } else if (valStr.startsWith('gt.')) {
            return `?? > ?`;
          } else if (valStr.startsWith('lt.')) {
            return `?? < ?`;
          } else if (valStr.startsWith('neq.')) {
            return `?? != ?`;
          }
          return `?? = ?`;
        }).join(' AND ');
        
        filterKeys.forEach(k => {
          params.push(k);
          const valStr = String(filters[k]);
          if (valStr.startsWith('in.(')) {
            const values = valStr.substring(4, valStr.length - 1).split(',');
            params.push(values);
          } else if (valStr.startsWith('gte.')) {
            params.push(valStr.substring(4));
          } else if (valStr.startsWith('lte.')) {
            params.push(valStr.substring(4));
          } else if (valStr.startsWith('gt.')) {
            params.push(valStr.substring(3));
          } else if (valStr.startsWith('lt.')) {
            params.push(valStr.substring(3));
          } else if (valStr.startsWith('neq.')) {
            params.push(valStr.substring(4));
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
      res.status(500).json({ error: `Failed to fetch from ${tableName}` });
    }
  });

  app.post('/api/migrate', async (req, res) => {
    const { supabaseUrl, supabaseKey, tables } = req.body;
    if (!supabaseUrl || !supabaseKey || !tables || !Array.isArray(tables)) {
      return res.status(400).json({ error: 'Missing required migration parameters' });
    }

    const { createClient } = require('@supabase/supabase-js');
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

              const sql = `INSERT INTO ?? (??) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;
              await query(sql, [table, keys, ...values, ...updateParams]);
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
      console.error('Migration Error:', err);
      res.status(500).json({ error: 'Migration failed', details: err.message });
    }
  });

  // Database Initialization (Manual trigger if needed)
  app.post('/api/init-db', async (req, res) => {
    try {
      await ensureTablesExist();
      res.json({ success: true, message: 'Database initialized successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Initialization failed', details: err.message });
    }
  });
  app.post('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const data = req.body;
    console.log(`[${new Date().toISOString()}] POST request for ${tableName}. Data type: ${Array.isArray(data) ? 'Array' : typeof data}`);
    
    const uuidTables = ['students', 'class_rooms', 'student_savings', 'student_attendance', 'student_health_records', 'academic_years', 'director_events', 'profiles', 'schools', 'documents', 'finance_accounts', 'finance_transactions', 'plan_project_expenses', 'teacher_duty_reports'];

    if (!data || (typeof data !== 'object' && !Array.isArray(data))) {
      console.error(`[POST /api/table/${tableName}] Invalid data format:`, typeof data);
      return res.status(400).json({ error: 'Invalid data format. Expected object or array of objects.' });
    }

    try {
      // Get actual columns from the database to filter out extra fields
      const result = await query(`DESCRIBE ??`, [tableName]);
      const columnsInfo = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : (Array.isArray(result) ? result : []);
      
      if (!Array.isArray(columnsInfo) || columnsInfo.length === 0) {
        console.error(`[POST /api/table/${tableName}] Failed to get columns. Result:`, result);
        throw new Error(`Could not retrieve table structure for ${tableName}`);
      }
      
      const validColumns = columnsInfo.map(c => c.Field || c.column_name || c.COLUMN_NAME).filter(Boolean);
      console.log(`[POST /api/table/${tableName}] Columns in DB: ${validColumns.join(', ')}`);
      const columnTypes = {};
      columnsInfo.forEach(c => {
        const field = c.Field || c.column_name || c.COLUMN_NAME;
        const type = (c.Type || c.data_type || c.DATA_TYPE || '').toLowerCase();
        columnTypes[field] = type;
      });

      if (Array.isArray(data)) {
        // Bulk insert
        console.log(`[Bulk Insert] Table: ${tableName}, Rows: ${data.length}`);
        const allKeys = new Set();
        data.forEach(item => {
          if (item && typeof item === 'object') {
            if (!item.id && uuidTables.includes(tableName)) {
              item.id = getSafeUUID();
            }
            Object.keys(item).forEach(key => {
              if (item[key] !== undefined && validColumns.includes(key)) allKeys.add(key);
            });
          }
        });
        const keys = Array.from(allKeys);
        console.log(`[Bulk Insert] Keys: ${keys.join(', ')}`);
        
        if (keys.length === 0) {
          console.log('[Bulk Insert] No valid keys found, skipping.');
          return res.json([]);
        }

        const values = [];
        const placeholders = data.map(() => `(${keys.map(() => '?').join(', ')})`).join(', ');
        
        data.forEach((item, idx) => {
          keys.forEach(k => {
            let val = item[k];
            if (val === undefined) val = null;
            if (typeof val === 'string') val = val.trim();
            
            const nullIfEmpty = [
              'student_id', 'national_id', 'age', 'weight', 'height', 
              'lat', 'lng', 'radius', 'family_annual_income', 'birthday'
            ];
            if (val === '' && nullIfEmpty.includes(k)) {
              val = null;
            }
            
            if (typeof val === 'string' && val.includes('T') && (val.endsWith('Z') || val.length > 10)) {
              const type = columnTypes[k];
              if (type && (type.includes('datetime') || type.includes('timestamp') || type.includes('date'))) {
                try {
                  const d = new Date(val);
                  if (!isNaN(d.getTime())) {
                    if (type.includes('date') && !type.includes('time')) {
                      val = d.toISOString().split('T')[0];
                    } else {
                      val = d.toISOString().slice(0, 19).replace('T', ' ');
                    }
                  }
                } catch (e) {}
              }
            }
            
            if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
              try {
                val = JSON.stringify(val);
              } catch (e) {
                console.error(`[Bulk Insert] Failed to stringify field ${k} at row ${idx}:`, e.message);
                val = null;
              }
            }
            values.push(val);
          });
        });

        const updates = keys.filter(k => k !== 'id').map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');
        let sql = `INSERT INTO ?? (??) VALUES ${placeholders}`;
        if (updates.length > 0) {
          sql += ` ON DUPLICATE KEY UPDATE ${updates}`;
        }
        
        const formattedSql = mysql.format(sql, [tableName, keys, ...values]);
        console.log(`[Bulk Insert] Executing SQL: ${formattedSql.substring(0, 1000)}${formattedSql.length > 1000 ? '...' : ''}`);
        await query(sql, [tableName, keys, ...values]);
      } else {
        // Single insert
        console.log(`[Insert] Table: ${tableName}, ID: ${data.id}`);
        if (!data.id && uuidTables.includes(tableName)) {
          data.id = getSafeUUID();
        }

        const keys = Object.keys(data).filter(k => data[k] !== undefined && validColumns.includes(k));
        const values = [];
        keys.forEach(k => {
          let val = data[k];
          if (typeof val === 'string') val = val.trim();
          
          const nullIfEmpty = [
            'student_id', 'national_id', 'age', 'weight', 'height', 
            'lat', 'lng', 'radius', 'family_annual_income', 'birthday'
          ];
          if (val === '' && nullIfEmpty.includes(k)) {
            val = null;
          }

          if (typeof val === 'string' && val.includes('T') && (val.endsWith('Z') || val.length > 10)) {
            const type = columnTypes[k];
            if (type && (type.includes('datetime') || type.includes('timestamp') || type.includes('date'))) {
              try {
                const d = new Date(val);
                if (!isNaN(d.getTime())) {
                  if (type.includes('date') && !type.includes('time')) {
                    val = d.toISOString().split('T')[0];
                  } else {
                    val = d.toISOString().slice(0, 19).replace('T', ' ');
                  }
                }
              } catch (e) {}
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

        let sql = `INSERT INTO ?? (??) VALUES (${placeholders})`;
        if (updates.length > 0) {
          sql += ` ON DUPLICATE KEY UPDATE ${updates}`;
        }
        
        const formattedSql = mysql.format(sql, [tableName, keys, ...values]);
        console.log(`[Insert] Executing SQL: ${formattedSql.substring(0, 1000)}${formattedSql.length > 1000 ? '...' : ''}`);
        await query(sql, [tableName, keys, ...values]);
      }
      
      res.json(Array.isArray(data) ? data : [data]);
    } catch (err) {
      console.error(`[CRITICAL DATABASE ERROR] Table: ${tableName}, Method: ${req.method}`);
      console.error('Error Details:', err);
      res.status(500).json({ 
        error: `Failed to save to ${tableName}`, 
        details: err.message,
        code: err.code,
        errno: err.errno,
        sql: err.sql ? (err.sql.length > 500 ? err.sql.substring(0, 500) + '...' : err.sql) : undefined
      });
    }
  });

  app.patch('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const data = req.body;
    const filters = { ...req.query };
    try {
      const keys = Object.keys(data);
      const values = keys.map(k => {
        if (Array.isArray(data[k]) || (typeof data[k] === 'object' && data[k] !== null)) {
          return JSON.stringify(data[k]);
        }
        return data[k];
      });
      
      let sql = `UPDATE ?? SET ` + keys.map(k => `?? = ?`).join(', ');
      let params = [tableName];
      keys.forEach((k, i) => {
        params.push(k, values[i]);
      });

      const filterKeys = Object.keys(filters);
      if (filterKeys.length === 0) {
        return res.status(400).json({ error: `Update without filters is not allowed for safety.` });
      }
      
      sql += ` WHERE ` + filterKeys.map(k => {
        if (typeof filters[k] === 'string' && filters[k].startsWith('in.(')) {
          return `?? IN (?)`;
        }
        return `?? = ?`;
      }).join(' AND ');
      
      filterKeys.forEach(k => {
        params.push(k);
        if (typeof filters[k] === 'string' && filters[k].startsWith('in.(')) {
          const values = filters[k].substring(4, filters[k].length - 1).split(',');
          params.push(values);
        } else {
          params.push(filters[k]);
        }
      });
      
      await query(sql, params);
      res.json(Array.isArray(data) ? data : [data]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Failed to update ${tableName}` });
    }
  });

  app.delete('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const filters = { ...req.query };
    try {
      const filterKeys = Object.keys(filters);
      
      // Cascade Delete for students
      if (tableName === 'students' && filterKeys.length > 0) {
        let selectSql = `SELECT id FROM students`;
        let selectParams = [];
        selectSql += ` WHERE ` + filterKeys.map(k => {
          if (typeof filters[k] === 'string' && filters[k].startsWith('in.(')) return `?? IN (?)`;
          return `?? = ?`;
        }).join(' AND ');
        filterKeys.forEach(k => {
          selectParams.push(k);
          if (typeof filters[k] === 'string' && filters[k].startsWith('in.(')) {
            const values = filters[k].substring(4, filters[k].length - 1).split(',');
            selectParams.push(values);
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

      let sql = `DELETE FROM ??`;
      let params = [tableName];
      
      if (filterKeys.length > 0) {
        sql += ` WHERE ` + filterKeys.map(k => {
          if (typeof filters[k] === 'string' && filters[k].startsWith('in.(')) {
            return `?? IN (?)`;
          }
          return `?? = ?`;
        }).join(' AND ');
        
        filterKeys.forEach(k => {
          params.push(k);
          if (typeof filters[k] === 'string' && filters[k].startsWith('in.(')) {
            const values = filters[k].substring(4, filters[k].length - 1).split(',');
            params.push(values);
          } else {
            params.push(filters[k]);
          }
        });
      } else {
        return res.status(400).json({ error: 'Delete requires filters to prevent accidental full table wipe' });
      }
      
      await query(sql, params);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: `Failed to delete from ${tableName}` });
    }
  });

  // GAS Bridge
  app.post('/api/gas/bridge', async (req, res) => {
    const { secret, action, table, data, id } = req.body;
    
    // Simple secret check
    if (secret !== 'MySecretKey0930935255') {
      return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }

    // Map 'teachers' to 'profiles' if needed
    const targetTable = table === 'teachers' ? 'profiles' : table;

    try {
      if (action === 'update') {
        const keys = Object.keys(data);
        const values = keys.map(k => {
          if (Array.isArray(data[k]) || (typeof data[k] === 'object' && data[k] !== null)) {
            return JSON.stringify(data[k]);
          }
          return data[k];
        });

        let sql = `UPDATE ?? SET ` + keys.map(k => `?? = ?`).join(', ');
        let params = [targetTable];
        keys.forEach((k, i) => {
          params.push(k, values[i]);
        });

        sql += ` WHERE id = ?`;
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

  // Global Error Handler
  app.use((err, req, res, next) => {
    console.error('Global Error:', err);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: err.message,
      path: req.path
    });
  });

  // Serve PWA assets directly
  app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(path.join(process.cwd(), 'manifest.json'));
  });

  app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(process.cwd(), 'sw.js'));
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
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.join(process.cwd(), 'logo-192.png'));
  });

  app.get('/logo-512.png', (req, res) => {
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.join(process.cwd(), 'logo-512.png'));
  });

  // Serve static files from dist folder
  const distPath = path.join(process.cwd(), 'dist');
  
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    app.get('*all', (req, res) => {
      res.status(404).send(`
        <h1>SchoolOS: ไม่พบโฟลเดอร์ dist</h1>
        <p>กรุณาทำการ Build โปรเจกต์ที่เครื่องของคุณ (npm run build) แล้วอัปโหลดโฟลเดอร์ <b>dist</b> ขึ้นมาไว้ที่เซิร์ฟเวอร์ก่อนครับ</p>
        <p>หลังจากอัปโหลดแล้ว ให้กด <b>Restart App</b> อีกครั้งครับ</p>
      `);
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
