/**
 * 轻量 toast。
 *
 * 复用旧世界那套 DOM 契约：容器 `#toastContainer`（由外壳渲染）+ 消息类
 * `.toast-msg / .toast-info / .toast-success / .toast-error`。
 *
 * **刻意不定义 `window._showToast`** —— 那个函数由 js/app.js:5794 定义并负责旧视图的
 * toast；两边都定义会互相覆盖。这里只操作同一个容器，视觉结果一致。
 */

const DEFAULT_DURATION = 2600

function container() {
  let el = document.getElementById('toastContainer')
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast-container'
    el.id = 'toastContainer'
    document.body.appendChild(el)
  }
  return el
}

/**
 * @param {string} message
 * @param {'info'|'success'|'error'} [type]
 * @param {number} [duration]
 */
export function showToast(message, type = 'info', duration = DEFAULT_DURATION) {
  const el = document.createElement('div')
  el.className = `toast-msg toast-${type}`
  el.textContent = message
  container().appendChild(el)
  setTimeout(() => el.remove(), duration)
}

export function useToast() {
  return { showToast }
}
