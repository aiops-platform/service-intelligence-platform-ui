# service-intelligence-platform-ui

Service Intelligence Platform (SIP) 前端。

> **v2.0.0 起本仓是「双世界」结构**：外壳与 2 个视图已迁 Vue（`src/`），
> 其余 15 个视图仍由 `js/app.js` 驱动。改动前请先看 `CLAUDE.md`。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
```

开发时前端在 `:5173`，后端经 Vite proxy 转发（见 `vite.config.js`）：

| 前端请求 | 转发到 | 说明 |
|---|---|---|
| `/api/sip-aiops/*` | `http://localhost:8080` | 同名前缀直通，不 rewrite |
| `/agentflow/*` | `http://localhost:8000` | agentflow 路由挂在根路径，需剥掉 `/agentflow` 前缀 |
| `/api/cmdb/*` | `http://localhost:8300` | CMDB 管理端点；后端真实路径是 `/admin/cmdb`，需 rewrite |

浏览器视角**同源**，因此没有 CORS、没有预检。若后端在别处，用环境变量覆盖
（见 `.env.example`），或 dev 下临时改：

```js
__sipApi.setBase('sipAiops', 'http://other-host:8080/api/sip-aiops')
```

**后端没起也能看界面**：未迁移的视图会静默失败、两个已迁移视图显示空列表，
外壳与导航完全可用。

## 构建与部署

```bash
npm run build      # 产出 dist/
npm run preview    # 本地预览产物，http://localhost:4173
```

`dist/` 是纯静态产物，另含 `dist/js/app.js`（未迁移视图的遗留脚本，由
`vite.config.js` 的 `sip-legacy-build-copy` 插件复制）。

### 生产：同源反向代理

**这是跨域方案的核心** —— 前端与 API 同源部署，浏览器视角没有跨域这回事：

```nginx
server {
    listen 80;
    root /var/www/sip;                       # dist/ 的内容

    # ⚠️ 必须放在 location / 之前（nginx 的 `=` 精确匹配优先级最高，位置其实不影响，
    #    但写在这里更醒目）。
    #
    # 内嵌页产物里有 dist/service-ops/index.html，于是通用规则会把 /service-ops
    # 经 `$uri/` 解成那个目录索引，**吐出裸的内嵌页**（没有 AppHeader / 侧边栏，
    # Vue 应用根本不启动）。这条把无斜杠路径强制指回 SPA；
    # 带斜杠的 `/service-ops/` 继续走通用规则解析目录索引，正是 iframe 需要的那个。
    # 详见 src/views/service-ops/ServiceOpsView.vue 与 vite.config.js。
    location = /service-ops { try_files /index.html =404; }

    # 同理。Architecture 与 Service Ops 一样**两边同名**（Vue 路由 /architecture、
    # 内嵌页 /architecture/），所以要再来一条。详见 ArchitectureView.vue。
    location = /architecture { try_files /index.html =404; }

    location / {
        try_files $uri $uri/ /index.html;    # history 模式回退，直达 URL 刷新才不 404
    }

    location /api/sip-aiops/ { proxy_pass http://sip-aiops:8080; proxy_set_header Host $host; }
    location /agentflow/     { proxy_pass http://agentflow:8000/; }   # 末尾斜杠 = 剥前缀
    location /api/cmdb/      { proxy_pass http://datasource:8300/admin/cmdb/; }
}
```

> **若部署环境不方便配 nginx**：把 `src/router/index.js` 的 `createWebHistory`
> 换成 `createWebHashHistory`（一行），URL 变成 `/#/log-analysis`，不再需要 `try_files`。

### 可选：运行时改后端地址

`src/api/config.js` 的 base 解析顺序是 **localStorage > `VITE_*` > 相对路径默认**，
localStorage 键沿用改造前的名字（`bugSolveBaseUrl` / `workflowBaseUrl` /
`agentsBaseUrl` / `mcpBaseUrl` / `agentConfigBaseUrl` / `sipAiopsBaseUrl`）。
用相对路径时不需要设任何东西。

## 不在本次范围

- **APM（`:7070`）与 KB** 相关视图未迁移（`page-problems` / `page-monitor-targets` /
  `page-domain-config` / `page-reflow-log` / `page-knowledge-search`）
- `engineering-ops-standalone.html`（260KB，早期导入的单文件导出产物）不参与构建，
  **不会被发进 `dist/`**；直接双击打开即可

## Monitor Targets — Manual Run（暂移除）

Observability › APM › Monitor Targets 页面曾提供 **Manual Run**（手动触发一轮检测，`POST /v1/monitors/{id}/run`），因当前阶段暂不需要，已从模态框中移除（含列表行 Run 按钮）。

后续如菜单/流程需要，可重新加回：`index.html` 的 `apm-form-actions` 增加 `Manual Run` 按钮，`js/app.js` 恢复 `manualRun()`、列表行 `data-act="run"`、`onListAction` 的 run 分支与事件绑定即可，后端接口未变。

> 注：上述"可重新加回"的路径写在 v2.0.0 之前。该页面的 DOM 与脚本现在位于
> `src/legacy/legacy-panels.html` 与 `js/app.js`，恢复方式不变。

## Ticket Workspace — Approval Center / L1 Automation（已隐藏）

Service Ops 域侧边栏 `Ticket Workspace` 分组下的 **Approval Center** 与 **L1 Automation**
两个入口已按要求隐藏（2026-09-17），该分组现只剩 `Ticket Inbox` 一项。

做法与上面 Business Ops 那次摘侧边栏同理 —— **只摘导航，不删页面**：
`src/router/nav.js` 的 `ticket-workspace-svc` 分组里去掉两个叶子。侧边栏由 `NAV` 直接渲染，
所以菜单立刻少两项；而 `flattenItems()` 是路由表的唯一来源（`src/router/index.js:161`），
叶子没了路由也就没了，因此直接输 `/approval-center` / `/l1-automation` 会落进
catch-all 重定向回 `/service-ops` —— 这是有意的，留着可直达的 URL 等于没隐藏。

**一个字节都没动的东西**（恢复时不用碰）：

| 位置 | 内容 |
|---|---|
| `src/legacy/legacy-panels.html` | `#page-l1-automation`（:626）、`#page-approval-center`（:700）两个面板 |
| `js/app.js` | `initNavigation` 里 `l1-automation` / `approval-center` 两个分支（:142-145、:644-645） |
| `src/router/nav.js` | `PANEL_ID` 的两条映射（:25-26） |

**恢复方式**：把这两行放回 `nav.js` 的 `ticket-workspace-svc.items` 即可：

```js
{ slug: 'approval-center', label: 'Approval Center' },
{ slug: 'l1-automation', label: 'L1 Automation' },
```

> 注：`js/app.js` 那两个分支只在**独立打开旧 `index.html`** 时才会走到 ——
> 嵌入模式下 `initNavigation` 整个被跳过（见 CLAUDE.md「接缝」一节），导航完全由
> Vue 侧边栏接管。所以留着它们不影响本次隐藏，删掉反而会弄坏旧单页入口。

## Value Pool 域（已隐藏）

顶栏第 9 个域 **Value Pool** 已按要求隐藏（2026-09-17），顶栏从 9 个域变 **8 个**。

它与上面那次**不同**：上次只是 Service Ops 里摘两个侧边栏叶子、域还在；这次是
**整个域都不在了**。做法还是同一条 —— 从 `src/router/nav.js` 的 `NAV` 摘掉那一项，
其余全是自动的：

| 连带效果 | 机制 |
|---|---|
| 顶栏少一项 | `AppHeader.vue:96` 直接渲染 `NAV` |
| `/value-pool` 路由消失 | `EMPTY_DOMAINS = NAV.filter(n => !n.sidebar)` → 空壳域 6 → 5，`emptyDomainRoutes` 由它派生 |
| 输 `/value-pool` 落回 `/service-ops` | catch-all `/:pathMatch(.*)*` |

**footer 的 PANEL 编号同步从 `x/9` 改成了 `x/8`**（8 处 `panel` 字符串 + `AppFooter.vue`
的 prop 默认值）。分母是**域的总数**，域少了一个分母就得跟着改，否则 footer 会出现
「8/9」这种顶栏没有第 9 项的对不上。这是纯展示文案，没有逻辑消费方
（`data-panel` 属性只在独立打开旧 `index.html` 时被 `initNavigation` 读）。

**恢复方式**：把下面这段放回 `NAV` 末尾，并把 8 处 `panel` 改回 `x/9`：

```js
{
  key: 'value-pool',
  label: 'Value Pool',
  dot: '#10b981',
  panel: '9/9 · VALUE POOL',
  title: 'Value realization · ROI tracking',
  sidebar: null,
},
```

> ⚠️ `js/app.js` 里还有**一份独立的**空壳域名单（`initNavigation` 的 else 分支），
> 只服务独立打开旧 `index.html` 的场景。它**不会**跟着 `NAV` 自动同步 ——
> 那边仍然认 Value Pool（旧单页入口里它还在，这是对的，不用改）。
>
> 另注：**没有**为此新增 `hidden` 标志位。加标志位等于给「可见性」引入第三套语义
> （`NAV` 的成员资格 + `EMPTY_DOMAINS` 的派生 + 渲染时的过滤），而「从 `NAV` 摘掉」
> 本身已经同时表达了全部三者。

## APM — Metrics Analysis / Log Analysis（已隐藏）

> 分组名原为 `Observability`，2026-09-21 改名为 `APM`（同时摘掉二级 APM 分组、
> 把 Problem Center / Monitor Targets / Domain Rules 收进 `Smart Inspection` 下一级）。
> 见 `changelogs/v2.2.18-service-ops-nav-apm-regroup.md`。
>
> 同一天稍后 **Problem Center 这个菜单项改名为 `Diagnosis Center`**（URL 仍是 `/problems`，
> 实体名仍是 problem）—— 见 `changelogs/v2.2.19-…md`。本节正文里出现的 `Diagnosis Center`
> 与那次改版前的 `Problem Center` 是同一页。
>
> 本节其余结论都不受这两次改动影响。

**Metrics Analysis** 与 **Log Analysis** 两个入口已按要求隐藏（2026-09-18）。
按改版后的结构，它们若恢复，会成为 `APM` 分组下的两个叶子，与 `Smart Inspection` 子分组平级。

做法还是**只摘导航，不删页面** —— `src/router/nav.js` 的 `apm` 分组里去掉两个叶子。
侧边栏由 `NAV` 直接渲染所以菜单立刻少两项；`flattenItems()` 是路由表的唯一来源，
叶子没了路由也就没了，直接输 `/metrics-analysis` / `/log-analysis` 会落进 catch-all 回到
`/service-ops`（同上面两次）。

**一个字节都没动的东西**（恢复时不用碰）：

| 位置 | 内容 |
|---|---|
| `src/legacy/legacy-panels.html` | `#page-metrics-analysis`（:885） |
| `js/app.js` | `initMetricsAnalysis()`、两个 `_pageRefreshers`（:3475、:3664）、`initNavigation` 的两个分支（:153-156） |
| `src/router/nav.js` | `MIGRATED` 的 `log-analysis`（:9）、`PANEL_ID` 两条映射（:28-29） |
| `src/router/index.js` | `VIEW_COMPONENTS` 的 `log-analysis`（:19） |

> 两者性质不同：`metrics-analysis` 是 **legacy 面板**（DOM + `js/app.js`），
> `log-analysis` 是**已迁到 Vue 的视图**。`MIGRATED` / `VIEW_COMPONENTS` 那两条现在
> 暂时没有消费方，但**刻意保留** —— 它们是「已迁移」的唯一登记口，且两处必须成对。

**恢复方式**：在 `nav.js` 的 `apm` 分组上**新增** `items`（该分组改版后只剩 `groups`，
没有 `items` 键了 —— 见 `changelogs/v2.2.18-…md`）：

```js
items: [
  { slug: 'metrics-analysis', label: 'Metrics Analysis' },
  { slug: 'log-analysis', label: 'Log Analysis' },
],
```

> ⚠️ **与上两次隐藏的一处实质区别**：Metrics Analysis **不是只有菜单能到**。
> Smart Inspection 表格里的 **Alert Count 徽标**点下去会 `navigateToPage('metrics-analysis')`
> （`js/app.js:2124`），经接缝 S3 变成 `router.push('/metrics-analysis')` —— 隐藏后这条 URL
> 不存在了，于是那个徽标会**静默落进 catch-all 弹回 `/service-ops`**。这是「隐藏即可直达」
> 语义的应有效果，但落点在**一个还看得见的页面**上，所以特别记一笔，免得日后当 bug 排查。
>
> （另一列的 Log Anomalies 徽标不受影响：该列数据源已下线、恒为 `-`，渲染出的 class 是
> `null-alert`，`js/app.js:2113` 选的是 `.si-alert-badge.has-alerts`，本来就选不中。）
>
> **↑ 这一条已于 2026-09-18 失效**：上面那两个徽标现在都下钻到 Diagnosis Center，
> 详见下一节。

## Smart Inspection 的两个问题数列（2026-09-18 改）

`Alerts` 与 `Log Anomalies` 两列不再读 agentflow 的 `alertCount`（线上三个服务全是 `null`，
所以两列此前实际都显示 `-`），改为从 **Diagnosis Center 的数据源**实时汇总：

| 列 | 含义 |
|---|---|
| `Alerts` | 该服务**指标类问题**的未解决数 |
| `Log Anomalies` | 该服务**日志类问题**的未解决数 |

两列都**排除已解决**。点任一徽标（含 `0`）跳到 Diagnosis Center，并带上三个 query：

```
/problems?service=<服务名>&type=<metric|log>&state=open
```

**核心不变式：徽标上的数字 == 点进去后 Diagnosis Center 的行数**（`#pcRowCount`）。
为守住它，两侧共用 `js/app.js` 顶层的同一组谓词（`problemIsOpen` / `problemHasMetric` /
`problemHasLog` / `problemMatchesService` / `problemMatchesType` / `fetchProblemRecords`），
而不是各写一份 —— 各写一份今天能对上纯属巧合，后端一改就静默漂移。

几个容易踩的点：

- **「未解决」是白名单** `state ∈ {pending, in_progress}`，与 Diagnosis Center 自己的 "Open"
  chip 逐字相同。刻意不写「排除 resolved/closed/archived」的黑名单：后端将来加状态时，
  白名单让两侧*一样地*不计入，黑名单会一边算一边不算。
- **类型按证据存在与否判断**（`metric_anomalies` / `log_anomalies` 谁非空），**不要**改用后端的
  `detection_type` 等值判断 —— 它是 `log/metric/combined/unknown`，`combined` 记录在等值判断下
  两种筛选都匹配不上；按证据判断则两列各计一次。
- **`service` 可能是逗号拼接的多服务串**，两侧都按**成员**匹配。这类记录会在它点名的
  每个服务的徽标里各计一次（Σ 徽标 > 问题总数），下钻到任一服务也都能看到它。
- 问题数据来自 **APM `:7070`**（绝对 URL + 后端 CORS），与 Smart Inspection 自己的服务列表
  （agentflow `/agentflow`，相对路径）是**两个后端**；`fetchProblemTally` 有**独立的失败路径**，
  绝不碰 `siErrorBar` —— APM 挂了不该让整页看起来坏掉，那种情况两列维持上次的值。
- 问题计数走**独立的 15s 定时器**（`/v1/problems?limit=500` 响应很肥，不挤进 5s 的服务轮询）。
- 记录数超 500 时两侧读的是同一份截断列表，因此**一样地**少算，不变式仍成立。

Diagnosis Center 侧相应新增了一组 `All Types / Metric / Log` chip，以及
`applyQueryFilters()` 消费上述 query（读 `location.search`，因为 `router.afterEach` 只把
`meta.panelId` 递给 `__SIP_SHOW_PAGE`，query 到不了 legacy 面板）。
