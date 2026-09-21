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
 * 顶部 8 个域 + 各自侧边栏（原 9 个，Value Pool 已摘，见数组末尾的说明）。
 *
 * sidebar 为 null 的 5 个（constellation / biz-ops / architecture / finops /
 * security-ops）**没有侧边栏**：改造前 `initNavigation` 的 else 分支直接
 * 落到 `page-service-ops` 并把 footer 文案改成域名，这里保持同样语义。
 *
 * ⚠️ 但「没有侧边栏」≠「没有自己的页面」—— 其中三个已经在内嵌页上接了真实内容
 * （constellation / biz-ops / architecture，登记在 `router/index.js` 的
 * `DOMAIN_COMPONENTS`，路由仍由这里的 key 派生）。剩下 finops / security-ops
 * 才是真正的空壳（落到 service-ops 概览）。
 * 有侧边栏的域不受影响：它们的 `sidebar` 是对象，走 flattenItems() 那一套。
 *
 * 分组可嵌套（只有 Service Ops › APM › Smart Inspection 这一处）：子分组渲染在
 * 父分组同一个 `.sidebar-children` 容器内，与改造前的 DOM 结构一致。
 *
 * 分组对象上还可以带 `slug`（目前只有 Smart Inspection）：那样它**同时是一个叶子**
 * —— 点标题进页面、点箭头展开/收起（渲染见 SidebarGroup.vue，路由见 flattenItems()）。
 *
 * `items` 与 `groups` 都是可选的：只有子分组的分组（APM）不写 items，只有叶子的
 * 分组不写 groups。消费方（SidebarGroup.vue 的两处 v-for、flattenItems）都要按可选处理。
 */
export const NAV = [
  {
    key: 'constellation',
    label: 'Constellation',
    dot: '#8b5cf6',
    panel: '1/8 · CONSTELLATION',
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
    panel: '2/8 · BUSINESS OPS',
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
    panel: '3/8 · SERVICE OPS',
    title: '',
    sidebar: {
      id: 'sidebar-service-ops',
      title: 'Service Ops',
      groups: [
        {
          /*
           * 原先这里还有 Approval Center 与 L1 Automation 两个叶子。按用户要求
           * 「隐藏掉」，已于 2026-09-17 从本数组摘除。
           *
           * 与上面 Business Ops 那次摘侧边栏同理：**只摘导航，不删页面**。
           * 两个 legacy 面板仍在 js/app.js 与 legacy-panels.html 里，PANEL_ID 的两条
           * 映射也没动 —— 但 flattenItems() 是路由表的唯一来源，不产出就没有路由，
           * 于是侧边栏点不到、直接输 URL 也落进 catch-all 回到 service-ops。
           *
           * 要恢复就把这两行放回来（其余文件一个都不用碰）：
           *   { slug: 'approval-center', label: 'Approval Center' },
           *   { slug: 'l1-automation', label: 'L1 Automation' },
           */
          key: 'ticket-workspace-svc',
          label: 'Ticket Workspace',
          items: [{ slug: 'tickets', label: 'Ticket Inbox' }],
        },
        {
          /*
           * 本分组有两段「只摘导航、不删页面」的历史。
           *
           * ── 2026-09-18：摘掉 Metrics Analysis 与 Log Analysis 两个叶子
           * 原有的两行是：
           *   { slug: 'metrics-analysis', label: 'Metrics Analysis' },
           *   { slug: 'log-analysis', label: 'Log Analysis' },
           * 两者性质不同，恢复时都要留意：
           *   - metrics-analysis 是 **legacy 面板**：DOM 在 legacy-panels.html:885，
           *     脚本在 js/app.js 的 initMetricsAnalysis()，两处都没动；
           *   - log-analysis 是**已迁到 Vue 的视图**：仍留在 MIGRATED 与
           *     router/index.js 的 VIEW_COMPONENTS 里。这两处现在暂时没有消费方
           *     （叶子不产出 → 没有路由 → 组件不会被加载），但**必须保留**：它们是
           *     「已迁移」的唯一登记口，摘掉反而要在恢复时重新拼回来。
           *
           * ⚠️ 与 Ticket Workspace 那次的一个区别：Metrics Analysis **有一条应用内
           * 的入口**，不是只有菜单能到 —— Smart Inspection 的两个问题数徽标点下去曾
           * 分别走 navigateToPage('metrics-analysis' / 'log-analysis')，叶子摘掉后
           * 这些 URL 不再存在，徽标会静默落进 catch-all 回到 /service-ops。
           *
           * 【该入口后来改道了】2026-09-18：那两个徽标改为下钻 Diagnosis Center
           * （路由 /problems），带上 service / type / state 三个 query 预筛选。
           * 所以上面这条副作用**已经不是问题** —— 但摘叶子的决定本身没变。
           * 下钻实现在 js/app.js 的 initSmartInspection 闭包里（navigateToPage('problems', …)），
           * 落点由 initProblems 的 applyQueryFilters() 消费。
           *
           * 要恢复就在本分组上**新增** items（其余文件一个都不用碰）—— 注意是新增：
           * 2026-09-21 改版后本分组只剩子分组，已经没有 items 键了。
           *   items: [
           *     { slug: 'metrics-analysis', label: 'Metrics Analysis' },
           *     { slug: 'log-analysis', label: 'Log Analysis' },
           *   ],
           *
           * ── 2026-09-21：一级改名 APM、去掉二级 APM 分组
           * 原结构是 Observability ▸ { Smart Inspection, Diagnosis Center }，外加一个
           * 二级分组 APM ▸ { Monitor Targets, Domain Rules }。按用户要求改为
           * APM ▸ Smart Inspection ▸ { Diagnosis Center, Monitor Targets, Domain Rules }。
           *
           * 键名同步由 observability 改为 apm：分组键就是 DOM id 与 data-toggle，
           * 标签叫 APM 而键叫 observability 会误导。消费方只有 App.vue 的默认展开
           * 集合，已同步。
           */
          key: 'apm',
          label: 'APM',
          groups: [
            {
              /*
               * Smart Inspection 是**可导航的分组头**：`slug` 让它自身仍是一条路由
               * （/smart-inspection，点标题进页面），`items` 是它下一级的三个页面。
               *
               * 它原先是个普通叶子，与被摘掉的那个二级 APM 分组平级。四者现在收进
               * 同一棵子树，而视觉深度不变：标题仍在 38px（.sidebar-children
               * .sidebar-item），三个子项落到 56px —— 正是改版前 Monitor Targets /
               * Domain Rules 所在的位置。
               */
              key: 'smart-inspection',
              label: 'Smart Inspection',
              slug: 'smart-inspection',
              items: [
                /*
                 * 标签是 Diagnosis Center，但 slug / panel id 仍叫 problems
                 * （URL 保持 `/problems`，PANEL_ID 的 'problems' 键也没动）。
                 *
                 * 2026-09-21 改名的理由：这页的独有价值在「Analyze → 起 agentflow run
                 * 诊断 → 形成 ticket」那一步。但**它列出的记录本身仍叫 problem**
                 * （后端 `/v1/problems`、`occurrence_count`、状态机），所以副标题
                 * Detected Problems、KPI Total Problems、表头 Problem 都按实体名保留，
                 * 没有跟着改 —— 改的是页面名，不是实体名。
                 *
                 * ⚠️ 不要顺手把 slug 也改成 diagnosis-center：那会牵动 PANEL_ID、
                 * initSmartInspection 里的 navigateToPage('problems')、applyQueryFilters
                 * 消费的三个 query，以及所有已分享出去的 `/problems?service=…` 链接。
                 * 本次刻意只改文案层（菜单 / H1 / 面包屑 / 一处审批 comment 文本）。
                 */
                { slug: 'problems', label: 'Diagnosis Center' },
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
    panel: '4/8 · ENGINEERING OPS',
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
    panel: '5/8 · ARCHITECTURE',
    title: '6R classification · modernization queues',
    sidebar: null,
  },
  {
    key: 'finops',
    label: 'FinOps',
    dot: '#f59e0b',
    panel: '6/8 · FINOPS',
    title: 'Cloud trajectory · vendor consolidation · untagged spend',
    sidebar: null,
  },
  {
    key: 'security-ops',
    label: 'Security Ops',
    dot: '#f97316',
    panel: '7/8 · SECURITY OPS',
    title: 'Vulnerability heatmap · attack surface · freeze risk',
    sidebar: null,
  },
  {
    key: 'agents',
    label: 'Agents',
    landing: 'agent-registry',
    dot: '#6366f1',
    panel: '8/8 · AGENTS',
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
  /*
   * 原先这里还有第 9 个域 Value Pool（空壳域，panel '9/9 · VALUE POOL'，
   * 原型自带、随 c4f3199 的代码导入进来）。按用户要求「隐藏掉」，
   * 已于 2026-09-17 从 NAV 摘除。
   *
   * 与上面 Business Ops 那次**不同**：那次只摘侧边栏、域还在（仍是 9 个域）；
   * 这次是整个域都不在了，所以是 8 个。
   *
   * 连带效果全是自动的，没有额外的代码要改：
   *   - 顶栏（AppHeader）直接渲染 NAV → 少一个 nav-item
   *   - EMPTY_DOMAINS = NAV.filter(n => !n.sidebar) → 空壳域 5 → 4
   *   - emptyDomainRoutes 由 EMPTY_DOMAINS 派生（router/index.js）→ `/value-pool`
   *     这条路由不再生成，直接输 URL 会落 catch-all 回到 /service-ops
   *   - 其余 8 个域的 panel 文案同步 x/9 → x/8（分母是域的总数）
   *
   * 要恢复就把上面那段放回来，并把 8 处 panel 改回 `x/9` —— 没有别的东西要动。
   * 注意 `js/app.js` 里那份空壳域名单（initNavigation 的 else 分支）**是独立的**
   * 一份实现，只服务独立打开旧 index.html 的场景，两边不会自动同步。
   */
]

/** 默认落地页（改造前 `page-service-ops` 无 display:none，是唯一默认可见的面板） */
export const DEFAULT_SLUG = 'service-ops'

/**
 * 5 个无侧边栏的域：**没有侧边栏**（其中 finops / security-ops 也没有自己的页面）。
 *
 * 改造前点它们会走 initNavigation 的 else 分支：隐藏所有侧边栏 → 落到 service-ops 概览
 * → 把该页标题改成域名。
 *
 * 这里给每个域**一条自己的路由**（`/constellation` 等），而不是在组件里存一个"当前选的域"
 * 的覆盖状态 —— 否则高亮域与 URL 两套真源会打架：早期实现用 domainOverride 覆盖，
 * 结果被 watch(activeSlug) 清掉，出现「标题是 FinOps 但侧边栏是 Service Ops」的错位。
 * 进 URL 后一切都从路由派生，且可分享可刷新。
 *
 * ⚠️ 变量名与注释里的「空壳」是**改造前**的语义（那时这 5 个都落到 page-service-ops）。
 * 现在 constellation / biz-ops / architecture 三个域在 `router/index.js` 的
 * `DOMAIN_COMPONENTS` 里各自接了内嵌页，`meta.panelId` 仍指向 page-service-ops
 * 但 `meta.legacy` 是 false，所以那个面板不会被显示 —— 兜底语义只在 finops /
 * security-ops 上还完整成立。名字不改：它是本文件的导出面，且语义边界仍由
 * `!n.sidebar` 精确表达。
 */
export const EMPTY_DOMAINS = NAV.filter((n) => !n.sidebar)

/**
 * 把分组树拍平成叶子列表（供路由表使用）。
 *
 * ⚠️ 递归的是**分组**，不是 item —— `groups` 与 `items` 在分组对象上平级，
 * 从来不是 item 的字段。早期版本把 `if (it.groups)` 写在遍历 items 的循环里，
 * 那个分支永不成立，于是只有顶层分组被走到：子分组（当时是 Observability › APM，
 * 现在是 APM › Smart Inspection）底下的叶子从未进入返回列表，`/monitor-targets`
 * 与 `/domain-config` 两条路由根本没生成，点菜单落进 catch-all 被静默重定向回
 * service-ops（症状是「页面不见了」，但面板与 init 全都在）。
 *
 * ⚠️ 带 `slug` 的分组（Smart Inspection）**自身也要进列表** —— 它既是父节点又是
 * 叶子，漏掉这一步 `/smart-inspection` 会从路由表里消失，而侧边栏上它看着好好的。
 * `navKeyOf()` 也走本函数，所以这一条同时决定「点进该页时顶栏高亮哪个域」。
 *
 * `items` / `groups` 都是可选的（见文件头），故都按 `|| []` 取 —— 只有子分组的
 * 分组（APM）没有 items，直接 `for…of g.items` 会抛 TypeError。
 *
 * 顺序与 SidebarGroup.vue 的递归渲染保持一致：先分组头自己，再 items，后 groups。
 */
export function flattenItems(nav = NAV) {
  const out = []
  const walkGroup = (g) => {
    if (g.slug) out.push({ slug: g.slug, label: g.label })
    for (const it of g.items || []) if (it.slug) out.push(it)
    for (const sub of g.groups || []) walkGroup(sub)
  }
  for (const top of nav) {
    if (!top.sidebar) continue
    for (const g of top.sidebar.groups) walkGroup(g)
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
