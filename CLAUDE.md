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

> 三个命令都经 `scripts/vite-with-base.mjs` **自动探测部署形态**（本机 `/`、共享机器 `/sip/`），
> 不需要传任何参数；启动时会打印判定依据。详见「部署形态：本机 / 子路径」。

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
（那三个「相对路径默认」由部署 `base` 派生 —— 见「部署形态」，本机拼出 `/agentflow`。）

> **未迁移的 15 个视图**（`js/app.js`）不走上面这套：它不过打包器、读不到 `import.meta.env`，
> 改用**运行时判定**的三个常量 `SIP_AGENTFLOW` / `SIP_AIOPS` / `SIP_APM`。
> 本机形态下它们解析成绝对 `http://localhost:<port>`（与改造前逐字一致），
> 远端形态下改走同源前缀。详见「部署形态」。

## 部署形态：本机 / 子路径

同一份源码要能落在两种位置，**靠自动探测的 `base` 切换，不靠人记参数**。

|  | 本机部署 | 子路径部署（如共享机器上的 `/sip/`） |
|---|---|---|
| 挂载点 | `/` | `/sip/` |
| 资源引用 | `/assets/…` | `/sip/assets/…` |
| 后端地址 | 绝对 `http://localhost:<port>` 直连 | 同源前缀 `/sip/agentflow` 等，经 proxy / nginx |
| base 由谁定 | `scripts/vite-with-base.mjs` 探测 | 同左 |

`dev` / `build` / `preview` 都经那个包装器，**零参数**。判定顺序（先命中先用）：

1. 环境变量 `VITE_BASE` —— 显式覆盖（CI、临时换挂载点）
2. 本机 nginx 里存在「**指向本应用 preview 端口(4173)** 的 `/sip/` 反代」→ `/sip/`
3. 否则 `/`

第 2 步刻意要求**两个条件同时成立**（前缀 + 指向本应用）：光看 `/sip/` 前缀会把**别人的站点**
认成自己 —— 那台共享机器上还有十几个别人的 location。启动时先看这一行，再怀疑别处：

```
[sip] base=/sip/  （/opt/homebrew/etc/nginx/nginx.conf 里有指向本应用(:4173)的 /sip/ 反代）
```

### 为什么 base 在构建期定、后端地址却在运行期定

**base 必须构建期定**：它被焊进 `dist/index.html` 的资源引用 —— `base='/'` 的产物放到 `/sip/` 下，
assets 会全部 404。

**后端地址反过来只能运行期定**：判据是「浏览器与后端同不同机」，而这**只有浏览器自己知道**。
`js/app.js` 用 `location.hostname` 判（`src/api/config.js` 那侧不需要 —— 它的默认值本就是相对路径，
由 base 派生就够了）：

```js
var SIP_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
var SIP_AGENTFLOW = SIP_LOCAL ? 'http://localhost:8000' : SIP_PREFIX + '/agentflow';
```

所以 **`js/app.js` 在两种形态下逐字节相同**（实测 md5 一致）—— 它是唯一与 base 无关的产物。
`base` 传进它得靠 `src/legacy/bridge.js` 注入的 `window.__SIP_BASE__`（同一个 IIFE 读不到
`import.meta.env`，与 `__SIP_DEFER_LEGACY_INIT` 是同一套接缝）。

### 三处容易踩的地方

- **别用 `.env` 配 base**：Vite 在**任何 mode 下都加载 `.env`**，而 `src/api/config.js` 的优先级是
  `localStorage > VITE_* > 相对默认` —— 一个残留的 `.env` 会**静默盖掉**默认值。所以仓库里
  没有 `.env`（只有 `.env.example`）。
- **`import.meta.env.BASE_URL` 末尾带斜杠**（`'/'` 或 `'/sip/'`）。拼路径前先
  `replace(/\/+$/, '')`，否则 `BASE_URL + '/x/'` 得到 `//x/` —— 浏览器按**协议相对 URL** 解析，
  会把 `x` 当主机名。
- **视图里的 `'/architecture/'` 字面量不能省**：`check-embed-wiring.py` 按它反查「哪个视图渲染了
  哪个内嵌页」。写成 `` `${base}/architecture/` `` 会让该视图被判成「没有任何视图渲染它」——
  **校验脚本会红**。要写成 `base + '/architecture/'` 保住这个字面量。

> 子路径部署时，七个内嵌页里 turbopack 硬编码的 `/_next/…` 需要 nginx 额外一条
> `location ^~ /_next/ { proxy_pass http://127.0.0.1:4173/sip/_next/; }` —— 因为 `base='/sip/'`
> 破坏了「`public/` 按根伺服」这个前提（见 `NextEmbed.vue` 的说明）。**本机部署不需要它。**


## 样式

`css/styles.css` 全局引入、**不做 scoped、不重写**。组件模板**逐字沿用其中的 class 名**。

- 少写一个 class 就掉样式；新加 class 无处定义
- **给既有类做局部覆盖（元素挂两个类）必须用复合选择器**（`.dgx-btn.dgx-flowbtn`）。
  本表是"到处追加"的长文件，两个单类**权重相同 → 后写的赢**：新类写在前面时会被
  后面定义的旧类整条盖掉，且不报错（实测 `.dgx-flowbtn` 的 padding 被 `.dgx-btn` 覆盖，
  按钮仍是原尺寸、把吸顶条撑高 8px —— 肉眼看不出是"没生效"，只像"没调够"）
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

## Run / 工单的状态（`src/utils/runStatus.js`）

后端的 run 判定是**两层**的，前端必须都用上：

- `status` —— **有没有节点失败**。它**不等于「有结论」**：
  中断的 run 没有节点失败（halt 节点自己 DONE、其余 SKIPPED），
  审批超时的 run 也没有（超时节点是 `rejected-canceled`，终态非失败，下游照常收敛）
  —— 两种都是 `success`。
- `outcome` —— **为什么没给出结论**，三档：
  - `completed` 按图走完
  - `halted` 中途证据不足，`halted_at` 指停在哪个 halt 节点
  - `rejected` 审批被否决，`rejected_at` 指哪个门 + `reject_reason`
    （`timeout` 超时自动拒绝 / `manual` 人工驳回）
- **误把任一档当成 `success` 都会说反话**：halted 被算成"顺利跑完"，
  rejected 被算成"事故已解决"。实测：某租户 11 条 Resolved 里 **9 条其实是被否决的**。

- **判据与配色只写一份**（`runStatusOf` / `nodeStatusOf` / `NODE_STATUS_CLASS`）。
  图画布、节点表、详情徽章三处各写一遍，就会出现「图是绿的、表写 done、徽章说中断」。
- **`displayStatus` 与 `status` 必须分开**：`TERMINAL` 里没有 `halted`/`rejected`，
  拿展示值去判终态，轮询永远停不下来（终态 run 被 2 秒一轮地反复拉）。
- **节点状态表要把后端在用的取值**都放进去（含 `rejected-canceled`）。
  漏一条不是"少个颜色"而是**说反话**：它会落到兜底 `bs-node-status-pending`，
  于是一个被超时否决的审批节点在图上渲染成灰色"还没跑"。
- **工单的展示状态由 run 派生**（`useTickets.ticketDisplayStatus`）。
  `ticket.status` 只在"没发起过 run"时才有意义 —— 后端只在发起时写一次
  `running`，之后**没有任何代码回写**（`TICKET_RESOLVED`/`TICKET_FAILED` 定义了但从未被写入）。
- 后端 `GET /tickets` 为此返回 `latest_run`；`GET /runs` 也带 `outcome`。

## 内嵌页（`public/` 下的 Next.js 离线副本）

Constellation / Business Ops / Service Ops / Architecture / Security Ops / FinOps /
Engineering Ops 七个域都是**另一套 Next.js 应用**的离线副本，由 `NextEmbed.vue` 用同源
iframe 嵌进来。

> **这七个就是全部** —— `NAV` 里 6 个 `sidebar: null` 的域至此**全部**有了自己的页面，
> 没有域再走到「空壳兜底」（落 service-ops 概览 + 改写标题）。
> 其中 `eng-ops` 原本**有**侧边栏（Knowledge Studio），2026-09-21 按要求摘掉后接入，
> 见 nav.js 里那段注释（含恢复方法）。

几条改之前必须知道的：

- **产物由 `tools/make-offline-page.py` 生成，绝不手改 `public/`。**
  构建每次都从 `tools/vendor/` 重新铺 `public/_next/`，手改没有任何工具会写回去 ——
  **下次重建静默回退**。要对产物做的每一处改写，都得是同目录下
  `tenant_copy.py` 里的一个**声明式补丁**（有意为之的手改已经栽过一次：默认租户）。
  **提交前先看 `git status` / diff**，别看构建输出「一切正常」。
- **内层页面里指向本仓没有导出的路由的链接，会让宿主套进自己**。
  典型是 Service Ops 行尾的 `›` → `/entity/app/<slug>/`：该路径落进宿主 SPA 兜底，
  vue-router 的 catch-all 再重定向回 `/service-ops`，于是在 Service Ops 里渲染出
  Service Ops，点一次多一层。当前两道防线：
  ① 构建期拆链接（`patch_service_ops_entity_links`）；
  ② 运行期 `NextEmbed.vue` 的 `inSameOriginFrame()` —— **同源祖先**时不渲染 iframe
  （跨源不算，那是正常的第三方嵌入）。
- **路径不能随便改**：内层用 `usePathname()` 查面板表决定 h1，对不上时**静默**变成
  `"SIP"`（不报错、不白屏）。详见各视图与 `vite.config.js` 的 `sipEmbedPageIndex`。
- **与 Vue 路由同名的内嵌页要三处成对**（现有 service-ops / architecture / security-ops /
  finops 四例）：
  `vite.config.js` 的 `EMBED_PAGES` 只拦**带尾斜杠**的请求、生产 nginx 各补一条
  `location = /<页> { try_files /index.html =404; }`、组件在 `router/index.js` 的
  `DOMAIN_COMPONENTS` 登记。少一处就表现为「刷新后拿到裸的内嵌页，没有导航」。
  ⚠️ **不同名的也一样要进 `EMBED_PAGES`**（business-ops / engineering-ops）：那个列表的
  另一半职责是给 dev/preview 补「Vite 不解析 `public/` 目录索引」。少了它，`/x/` 落进
  SPA 兜底、iframe 里渲染出 Vue 应用自己 —— 与同名冲突是两件事。
- **内层自己的 `router.push` 要改道给外壳**（`useEmbedBridge.js` 的 postMessage 桥）。
  那是另一套 Next 应用，push 的是**它的**路由；本仓没导出成内层页的路径会落进 SPA 兜底
  → iframe 里跑起整个 Vue 应用。Engineering Ops 实测中招（点「SDLC Agents Live」→
  `/agents?group=sl`），而且**这一例连 `NextEmbed` 的 `inSameOriginFrame()` 都躲过了** ——
  那个闸只在目标路由本身是内嵌页时才生效。见 `patch_engineering_ops_links`。
  ⚠️ **「本仓有这个页面」也不等于安全**：Security Ops 的卡片 push `/engineering-ops/`
  （带尾斜杠、本仓确实导出了），但 **Next 默认 `trailingSlash: false` 会抹掉尾斜杠** ——
  请求变成 `/engineering-ops`，目录索引插件只拦带斜杠的，于是照样落 SPA 兜底、
  被 catch-all 重定向到 `/service-ops`。**必须实测点击**，见 `patch_security_ops_links`。
- **改写器的兜底租户必须与 `patch_default_tenant` 同值**（都是 `DT_DEFAULT`）。
  两处不一致时「没设过租户」会数据走 otr、文案走 retail，同一页两套数字。
- **页面自己写死的租户数据要在 `tenant_copy.py` 里按租户替换，别只改文案**。
  这一页是照着某个租户写的，它写死的可能是**结构化数据**而不只是句子。Security Ops 上
  踩过两种：写死的事故号/子事件数（同屏会和上方按租户算的 KPI 自相矛盾），以及写死的
  `appKey` —— 后者的失败方式是 `snapshot.apps.find(...)` 落空后走 `s && (…)` 短路，
  **整节静默消失**（不报错、不留空态）。判断方法：拿该页的写死值去逐个租户的快照里查一遍。

> 接第 7 个内嵌页（或重建、排查现有的）走 `.claude/skills/sip-embed-page/`：
> 分步流程 + 坑位速查，外加一个把上面这些不变量机械校验一遍的脚本
> （`scripts/check-embed-wiring.py`，有 ✗ 时非零退出）。

## 项目约定

开发流程、Commit 格式、Changelog 规范等约定参见 `CONTRIBUTING.md`。

## Changelog 强制规则

**每次代码修改（feat/fix/refactor/style）完成后，必须同步生成 changelog 文件，不允许遗漏。**

- changelog 文件放在 `changelogs/` 目录下
- 命名格式：`v{MAJOR}.{MINOR}.{PATCH}-{slug}.md`
- 模板和必须包含的内容见 `CONTRIBUTING.md` 第 48-90 行
- 当前版本号：`v2.6.14`
- 已有的 changelog 文件保留不动，只新增不修改历史文件
