import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * js/app.js 原地保留（未迁移的 15 个视图仍由它驱动），但它不是 ESM、也不在 public/ 下。
 * 拆成两个插件，各自限定 apply —— 早期版本写成单个插件 + `apply: 'build'`，
 * 结果 configureServer 在 dev 下根本不执行，Vite 会给这个 470KB 的文件追加约 2.4MB
 * 的 inline sourcemap（功能无损但纯浪费）。
 */

/** dev：以 classic script 原样伺服 /js/app.js，不经过 Vite 的转换 */
function sipLegacyDevServe() {
  return {
    name: 'sip-legacy-dev-serve',
    apply: 'serve',
    configureServer(server) {
      // 在 Vite 内置中间件之前注册，确保拿到的是原文件
      server.middlewares.use('/js/app.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(new URL('./js/app.js', import.meta.url)))
      })
    },
  }
}

/** build：把它复制进 dist/js/，供发布产物直接引用 */
function sipLegacyBuildCopy() {
  return {
    name: 'sip-legacy-build-copy',
    apply: 'build',
    closeBundle() {
      mkdirSync('dist/js', { recursive: true })
      copyFileSync('js/app.js', 'dist/js/app.js')
    },
  }
}

export default defineConfig({
  plugins: [vue(), sipLegacyDevServe(), sipLegacyBuildCopy()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      // sip-aiops 的真实路径就是 /api/sip-aiops/...，同名前缀直通，不 rewrite
      '/api/sip-aiops': { target: 'http://localhost:8080', changeOrigin: true },
      // agentflow 的路由挂在根路径（/workflows、/runs/{id}），加前缀后需剥掉
      '/agentflow': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/agentflow/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
