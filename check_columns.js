import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: parseInt(process.env.MYSQL_PORT || '3306')
  });

  const [rows] = await connection.execute("SHOW COLUMNS FROM student_attendance");
  console.log("Columns in student_attendance:", rows.map(r => r.Field));
  
  const [profiles] = await connection.execute("SHOW TABLES LIKE 'profiles'");
  console.log("Profiles table exists:", profiles.length > 0);

  const [teachers] = await connection.execute("SHOW TABLES LIKE 'teachers'");
  console.log("Teachers table exists:", teachers.length > 0);

  await connection.end();
}

check().catch(console.error);
