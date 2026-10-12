<!--
  Architecture 域 —— 内嵌部署站的 Architecture 面板（替换改造前的空壳域行为）。

  改造前 Architecture 是 **5 个空壳域之一**（`NAV` 里 `sidebar: null`）：点顶栏落到
  service-ops 概览，再由接缝 S9 把那页标题改写成域名 —— 也就是说这一栏背后**没有自己的页面**。
  本视图给它接上真实内容。

  页面内容：KPI 四格（Apps in estate / Tier-1+Tier-2 / Peak-Season-Critical / Decommissioned）、
  22 个 portfolio 的 **Estate graph**（cytoscape，可点选、可按 6R / 风险 / journey 上色）、
  6R distribution、Risk concentration by journey、ADR drift watch、Tech stack roster、
  Modernization wave plan，右侧是 portfolio / app inspector。

  ## 为什么是内嵌

  和 Constellation / Business Ops / Service Ops 同理：那是**另一套 Next.js 应用**的一整页。
  这张图是 cytoscape 现场跑的布局（+ 4 层边着色、上下钻、inspector 联动），用 Vue 重写
  等于重写整个页面 —— Constellation 那次试过重写力导向图，结论是「做出来不像」，
  完整记录见 `changelogs/v2.0.0-constellation-embed.md`。
  机制细节（资源怎么来、两条菜单栏怎么剥掉、高度链为什么断、加载检测为什么有三层）
  统一写在 `src/components/NextEmbed.vue`。

  ## 路径为什么必须是 `/architecture/`

  内层用 `usePathname()` 查面板表决定 h1（`0wuztp2.9oz~8.js` 的 `panelByRoute`，由
  `PanelContainer` 消费）。该表里 Architecture 那条是：

      { id:"architecture", label:"Architecture", route:"/architecture", pool:"VP4",
        subtitle:"6R classification · modernization queues" }

  `panelByRoute` **只剥一个尾斜杠**、不认 `index.html`，对不上时 `d` 是 undefined，
  而代码写的是 `d?.label ?? "SIP"` —— **不报错**，只是 h1 从「Architecture」悄悄变成 "SIP"。
  所以产出文件必须是 `public/architecture/index.html`。**这个路径不能改。**

  > 该表里的 `subtitle` 与 `NAV` 里 Architecture 域的 `title` 是同一句
  > 「6R classification · modernization queues」—— 两者本来就一致，不是巧合。

  ## 与 Vue 路由**同名**：冲突处置与 Service Ops 完全一致

  这里和 Business Ops 有个关键区别：那边 Vue 路由叫 `/biz-ops`、内嵌页在 `/business-ops/`，
  两边不同名所以从不打架。本域两边**都叫 `/architecture`** —— 目录索引插件剥掉尾斜杠后
  会把 `/architecture` 也拦下来，硬刷新就会返回这个裸的内嵌页、Vue 应用根本不启动。

  解法（三处必须成对，与 Service Ops 逐条对应）：
  1. `vite.config.js` 的 `sipEmbedPageIndex` 只拦**带尾斜杠**的请求
     → `/architecture/` 给内嵌页（iframe 打的就是它），`/architecture` 留给 SPA；
  2. 生产 nginx 补 `location = /architecture { try_files /index.html =404; }`
     —— 否则通用 `try_files $uri $uri/ /index.html` 会把 `/architecture` 经 `$uri/`
     解成目录索引，同样吐内嵌页。见 README 的 nginx 片段；
  3. 组件在 `src/router/index.js` 的 `DOMAIN_COMPONENTS` 里登记一次
     （空壳域不走 MIGRATED / VIEW_COMPONENTS 那一套，理由见那里的注释）。

  ## 为什么没有侧边栏

  `NAV` 里本域 `sidebar: null`，改造前就是空壳域 —— 一个叶子都没有，没有可挂的导航。
  另一个理由与 Business Ops 相同：那页**右侧自带 inspector 栏**，再来一条外层侧边栏
  会把中间的图挤没。
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
  <NextEmbed :src="base + '/architecture/'" title="Architecture" label="正在载入 Architecture…" />
</template>
