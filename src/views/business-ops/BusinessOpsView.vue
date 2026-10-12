<!--
  Business Ops 域 —— 内嵌部署站的 Business Ops 概览页。

  页面内容：journey health（AVG XLA / 风险 journey / holiday-critical）、六条 journey 的
  可排序 XLA 表、14 周 × 7 天的 incident pressure 热力图，右侧是选中节点的 inspector。

  ## 为什么是内嵌

  和 Constellation 同理：那是**另一套 Next.js 应用**的一整页（`PanelContainer` + inspector +
  表格排序 + 热力图），用 Vue 重写等于重写整个页面。机制细节（资源怎么来、两条菜单栏怎么
  剥掉、高度链为什么断、加载检测为什么有三层）统一写在 `src/components/NextEmbed.vue`。

  ## 路径为什么必须是 `/business-ops/`

  内层页面用 `usePathname()` 查面板表来决定 h1（`0wuztp2.9oz~8.js` 的 `panelByRoute`，
  由 `0pfw3-ib1qee0.js` 的 `PanelContainer` 消费）：

      { id:"business-ops", index:2, label:"Business Ops", route:"/business-ops", … }

  路径对不上时 `d` 是 undefined，而代码写的是 `d?.label ?? "SIP"` —— **不报错**，
  只是 h1 从「Business Ops」悄悄变成「SIP」。

  所以产出文件必须叫 `public/business-ops/index.html`（`panelByRoute` 会剥掉尾部斜杠），
  这里也就必须打 `/business-ops/`。**这个路径不能改。**

  本域的 Vue 路由另走 `/biz-ops`（`NAV` 里的 key），两者不同名、不打架。
  dev/preview 下 Vite 不解析 public/ 的目录索引，靠 `vite.config.js` 的
  `sip-embed-page-index` 插件补上。
-->
<script setup>
import NextEmbed from '@/components/NextEmbed.vue'

/**
 * 应用挂载前缀（末尾不带斜杠）：本机 `''`、子路径部署 `'/sip'`。
 * 取自 Vite 的 `base` —— 编译期常量，由 scripts/vite-with-base.mjs 探测后传入。
 *
 * 内嵌页的真实路径必须是 `/xxx/` 这个形态（见本文件顶部「路径为什么必须是 …」那节），
 * 所以前缀与裸路径**分开拼**，保留 `/` 开头的字面量 ——
 * `.claude/skills/sip-embed-page/scripts/check-embed-wiring.py` 正是按它反查的。
 */
const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
</script>

<template>
  <NextEmbed :src="base + '/business-ops/'" title="Business Ops" label="正在载入 Business Ops…" />
</template>
