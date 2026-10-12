<!--
  FinOps 域 —— 内嵌部署站的 FinOps 面板（替换改造前的空壳域行为）。

  改造前 FinOps 是 **5 个空壳域之一**（`NAV` 里 `sidebar: null`）：点顶栏落到 service-ops 概览，
  再由接缝 S9 把那页标题改写成域名 —— 也就是说这一栏背后**没有自己的页面**。
  本视图给它接上真实内容。

  > 接上本页之后，`NAV` 里 5 个 `sidebar: null` 的域**全部**有了自己的页面。
  > 空壳兜底（落 service-ops 概览 + 改写标题）就此不再有域走到，但机制保留 ——
  > 见 `src/router/index.js` 的 `emptyDomainRoutes` 与 `nav.js` 数组末尾的说明。

  页面内容：KPI 四格（**Total estate burn** / Hidden-cost share / Legacy-stack apps /
  Cost / incident）、**Cost of running · top 12 apps**（按 monthly burn 排序，行内可见/隐藏
  成本拆分，点行看账单里藏了什么）、**Cost concentration · by portfolio** 与 **Cost vs risk
  scatter**（T1+T2 的 cost vs risk）、**Hidden cost of legacy · estate composition**，
  顶部有 **With agents / Without agents** 对照开关与一条 agent 活动 ticker，右侧 inspector
  （Tab：Cost / Activity / Evidence，含 Rationalization candidates）。

  ## 这一页的数是**算出来的**，不是写死的

  与 Security Ops 不同：本页的成本模型完全从租户快照推导，没有写死的 estate 数字。

      x(app) = tierBase(tier) + infraCost(log10 事故数) + changeCost(变更数)
             + legacyStackTax(legacyShare × tierBase × 0.45)
             + humanMttrPremium(humanMTTR / botMTTR) + scalingAroundFlaws(bot 解决率)

  `totalBurn` / `hiddenShare` / `top 12` / 组合聚合 / `legacyAppCount` 都是对
  `snapshot.apps` 求和得来的，`legacyShare` 来自 `snapshot.appTechnologies` 与一份
  **静态技术栈关键词表**（Mainframe / COBOL / Oracle Forms / Teradata / Maestro …）匹配
  —— 那是通用技术名，不是租户数据，属于正常写死。

  ## 为什么是内嵌

  和另外五个域同理：那是**另一套 Next.js 应用**的一整页（面板容器 + 可排序的成本表 +
  scatter + 组合聚合 + inspector + 对照开关），用 Vue 重写等于重写整个页面。

  ## 路径为什么必须是 `/finops/`

  内层用 `usePathname()` 查面板表决定 h1（`0wuztp2.9oz~8.js` 的 `panelByRoute`，
  由 `PanelContainer` 消费）。该表里本域那条是：

      { id:"finops", index:6, label:"FinOps", shortLabel:"FinOps", route:"/finops",
        subtitle:"Cloud trajectory · vendor consolidation · untagged spend" }

  —— **没有 `pool` 字段**（与 security-ops 一样，其余六个域都有）。

  `panelByRoute` **只剥一个尾斜杠**、不认 `index.html`，对不上时 `d` 是 undefined，
  而代码写的是 `d?.label ?? "SIP"` —— **不报错**，只是 h1 从「FinOps」悄悄变成 "SIP"。
  所以产出文件必须是 `public/finops/index.html`。**这个路径不能改。**

  > 该表里的 `subtitle` 与 `NAV` 里本域的 `title` 是同一句
  > 「Cloud trajectory · vendor consolidation · untagged spend」—— 两者本来就一致。

  ## 与 Vue 路由**同名**：冲突处置与 Service Ops / Architecture / Security Ops 一致

  本域两边**都叫 `/finops`** —— 目录索引插件剥掉尾斜杠后会把 `/finops` 也拦下来，
  硬刷新就会返回这个裸的内嵌页、Vue 应用根本不启动。

  实测过不加 `EMBED_PAGES` 的症状：`/finops/` 落进 SPA 兜底，Vue 把「空壳域落到
  service-ops 概览 + 标题改写成域名」那套跑出来 —— **h1 显示「FinOps」，内容却是
  Service Ops 的**（KPI 是事故数 / MTTR / TOP APPS BY INCIDENT PRESSURE）。看着像
  「页面接上了」，其实接的是另一个页面。

  解法（三处必须成对）：
  1. `vite.config.js` 的 `sipEmbedPageIndex` 只拦**带尾斜杠**的请求
     → `/finops/` 给内嵌页（iframe 打的就是它），`/finops` 留给 SPA；
  2. 生产 nginx 补 `location = /finops { try_files /index.html =404; }` —— 否则通用
     `try_files $uri $uri/ /index.html` 会把 `/finops` 经 `$uri/` 解成目录索引。见 README；
  3. 组件在 `src/router/index.js` 的 `DOMAIN_COMPONENTS` 里登记一次
     （空壳域不走 MIGRATED / VIEW_COMPONENTS 那一套，理由见那里的注释）。

  ## 为什么没有侧边栏

  `NAV` 里本域 `sidebar: null`，改造前就是空壳域 —— 一个叶子都没有，没有可挂的导航。
  另一个理由与 Architecture / Business Ops / Security Ops 相同：那页**右侧自带
  inspector 栏**，再来一条外层侧边栏会把中间的成本表挤没。

  ## 写死内容（已核，结论：不需要租户补丁）

  - agent 活动 ticker 的 8 条文案里有 app / portfolio 名（Manhattan WMS、Retek
    Merchandising、Maestro Batch、Selling portfolio）与一个金额（$13.4M）——
    但该 ticker 自带 tooltip 标注 `"Synthetic-but-believable FinOps activity ticker ·
    scripted for the demo"`，页面**自己声明**它是剧本化演示文案；且它只驱动自身显示，
    不喂任何 KPI（与 Security Ops 的 case 列表不同，那个是 KPI 计数的数据源）。
  - 名字逐个租户核过：`Manhattan WMS` 只在 best-buy-reference，另外三个在任何租户里
    都不存在 —— 没有语义对得上的映射可做，硬凑即编数据，故保持原样。
  - `Cost of running · top 12 apps` 里的「top 12」与代码 `slice(0,12)` 一致，是标签不是数据。
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
  <NextEmbed :src="base + '/finops/'" title="FinOps" label="正在载入 FinOps…" />
</template>
