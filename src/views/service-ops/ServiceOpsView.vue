<!--
  Service Ops 域 —— 内嵌部署站的 Service Ops 概览页（替换改造前的 page-service-ops 面板）。

  页面内容：KPI 卡片行、按事件压力排序的 Applications 表（可点表头排序）、
  一行筛选 chip、Closure Agent 的 SUGGEST 提示条，以及**点表格行时右侧弹出的详情面板** ——
  最后这条正是本次内嵌的诉求：legacy 那份面板点了没反应。

  ## 为什么是内嵌

  和 Constellation / Business Ops 同理：那是另一套 Next.js 应用的一整页，用 Vue 重写等于
  重写整个页面（含详情面板的取数与渲染）。机制细节统一写在 `src/components/NextEmbed.vue`。

  ## 路径为什么必须是 `/service-ops/`，以及和 Vue 路由的冲突

  内层用 `usePathname()` 查面板表决定 h1。从 `0wuztp2.9oz~8.js` 取到的真实实现是：

      function(e){ let o = "/" !== e && e.endsWith("/") ? e.slice(0,-1) : e;
                  return t.find(t => t.route === o) }

  —— **只剥一个尾斜杠**，且该 chunk 里 `index.html` 零命中。所以合法路径只有
  `/service-ops` 和 `/service-ops/` 两种写法，没有别名绕法。对不上时 `d` 是 undefined，
  代码写的是 `d?.label ?? "SIP"`，于是 h1 **不报错地**变成 "SIP"。

  ⚠️ 这里和 Business Ops 有个关键区别：那边 Vue 路由叫 `/biz-ops`、内嵌页在 `/business-ops/`，
  **两边不同名所以从不打架**。而本页两边都叫 `/service-ops` —— 目录索引插件剥掉尾斜杠后
  就会把 `/service-ops` 也拦下来，硬刷新会返回这个裸的内嵌页、Vue 应用根本不启动。

  解法（两处必须成对）：
  1. `vite.config.js` 的 `sipEmbedPageIndex` 只拦**带尾斜杠**的请求
     → `/service-ops/` 给内嵌页（iframe 打的就是它），`/service-ops` 留给 SPA；
  2. 生产 nginx 补一条 `location = /service-ops { try_files /index.html =404; }`
     —— 否则通用 `try_files $uri $uri/ /index.html` 会把 `/service-ops` 经 `$uri/`
     解成目录索引，同样吐内嵌页。见 README 的 nginx 片段。
  ## 深链：`?portfolio=<id>`

  Business Ops 的组合名点了之后跳到 `/service-ops?portfolio=portfolio:lead`
  （外壳收到 iframe 的 postMessage 后 push 的，见 `src/composables/useEmbedBridge.js`）。
  本视图把这个 query 拼进 iframe 的 src，内嵌页自己从自己的 URL 里读它、预置筛选器。

  ⚠️ **路径不变**：仍是 `/service-ops/`，只是多一个查询串 —— 实测内层 h1 仍解析成
  "Service Ops"（不会掉进上面那个静默变 "SIP" 的分支）。上面那条"路径不能改"的约束
  说的是 pathname，查询串不参与 `panelByRoute` 的比较。
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import NextEmbed from '@/components/NextEmbed.vue'

const route = useRoute()

/** 深链参数。数组形式（`?portfolio=a&portfolio=b`）一律当没有 —— 只认单个字符串。 */
const portfolio = computed(() =>
  typeof route.query.portfolio === 'string' ? route.query.portfolio : '',
)

const src = computed(() =>
  portfolio.value
    ? `/service-ops/?portfolio=${encodeURIComponent(portfolio.value)}`
    : '/service-ops/',
)

/**
 * 重新挂载 iframe 的计数器。
 *
 * 只在**带着 portfolio 落到本页**时自增，用来兜住一种情况：目标组合跟上次一样时
 * `src` 不变，Vue 就不会重设 iframe 的 src，iframe 也就不重载 —— 用户看到的是自己
 * 上次手动改过的筛选（比如点过 All），像是"跳转没生效"。
 *
 * 不带 portfolio 的普通导航（点顶栏 Service Ops）不自增，保持改造前的行为：
 * KeepAlive 缓存着这个视图，来回切页时内层状态原样保留。
 */
const embedKey = ref(0)
watch(
  () => route.fullPath,
  () => {
    if (route.path === '/service-ops' && portfolio.value) embedKey.value++
  },
)
</script>

<template>
  <NextEmbed
    :key="embedKey"
    :src="src"
    title="Service Ops"
    label="正在载入 Service Ops…"
  />
</template>
