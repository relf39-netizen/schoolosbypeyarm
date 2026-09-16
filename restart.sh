#!/bin/bash
# สคริปต์ Restart สำหรับ cPanel / CloudLinux Node.js App (Phusion Passenger)
echo "🔄 กำลังสั่ง Restart Node.js Application..."
mkdir -p tmp && touch tmp/restart.txt
pkill -f "Passenger NodeApp" 2>/dev/null
echo "✅ Restart สำเร็จเรียบร้อยแล้ว!"
