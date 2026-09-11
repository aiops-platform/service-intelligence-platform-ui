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

    location / {
        try_files $uri $uri/ /index.html;    # history 模式回退，直达 URL 刷新才不 404
    }

    location /api/sip-aiops/ { proxy_pass http://sip-aiops:8080; proxy_set_header Host $host; }
    location /agentflow/     { proxy_pass http://agentflow:8000/; }   # 末尾斜杠 = 剥前缀
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
