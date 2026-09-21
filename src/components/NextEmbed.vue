<!--
  Next.js 内嵌页 —— Constellation 与 Business Ops 共用。

  两个域背后都是**另一套 Next.js 应用**（部署站 `sip-platform.web.app`），不是本仓的产物。
  为什么内嵌而不是用 Vue 重写，各域自己的理由写在各自的视图里。

  ## 资源怎么来

  副本在 **`public/`** 下（构建脚本 `tools/make-offline-page.py` 产出，已提交）：

      public/constellation-app.html     入口
      public/business-ops/index.html    入口（这个路径不能改，见 BusinessOpsView.vue）
      public/service-ops/index.html     入口（同上，见 ServiceOpsView.vue）
      public/architecture/index.html    入口（同上，见 ArchitectureView.vue）
      public/_next/**                   chunk / css / 字体（四页共用）

  Vite 的 `public/` 是**按根伺服**的，所以内层的 `/_next/…`（turbopack 硬编码的根绝对
  路径）在 dev 和 build 下都对得上，不需要任何 Vite 插件。`src/` 里也不出现
  `http://localhost:*`。

  ## 两条菜单栏怎么解决的

  内层页面自带顶栏（9 个域）和一条底栏，而外层 Vue 应用已经有 AppHeader / AppFooter。
  构建脚本往内层注入了一段 `<style id="sip-embed-shell-strip">` 把那两条剥掉，
  并把 `main` 的高度从 `calc(100vh - 92px)` 还原成 `100vh`。

  ## 定位为什么写在 css 里

  外壳的高度链曾经是断的（`#app` 没有任何规则、`main` 只有 60px 高且会裁切），
  那时 `.cs-embed` 只能靠 `position: fixed` 相对视口定位来绕开。
  **`#app` 的规则后来补上了**（见 `css/styles.css` body 之后那一节），高度链已通，
  所以 `.cs-embed` 现在改成相对 `main` 的绝对定位 —— 这样它才会给侧边栏让位。
  详见 `css/styles.css` 的 `/* Next.js Embed */` 一节。

  ⚠️ 注意：用 `fixed` 时它是**无视 .app-body 的 flex 布局**的，会盖住左侧的
  `.sidebar` / `.sidebar-grip`。Service Ops 域有侧边栏，不能再用那个写法。

  ## 为什么加载检测有三层

  不能只依赖 iframe 的 load 事件 —— 那个事件**可能在 Vue 挂上监听之前就触发**
  （浏览器有缓存、或 iframe 加载极快时），一旦漏掉，loading 就永远是 true，表现是
  **一层白布永久盖住页面**。这个 bug 在本机 headless 里复现不出来（时序刚好躲过），
  但真实浏览器会中。

  所以补两层兜底：轮询 readyState，外加一个最终超时。遮罩只是装饰，宁可早撤也不要卡住。

  > 这段逻辑原来只写在 ConstellationView.vue 里。接第二个内嵌页时抽到这里 ——
  > 复制一份等于以后要把上面这个 bug 修两遍。
-->
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

defineProps({
  /** 入口路径，同源相对路径 —— 见文件头说明 */
  src: { type: String, required: true },
  /** iframe 的无障碍标题 */
  title: { type: String, required: true },
  /** 遮罩上的文案，如「正在载入 Constellation…」 */
  label: { type: String, required: true },
})

/**
 * 本应用是不是**已经被同源页面嵌着**在跑。
 *
 * 兜住一类别的东西都拦不住的故障：**外壳被套进自己的 iframe**。
 * 起因是内嵌页里一个指向本仓**没有导出**的路由的链接（Service Ops 表格行尾的 `›`
 * → `/entity/app/<slug>/`）—— 那个路径落进宿主的 SPA 兜底，返回 Vue 应用自己的
 * index.html，vue-router 的 catch-all 再重定向回 `/service-ops`，于是 Service Ops
 * 的 iframe 里又是一个 Service Ops，每点一次多套一层。
 *
 * 那两个链接的具体处置在构建期（`tools/tenant_copy.py` 的
 * `patch_service_ops_entity_links`）。这里是**第二道**：不管什么原因让宿主被套进自己，
 * 都在这一层停住，不再往下渲染 iframe。
 *
 * 为什么判同源、而不是判「在不在 iframe 里」：跨源 iframe 是**正常的**第三方嵌入
 * （别人把 SIP 挂进自己页面），那时本组件应当照常工作。只有同源祖先才说明
 * 「SIP 套 SIP」。跨源时读 `window.top.location` 会抛，正好用来区分。
 */
function inSameOriginFrame() {
  if (window.self === window.top) return false
  try {
    void window.top.location.href
    return true
  } catch {
    return false                                  // 跨源：读不到 → 正常的第三方嵌入
  }
}

const frameEl = ref(null)
const loading = ref(true)
const selfEmbedded = inSameOriginFrame()

let poll = null
let fallback = null

function done() {
  if (!loading.value) return
  loading.value = false
  if (poll) { clearInterval(poll); poll = null }
  if (fallback) { clearTimeout(fallback); fallback = null }
}

onMounted(() => {
  if (selfEmbedded) return                       // 不渲染 iframe，也就没有 load 要等
  poll = setInterval(() => {
    const f = frameEl.value
    if (f && f.contentDocument && f.contentDocument.readyState === 'complete') done()
  }, 400)
  fallback = setTimeout(done, 12000)
})

onUnmounted(() => {
  if (poll) clearInterval(poll)
  if (fallback) clearTimeout(fallback)
})
</script>

<template>
  <!--
    绝对定位填充 main —— 位置与高度都由 .cs-embed 的规则定，见 styles.css。
    （`cs-` 前缀是历史：最初为 Constellation 写的，现在两个内嵌页共用，类名不改 ——
    它是 styles.css 的消费方，改名会静默掉样式。）
  -->
  <div class="cs-embed">
    <!-- 第二道闸：宿主已被同源页面嵌着，就不再往下套（见 inSameOriginFrame 的说明） -->
    <div v-if="selfEmbedded" class="cs-embed__guard">
      <div class="cs-embed__guard-title">未继续加载内嵌页</div>
      <div class="cs-embed__guard-body">
        本应用当前运行在同源 iframe 里，再嵌一层会变成「自己套自己」。
        请在新标签页打开本页，或从顶部导航进入。
      </div>
    </div>
    <template v-else>
      <iframe
        ref="frameEl"
        :src="src"
        class="cs-embed__frame"
        :title="title"
        @load="done"
      />
      <div v-if="loading" class="cs-embed__mask">
        <div class="cs-embed__spinner" />
        <div>{{ label }}</div>
      </div>
    </template>
  </div>
</template>
