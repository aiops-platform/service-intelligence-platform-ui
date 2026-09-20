# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概述

Service Intelligence Platform (SIP) 前端 —— 面向服务运维事件管理的仪表盘。展示 KPI 指标、可筛选的
应用/告警/问题列表，以及跨运维域的导航（Service Ops、Business Ops、Engineering Ops、Agents 等）。

**自 v2.0.0 起本仓是「双世界」结构**（见下），改动前请先确认你改的是哪一边。

## 常用命令

```bash
npm install
npm run dev       # Vite 开发服务器，默认 :5173
npm run build     # 产出 dist/
npm run preview   # 预览构建产物，默认 :4173
```

浏览器访问 `http://localhost:5173`。

> **端口注意**：开发时前端在 `:5173`，经 Vite proxy 转发到三个后端
> （sip-aiops `:8080`、agentflow `:8000`、aiops-datasource-mcp-server `:8300`）。
> **不要**把前端起在 `8080` —— 那是 sip-aiops 的端口。

## 架构：双世界（v2.0.0）

同一文档内两个世界共存，**唯一不变式是「同一棵 DOM 子树只能有一个所有者」**。

| | Vue 世界 | 遗留世界 |
|---|---|---|
| 位置 | `src/` | `js/app.js`（8777 行 IIFE，原地保留） |
| 拥有的 DOM | 外壳（header/sidebar/footer）+ **已迁移视图** | **未迁移的 15 个视图** + 12 个共享模态 + drawer |
| 样式 | 共用 `css/styles.css`（7099 行，全局引入，**一字未改**） | 同左 |

**已迁移视图**（`src/router/nav.js` 的 `MIGRATED` 集合）：`log-analysis`、`bug-solve`、
`tickets`、`agent-registry`。

> **不属于任何域的页面走 `EXTRA_ROUTES`**（`src/router/index.js`），不走 `MIGRATED` /
> `VIEW_COMPONENTS` 那一套——后者是给**侧边栏叶子**用的（会经 `flattenItems()` 产出路由）。
> 现有两条：`/runs/:runId`（Run 详情）与 `/cmdb`（CMDB 编辑器，入口在头部右上的用户菜单里）。
> 加这类页只需要在 `EXTRA_ROUTES` 里登记一次，并给出自己的入口。

### 接缝（`js/app.js` 里的 `window.__SIP_*`）

| 接缝 | 作用 |
|---|---|
| `legacyRoot()` | 全文档查询的作用域根。**本文件所有 `querySelectorAll` 都必须收进它**，否则会误伤 Vue 渲染的节点（典型后果：`initTableSorting` 重排 Vue 表格的行 → vdom 失步，症状随机难复现） |
| `__SIP_LEGACY_ROOT` | 由 `src/legacy/bridge.js` 设置；同时是「嵌入模式」的判据（据此跳过 `initSidebar`/`initNavigation`/`initLogAnalysis`/`initBugSolve`） |
| `__SIP_SHOW_PAGE` | 切 legacy 面板。路由守卫调用它，旧 `_pageRefreshers` 原样生效 |
| `__SIP_NAVIGATE` | 旧代码跨页下钻 → Vue Router（context 变 URL query） |
| `__SIP_OPEN_ALERT_DETAIL` | 旧视图（metrics-analysis）打开 Vue 的告警详情模态 |
| `__SIP_SET_DOMAIN_HEADER` | 空壳域改写 service-ops 概览页标题（那两个节点归 legacy 所有） |
| `__SIP_DEFER_LEGACY_INIT` / `__SIP_LEGACY_INIT` | 延迟自启动：等 Vue 注入完 legacy DOM 再调 `init()` |

独立打开旧 `index.html` 时这些全不生效，行为与改造前一致。

### 迁移一个新视图的步骤

1. `src/views/<name>/` 建 `XxxView.vue` + `useXxx.js`（状态就近放，**不用 Pinia**）
2. `src/router/nav.js` 的 `MIGRATED` 加入该 slug
3. `src/router/index.js` 的 `VIEW_COMPONENTS` 加入懒加载（**两处必须同时改**，
   否则会出现「组件渲染了但 legacy 面板没隐藏」的双显）
4. `js/app.js` 的 `init()` 里跳过对应的 `initXxx()`（嵌入模式下）
5. 从 `src/legacy/legacy-panels.html` 删掉该面板

## 跨域

**`src/` 下永不出现 `http://localhost:*`，只出现 `/` 开头的相对路径。**

- 开发：`vite.config.js` 的 `server.proxy`（`/api/sip-aiops`→`:8080`；`/agentflow`→`:8000`，
  后者需 `rewrite` 剥前缀，因 agentflow 路由挂根路径；`/api/cmdb`→`:8300`，
  同样 `rewrite` 成 `/admin/cmdb`）。浏览器视角同源，**无 CORS 无预检**。
- 生产：dist 静态托管 + 同源 nginx 反代（片段见 README）。

`src/api/config.js` 的 base 三级回退：**localStorage > `VITE_*` > 相对路径默认**。
dev 下可用 `__sipApi.setBase('sipAiops', 'http://host:8080/api/sip-aiops')` 临时改。

> **未迁移的 15 个视图仍打硬编码绝对 URL**、依赖后端开 CORS —— 这是有意保留的不对称，
> 等它们逐个迁移时自然收敛。**不要**为了它们去改那些 base。

## 样式

`css/styles.css` 全局引入、**不做 scoped、不重写**。组件模板**逐字沿用其中的 class 名**。

- 少写一个 class 就掉样式；新加 class 无处定义
- **样式表也是 id 的消费方**：`styles.css:6081` 有 `#bsZoomFit`。曾因为「反正改用 ref 了」
  删掉 id 而静默丢样式（按钮仍可点，只是变窄）
- 验证方法：用 `grep -o 'class="[^"]*"'` 对旧面板与新组件做 class 差集，期望为空

## 渲染约定

- **已迁移视图禁止拼 HTML 字符串**（旧世界有 100 处 `innerHTML`，是本次要消灭的模式）
- 唯一允许 `v-html` 的地方是 `src/legacy/`（注入静态面板快照，自有内容非用户数据）
- 告警详情模态 `renderAnalysis.js` 保留拼串 —— 那块内容是一次生成、之后不变的静态 DOM，
  Vue 响应式买不到东西；但**其产物经 `v-html` 注入，`escapeHtml` 一处都不能省**，
  且**不能用 `onclick`**（v-html 注入的 HTML 不会被 Vue 编译），一律用 `data-action` + 委托

## 图渲染（`src/components/graph/`）

workflow DAG 由 `GraphCanvas.vue` + `useGraphCanvas.js`（命令式引擎）画，
**Run Detail 与 Bug Solve 共用**。几条改之前必须知道的不变量：

- **`<svg>` 里必须是空的**，一个 Vue 插值子节点都不能有——图内容由引擎
  `innerHTML` 整段重写，Vue 的 patch 会与它互相覆盖。（`GraphCanvas.vue` 顶部有说明。）
- **连线一律正交折线**，横向段走**层间空档**（两层之间必然无节点），
  竖向段借「列间通道」。判"某竖线是否畅通"必须按**真实 x 区间重叠**算
  （`vFree`）——**不能按列号**：每层各自居中排列，列号相同在不同层的 x 并不一样，
  按列号判会判出"畅通"的线实际穿过别层节点（实测扫出 6 处遮挡，肉眼看不出来）。
- **同一节点的多条出入边合并为共享主干**（节点上下各只接一条线）。
- **缩放只写 SVG 的 `width`/`height`，不用 CSS `transform`**：transform 不改布局尺寸，
  容器的可滚动区域会算错，"缩小后滚动"就滚偏。
- **fit 有可读下限 `MIN_SCALE`**：装不下时不再缩、改让容器滚动。
  节点字号 11px，缩到 0.4 只剩 4.4px —— **图看着就是一片空白**（实测踩过）。
- **`.bs-canvas` / `.bs-zoom` / `.bs-edge` / `.bs-node` 与 legacy `js/app.js` 共用**，
  改样式前先 grep 使用方（legacy 的 Flow Diagram 弹框用的是同一套类名）。
  新行为一律加**专属修饰类**（如 `bs-graph-fit`），别改共用类。
- **悬停提示内容一律 `textContent`**：节点 id / agent 名 / error 文本都是数据，
  拼 HTML 就是注入口子。
- **`nodeTip` 的两个描述是不同维度**：`desc` = agent 的描述（Agents 页同一份，
  `GET /agents`，可被租户覆盖）；`nodeDesc` = 节点在 YAML 里写的自述。

## 项目约定

开发流程、Commit 格式、Changelog 规范等约定参见 `CONTRIBUTING.md`。

## Changelog 强制规则

**每次代码修改（feat/fix/refactor/style）完成后，必须同步生成 changelog 文件，不允许遗漏。**

- changelog 文件放在 `changelogs/` 目录下
- 命名格式：`v{MAJOR}.{MINOR}.{PATCH}-{slug}.md`
- 模板和必须包含的内容见 `CONTRIBUTING.md` 第 48-90 行
- 当前版本号：`v2.0.0`
- 已有的 changelog 文件保留不动，只新增不修改历史文件
