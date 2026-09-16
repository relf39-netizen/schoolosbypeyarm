#!/bin/bash
# สคริปต์ Build สำหรับ cPanel / CloudLinux Hosting
echo "🚀 กำลังเคลียร์ Process ที่ค้างอยู่บน cPanel..."
pkill -f "esbuild" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 1

echo "🚀 กำลังเริ่ม Build ระบบ SchoolOS (Production Mode)..."
export NODE_ENV=production
export GOMAXPROCS=1
export ESBUILD_WORKER_THREADS=0
export NODE_OPTIONS="--max-old-space-size=1024"

node build-app.js

if [ $? -eq 0 ]; then
  echo "✅ Build สำเร็จเรียบร้อยแล้ว!"
  # สั่ง Restart cPanel Node.js App อัตโนมัติผ่าน Passenger restart.txt
  mkdir -p tmp && touch tmp/restart.txt
  echo "🔄 ทำการ Restart Node.js App เรียบร้อยแล้ว (ผ่าน tmp/restart.txt)!"
else
  echo "❌ หากยังติด thread limit กรุณาใช้ไฟล์ dist ที่ Build จาก GitHub ได้ทันทีโดยไม่ต้องรัน Build บนเซิร์ฟเวอร์ครับ"
fi
