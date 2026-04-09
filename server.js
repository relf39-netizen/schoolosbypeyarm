import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Accessing the secret key from environment variables
const MY_SECRET_KEY = process.env.MY_SECRET_KEY;

if (!MY_SECRET_KEY) {
  console.warn('Warning: MY_SECRET_KEY is not defined in environment variables.');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

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
    queueLimit: 0
  });

  // Helper to handle SQL queries
  const query = async (sql, params = []) => {
    try {
      // Use query instead of execute to support ?? placeholders for identifiers
      const [results] = await pool.query(sql, params);
      return results;
    } catch (error) {
      console.error('Database Error:', error);
      throw error;
    }
  };

  // Database Initialization Function
  const initializeDatabase = async () => {
    try {
      const schema = [
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
          auto_check_out_time VARCHAR(255) DEFAULT '16:30'
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS attendance (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          school_id VARCHAR(255),
          teacher_id VARCHAR(255),
          date DATE,
          check_in TEXT,
          check_out TEXT,
          status VARCHAR(255),
          leave_type VARCHAR(255),
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
        )`
      ];

      for (const sql of schema) {
        await query(sql);
      }

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
            { name: 'telegram_chat_id', type: 'VARCHAR(255)' }
          ]
        },
        {
          table: 'school_configs',
          columns: [
            { name: 'official_garuda_base_64', type: 'LONGTEXT' },
            { name: 'officer_department', type: 'VARCHAR(255)' },
            { name: 'internal_departments', type: 'JSON' },
            { name: 'external_agencies', type: 'JSON' },
            { name: 'director_signature_base_64', type: 'LONGTEXT' },
            { name: 'director_signature_scale', type: 'FLOAT DEFAULT 1.0' },
            { name: 'director_signature_y_offset', type: 'FLOAT DEFAULT 0' }
          ]
        }
      ];

      for (const m of migrations) {
        for (const col of m.columns) {
          try {
            await query(`ALTER TABLE ?? ADD COLUMN ?? ${col.type}`, [m.table, col.name]);
          } catch (e) {
            // Ignore if column already exists
          }
        }
      }
      console.log('Database initialized and migrated successfully');
    } catch (err) {
      console.error('Database initialization error:', err);
    }
  };

  // Run initialization on startup
  await initializeDatabase();

  // API Routes
  
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

  // 3. Generic Table Access (for other tables)
  app.get('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const filters = { ...req.query };
    try {
      let sql = `SELECT * FROM ??`;
      let params = [tableName];
      
      const filterKeys = Object.keys(filters).filter(k => k !== 'order' && k !== 'limit');
      if (filterKeys.length > 0) {
        sql += ` WHERE ` + filterKeys.map(k => `?? = ?`).join(' AND ');
        filterKeys.forEach(k => {
          params.push(k, filters[k]);
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
      res.status(500).json({ error: `Failed to fetch from ${tableName}` });
    }
  });

  // Database Initialization (Manual Trigger)
  app.post('/api/init-db', async (req, res) => {
    try {
      await initializeDatabase();
      res.json({ 
        success: true, 
        message: 'ปรับปรุงโครงสร้างฐานข้อมูลเรียบร้อยแล้ว' 
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to initialize database' });
    }
  });

  app.post('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    let data = req.body;
    console.log(`[${new Date().toISOString()}] POST /api/table/${tableName} - Data size: ${JSON.stringify(data).length} bytes`);
    
    try {
      const uuidTables = ['students', 'class_rooms', 'student_savings', 'academic_years', 'director_events'];
      
      if (Array.isArray(data)) {
        console.log(`[${new Date().toISOString()}] Bulk insert into ${tableName}: ${data.length} items`);
        if (data.length === 0) return res.json({ success: true });
        
        // Ensure all items have IDs if needed
        if (uuidTables.includes(tableName)) {
          data = data.map(item => ({
            id: item.id || crypto.randomUUID(),
            ...item
          }));
        }

        const keys = Object.keys(data[0]);
        const values = [];
        const placeholders = data.map(() => `(${keys.map(() => '?').join(', ')})`).join(', ');
        
        data.forEach(item => {
          keys.forEach(k => {
            let val = item[k];
            if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
              val = JSON.stringify(val);
            }
            values.push(val);
          });
        });

        // Use ON DUPLICATE KEY UPDATE for bulk inserts too
        const updates = keys.filter(k => k !== 'id').map(k => `?? = VALUES(??)`).join(', ');
        const updateParams = [];
        keys.filter(k => k !== 'id').forEach(k => updateParams.push(k, k));

        let sql = `INSERT INTO ?? (??) VALUES ${placeholders}`;
        if (updates) {
          sql += ` ON DUPLICATE KEY UPDATE ${updates}`;
        }
        
        console.log(`[${new Date().toISOString()}] Executing bulk insert SQL for ${tableName}`);
        await query(sql, [tableName, keys, ...values, ...updateParams]);
      } else {
        // Single insert
        console.log(`[${new Date().toISOString()}] Single insert into ${tableName}`);
        if (!data.id && uuidTables.includes(tableName)) {
          data.id = crypto.randomUUID();
        }

        const keys = Object.keys(data);
        const values = keys.map(k => {
          if (Array.isArray(data[k]) || (typeof data[k] === 'object' && data[k] !== null)) {
            return JSON.stringify(data[k]);
          }
          return data[k];
        });
        
        const placeholders = keys.map(() => '?').join(', ');
        const updates = keys.map(k => `?? = ?`).join(', ');
        const updateParams = keys.flatMap(k => {
          const val = data[k];
          return [k, Array.isArray(val) || (typeof val === 'object' && val !== null) ? JSON.stringify(val) : val];
        });

        const sql = `INSERT INTO ?? (??) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;
        await query(sql, [tableName, keys, ...values, ...updateParams]);
      }
      
      console.log(`[${new Date().toISOString()}] Successfully saved to ${tableName}`);
      res.json({ success: true });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] API Error for ${tableName}:`, err);
      res.status(500).json({ error: `Failed to save to ${tableName}: ${err.message}` });
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
      if (filterKeys.length > 0) {
        sql += ` WHERE ` + filterKeys.map(k => `?? = ?`).join(' AND ');
        filterKeys.forEach(k => {
          params.push(k, filters[k]);
        });
      }
      
      await query(sql, params);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Failed to update ${tableName}` });
    }
  });

  app.delete('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const filters = { ...req.query };
    try {
      let sql = `DELETE FROM ??`;
      let params = [tableName];
      
      const filterKeys = Object.keys(filters);
      if (filterKeys.length > 0) {
        sql += ` WHERE ` + filterKeys.map(k => `?? = ?`).join(' AND ');
        filterKeys.forEach(k => {
          params.push(k, filters[k]);
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

  // Catch-all for unmatched API routes
  app.all('/api/*', (req, res) => {
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
  });
}

startServer();
