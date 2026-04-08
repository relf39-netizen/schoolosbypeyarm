import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // กำหนด root เป็นโฟลเดอร์ปัจจุบัน
  root: './',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    commonjsOptions: {
      transformMixedEsModules: true
    },
    // บังคับให้ esbuild ไม่ต้องพยายามหาไฟล์นอกเหนือจากโฟลเดอร์นี้
    target: 'es2020',
  },
  // ป้องกัน esbuild พยายามเข้าถึงโฟลเดอร์ที่ไม่มีสิทธิ์
  optimizeDeps: {
    esbuildOptions: {
      absWorkingDir: process.cwd(),
      target: 'es2020',
      supported: { 
        'top-level-await': true 
      },
    }
  },
  esbuild: {
    // ระบุ tsconfig ให้ชัดเจนเพื่อไม่ให้ esbuild พยายามหาไฟล์ข้างนอก
    tsconfigRaw: {
      compilerOptions: {
        jsx: 'react-jsx',
      }
    }
  }
})
