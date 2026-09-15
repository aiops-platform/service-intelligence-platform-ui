import { createRouter, createWebHistory } from 'vue-router'
import { flattenItems, PANEL_ID, DEFAULT_SLUG, MIGRATED, SLUG_ALIASES, EMPTY_DOMAINS } from './nav'
import { ensureLegacyBooted } from '@/legacy/bridge'

/**
 * 未迁移视图的占位组件。
 *
 * 真正的 DOM 是持久存在的 LegacyPanels（15 个 legacy 面板 + 12 个模态），
 * 由路由 meta.legacy 控制显隐 —— 每个路由**不能**各自挂一份，否则每次切页都会
 * 重挂整棵 legacy 树，重跑 app.js 的 17 个 init fetch 与 8 个 setInterval。
 */
const LegacyPanelHost = { name: 'LegacyPanelHost', template: '<span />' }

/**
 * 已迁移视图的真实组件。键必须同时在 nav.js 的 MIGRATED 集合里 ——
 * `meta.legacy` 由它决定，两者不一致会出现「组件渲染了但 legacy 面板没隐藏」。
 */
const VIEW_COMPONENTS = {
  'log-analysis': () => import('@/views/log-analysis/LogAnalysisView.vue'),
  'bug-solve': () => import('@/views/bug-solve/BugSolveView.vue'),
  tickets: () => import('@/views/tickets/TicketsView.vue'),
  'agent-registry': () => import('@/views/agents/AgentsView.vue'),
}

/** 不在侧边栏里的 Vue 原生页（动态路由 / 详情页） */
const EXTRA_ROUTES = [
  {
    path: '/runs/:runId',
    name: 'run-detail',
    component: () => import('@/views/runs/RunDetailView.vue'),
    meta: { label: 'Run 详情', legacy: false },
  },
]

/** 取某 slug 的路由路径与别名 */
function routeFor(item) {
  const aliases = Object.entries(SLUG_ALIASES)
    .filter(([, canonical]) => canonical === item.slug)
    .map(([alias]) => `/${alias}`)
  return {
    path: `/${item.slug}`,
    name: item.slug,
    alias: aliases,
    component: VIEW_COMPONENTS[item.slug] || LegacyPanelHost,
    meta: {
      label: item.label,
      panelId: PANEL_ID[item.slug],
      legacy: !MIGRATED.has(item.slug),
    },
  }
}

/**
 * 不在任何侧边栏里的独立页面。
 *
 * `service-ops`（域概览页）**只**能由默认值和顶部导航落过来，侧边栏里没有它 ——
 * 所以 flattenItems() 不会产出它。早期版本漏了这条，导致 `/service-ops` 匹配不到路由、
 * 落到 catch-all 再重定向回 `/service-ops` → **无限重定向（Maximum call stack size exceeded）**。
 */
const STANDALONE_PAGES = [{ slug: DEFAULT_SLUG, label: 'Service Ops' }]

/**
 * 空壳域里**已经接了真实组件**的。
 *
 * 目前只有 Constellation —— 它内嵌 SIP 部署站那份 Next.js 页面
 * （见 src/views/constellation/ConstellationView.vue 里的说明）。
 *
 * ⚠️ 注意这里**不适用** nav.js 里那条「MIGRATED 与 VIEW_COMPONENTS 两处必须同时改」的规矩：
 * 那条针对的是**侧边栏叶子**（会经 flattenItems() 产出路由）。空壳域不在任何侧边栏里，
 * 走的是下面 emptyDomainRoutes 这条独立分支，所以只需要在这里登记一次。
 *
 * 其余 4 个空壳域（architecture / finops / security-ops / value-pool）仍是空壳。
 */
const DOMAIN_COMPONENTS = {
  constellation: () => import('@/views/constellation/ConstellationView.vue'),
}

/**
 * 空壳域各自一条路由。
 * 没有专属组件的落到 service-ops 概览（改造前 initNavigation 的 else 分支语义）；
 * 有组件的（Constellation）直接渲染，并把 meta.legacy 置 false ——
 * **这个标记必须跟组件一致**：它为 true 时 App.vue 会继续显示 LegacyPanels，
 * 于是同一个位置出现两套内容（本轮迁移踩过同类问题）。
 *
 * 这样高亮域、footer 文案、页面标题全部由 URL 派生，不依赖组件内的覆盖状态。
 */
const emptyDomainRoutes = EMPTY_DOMAINS.map((d) => {
  const own = DOMAIN_COMPONENTS[d.key]
  return {
    path: `/${d.key}`,
    name: `domain-${d.key}`,
    component: own || LegacyPanelHost,
    meta: {
      label: d.label,
      domainKey: d.key,
      panelId: PANEL_ID[DEFAULT_SLUG],
      legacy: !own,
    },
  }
})

const routes = [
  { path: '/', redirect: `/${DEFAULT_SLUG}` },
  ...[...flattenItems(), ...STANDALONE_PAGES].map(routeFor),
  ...emptyDomainRoutes,
  ...EXTRA_ROUTES,
  // 落到底默认页，而不是抛 404（改造前任何未知入口也都落到 Service Ops）
  { path: '/:pathMatch(.*)*', redirect: `/${DEFAULT_SLUG}` },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

/**
 * 切页守卫：替代改造前 showPage() 的调用点。
 *
 * 旧世界的 `_pageRefreshers`（10 处注册）**原样保留生效** —— 它们挂在 showPage 内部，
 * 这里只要把 panelId 递过去即可，不需要改动那 10 处。
 *
 * 已迁移的视图不用这条路径（它们用 onActivated 自己做刷新）。
 */
router.afterEach(async (to) => {
  if (!to.meta.legacy) return
  try {
    await ensureLegacyBooted()
    window.__SIP_SHOW_PAGE?.(to.meta.panelId)
  } catch (err) {
    console.error('[sip] 切页时旧世界装载失败：', err)
  }
})

/**
 * 接缝 S3：旧代码的跨页下钻改走路由。
 *
 * 改造前是 `navigateToPage(pageId, context)` —— 把 context 塞 sessionStorage 再切页。
 * 现在 context 变成 URL query：可分享、可刷新、可前进后退。
 */
export function installLegacyBridge() {
  window.__SIP_NAVIGATE = (pageId, context) => {
    const slug = (() => {
      if (!pageId) return DEFAULT_SLUG
      const s = String(pageId)
      if (s.startsWith('page-')) {
        const hit = Object.entries(PANEL_ID).find(([, pid]) => pid === s)
        return hit ? hit[0] : s.slice(5)
      }
      return SLUG_ALIASES[s] || s
    })()
    return router.push({ path: `/${slug}`, query: context || {} })
  }
}
