
import mysql from 'mysql2/promise';

async function check() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'school_os',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    const [columns] = await pool.query('SHOW COLUMNS FROM students');
    console.log('Columns in students table:');
    columns.forEach(c => console.log(`- ${c.Field}: ${c.Type}`));
  } catch (err) {
    console.error('Error checking students table:', err.message);
  } finally {
    await pool.end();
  }
}

check();
