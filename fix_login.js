
import mysql from 'mysql2/promise';

async function fix() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'school_os',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    // ตรวจสอบว่ามีโรงเรียนหรือยัง ถ้าไม่มีให้สร้างโรงเรียนตัวอย่าง
    const [schools] = await pool.query('SELECT id FROM schools LIMIT 1');
    let schoolId = '12345678';
    if (schools.length === 0) {
      await pool.query('INSERT INTO schools (id, name) VALUES (?, ?)', [schoolId, 'โรงเรียนตัวอย่าง']);
      console.log('Created sample school');
    } else {
      schoolId = schools[0].id;
    }

    // เพิ่มหรืออัปเดตผู้ใช้งาน
    const userId = '3300600837116';
    const [users] = await pool.query('SELECT id FROM profiles WHERE id = ?', [userId]);
    
    if (users.length === 0) {
      await pool.query(
        'INSERT INTO profiles (id, school_id, name, password, position, roles, is_approved) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, schoolId, 'ผู้ดูแลระบบ', '123456789', 'ผู้อำนวยการ', JSON.stringify(['SYSTEM_ADMIN', 'DIRECTOR']), 1]
      );
      console.log('Added user 3300600837116 successfully');
    } else {
      await pool.query(
        'UPDATE profiles SET password = ?, is_approved = 1, roles = ? WHERE id = ?',
        ['123456789', JSON.stringify(['SYSTEM_ADMIN', 'DIRECTOR']), userId]
      );
      console.log('Updated user 3300600837116 successfully');
    }
  } catch (err) {
    console.error('Error fixing login:', err.message);
  } finally {
    await pool.end();
  }
}

fix();
