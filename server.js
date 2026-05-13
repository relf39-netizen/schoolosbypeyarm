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
      console.error('SQL:', sql);
      console.error('Params:', JSON.stringify(params).substring(0, 500) + (JSON.stringify(params).length > 500 ? '...' : ''));
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
    const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/telegram/webhook/${token}`;
    try {
      console.log(`[Telegram] Setting webhook for bot to: ${webhookUrl}`);
      const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl })
      });
      const result = await response.json();
      console.log(`[Telegram] SetWebhook result:`, result);
      return result;
    } catch (error) {
      console.error('Error setting Telegram webhook:', error);
      return { ok: false, error: error.message };
    }
  };

  // Telegram Webhook Endpoint
  app.post('/api/telegram/webhook/:token', async (req, res) => {
    const { token } = req.params;
    const update = req.body;

    console.log(`[Telegram] Received update for token ...${token.substring(token.length - 5)}`);

    if (update.message && update.message.text) {
      const { text, chat } = update.message;
      const chatId = chat.id.toString();

      // Handle /start [userId]
      if (text.startsWith('/start')) {
        const parts = text.split(' ');
        if (parts.length > 1) {
          const userId = parts[1].trim();
          console.log(`[Telegram] User ID [${userId}] linking with Chat ID [${chatId}]`);

          try {
            // First check if user exists
            const [user] = await query('SELECT id, name FROM profiles WHERE id = ?', [userId]);
            
            if (user) {
              // Update the profile with the chat ID
              await query(
                'UPDATE profiles SET telegram_chat_id = ? WHERE id = ?',
                [chatId, userId]
              );
              console.log(`[Telegram] Successfully linked Chat ID ${chatId} to user ${user.name} (${userId})`);
              await sendTelegramMessage(token, chatId, `✅ <b>เชื่อมต่อสำเร็จ!</b>\n\nบัญชีของท่าน (คุณ${user.name}) ได้รับการผูกกับระบบโรงเรียนเรียบร้อยแล้ว ท่านจะได้รับการแจ้งเตือนหนังสือราชการและการลาผ่านช่องทางนี้ครับ`);
            } else {
              console.warn(`[Telegram] User ID ${userId} not found in database`);
              await sendTelegramMessage(token, chatId, `❌ <b>ไม่พบข้อมูลผู้ใช้งาน</b>\n\nไม่พบรหัสผู้ใช้งาน "${userId}" ในระบบ\n\n<b>วิธีแก้ไข:</b>\n1. ตรวจสอบว่าท่านเข้าสู่ระบบในแอปแล้ว\n2. ลองกดปุ่มเชื่อมต่อจากเมนู "ข้อมูลส่วนตัว" อีกครั้งครับ`);
            }
          } catch (err) {
            console.error('[Telegram] Error during linking process:', err);
            await sendTelegramMessage(token, chatId, `⚠️ <b>เกิดข้อผิดพลาด</b>\n\nไม่สามารถบันทึกข้อมูลการเชื่อมต่อได้ในขณะนี้ กรุณาลองใหม่อีกครั้งภายหลังครับ`);
          }
        } else {
          await sendTelegramMessage(token, chatId, `👋 <b>ยินดีต้อนรับสู่ระบบแจ้งเตือน!</b>\n\nกรุณาเริ่มการเชื่อมต่อจากเมนู "ข้อมูลส่วนตัว" ภายในแอปพลิเคชัน เพื่อผูกบัญชีของท่านครับ`);
        }
      }
    }

    res.sendStatus(200);
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

  app.get('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const filters = { ...req.query };
    try {
      let sql = `SELECT * FROM ??`;
      let params = [tableName];
      
      const filterKeys = Object.keys(filters).filter(k => k !== 'order' && k !== 'limit' && k !== 'select' && k !== 'head');
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
      
      // Trigger Telegram Webhook Setup if school_configs was updated
      if (tableName === 'school_configs') {
        const config = Array.isArray(data) ? data[0] : data;
        if (config.telegram_bot_token && config.app_base_url) {
          setTelegramWebhook(config.telegram_bot_token, config.app_base_url);
        }
      }

      // --- Telegram Notifications ---
      try {
        if (tableName === 'documents' || tableName === 'leave_requests') {
          const item = Array.isArray(data) ? data[0] : data;
          const schoolId = item.school_id || item.schoolId;
          
          if (schoolId) {
            // Fetch school config for bot token
            const [config] = await query('SELECT telegram_bot_token FROM school_configs WHERE school_id = ?', [schoolId]);
            
            if (config && config.telegram_bot_token) {
              let message = '';
              let recipients = [];
              
              if (tableName === 'documents' && item.status !== 'Distributed') {
                message = `📄 <b>มีหนังสือราชการใหม่</b>\n\n📌 <b>เรื่อง:</b> ${item.title || 'ไม่มีหัวข้อ'}\n🏢 <b>จาก:</b> ${item.from || '-'}\n📅 <b>วันที่:</b> ${item.date || '-'}\n\nกรุณาเข้าสู่ระบบเพื่อตรวจสอบครับ`;
                // Documents go to Director and Document Officers
                recipients = await query(
                  'SELECT telegram_chat_id FROM profiles WHERE school_id = ? AND telegram_chat_id IS NOT NULL AND (roles LIKE ? OR roles LIKE ?)',
                  [schoolId, '%DIRECTOR%', '%DOCUMENT_OFFICER%']
                );
              } else if (tableName === 'leave_requests') {
                const results = await query('SELECT name FROM profiles WHERE id = ?', [item.teacher_id || item.teacherId]);
                const teacher = results[0];
                message = `📝 <b>มีการแจ้งขอลาใหม่</b>\n\n👤 <b>จาก:</b> ${teacher ? teacher.name : (item.teacher_id || 'ไม่ระบุ')}\n📅 <b>วันที่:</b> ${item.start_date || '-'} ถึง ${item.end_date || '-'}\n❓ <b>เหตุผล:</b> ${item.reason || '-'}\n\nกรุณาเข้าสู่ระบบเพื่อพิจารณาครับ`;
                // Leave requests go to Director and Vice Directors
                recipients = await query(
                  'SELECT telegram_chat_id FROM profiles WHERE school_id = ? AND telegram_chat_id IS NOT NULL AND (roles LIKE ? OR roles LIKE ?)',
                  [schoolId, '%DIRECTOR%', '%VICE_DIRECTOR%']
                );
              }
              
              if (message && recipients.length > 0) {
                for (const r of recipients) {
                  if (r.telegram_chat_id) {
                    sendTelegramMessage(config.telegram_bot_token, r.telegram_chat_id, message);
                  }
                }
              }
            }
          }
        }
      } catch (notifyErr) {
        console.error('Error sending Telegram notification:', notifyErr);
      }
      
      res.json(Array.isArray(data) ? data : [data]);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] API Error for ${tableName}:`, err);
      res.status(500).json({ error: `Failed to save to ${tableName}: ${err.message || String(err)}` });
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
      }
      
      await query(sql, params);

      // Trigger Telegram Webhook Setup if school_configs was updated
      if (tableName === 'school_configs' && data.telegram_bot_token && data.app_base_url) {
        setTelegramWebhook(data.telegram_bot_token, data.app_base_url);
      }

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
