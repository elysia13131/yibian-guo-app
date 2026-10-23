import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// 构建时读取版本号
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))
const versionCodeFile = path.resolve(__dirname, '.versioncode')
const versionCode = parseInt(fs.existsSync(versionCodeFile) ? fs.readFileSync(versionCodeFile, 'utf-8').trim() : '0', 10)

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
    __APP_VERSION_CODE__: versionCode,
  },
  plugins: [
    react(),
    {
      name: 'troika-patch',
      transform(code, id) {
        if (id.includes('troika-') && id.endsWith('.js')) {
          return code
            .replace(/PlaneBufferGeometry/g, 'PlaneGeometry')
            .replace(/CylinderBufferGeometry/g, 'CylinderGeometry')
            .replace(/SphereBufferGeometry/g, 'SphereGeometry')
            .replace(/BoxBufferGeometry/g, 'BoxGeometry')
            .replace(/RingBufferGeometry/g, 'RingGeometry')
        }
        return code
      },
    },
  ],
  build: {
    rollupOptions: {
      external: ['@capacitor/app', /^\.\.\/plugins\/AppUpdate/],
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/modelbest': {
        target: 'https://api.modelbest.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/modelbest/, '/v1'),
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              delete proxyRes.headers['content-encoding']
            }
          })
        },
      },
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              delete proxyRes.headers['content-encoding']
            }
          })
        },
      },
      '/uploads': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})