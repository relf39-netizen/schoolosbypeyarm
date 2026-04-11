
const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'school_os',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    const uuidTables = ['students', 'class_rooms', 'student_savings', 'student_attendance', 'student_health_records', 'academic_years', 'director_events', 'profiles', 'schools', 'documents', 'finance_accounts', 'finance_transactions'];
    for (const table of uuidTables) {
      try {
        const [cols] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
        const idCol = cols.find(c => (c.Field || c.column_name || c.COLUMN_NAME) === 'id');
        if (idCol) {
          console.log(`Table: ${table.padEnd(25)} | ID Type: ${idCol.Type || idCol.type}`);
        } else {
          console.log(`Table: ${table.padEnd(25)} | ID Column NOT FOUND`);
        }
      } catch (e) {
        console.log(`Table: ${table.padEnd(25)} | Error: ${e.message}`);
      }
    }
  } finally {
    await pool.end();
  }
}

check();
