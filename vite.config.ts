
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // แก้ปัญหาหน้าจอขาวจาก process.env ที่เรียกใช้ใน supabaseClient.ts
    'process.env': process.env
  },
  server: {
    host: true
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true
    }
  }
})
