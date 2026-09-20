/**
 * 内嵌页 → 外壳 的跳转桥。
 *
 * 三套内嵌页（Constellation / Business Ops / Service Ops）都是**同源 iframe**，
 * 在此之前全仓没有任何通信通道（`postMessage` 零命中）。这是第一条，也是唯一一条：
 * 内嵌页说「我要去某页」，外壳负责把它翻成**一次路由跳转**。
 *
 * ## 消息契约
 *
 *     { type: 'sip:open-service-ops', portfolio: 'portfolio:lead' }
 *
 * 目前只有一个动作（Business Ops 的组合名 → Service Ops 的该组合）。
 * 发消息的一方在编译产物里，见 `tools/tenant_copy.py` 的 `patch_business_ops_portfolio_jump()`。
 *
 * ## 为什么由外壳做路由，而不是让 iframe 直接改 `parent.location`
 *
 * 后者要整页刷新：Vue 应用重启、legacy 世界（js/app.js 的 17 个 init）重跑一遍、
 * 其它视图的 KeepAlive 缓存全丢。走路由只重载目标那一个 iframe。
 *
 * ## 校验不过一律静默忽略
 *
 * 这条通道只应由内嵌页发起。任何窗口都能往这里 postMessage，所以三样都得对：
 * 来源 origin 是本页 origin、`type` 完全相等、`portfolio` 是 `portfolio:` 开头的字符串。
 * 不满足就当没收到 —— 绝不该因为别人发来一条消息就把用户跳走。
 */
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

/** 消息类型常量。内嵌页侧是字面量（在编译产物里），两处必须一致。 */
export const OPEN_SERVICE_OPS = 'sip:open-service-ops'

/** 组合 id 的形状，用来挡住构造出来的怪值 */
const PORTFOLIO_ID = /^portfolio:[A-Za-z0-9._~:@+-]{1,200}$/

export function useEmbedBridge() {
  const router = useRouter()

  function onMessage(event) {
    if (event.origin !== window.location.origin) return
    const msg = event.data
    if (!msg || msg.type !== OPEN_SERVICE_OPS) return
    if (typeof msg.portfolio !== 'string' || !PORTFOLIO_ID.test(msg.portfolio)) return

    // 组合 id 进 query，由 ServiceOpsView 拼进 iframe 的 src —— URL 因此可分享、可刷新
    router.push({ path: '/service-ops', query: { portfolio: msg.portfolio } })
  }

  // App 全生命周期只挂载一次（main.js），所以这一个监听就是全局唯一的那一个
  onMounted(() => window.addEventListener('message', onMessage))
  onUnmounted(() => window.removeEventListener('message', onMessage))
}
