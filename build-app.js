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
        commonjsOptions: {
          transformMixedEsModules: true
        },
        rollupOptions: {
          input: path.resolve(__dirname, 'index.html'),
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
