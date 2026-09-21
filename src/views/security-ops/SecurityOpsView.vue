<!--
  Security Ops 域 —— 内嵌部署站的 Security Ops 面板（替换改造前的空壳域行为）。

  改造前 Security Ops 是 **5 个空壳域之一**（`NAV` 里 `sidebar: null`）：点顶栏落到
  service-ops 概览，再由接缝 S9 把那页标题改写成域名 —— 也就是说这一栏背后**没有自己的页面**。
  本视图给它接上真实内容。

  页面内容：KPI 四格（Cases contained today / Top alert storm 等）、Alert Triage 的 case 列表
  （SEC-* 带 INVESTIGATING / CONTAINED / ESCALATED，可按状态与 agent 过滤）、Live agent
  containment 的 agent 活动流（live / suggest / shadow 三种模式）、Composite security score ·
  top apps（按 tier / 分数档 / holiday-critical 过滤的高暴露 app）、Emergency change risk
  （跨面板），顶部有 **With agents / Without agents** 对照开关，右侧是 case / app inspector。

  ## 为什么是内嵌

  和 Constellation / Business Ops / Service Ops / Architecture 同理：那是**另一套 Next.js 应用**
  的一整页 —— 面板容器 + 可过滤的 case 列表 + app 打分排序 + 右侧 inspector 联动 + 对照开关，
  用 Vue 重写等于重写整个页面。机制细节（资源怎么来、两条菜单栏怎么剥掉、高度链为什么断、
  加载检测为什么有三层）统一写在 `src/components/NextEmbed.vue`。

  ## 路径为什么必须是 `/security-ops/`

  内层用 `usePathname()` 查面板表决定 h1（`0wuztp2.9oz~8.js` 的 `panelByRoute`，
  由 `PanelContainer` 消费）。该表里本域那条是：

      { id:"security-ops", index:7, label:"Security Ops", shortLabel:"Security",
        route:"/security-ops", subtitle:"Vulnerability heatmap · attack surface · freeze risk" }

  —— **没有 `pool` 字段**（与 finops 一样，其余六个域都有）。

  `panelByRoute` **只剥一个尾斜杠**、不认 `index.html`，对不上时 `d` 是 undefined，
  而代码写的是 `d?.label ?? "SIP"` —— **不报错**，只是 h1 从「Security Ops」悄悄变成 "SIP"。
  所以产出文件必须是 `public/security-ops/index.html`。**这个路径不能改。**

  > 该表里的 `subtitle` 与 `NAV` 里本域的 `title` 是同一句
  > 「Vulnerability heatmap · attack surface · freeze risk」—— 两者本来就一致，不是巧合。

  ## 与 Vue 路由**同名**：冲突处置与 Service Ops / Architecture 完全一致

  本域两边**都叫 `/security-ops`** —— 目录索引插件剥掉尾斜杠后会把 `/security-ops` 也拦下来，
  硬刷新就会返回这个裸的内嵌页、Vue 应用根本不启动。（Business Ops 那边不打架，是因为
  Vue 路由叫 `/biz-ops`、内嵌页在 `/business-ops/`，两边不同名。）

  解法（三处必须成对，与 Service Ops / Architecture 逐条对应）：
  1. `vite.config.js` 的 `sipEmbedPageIndex` 只拦**带尾斜杠**的请求
     → `/security-ops/` 给内嵌页（iframe 打的就是它），`/security-ops` 留给 SPA；
  2. 生产 nginx 补 `location = /security-ops { try_files /index.html =404; }`
     —— 否则通用 `try_files $uri $uri/ /index.html` 会把 `/security-ops` 经 `$uri/`
     解成目录索引，同样吐内嵌页。见 README 的 nginx 片段；
  3. 组件在 `src/router/index.js` 的 `DOMAIN_COMPONENTS` 里登记一次
     （空壳域不走 MIGRATED / VIEW_COMPONENTS 那一套，理由见那里的注释）。

  ## 为什么没有侧边栏

  `NAV` 里本域 `sidebar: null`，改造前就是空壳域 —— 一个叶子都没有，没有可挂的导航。
  另一个理由与 Architecture / Business Ops 相同：那页**右侧自带 inspector 栏**，
  再来一条外层侧边栏会把中间的内容挤没。

  ## 这一页的写死内容（构建期补丁，见 tools/tenant_copy.py）

  页面是照着 best-buy-reference 租户（893 apps 那个）写的，有两处不跟租户变，都已补掉：

  - **那场告警风暴**：case 列表 / agent 活动流 / With-Without-agents 对照条里写死了
    `INC13075702` 与 `1,809`（KPI「Top alert storm」读的是 REAL、本来就按租户算，
    于是同屏会出现 KPI 说 A、正下方 case 说 B 的自相矛盾）→ `tenant_pairs()` 里按租户替换；
  - **case inspector 的「Linked app」**：两条 case 的 `appKey:"manhattan wms"` 只存在于
    best-buy-reference，其余 11 个租户（含默认租户 `otr`）反查落空，那一整节会**静默消失**
    （渲染走的是 `s && (…)` 短路，不报错也不留空态）→ `patch_security_ops_linked_app()`
    改写成读本租户的 `snapshot.topStorm.appKey`。

  其余三条 case 的 appKey（`anchor-app` / `order management` / `enterprise teradata` /
  `repair workbench`）在任何租户里都不存在，没有语义对得上的映射，保持原样。
-->
<script setup>
import NextEmbed from '@/components/NextEmbed.vue'
</script>

<template>
  <NextEmbed src="/security-ops/" title="Security Ops" label="正在载入 Security Ops…" />
</template>
