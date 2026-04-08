import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

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
      const [results] = await pool.execute(sql, params);
      return results;
    } catch (error) {
      console.error('Database Error:', error);
      throw error;
    }
  };

  // API Routes
  
  // 1. Schools
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

  // Database Initialization
  app.post('/api/init-db', async (req, res) => {
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
          name VARCHAR(255) NOT NULL,
          current_class VARCHAR(255) NOT NULL,
          academic_year VARCHAR(255) NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
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
      res.json({ success: true, message: 'Database initialized successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to initialize database' });
    }
  });

  app.post('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const data = req.body;
    try {
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
      
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `Failed to save to ${tableName}` });
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
