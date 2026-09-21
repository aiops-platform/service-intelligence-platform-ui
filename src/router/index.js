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

/**
 * 不在侧边栏里的 Vue 原生页（动态路由 / 详情页 / 工具页）。
 *
 * `/cmdb` 是 CMDB 实体图谱的浏览与编辑页 —— 它是本仓**第一个会写数据**的页面
 * （其余都是查询）。数据源不是 agentflow / sip-aiops，而是 aiops-datasource-mcp-server
 * 的实体文件，走那台服务新增的 `/admin/cmdb/**` 端点。见 `src/views/cmdb/`。
 *
 * **它刻意不属于任何域**：这是一张给少数人用的运维工具表，不是产品叙事的一部分，
 * 所以不进顶栏的 9 个域、也不进任何侧边栏。入口在头部右上的用户菜单里
 * （点姓名 → 编辑 CMDB）。放进某个域会让它出现在演示动线的导航里。
 */
const EXTRA_ROUTES = [
  {
    path: '/runs/:runId',
    name: 'run-detail',
    component: () => import('@/views/runs/RunDetailView.vue'),
    meta: { label: 'Run 详情', legacy: false },
  },
  {
    path: '/cmdb',
    name: 'cmdb',
    component: () => import('@/views/cmdb/CmdbView.vue'),
    // `standalone: true` —— 该页**不属于任何导航域**（nav.js 里没有它）：
    // 显示侧边栏会把 Service Ops 的导航挂在一个跟它无关的页面上（见 App.vue 的 showSidebar）。
    meta: { label: 'CMDB', legacy: false, standalone: true },
  },
]

/**
 * 取某 slug 的路由路径与别名。
 *
 * `item.component` 是给 STANDALONE_PAGES 用的第三条登记口（不是侧边栏叶子、也不是空壳域）。
 * ⚠️ **它必须和 `legacy: false` 成对出现** —— 上面 VIEW_COMPONENTS 那条注释说的
 * 「组件渲染了但 legacy 面板没隐藏」在这里同样成立：`App.vue` 的
 * `<LegacyPanels v-show="isLegacyRoute">` 与 `<RouterView v-if="!isLegacyRoute">` 是兄弟节点，
 * `meta.legacy` 判错就会两个内容挤在同一个槽位里。
 */
function routeFor(item) {
  const aliases = Object.entries(SLUG_ALIASES)
    .filter(([, canonical]) => canonical === item.slug)
    .map(([alias]) => `/${alias}`)
  return {
    path: `/${item.slug}`,
    name: item.slug,
    alias: aliases,
    component: item.component || VIEW_COMPONENTS[item.slug] || LegacyPanelHost,
    meta: {
      label: item.label,
      panelId: PANEL_ID[item.slug],
      legacy: item.component ? false : !MIGRATED.has(item.slug),
    },
  }
}

/**
 * 首屏落地页：打开站点根路径 `/` 时跳到哪。
 *
 * ⚠️ 它**故意不等于** DEFAULT_SLUG —— 两者语义不同：
 *   - `DEFAULT_SLUG`（service-ops）是「**没有页面可落**时的兜底」：catch-all、
 *     空壳域的面板 id、`__SIP_NAVIGATE` 空参，都指它；
 *   - 这里只是「**打开站点先看哪一页**」，当前指向 Constellation。
 * 改 DEFAULT_SLUG 去实现落地页会连带把兜底一起改掉（未知入口也跳到空壳域），所以分开。
 *
 * 落地到空壳域是安全的：LegacyPanels 用 v-show（不是 v-if），旧世界在首屏就完成装载，
 * 于是 `onLegacyBooted` 仍能在 `syncDomainHeader` 改写标题**之前**留底原始标题。
 */
const LANDING_PATH = '/constellation'

/**
 * 不在任何侧边栏里的独立页面。
 *
 * `service-ops`（域概览页）**只**能由默认值和顶部导航落过来，侧边栏里没有它 ——
 * 所以 flattenItems() 不会产出它。早期版本漏了这条，导致 `/service-ops` 匹配不到路由、
 * 落到 catch-all 再重定向回 `/service-ops` → **无限重定向（Maximum call stack size exceeded）**。
 *
 * `component` 是上面 routeFor() 说的第三条登记口：Service Ops 概览页现在是内嵌的
 * Next.js 页面（`ServiceOpsView.vue`），既不是侧边栏叶子（不进 MIGRATED/VIEW_COMPONENTS），
 * 也不是空壳域（它有侧边栏，不进 DOMAIN_COMPONENTS）。
 *
 * ⚠️ 不要为了「让它像 biz-ops 那样」而把该域的 sidebar 设成 null ——
 * flattenItems() 只遍历有侧边栏的域，那会一次性干掉域内 9 条叶子路由，
 * 而且 service-ops 会落进 EMPTY_DOMAINS，emptyDomainRoutes 再产出一条 `/service-ops`
 * 覆盖掉本页（且只有一个 console 警告）。
 */
const STANDALONE_PAGES = [
  {
    slug: DEFAULT_SLUG,
    label: 'Service Ops',
    component: () => import('@/views/service-ops/ServiceOpsView.vue'),
  },
]

/**
 * 空壳域里**已经接了真实组件**的。
 *
 * 三个都是内嵌 SIP 部署站那份 Next.js 页面：
 *   constellation  → 星座图（见 src/views/constellation/ConstellationView.vue）
 *   biz-ops        → Business Ops 概览
 *   architecture   → Architecture 面板（2026-09-21 接入，此前是空壳）
 *
 * ⚠️ 注意这里**不适用** nav.js 里那条「MIGRATED 与 VIEW_COMPONENTS 两处必须同时改」的规矩：
 * 那条针对的是**侧边栏叶子**（会经 flattenItems() 产出路由）。空壳域不在任何侧边栏里，
 * 走的是下面 emptyDomainRoutes 这条独立分支，所以只需要在这里登记一次。
 *
 * ⚠️ 这里跟的是**域的 key**，不是 slug —— 所以 Business Ops 是 `biz-ops`（它的 slug
 * 集合为空：摘掉侧边栏后没有任何叶子指向它），落在 `/biz-ops` 这个 URL 上。
 *
 * ⚠️ architecture 这一条与上面两条有个不同：**它的 key 与内嵌页路径同名**
 * （都是 `/architecture`）。dev 下靠 `sip-embed-page-index` 插件只拦带尾斜杠的请求
 * 来分流，生产 nginx 也要补一条 `location = /architecture` —— 与 Service Ops 同一套处置，
 * 详见 `src/views/architecture/ArchitectureView.vue` 与 README。
 *
 * 其余 2 个空壳域（finops / security-ops）仍是空壳。
 * （空壳域原有 5 个：Value Pool 已于 2026-09-17 从 NAV 摘除，见 nav.js 数组末尾；
 *   architecture 于 2026-09-21 接上本文件里的组件。）
 */
const DOMAIN_COMPONENTS = {
  constellation: () => import('@/views/constellation/ConstellationView.vue'),
  'biz-ops': () => import('@/views/business-ops/BusinessOpsView.vue'),
  architecture: () => import('@/views/architecture/ArchitectureView.vue'),
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
  { path: '/', redirect: LANDING_PATH },
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
