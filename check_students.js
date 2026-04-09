
const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: process.env.MYSQL_PORT || 3306
  });

  try {
    const [columns] = await connection.query('SHOW COLUMNS FROM students');
    console.log('Columns in students table:');
    columns.forEach(col => {
      console.log(`- ${col.Field}: ${col.Type} (Null: ${col.Null}, Key: ${col.Key})`);
    });
  } catch (err) {
    console.error('Error checking students table:', err.message);
  } finally {
    await connection.end();
  }
}

check();
