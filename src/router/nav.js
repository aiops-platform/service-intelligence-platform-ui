/**
 * 导航唯一真源。
 *
 * 改造前，导航结构散在 index.html 的 data-* 属性 + app.js:61-124 的一长串 if-else 里
 * （slug 与 page id 命名还不一致）。这里把它收敛成数据：shell 组件与路由表都从这里派生。
 */

/** 已迁到 Vue 的视图（其余仍由 js/app.js 驱动 legacy 面板） */
export const MIGRATED = new Set(['log-analysis', 'bug-solve', 'tickets', 'agent-registry'])

/**
 * slug → legacy panel id。
 *
 * 绝大多数 slug 加 `page-` 前缀即可，**只有两处真正不一致**（改造前靠 if-else 硬编码）：
 *   knowledge-reflow-log → page-reflow-log
 *   agent-registry       → page-agents
 */
export const PANEL_ID = {
  'service-ops': 'page-service-ops',
  'knowledge-reflow-log': 'page-reflow-log',
  'knowledge-search': 'page-knowledge-search',
  'agent-tasks': 'page-agent-tasks',
  // 新增的 Vue 原生页（无 legacy 面板对应）——值仅为占位，路由 meta.legacy=false
  tickets: 'page-tickets',
  'l1-automation': 'page-l1-automation',
  'approval-center': 'page-approval-center',
  'smart-inspection': 'page-smart-inspection',
  'metrics-analysis': 'page-metrics-analysis',
  'log-analysis': 'page-log-analysis',
  problems: 'page-problems',
  'monitor-targets': 'page-monitor-targets',
  'domain-config': 'page-domain-config',
  'agent-registry': 'page-agents',
  'workflow-studio': 'page-workflow-studio',
  'bug-solve': 'page-bug-solve',
  'mcp-servers': 'page-mcp-servers',
  'agent-config': 'page-agent-config',
}

/** 历史/简写别名 → 规范 slug（改造前靠 if-else 的字符串比较，这里显式化） */
export const SLUG_ALIASES = {
  'reflow-log': 'knowledge-reflow-log',
  agents: 'agent-registry',
}

/**
 * 顶部 9 个域 + 各自侧边栏。
 *
 * sidebar 为 null 的 5 个是**空壳**：改造前 `initNavigation` 的 else 分支直接
 * 落到 `page-service-ops` 并把 footer 文案改成域名，这里保持同样语义。
 *
 * 分组可嵌套（只有 Service Ops › Observability › APM 这一处）：子分组渲染在
 * 父分组同一个 `.sidebar-children` 容器内，与改造前的 DOM 结构一致。
 */
export const NAV = [
  {
    key: 'constellation',
    label: 'Constellation',
    dot: '#8b5cf6',
    panel: '1/9 · CONSTELLATION',
    title: '893 apps · 22 portfolios · 6 journeys · 173 teams',
    sidebar: null,
  },
  {
    /*
     * Business Ops 现在自成一页（内嵌部署站的 Business Ops 概览页），与 Constellation 同构：
     * sidebar 为 null ⇒ 落进 EMPTY_DOMAINS ⇒ 走自己的路由 /biz-ops，不挂侧边栏。
     *
     * 不挂侧边栏还有个布局原因：那页**右侧自带 340px 的 inspector**，再来一条外层侧边栏
     * 会把中间挤没。
     *
     * 原先这里有 Ticket Workspace（approval-center / agent-tasks）。按用户要求
     * 「顶栏点 Business Ops 直接展示概览页，老的侧边栏对应的页面暂时不要了」摘掉。
     * 那两个 legacy 面板**仍在** js/app.js 与 legacy-panels.html 里，只是导航到不了 ——
     * 要恢复就把这段 sidebar 放回来，并从 index.js 的 DOMAIN_COMPONENTS 摘掉 biz-ops。
     */
    key: 'biz-ops',
    label: 'Business Ops',
    dot: '#ec4899',
    panel: '2/9 · BUSINESS OPS',
    title: 'XLA dashboard · journey health · freeze readiness',
    sidebar: null,
  },
  {
    key: 'service-ops',
    label: 'Service Ops',
    landing: 'service-ops',
    /** 该域的侧边栏可收起、且默认收起。消费方见 src/App.vue 的 sidebarCollapsible。 */
    collapsible: true,
    dot: '#10b981',
    panel: '3/9 · SERVICE OPS',
    title: '',
    sidebar: {
      id: 'sidebar-service-ops',
      title: 'Service Ops',
      groups: [
        {
          key: 'ticket-workspace-svc',
          label: 'Ticket Workspace',
          items: [
            { slug: 'tickets', label: 'Ticket Inbox' },
            { slug: 'approval-center', label: 'Approval Center' },
            { slug: 'l1-automation', label: 'L1 Automation' },
          ],
        },
        {
          key: 'observability',
          label: 'Observability',
          items: [
            { slug: 'smart-inspection', label: 'Smart Inspection' },
            { slug: 'metrics-analysis', label: 'Metrics Analysis' },
            { slug: 'log-analysis', label: 'Log Analysis' },
            { slug: 'problems', label: 'Problem Center' },
          ],
          groups: [
            {
              key: 'apm',
              label: 'APM',
              items: [
                { slug: 'monitor-targets', label: 'Monitor Targets' },
                { slug: 'domain-config', label: 'Domain Rules' },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    key: 'eng-ops',
    label: 'Engineering Ops',
    landing: 'knowledge-reflow-log',
    dot: '#3b82f6',
    panel: '4/9 · ENGINEERING OPS',
    title: 'Code velocity · change calendar · Claude Code workbench',
    sidebar: {
      id: 'sidebar-eng-ops',
      title: 'Engineering Ops',
      groups: [
        {
          key: 'knowledge-studio',
          label: 'Knowledge Studio',
          items: [
            { slug: 'knowledge-reflow-log', label: 'Knowledge Reflow Log' },
            { slug: 'knowledge-search', label: 'Knowledge Search' },
          ],
        },
      ],
    },
  },
  {
    key: 'architecture',
    label: 'Architecture',
    dot: '#14b8a6',
    panel: '5/9 · ARCHITECTURE',
    title: '6R classification · modernization queues',
    sidebar: null,
  },
  {
    key: 'finops',
    label: 'FinOps',
    dot: '#f59e0b',
    panel: '6/9 · FINOPS',
    title: 'Cloud trajectory · vendor consolidation · untagged spend',
    sidebar: null,
  },
  {
    key: 'security-ops',
    label: 'Security Ops',
    dot: '#f97316',
    panel: '7/9 · SECURITY OPS',
    title: 'Vulnerability heatmap · attack surface · freeze risk',
    sidebar: null,
  },
  {
    key: 'agents',
    label: 'Agents',
    landing: 'agent-registry',
    dot: '#6366f1',
    panel: '8/9 · AGENTS',
    title: 'AI agent registry · performance · usage',
    sidebar: {
      id: 'sidebar-agents',
      title: 'Agents',
      groups: [
        {
          key: 'agent-fleet',
          label: 'Agent Fleet',
          items: [
            { slug: 'agent-registry', label: 'Agent Registry' },
            { slug: 'workflow-studio', label: 'Workflow Studio' },
            { slug: 'bug-solve', label: 'Bug Solve' },
            { slug: 'mcp-servers', label: 'MCP Server Config' },
            { slug: 'agent-config', label: 'Agent Config' },
          ],
        },
      ],
    },
  },
  {
    key: 'value-pool',
    label: 'Value Pool',
    dot: '#10b981',
    panel: '9/9 · VALUE POOL',
    title: 'Value realization · ROI tracking',
    sidebar: null,
  },
]

/** 默认落地页（改造前 `page-service-ops` 无 display:none，是唯一默认可见的面板） */
export const DEFAULT_SLUG = 'service-ops'

/**
 * 5 个无侧边栏的「空壳」域：没有自己的页面。
 *
 * 改造前点它们会走 initNavigation 的 else 分支：隐藏所有侧边栏 → 落到 service-ops 概览
 * → 把该页标题改成域名。
 *
 * 这里给每个空壳域**一条自己的路由**（`/constellation` 等，面板仍指向 page-service-ops），
 * 而不是在组件里存一个"当前选的域"的覆盖状态 —— 否则高亮域与 URL 两套真源会打架：
 * 早期实现用 domainOverride 覆盖，结果被 watch(activeSlug) 清掉，出现「标题是 FinOps
 * 但侧边栏是 Service Ops」的错位。进 URL 后一切都从路由派生，且可分享可刷新。
 */
export const EMPTY_DOMAINS = NAV.filter((n) => !n.sidebar)

/** 把分组树拍平成叶子列表（供路由表使用） */
export function flattenItems(nav = NAV) {
  const out = []
  const walk = (items) => {
    for (const it of items) {
      if (it.slug) out.push(it)
      if (it.groups) for (const g of it.groups) walk(g.items)
    }
  }
  for (const top of nav) {
    if (!top.sidebar) continue
    for (const g of top.sidebar.groups) walk(g.items)
  }
  return out
}

/**
 * 把 slug 或 legacy panel id 归一成规范 slug。
 *
 * 路由参数、旧代码传来的 `page-xxx`、历史别名（`agents`）都要能吃进同一个入口。
 */
export function resolveSlug(input) {
  if (!input) return null
  let s = String(input)
  if (s.startsWith('page-')) {
    const hit = Object.entries(PANEL_ID).find(([, pid]) => pid === s)
    return hit ? hit[0] : s.slice(5)
  }
  return SLUG_ALIASES[s] || s
}

/** legacy panel id → 规范 slug（接缝 S3 用：旧代码传 `page-xxx` 过来） */
export function slugFromPanelId(pageId) {
  return resolveSlug(pageId)
}

/** slug → 所属顶部域的 key（供 header 高亮 + footer 文案） */
export function navKeyOf(slug) {
  for (const top of NAV) {
    if (!top.sidebar) continue
    const found = flattenItems([top]).some((it) => it.slug === slug)
    if (found) return top.key
  }
  return DEFAULT_SLUG === slug ? 'service-ops' : null
}
