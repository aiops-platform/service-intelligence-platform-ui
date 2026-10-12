/**
 * 后端 base 解析。
 *
 * 改造前的状况：base URL 在 js/app.js 里硬编码 12 处，只有一部分支持 localStorage 覆盖，
 * 而且**全文件没有任何 localStorage.setItem** —— 覆盖值只能从浏览器 console 盲设，
 * 前端没有写入口。这里收敛成一处，并补上缺失的 setBase()。
 *
 * 优先级：localStorage > VITE_* 环境变量 > 相对路径默认值。
 *
 * 默认值刻意用**相对路径**（/api/sip-aiops、/agentflow）：由 vite dev proxy 或生产 nginx
 * 反代转发到真实后端，浏览器视角同源 —— 这就是跨域问题的解法本身。
 */

/**
 * 应用挂载前缀（末尾不带斜杠）：本机 `''`、子路径部署 `'/sip'`。
 *
 * 取自 Vite 的 `base` —— 那是**编译期常量**，由 scripts/vite-with-base.mjs 探测后经
 * VITE_BASE 传入。所以这里不需要任何运行时判断：base 一变，这几个默认值跟着变。
 * 拼出来的仍是相对路径，照旧由 dev proxy / 生产 nginx 转发，浏览器视角同源。
 */
const PREFIX = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')

const DEFAULTS = {
  sipAiops: `${PREFIX}/api/sip-aiops`,
  agentflow: `${PREFIX}/agentflow`,
  // CMDB 编辑面：datasource MCP server 的 /admin/cmdb（dev proxy 会把前缀 rewrite 掉）
  cmdb: `${PREFIX}/api/cmdb`,
}

/**
 * localStorage key 沿用旧名，console/脚本里设过的值继续生效。
 * 数组表示回退链：agentflow 沿用了旧版 workflowBaseUrl → bugSolveBaseUrl 的分层习惯。
 */
const LS_KEYS = {
  sipAiops: ['sipAiopsBaseUrl'],
  agentflow: ['bugSolveBaseUrl', 'workflowBaseUrl', 'agentsBaseUrl', 'mcpBaseUrl', 'agentConfigBaseUrl'],
  cmdb: ['cmdbBaseUrl'],
}

const ENV = {
  sipAiops: import.meta.env.VITE_SIP_AIOPS_BASE,
  agentflow: import.meta.env.VITE_AGENTFLOW_BASE,
  cmdb: import.meta.env.VITE_CMDB_BASE,
}

function readLS(name) {
  for (const key of LS_KEYS[name] || []) {
    try {
      const v = window.localStorage.getItem(key)
      if (v) return v
    } catch {
      /* 隐私模式下 localStorage 可能抛错，忽略 */
    }
  }
  return null
}

/** 解析某个后端的 base（末尾不带斜杠） */
export function resolveBase(name) {
  const raw = readLS(name) || ENV[name] || DEFAULTS[name]
  if (!raw) throw new Error(`未知的 API base：${name}`)
  return raw.replace(/\/+$/, '')
}

/**
 * 运行时改写 base（补上改造前缺失的写入口）。
 * 写入该 base 的主 key；传 null 清除，回落到环境变量/默认值。
 */
export function setBase(name, url) {
  const key = LS_KEYS[name]?.[0]
  if (!key) throw new Error(`未知的 API base：${name}`)
  try {
    if (url) window.localStorage.setItem(key, url.replace(/\/+$/, ''))
    else window.localStorage.removeItem(key)
  } catch (err) {
    console.warn('[sip] 写入 localStorage 失败：', err)
  }
}

/** 所有 base 的当前视图（供调试面板/排查用） */
export function describeBases() {
  return Object.fromEntries(
    Object.keys(DEFAULTS).map((n) => [n, { key: LS_KEYS[n], value: resolveBase(n), fallback: DEFAULTS[n] }]),
  )
}

// ----------------------------------------------------------------------
// 租户（agentflow 的 X-Tenant-ID）
// ----------------------------------------------------------------------
/**
 * 默认租户。
 *
 * agentflow 在 **dev 模式**（`AGENTFLOW_JWT_SECRET` 为空）下从 `X-Tenant-ID` 头取租户，
 * 缺省是 `"local"`（`api/auth.py:61`）。而 agentflow **会给未注册的租户 id 自动建一个空库**
 * —— 所以前端**必须显式声明租户**，否则会落进一个空库、什么都不显示。
 *
 * 切 JWT 模式后这个头不再起作用（租户改由 token claim 派生），届时可原样保留，
 * 后端会忽略它。
 */
const DEFAULT_TENANT = 'otr'
const TENANT_KEY = 'agentflowTenantId'

/** 当前租户 id（localStorage 覆盖 > 默认值） */
export function resolveTenant() {
  try {
    return window.localStorage.getItem(TENANT_KEY) || DEFAULT_TENANT
  } catch {
    return DEFAULT_TENANT
  }
}

/** 运行时切换租户（刷新后生效 —— 缓存的视图数据属于上一个租户，不该跨租户复用） */
export function setTenant(tenantId) {
  try {
    if (tenantId) window.localStorage.setItem(TENANT_KEY, tenantId)
    else window.localStorage.removeItem(TENANT_KEY)
  } catch (err) {
    console.warn('[sip] 写入 localStorage 失败：', err)
  }
}

// dev 下方便在 console 里改后端地址：__sipApi.setBase('sipAiops', 'http://host:8080/api/sip-aiops')
if (import.meta.env.DEV) {
  // console 里可切租户（切完刷新页面，缓存的视图数据不该跨租户复用）：
  //   __sipApi.setTenant('team-a')
  window.__sipApi = { resolveBase, setBase, describeBases, resolveTenant, setTenant }
}
