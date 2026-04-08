import { build } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function runBuild() {
  console.log('Starting production build via Vite API...')
  
  try {
    await build({
      // ปิดการโหลดไฟล์ config อัตโนมัติเพื่อเลี่ยงปัญหา Directory Traversal
      configFile: false,
      root: __dirname,
      base: './',
      plugins: [react()],
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 1000, // ขยายขีดจำกัดคำเตือนเป็น 1000kB
        commonjsOptions: {
          transformMixedEsModules: true
        },
        rollupOptions: {
          input: path.resolve(__dirname, 'index.html'),
          output: {
            // แยก Library หลักๆ ออกเป็นไฟล์ต่างหากเพื่อลดขนาดไฟล์ index และลบคำเตือน
            manualChunks: {
              'vendor-react': ['react', 'react-dom'],
              'vendor-ui': ['lucide-react', 'framer-motion'],
              'vendor-utils': ['xlsx', 'pdf-lib']
            }
          }
        }
      },
      // บังคับให้ esbuild ทำงานเฉพาะในโฟลเดอร์นี้
      optimizeDeps: {
        esbuildOptions: {
          absWorkingDir: __dirname
        }
      }
    })
    console.log('Build completed successfully!')
  } catch (error) {
    console.error('Build failed:', error)
    process.exit(1)
  }
}

runBuild()
