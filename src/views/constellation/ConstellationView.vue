<!--
  Constellation 域 —— 内嵌企业架构星座图。

  ## 为什么是内嵌而不是用 Vue 重写

  那张图是 **three.js 的 3D 力导向图**（951 节点 / 1504 边，布局由物理模拟现场跑出来），
  整个页面是另一套 Next.js 应用。用 Vue 重写等于重写整个应用 + 重新实现布局 ——
  试过，做出来不像（先排成放射状"羽毛"，再改成"烟花"，又自写力导向调参数），
  而原站的构建器根本不把坐标拷进节点，布局完全由 3d-force-graph 跑出来。

  直接把能跑的搬进来、只做必要的适配，是这里唯一合理的选择。

  ## 资源怎么来

  副本在 **`public/`** 下（构建脚本 `tools/make-offline-page.py` 产出，已提交）：

      public/constellation-app.html     入口
      public/_next/**                   chunk / css / 字体

  Vite 的 `public/` 是**按根伺服**的，所以内层的 `/_next/…`（turbopack 硬编码的根绝对
  路径）在 dev 和 build 下都对得上，不需要任何 Vite 插件。`src/` 里也不出现
  `http://localhost:*`。

  ## 两条菜单栏怎么解决的

  内层页面自带顶栏（9 个域）和两条底栏，而外层 Vue 应用已经有 AppHeader / AppFooter。
  构建脚本往内层注入了一段 `<style id="sip-embed-shell-strip">` 把那三条剥掉，
  并把 `main` 的高度从 `calc(100vh - 92px)` 还原成 `100vh`。

  用 `--standalone` 构建时跳过这一步 —— 那时内层顶栏是你唯一的导航。

  ## 高度为什么写在 css 里

  `#app` 在 styles.css 里**没有任何规则**，是 `display:block` + 自动高度，高度链断在
  那里（实测只有 112px）。旧视图是在流内的真实内容把 `#app` 撑开的，而这里 iframe
  外层是绝对定位、不贡献高度，链一断就塌成 20px。详见 `css/styles.css` 的
  `/* Constellation Embed */` 一节。
-->

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const frameEl = ref(null)
const loading = ref(true)

/** 入口路径，同源相对路径 —— 见文件头说明 */
const SRC = '/constellation-app.html'

let poll = null
let fallback = null

function done() {
  if (!loading.value) return
  loading.value = false
  if (poll) { clearInterval(poll); poll = null }
  if (fallback) { clearTimeout(fallback); fallback = null }
}

onMounted(() => {
  /*
   * 不只依赖 iframe 的 load 事件。
   *
   * 那个事件**可能在 Vue 挂上监听之前就触发**（浏览器有缓存、或 iframe 加载极快时），
   * 一旦漏掉，loading 就永远是 true —— 表现是**一层白布永久盖住页面**。
   * 这个 bug 在本机 headless 里复现不出来（时序刚好躲过），但真实浏览器会中。
   *
   * 所以补两层兜底：轮询 readyState，外加一个最终超时。
   * 遮罩只是装饰，宁可早撤也不要卡住。
   */
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
  -->
  <div class="cs-embed">
    <iframe
      ref="frameEl"
      :src="SRC"
      class="cs-embed__frame"
      title="Constellation"
      @load="done"
    />
    <div v-if="loading" class="cs-embed__mask">
      <div class="cs-embed__spinner" />
      <div>正在载入 Constellation…</div>
    </div>
  </div>
</template>
