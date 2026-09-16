#!/bin/bash
# สคริปต์ Build สำหรับ cPanel / CloudLinux Hosting
echo "🚀 กำลังเริ่ม Build ระบบ SchoolOS..."
export GOMAXPROCS=1
export NODE_OPTIONS="--max-old-space-size=1024"

node build-app.js

if [ $? -eq 0 ]; then
  echo "✅ Build สำเร็จเรียบร้อยแล้ว!"
  echo "👉 อย่าลืมกดปุ่ม Restart ในหน้า Setup Node.js App บน cPanel ครับ"
else
  echo "❌ Build ไม่สำเร็จ กรุณาตรวจสอบว่าได้กด Stop App ใน cPanel ก่อนหรือยัง"
fi
