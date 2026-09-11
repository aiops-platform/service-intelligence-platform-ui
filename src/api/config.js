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

const DEFAULTS = {
  sipAiops: '/api/sip-aiops',
  agentflow: '/agentflow',
}

/**
 * localStorage key 沿用旧名，console/脚本里设过的值继续生效。
 * 数组表示回退链：agentflow 沿用了旧版 workflowBaseUrl → bugSolveBaseUrl 的分层习惯。
 */
const LS_KEYS = {
  sipAiops: ['sipAiopsBaseUrl'],
  agentflow: ['bugSolveBaseUrl', 'workflowBaseUrl', 'agentsBaseUrl', 'mcpBaseUrl', 'agentConfigBaseUrl'],
}

const ENV = {
  sipAiops: import.meta.env.VITE_SIP_AIOPS_BASE,
  agentflow: import.meta.env.VITE_AGENTFLOW_BASE,
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

// dev 下方便在 console 里改后端地址：__sipApi.setBase('sipAiops', 'http://host:8080/api/sip-aiops')
if (import.meta.env.DEV) {
  window.__sipApi = { resolveBase, setBase, describeBases }
}
