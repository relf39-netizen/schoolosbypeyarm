import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  server: {
    host: true,
    port: 3000,
    fs: {
      // จำกัดการเข้าถึงไฟล์ให้อยู่ในโฟลเดอร์โปรเจกต์เท่านั้น
      allow: [__dirname]
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    commonjsOptions: {
      transformMixedEsModules: true
    },
    rollupOptions: {
      // ป้องกันปัญหาการหาไฟล์ไม่เจอในบางระบบ
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  }
})
