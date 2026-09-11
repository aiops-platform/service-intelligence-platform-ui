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

/** 取某 slug 的路由路径与别名 */
function routeFor(item) {
  const aliases = Object.entries(SLUG_ALIASES)
    .filter(([, canonical]) => canonical === item.slug)
    .map(([alias]) => `/${alias}`)
  return {
    path: `/${item.slug}`,
    name: item.slug,
    alias: aliases,
    component: LegacyPanelHost, // 两个视图迁移后（S6/S7）改由 MIGRATED 分发到真实组件
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
 * 空壳域各自一条路由（面板都指向 service-ops 概览）。
 * 这样高亮域、footer 文案、页面标题全部由 URL 派生，不依赖组件内的覆盖状态。
 */
const emptyDomainRoutes = EMPTY_DOMAINS.map((d) => ({
  path: `/${d.key}`,
  name: `domain-${d.key}`,
  component: LegacyPanelHost,
  meta: {
    label: d.label,
    domainKey: d.key,
    panelId: PANEL_ID[DEFAULT_SLUG],
    legacy: true,
  },
}))

const routes = [
  { path: '/', redirect: `/${DEFAULT_SLUG}` },
  ...[...flattenItems(), ...STANDALONE_PAGES].map(routeFor),
  ...emptyDomainRoutes,
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
