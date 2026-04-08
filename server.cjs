const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

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
    queueLimit: 0
  });

  // Helper to handle SQL queries
  const query = async (sql, params = []) => {
    try {
      const [results] = await pool.query(sql, params);
      return results;
    } catch (error) {
      console.error('Database Error:', error);
      throw error;
    }
  };

  // Function to ensure all tables exist
  const ensureTablesExist = async () => {
    console.log('Checking database tables...');
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
      `CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(36) PRIMARY KEY,
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
  await ensureTablesExist().catch(err => console.error('Initial Table Check Failed:', err));

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

        // 2. Fetch data from Supabase
        const { data, error } = await supabaseSource.from(table).select('*');
        
        if (error) {
          results.push({ table, status: 'error', message: `Supabase Error: ${error.message}` });
          continue;
        }

        if (!data || data.length === 0) {
          results.push({ table, status: 'skipped', message: 'ไม่พบข้อมูลใน Supabase' });
          continue;
        }

        let successCount = 0;
        let failCount = 0;
        let lastError = null;
        let columnMismatch = false;

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
      if (filterKeys.length === 0) {
        return res.status(400).json({ error: `Update without filters is not allowed for safety.` });
      }
      
      sql += ` WHERE ` + filterKeys.map(k => `?? = ?`).join(' AND ');
      filterKeys.forEach(k => {
        params.push(k, filters[k]);
      });
      
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
