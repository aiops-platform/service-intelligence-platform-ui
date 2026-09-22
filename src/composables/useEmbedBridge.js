/**
 * 内嵌页 → 外壳 的跳转桥。
 *
 * 内嵌页（Constellation / Business Ops / Service Ops / FinOps / Security Ops /
 * Engineering Ops）都是**同源 iframe**，在此之前全仓没有任何通信通道
 * （`postMessage` 零命中）。这是第一条，也是唯一一条：
 * 内嵌页说「我要去某页」，外壳负责把它翻成**一次路由跳转**。
 *
 * ## 消息契约
 *
 *     { type: 'sip:open-service-ops', portfolio: 'portfolio:lead' }   // portfolio 可选
 *     { type: 'sip:open-agents' }
 *     { type: 'sip:open-engineering-ops' }
 *
 * 发消息的一方在编译产物里，见 `tools/tenant_copy.py` 的
 * `patch_business_ops_portfolio_jump()`、`patch_engineering_ops_links()` 与
 * `patch_security_ops_links()`。
 *
 * > 三种消息长得几乎一样（都只是「去某个顶层路由」）。**再多一种就该换成白名单表**
 * > （`{type: path}` 映射），而不是继续加常量 —— 那样校验与路由都在一处。
 * > 现在只有三个，显式写开更好读，先不抽象。
 *
 * ## 为什么必须有这条通道（而不是让内层自己 push）
 *
 * 内层是**另一套 Next.js 应用**，它 `router.push()` 的是**它自己的路由**。
 * 那些路径本仓大多没有导出成内层页，于是会落进宿主 SPA 兜底 ——
 * 也就是在 iframe 里**渲染出整个 Vue 应用自己**（`/agents/` 实测如此），
 * 或者套出一层别的内嵌页。
 *
 * Engineering Ops 上实测坐实：点「SDLC Agents Live」→ iframe 里跑起完整 SIP 外壳 +
 * AGENTS 页。而且这一例**连 `NextEmbed` 的第二道闸都躲过了** —— `inSameOriginFrame()`
 * 只在目标路由本身是内嵌页时才生效，`/agent-registry` 不是，所以没有任何拦截。
 *
 * Security Ops 的「Emergency change risk」卡片则是另一种形态（★ 值得记）：
 * 它 push 的是 `/engineering-ops/`（**带**尾斜杠，本仓确实导出了这个目录索引），
 * 但 **Next 默认 `trailingSlash: false`，导航前会把尾斜杠抹掉** ——
 * 实际请求的是 `/engineering-ops`，于是照样落进 SPA 兜底、被 vue-router 的 catch-all
 * 重定向到 `/service-ops`。**「本仓有这个页面」不等于这个链接是安全的**：
 * 只要它经过内层路由，尾斜杠就可能被规范化掉。
 *
 * ## 为什么由外壳做路由，而不是让 iframe 直接改 `parent.location`
 *
 * 后者要整页刷新：Vue 应用重启、legacy 世界（js/app.js 的 17 个 init）重跑一遍、
 * 其它视图的 KeepAlive 缓存全丢。走路由只重载目标那一个 iframe。
 *
 * ## 校验不过一律静默忽略
 *
 * 这条通道只应由内嵌页发起。任何窗口都能往这里 postMessage，所以来源 origin 必须是
 * 本页 origin、`type` 必须完全相等，带载荷的还要过形状校验。
 * 不满足就当没收到 —— 绝不该因为别人发来一条消息就把用户跳走。
 */
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

/** 消息类型常量。内嵌页侧是字面量（在编译产物里），两处必须一致。 */
export const OPEN_SERVICE_OPS = 'sip:open-service-ops'
export const OPEN_AGENTS = 'sip:open-agents'
export const OPEN_ENGINEERING_OPS = 'sip:open-engineering-ops'

/** 组合 id 的形状，用来挡住构造出来的怪值 */
const PORTFOLIO_ID = /^portfolio:[A-Za-z0-9._~:@+-]{1,200}$/

export function useEmbedBridge() {
  const router = useRouter()

  function onMessage(event) {
    if (event.origin !== window.location.origin) return
    const msg = event.data
    if (!msg) return

    if (msg.type === OPEN_SERVICE_OPS) {
      // `portfolio` **可选**：Business Ops 的组合名带它（由 ServiceOpsView 拼进 iframe 的
      // src，URL 因此可分享、可刷新）；Engineering Ops 的 MTTR 卡片只要求「打开 Service Ops」。
      // 带的时候仍然按原样校验 —— 放宽的只是「必须带」，不是「带了可以不合法」。
      const query = {}
      if (msg.portfolio !== undefined) {
        if (typeof msg.portfolio !== 'string' || !PORTFOLIO_ID.test(msg.portfolio)) return
        query.portfolio = msg.portfolio
      }
      router.push({ path: '/service-ops', query })
      return
    }

    if (msg.type === OPEN_AGENTS) {
      // ⚠️ 内层的 `?agent=` / `?group=sl` **没有往这里带**：本仓的 Agents 页
      // （`src/views/agents/`）完全不读 query，带了也只是挂在 URL 上没人消费。
      // 内层那两个参数指的是**部署站自己的** agent 分类（`sl` 组 = AI-First SDLC，
      // T3/T3+），与本仓 Agents 页的口径不保证一致 —— 与其装作能对上，不如只落地到页面。
      // 将来 Agents 页支持了选中，再把载荷加回来（内层那两个 push 目标还在，见 tenant_copy）。
      router.push('/agent-registry')
      return
    }

    if (msg.type === OPEN_ENGINEERING_OPS) {
      // Security Ops 的「Emergency change risk」卡片。原站上点它是整页切到
      // Engineering Ops 面板（见内层那句 `sub:"… · /engineering-ops"`），
      // 这里就落到本仓对应的顶层路由 `/eng-ops`。
      router.push('/eng-ops')
    }
  }

  // App 全生命周期只挂载一次（main.js），所以这一个监听就是全局唯一的那一个
  onMounted(() => window.addEventListener('message', onMessage))
  onUnmounted(() => window.removeEventListener('message', onMessage))
}
