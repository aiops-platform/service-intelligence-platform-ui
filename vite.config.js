import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 部署形态：由启动脚本 scripts/vite-with-base.mjs 探测后经 `VITE_BASE` 传入
 * （显式覆盖 > 本机 nginx 是否有指到本应用的 `/sip/` location > '/'）。
 *
 * 为什么 base 必须在**构建时**定：它会被焊进 `dist/index.html` 的资源引用。
 * base='/' 的产物放到 `/sip/` 下，资源会全部 404。
 *
 * 与之相对，**后端地址**是在**浏览器启动时**判定的（见 js/app.js / src/api/config.js）——
 * 那部分与 base 无关，靠 `location.hostname` 区分「浏览器与后端同不同机」。
 */
const BASE = process.env.VITE_BASE || '/'

/** base 去掉尾斜杠后的前缀：BASE='/' → ''；BASE='/sip/' → '/sip'。 */
const PREFIX = BASE.replace(/\/$/, '')

/**
 * js/app.js 原地保留（未迁移的 15 个视图仍由它驱动），但它不是 ESM、也不在 public/ 下。
 * 拆成两个插件，各自限定 apply —— 早期版本写成单个插件 + `apply: 'build'`，
 * 结果 configureServer 在 dev 下根本不执行，Vite 会给这个 470KB 的文件追加约 2.4MB
 * 的 inline sourcemap（功能无损但纯浪费）。
 *
 * ⚠️ **两个插件拿到的都是「原始 URL」，没剥过 base。** Vite 的中间件顺序是
 * 「插件钩子 → proxy → baseMiddleware」—— baseMiddleware 把 `/sip/` 剥掉是**最后**一步
 * （dev 与 preview 均如此，Vite 6.4.3 实测）。所以下面凡是要比对路径的地方，
 * 都得自己先剥 `PREFIX`，否则在 base='/sip/' 下**一条都匹配不上**：
 * dev 里 7 个内嵌 iframe 会落到 SPA 兜底、自己套自己，`js/app.js` 还会被 Vite 追加
 * 那 2.4MB 的 sourcemap。preview 恰好由 baseMiddleware→sirv 兜住了目录索引，
 * 所以这个坑只在 dev 暴露 —— 长期只跑 preview 就看不见。
 */

/** dev：以 classic script 原样伺服 `<base>js/app.js`，不经过 Vite 的转换 */
function sipLegacyDevServe() {
  return {
    name: 'sip-legacy-dev-serve',
    apply: 'serve',
    configureServer(server) {
      // 在 Vite 内置中间件之前注册，确保拿到的是原文件。
      // 挂载点必须带 base —— 见上面那段「原始 URL」说明。
      server.middlewares.use(`${BASE}js/app.js`, (_req, res) => {
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
 * （子路径部署时那条规则与 `location ^~ /sip/` 不冲突：`^~` 是前缀最长匹配，优先于 `=` 之外的规则。）
 *
 * ## 列表里另有一类：**不同名**的目录索引页
 *
 * `/business-ops` 与 `/engineering-ops` 属于这一类 —— 它们的 Vue 路由分别叫
 * `/biz-ops` 与 `/eng-ops`（NAV 里的 key），与内嵌页路径不同名，所以**生产 nginx
 * 不需要**那条 `location =`（没有同名 Vue 路由会被目录索引抢走）。
 * 但它们**仍然要列在这里**：这个列表的一半职责是给 dev/preview 补
 * 「Vite 不解析 public/ 目录索引」，那是与同名冲突无关的另一件事。
 *
 * ⚠️ 这里是**不含 base 的裸路径**，`check-embed-wiring.py` 也按这个形态断言。
 */
const EMBED_PAGES = ['/business-ops', '/service-ops', '/architecture',
                     '/security-ops', '/finops', '/engineering-ops']

function sipEmbedPageIndex() {
  // dev 读源目录 public/，preview 读产物 dist/ —— configResolved 里才拿得到这两个值
  const dirs = {}
  const handler = (which) => (req, res, next) => {
    const raw = (req.url || '/').split('?')[0]
    // 先剥 base：本钩子跑在 baseMiddleware **之前**，拿到的是原始 URL（见文件开头说明）
    const path0 = PREFIX && raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw
    // 只认目录请求。少了这一句，`/service-ops` 会被内嵌页抢走（见上面那段说明）。
    if (!path0.endsWith('/')) return next()
    const path = path0.replace(/\/+$/, '') || '/'
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
 *
 * 下面**三条是原样**：base='/' 时浏览器请求的就是这些裸路径，等价于改造前。
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

/**
 * 子路径部署时，浏览器请求的是 `<PREFIX>/agentflow` 等 —— 补上带前缀的**同义条目**。
 * 用追加而不是改写上面三条：这样本机构型下这份 proxy 与改造前逐字一致。
 *
 * `/apm-api` 是这次新接的 APM 后端（:7070）；本机构型**不需要**它 ——
 * 那时 js/app.js 走的是绝对地址 http://localhost:7070，不经过 proxy。
 */
if (PREFIX) {
  proxy[`${PREFIX}/api/sip-aiops`] = {
    target: 'http://localhost:8080', changeOrigin: true,
  }
  proxy[`${PREFIX}/agentflow`] = {
    target: 'http://localhost:8000',
    changeOrigin: true,
    rewrite: (p) => p.replace(new RegExp(`^${PREFIX}/agentflow`), ''),
  }
  proxy[`${PREFIX}/api/cmdb`] = {
    target: 'http://localhost:8300',
    changeOrigin: true,
    rewrite: (p) => p.replace(new RegExp(`^${PREFIX}/api/cmdb`), '/admin/cmdb'),
  }
  proxy[`${PREFIX}/apm-api`] = {
    target: 'http://localhost:7070',
    changeOrigin: true,
    rewrite: (p) => p.replace(new RegExp(`^${PREFIX}/apm-api`), ''),
  }
}

export default defineConfig({
  base: BASE,
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
