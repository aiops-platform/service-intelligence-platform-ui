<!--
  Engineering Ops 域 —— 内嵌部署站的 Engineering Ops 面板。

  ## 与另外五个内嵌域的唯一结构差异：本域**原本有侧边栏**

  改造前 `eng-ops` 是**有侧边栏的域**（Knowledge Studio › Knowledge Reflow Log /
  Knowledge Search），两个叶子都是 legacy 面板。按用户要求，2026-09-21 摘掉了侧边栏
  并接入这个内嵌页 —— 于是它才落进 `EMPTY_DOMAINS` / `DOMAIN_COMPONENTS` 这一类，
  与另外五个域对齐。摘导航的连带影响（两个叶子不再产出路由）与恢复方法写在
  `src/router/nav.js` 里 eng-ops 那一段的注释。

  ## 路径与 Vue 路由**不同名** —— 所以**不需要** nginx 那条

  Vue 路由是 `/eng-ops`（NAV 里的 key），内嵌页在 `/engineering-ops/`。
  两者不同名，所以不会出现「目录索引抢走同名 Vue 路由」的问题，README 的 nginx 片段
  里**没有** `location = /engineering-ops`（Business Ops 同理：`/biz-ops` vs
  `/business-ops/`）。

  但 `vite.config.js` 的 `EMBED_PAGES` **仍然要加** —— 那个列表的另一半职责是给
  dev/preview 补「Vite 不解析 `public/` 目录索引」，与同名冲突是两件事。少了它，
  `/engineering-ops/` 会落进 SPA 兜底，iframe 里渲染出 Vue 应用自己。

  ## 路径为什么必须是 `/engineering-ops/`

  内层用 `usePathname()` 查面板表决定 h1（`0wuztp2.9oz~8.js` 的 `panelByRoute`，
  由 `PanelContainer` 消费）。该表里本域那条是：

      { id:"engineering-ops", index:4, label:"Engineering Ops",
        shortLabel:"Engineering", route:"/engineering-ops",
        subtitle:"Code velocity · change calendar · Claude Code workbench", pool:"VP3" }

  —— **有 `pool`**（与 finops / security-ops 不同）。`panelByRoute` 只剥一个尾斜杠，
  对不上时 h1 静默变成 "SIP"。所以产出必须是 `public/engineering-ops/index.html`。

  ## 页面内容

  DORA 四格（Total Changes · N mo / Deploy frequency / Lead time / Change failure rate）、
  **Emergency vs Standard · backout differential**（对照开关打开时变 `1×`）、Pre-flight
  queue（变更列表，可按 risk / 类型 / app tier / freeze window / 6R 过滤）、右侧
  ChangeInspector（blast radius 1-hop、agents touching entity、linked PRs / CI /
  incidents / runbooks）、Cross-change conflicts、Reinvention pipeline（6R candidates、
  ADR drift）、CIO override queue，以及一条 agent 活动 ticker
  （CAB Reviewer / {criticalShort} Guard / Risk Scorer / HC Guard / Backout Predictor）。

  ## 这一页本就按多租户写的

  变更列表完全由 `snapshot.apps` 派生（T1 前 6 / T2 前 8 / T3 前 14），文案读
  `tenantLabels.criticalCaption` / `freezeLong` / `highlightEntities`；唯一那条合成
  应急变更的锚点 app 用的是**回退链**（`manhattan wms` → T1+HC → 第一个），所以少哪个
  都不会空。写死内容只有两处，都已处置或有意保留：

  - **`PanelContainer` description**：`86,994 changes · 13mo · 96×`（实测是
    best-buy 的值，而默认租户的 KPI 卡片同时写着 5.3K / 18 mo / 63×）→ 已进
    `tenant_copy.py` 的 `LEGACY["eng_desc"]` + `tenant_pairs()`，与 Architecture 的
    `arch_desc` 同一套处置；
  - **agent ticker 的三条叙事计数**（`auto-approved 8 standard changes` 等）：自检报 ⚠，
    但那是页面自带 tooltip `"Synthetic-but-believable activity ticker · scripted for the
    demo"` 声明过的剧本文案，数字无数据来源，有意保留。

  ## ⚠️ 页内有两个跳转目标落在本仓之外（已实测，见 changelog）

  `router.push("/agents/?group=sl")` 与 `router.push("/service-ops/")` 是**内层 Next 应用
  自己的路由**。本仓没有导出 `/agents/`，它会落进 SPA 兜底 → iframe 里渲染出整个 Vue
  应用自己（skill 记的「自己套自己」）。`/service-ops/` 则会在这个 iframe 里套出
  Service Ops 内嵌页。
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
  <NextEmbed :src="base + '/engineering-ops/'" title="Engineering Ops" label="正在载入 Engineering Ops…" />
</template>
