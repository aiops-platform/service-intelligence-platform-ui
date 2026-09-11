/**
 * 旧世界（js/app.js）的装载桥。
 *
 * 未迁移的 15 个视图 DOM 在 legacy-panels.html 里（S1 从原 index.html 逐字抽出），
 * 由 Vue 用 v-html 注入到 #sip-legacy-host；随后本模块把 js/app.js 以 **classic script**
 * 方式加载（不能走 ESM —— 那是个 IIFE，被当模块处理会改变语义），并显式调起它的 init。
 *
 * 两条硬约束：
 *   1. **只装载一次**（ensureLegacyBooted 是幂等 memoized promise）。重复装载会让
 *      app.js 的 17 个 init 再跑一遍 fetch、8 个 setInterval 再起一遍。
 *   2. **v-html 绑定的必须是冻结常量**，不能是 ref/computed —— 否则 Vue 重渲染时会
 *      重写这棵子树，把 app.js 绑好的监听器和已渲染内容全部冲掉。
 */
import rawHtml from './legacy-panels.html?raw'

/** 冻结常量：Vue 只负责把它注入一次，此后这棵子树完全归 js/app.js 所有。 */
export const legacyPanelsHtml = rawHtml

const LEGACY_HOST_ID = 'sip-legacy-host'
const LEGACY_SCRIPT = '/js/app.js'

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = false
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`加载 ${src} 失败`))
    document.head.appendChild(el)
  })
}

let bootPromise = null

/**
 * 装载旧世界，幂等。
 *
 * @returns {Promise<void>} 全生命周期只真正执行一次；后续调用复用同一个 promise。
 */
export function ensureLegacyBooted() {
  if (bootPromise) return bootPromise

  bootPromise = (async () => {
    const host = document.getElementById(LEGACY_HOST_ID)
    if (!host) {
      throw new Error(`未找到 #${LEGACY_HOST_ID} —— LegacyPanels 组件必须先挂载`)
    }

    // S1/S2/S9：把全文档查询收进这棵子树
    window.__SIP_LEGACY_ROOT = host

    // S7：让 app.js 加载后不立即自启，等我们把 DOM 备好再显式调 init
    window.__SIP_DEFER_LEGACY_INIT = true
    await loadClassicScript(LEGACY_SCRIPT)

    if (typeof window.__SIP_LEGACY_INIT !== 'function') {
      throw new Error('js/app.js 已加载但未导出 __SIP_LEGACY_INIT（S7 接缝缺失？）')
    }
    window.__SIP_LEGACY_INIT()
  })()

  // 失败时允许重试（例如 dev 下脚本还没就绪），避免一次抖动就永久锁死
  bootPromise.catch(() => {
    bootPromise = null
  })

  return bootPromise
}

/** 当前是否已装载（供路由守卫判断要不要先 await） */
export function isLegacyBooted() {
  return bootPromise !== null
}
