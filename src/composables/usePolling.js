import { ref, onUnmounted, onActivated, onDeactivated, getCurrentInstance } from 'vue'

/**
 * 轮询。
 *
 * 改造前有 8 处裸 `setInterval`（1s/2s/5s/10s 四档），靠 `page.style.display !== 'none'`
 * 判断页面是否可见。两个问题：切走页面后定时器仍在跑（靠守卫跳过请求，但定时器还在），
 * 且**标签页在后台时照打 2 秒一轮**。
 *
 * 这里统一处理三件事：
 *   - 组件卸载必停（onUnmounted）
 *   - keep-alive 下 deactivated 停、activated 恢复（对应改造前"切页"的语义）
 *   - document.hidden 时跳过本轮（省掉后台标签页的无谓请求）
 *
 * @param {Function} fn 每轮执行体（可以是 async）
 * @param {object}   opts
 * @param {number}   opts.interval  间隔毫秒
 * @param {Function} opts.enabled   返回 false 则自动停止（如"仅在 run 运行中轮询"）
 * @param {boolean}  opts.immediate 是否立刻先跑一轮
 */
export function usePolling(fn, { interval = 2000, enabled = () => true, immediate = false } = {}) {
  const isRunning = ref(false)
  let timer = null

  function clear() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    isRunning.value = false
  }

  async function runOnce() {
    // 后台标签页跳过本轮（定时器继续，回到前台自会接上）
    if (document.hidden) return
    if (!enabled()) {
      clear()
      return
    }
    try {
      await fn()
    } catch (err) {
      console.warn('[sip] 轮询执行失败：', err)
    }
  }

  function start() {
    if (timer !== null) return
    isRunning.value = true
    if (immediate) runOnce()
    timer = setInterval(runOnce, interval)
  }

  function stop() {
    clear()
  }

  /** 按当前 enabled() 决定起停（供外部状态变化后调用） */
  function sync() {
    if (enabled()) start()
    else stop()
  }

  const onVisibility = () => {
    if (!document.hidden && isRunning.value) runOnce()
  }
  document.addEventListener('visibilitychange', onVisibility)

  // 组件上下文里的生命周期钩子（非组件环境调用则跳过，便于单测/独立使用）
  if (getCurrentInstance()) {
    onDeactivated(() => {
      // 只暂停，不改"想要运行"的意图，activated 时恢复
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    })
    onActivated(() => {
      if (isRunning.value && timer === null) {
        timer = setInterval(runOnce, interval)
      }
    })
  }

  onUnmounted(() => {
    clear()
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { start, stop, sync, isRunning, runOnce }
}
