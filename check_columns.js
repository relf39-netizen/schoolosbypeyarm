
const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const [cols] = await connection.query('SHOW COLUMNS FROM documents');
  console.log('Documents Columns:', JSON.stringify(cols, null, 2));

  const [studentsCols] = await connection.query('SHOW COLUMNS FROM students');
  console.log('Students Columns:', JSON.stringify(studentsCols, null, 2));

  await connection.end();
}

check().catch(console.error);
