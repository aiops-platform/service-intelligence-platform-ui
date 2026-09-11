/**
 * 文本工具。逐字移植自 js/app.js 顶部的 Shared Utilities。
 */

/** HTML 转义。**v-html 不做转义**，凡是被 v-html 注入的插值都必须过这里。 */
export function escapeHtml(text) {
  if (text === null || text === undefined) return ''
  const div = document.createElement('div')
  div.appendChild(document.createTextNode(String(text)))
  return div.innerHTML
}

/** 截断加后缀（改造前 app.js 的 truncateText） */
export function truncateText(text, maxLen) {
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen) + '...[truncated]'
}
