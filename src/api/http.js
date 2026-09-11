/**
 * 统一 fetch 封装。
 *
 * 改造前：49 处 fetch 各写各的 `.then(res => res.json())`，错误处理散落各处；
 * 唯一的封装 apmApi() 还被复制粘贴了 3 份（app.js:3629/5804/6193）。
 * 这里给出一份，并把三个后端共用的行为收进来。
 */
import { resolveBase } from './config'

/** 预期内的失败一律归一成这个类型，调用方按 status / message 处理 */
export class ApiError extends Error {
  constructor(message, { status, url, method, body, cause } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.url = url
    this.method = method
    this.body = body
    this.cause = cause
  }
}

/**
 * 剥一层 `{success, data}` 信封。
 *
 * 后端两类响应体：
 *   - sip-aiops：`{success, data:{content,total}}` → 剥成 `{content,total}`
 *   - analysis ：`{success, data:{success, data:{…}}}` → 只剥**一层**，调用方继续判 `.success`/`.data`
 *     （与改造前 app.js:2269 的写法一致）
 *   - agentflow：无信封 → 原样返回
 */
const unwrapEnvelope = (body) =>
  body && typeof body === 'object' && 'success' in body ? body.data : body

/** 拼接 query：跳过 undefined/null/''（对齐改造前 `if (currentService)` 的条件拼接）；数组展开成重复 key */
function buildQuery(params) {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((item) => sp.append(k, item))
    else sp.append(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export function createClient({
  name,
  base, // 不传则每次请求时由 config.resolveBase(name) 现取（支持运行时 setBase）
  headers: baseHeaders = {},
  timeout = 15000,
  unwrap = unwrapEnvelope,
} = {}) {
  const resolveUrl = (path) => `${base ?? resolveBase(name)}${path.startsWith('/') ? path : `/${path}`}`

  async function request(path, { method = 'GET', params, body, headers, signal, raw = false } = {}) {
    const url = resolveUrl(path) + buildQuery(params)

    // 超时与调用方 signal 合成（AbortSignal.any 在旧 Safari 不支持，手工桥接）
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeout)
    const onAbort = () => ctrl.abort(signal?.reason)
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    const h = typeof baseHeaders === 'function' ? baseHeaders() : { ...baseHeaders }
    if (body !== undefined && !('Content-Type' in h)) h['Content-Type'] = 'application/json'

    let res
    try {
      res = await fetch(url, {
        method,
        headers: { ...h, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
    } catch (err) {
      if (err?.name === 'TimeoutError') {
        throw new ApiError(`请求超时（${Math.round(timeout / 1000)}s）：${path}`, { url, method, cause: err })
      }
      if (err?.name === 'AbortError') throw err // 调用方主动取消，原样抛出
      throw new ApiError(`网络错误：${err.message}`, { url, method, cause: err })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    const text = await res.text()
    let parsed = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text // 非 JSON（如 HTML 错误页）原样保留
      }
    }

    if (!res.ok) {
      const msg =
        (parsed && typeof parsed === 'object' && (parsed.detail || parsed.message || parsed.error)) ||
        `HTTP ${res.status}`
      throw new ApiError(String(msg), { status: res.status, url, method, body: parsed })
    }

    return raw ? parsed : unwrap(parsed)
  }

  return {
    name,
    request,
    get: (path, opts) => request(path, { ...opts, method: 'GET' }),
    post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
    put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
    del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
  }
}
