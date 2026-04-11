
const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: process.env.MYSQL_PORT || 3306
  });

  try {
    const [rows] = await connection.query('DESCRIBE documents');
    console.log('Columns in documents table:');
    rows.forEach(row => {
      console.log(`${row.Field}: ${row.Type}`);
    });
  } catch (err) {
    console.error('Error describing documents:', err);
  } finally {
    await connection.end();
  }
}

check();
