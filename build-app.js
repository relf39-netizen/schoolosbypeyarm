import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

// บังคับให้ Node.js, Vite, React และ esbuild รันในโหมด Production 100%
process.env.NODE_ENV = 'production';

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ตรวจสอบและสลับไปใช้ esbuild-wasm หาก native esbuild ทำงานไม่ได้บน CloudLinux/CageFS (แก้ปัญหา Aborted core dumped)
try {
  const esbuildPath = path.resolve(__dirname, 'node_modules', 'esbuild', 'bin', 'esbuild')
  const esbuildWasmPath = path.resolve(__dirname, 'node_modules', 'esbuild-wasm', 'bin', 'esbuild')
  
  if (fs.existsSync(esbuildPath) && fs.existsSync(esbuildWasmPath)) {
    let nativeWorks = false
    try {
      execFileSync(esbuildPath, ['--version'], { stdio: 'ignore', timeout: 3000 })
      nativeWorks = true
    } catch (_) {
      nativeWorks = false
    }

    if (!nativeWorks) {
      console.log('⚠️ ตรวจพบว่า native esbuild binary ถูกจำกัดโดยระบบโฮสติ้ง (CloudLinux / CageFS)')
      console.log('🔄 สลับไปใช้ esbuild-wasm (WebAssembly) อัตโนมัติเพื่อป้องกัน Aborted core dumped...')
      const esbuildLibMain = path.resolve(__dirname, 'node_modules', 'esbuild', 'lib', 'main.js')
      const wasmLibMain = path.resolve(__dirname, 'node_modules', 'esbuild-wasm', 'lib', 'main.js')
      if (fs.existsSync(wasmLibMain)) fs.copyFileSync(wasmLibMain, esbuildLibMain)
      fs.copyFileSync(esbuildWasmPath, esbuildPath)
      const wasmFileSrc = path.resolve(__dirname, 'node_modules', 'esbuild-wasm', 'esbuild.wasm')
      const wasmFileDest = path.resolve(__dirname, 'node_modules', 'esbuild', 'esbuild.wasm')
      if (fs.existsSync(wasmFileSrc)) fs.copyFileSync(wasmFileSrc, wasmFileDest)
      const wasmExecNodeSrc = path.resolve(__dirname, 'node_modules', 'esbuild-wasm', 'wasm_exec_node.js')
      const wasmExecNodeDest = path.resolve(__dirname, 'node_modules', 'esbuild', 'wasm_exec_node.js')
      if (fs.existsSync(wasmExecNodeSrc)) fs.copyFileSync(wasmExecNodeSrc, wasmExecNodeDest)
      console.log('✅ สลับมาใช้ WebAssembly Engine สำเร็จแล้ว!')
    }
  }
} catch (e) {
  // Ignore fallback check errors
}

import { build } from 'vite'
import react from '@vitejs/plugin-react'

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
        chunkSizeWarningLimit: 2000,
        sourcemap: false,
        reportCompressedSize: false,
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
    
    // Copy public assets to dist directory
    const fs = await import('fs');
    const filesToCopy = ['sw.js', 'manifest.json', 'logo-192.jpg', 'logo-512.jpg', 'logo-192.png', 'logo-512.png'];
    const distPath = path.resolve(__dirname, 'dist');
    for (const f of filesToCopy) {
      const src = path.resolve(__dirname, f);
      const dest = path.resolve(distPath, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied ${f} to dist/`);
      }
    }
  } catch (error) {
    console.error('Build failed:', error)
    process.exit(1)
  }
}

runBuild()
