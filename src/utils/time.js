/**
 * 时间格式化工具。
 *
 * 从 js/app.js 逐字移植 —— 两个世界各持一份，等所有视图迁完再删旧的那份。
 * 这两段都**不要顺手简化**，它们各自有非显然的边界处理。
 */

/** 相对时间（改造前 app.js 的 formatTimeAgo，模块级） */
export function formatTimeAgo(dateStr) {
  if (!dateStr) return ''
  try {
    const now = new Date()
    const then = new Date(dateStr)
    if (isNaN(then.getTime())) return dateStr
    const diffMs = now - then
    if (diffMs < 0) return dateStr
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return diffMin + '分钟前'
    if (diffHour < 24) return diffHour + '小时前'
    if (diffDay < 30) return diffDay + '天前'
    return then.toLocaleDateString('zh-CN')
  } catch {
    return dateStr
  }
}

/**
 * 绝对时间（上海时区）。
 *
 * 关键在**先剥掉字符串里自带的时区后缀再补 Z** —— 后端给的形如
 * `2026-09-10T12:34:56+08:00`，若直接 `new Date()` 会按本地时区解释，
 * 再转 Asia/Shanghai 就会偏。剥掉后用 `Z` 当作 UTC 再由 toLocaleString 转到上海。
 * （改造前 app.js 里这段有 3 份副本，行为一致。）
 */
export function formatTime(dateStr) {
  if (!dateStr) return '-' // 与改造前 initLogAnalysis 内的同名函数一致（空值返回 '-' 而非 'N/A'）
  try {
    const normalized = String(dateStr).replace(/[+-]\d{2}:\d{2}$/, '')
    const d = new Date(normalized + 'Z')
    if (isNaN(d.getTime())) return String(dateStr)
    return d.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return String(dateStr)
  }
}
