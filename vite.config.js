import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

/**
 * public/ 里的**目录索引**：Vite 不解析它。
 *
 * Vite 用 sirv 伺服 public/，但 `/business-ops/` 这种「目录 + 尾斜杠」不会被解析成
 * `business-ops/index.html` —— **实测**它直接落到 SPA 兜底，返回 Vue 应用自己的 index.html。
 * 后果是 Business Ops 那个内嵌 iframe 里**渲染出 Vue 应用自己**（自己套自己）。
 *
 * 生产**不需要**这个插件：nginx 的 `try_files $uri $uri/ /index.html` 本来就解析目录索引。
 * 这里只为补齐 dev 与 preview —— preview 不继承 server 的中间件，所以要各配一次。
 *
 * 为什么不能换个路径绕开：内层页面用 `usePathname()` 查面板表决定 h1，路径必须精确是
 * `/business-ops` / `/service-ops`。详见 src/views/business-ops/BusinessOpsView.vue。
 *
 * ## 只拦「带尾斜杠」的请求（`/service-ops`、`/architecture` 必须留给 SPA）
 *
 * Business Ops 那边 Vue 路由叫 `/biz-ops`、内嵌页在 `/business-ops/`，**两边不同名**，
 * 所以怎么拦都不打架。Service Ops 与 Architecture 两边**同名**：一旦把 `/service-ops`
 * 也拦下来，直接访问或刷新 `/service-ops`（书签、外链、F5）拿到的是那个裸的内嵌页 ——
 * 没有 AppHeader / AppFooter / 侧边栏，Vue 应用根本不启动，用户卡在没有导航的页面上。
 *
 * 所以只拦尾斜杠结尾的请求：iframe 的 src 本来就写 `/service-ops/`，
 * 而 `/service-ops` 落到 SPA 兜底，Vue 应用照常启动。`/architecture`、`/security-ops`、
 * `/finops` 同理。
 *
 * ⚠️ 生产端要同步：通用 `try_files $uri $uri/ /index.html` 会把这四个无斜杠路径
 * 经 `$uri/` 解成目录索引，同样吐内嵌页 —— nginx 需在通用规则**之前**各补一条
 * `location = /<页> { try_files /index.html =404; }`。见 README 的 nginx 片段。
 *
 * ## 列表里另有一类：**不同名**的目录索引页
 *
 * `/business-ops` 与 `/engineering-ops` 属于这一类 —— 它们的 Vue 路由分别叫
 * `/biz-ops` 与 `/eng-ops`（NAV 里的 key），与内嵌页路径不同名，所以**生产 nginx
 * 不需要**那条 `location =`（没有同名 Vue 路由会被目录索引抢走）。
 * 但它们**仍然要列在这里**：这个列表的一半职责是给 dev/preview 补
 * 「Vite 不解析 public/ 目录索引」，那是与同名冲突无关的另一件事。
 */
const EMBED_PAGES = ['/business-ops', '/service-ops', '/architecture',
                     '/security-ops', '/finops', '/engineering-ops']

function sipEmbedPageIndex() {
  // dev 读源目录 public/，preview 读产物 dist/ —— configResolved 里才拿得到这两个值
  const dirs = {}
  const handler = (which) => (req, res, next) => {
    const raw = (req.url || '/').split('?')[0]
    // 只认目录请求。少了这一句，`/service-ops` 会被内嵌页抢走（见上面那段说明）。
    if (!raw.endsWith('/')) return next()
    const path = raw.replace(/\/+$/, '') || '/'
    if (!EMBED_PAGES.includes(path) || !dirs[which]) return next()
    const file = resolve(dirs[which], `.${path}`, 'index.html')
    let body
    try {
      body = readFileSync(file)
    } catch {
      return next() // 还没构建过就交给 SPA 兜底，别把请求吞掉
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.end(body)
  }
  return {
    name: 'sip-embed-page-index',
    configResolved(cfg) {
      dirs.serve = cfg.publicDir
      dirs.preview = resolve(cfg.root, cfg.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use(handler('serve'))
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler('preview'))
    },
  }
}

/**
 * 后端转发规则。dev 与 preview **都要用** —— Vite 的 preview server 不继承 `server.proxy`，
 * 只配 server 的话 `npm run preview` 会连不上后端、页面看着像坏了。
 */
const proxy = {
  // sip-aiops 的真实路径就是 /api/sip-aiops/...，同名前缀直通，不 rewrite
  '/api/sip-aiops': { target: 'http://localhost:8080', changeOrigin: true },
  // agentflow 的路由挂在根路径（/workflows、/runs/{id}），加前缀后需剥掉
  '/agentflow': {
    target: 'http://localhost:8000',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/agentflow/, ''),
  },
  // CMDB 编辑面在 datasource MCP server 上，路径是 /admin/cmdb/**。
  // 用 /api/cmdb 这个更贴合前端习惯的前缀，rewrite 回真实路径。
  '/api/cmdb': {
    target: 'http://localhost:8300',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/api\/cmdb/, '/admin/cmdb'),
  },
}

export default defineConfig({
  plugins: [vue(), sipLegacyDevServe(), sipLegacyBuildCopy(), sipEmbedPageIndex()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
