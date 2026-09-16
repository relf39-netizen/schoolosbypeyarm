import path from 'path'
import { fileURLToPath } from 'url'

// บังคับให้ Node.js, Vite, React และ esbuild รันในโหมด Production 100%
process.env.NODE_ENV = 'production';
process.env.GOMAXPROCS = '1';
process.env.ESBUILD_WORKER_THREADS = '0';

import { build } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function runBuild() {
  console.log('Starting production build via Vite API...')
  
  try {
    await build({
      mode: 'production',
      configFile: false,
      root: __dirname,
      base: './',
      plugins: [
        react({
          jsxRuntime: 'automatic'
        })
      ],
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      esbuild: {
        jsx: 'automatic',
        jsxDev: false, // ห้ามใช้ jsxDEV เด็ดขาด เพื่อป้องกัน error r.jsxDEV is not a function ใน production
        drop: ['debugger'],
      },
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 1500,
        commonjsOptions: {
          transformMixedEsModules: true
        },
        rollupOptions: {
          input: path.resolve(__dirname, 'index.html'),
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom', 'react/jsx-runtime'],
              'vendor-ui': ['lucide-react', 'framer-motion'],
              'vendor-utils': ['xlsx', 'pdf-lib']
            }
          }
        }
      },
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
