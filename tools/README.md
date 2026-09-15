# tools/ — SIP · Constellation 离线副本与数据

把部署站 `https://sip-platform.web.app/` 的 **Constellation** 页面做成
本地可跑、可交互、可改数据的离线副本。

> 部署站**不是本仓库的产物**。它是另一套 Next.js 应用，与本仓的 Vue + legacy IIFE
> 是同一产品的不同世代。这个目录跟 `src/`、`js/app.js`、`css/styles.css` 无关。

---

## 快速开始

**双击 `启动 Constellation.command`** → 浏览器自动打开 <http://localhost:8777/constellation-app.html>

关掉那个终端窗口 = 停止服务。

> **不能双击 html。** 两个独立原因：
> 1. turbopack 运行时把懒加载 chunk 拼成从根算起的 `/_next/…`，`file://` 下会落到
>    **文件系统根**，必然 404
> 2. Chrome 保存的那份 html 是**运行时 DOM 快照**，React 根本不会启动 —— 页面看着
>    正常、console 零报错，但点不动、图是空的
>
> 所以必须是「HTTP 服务 + 正确的服务根目录」，这条在原理上绕不过去。

---

## 改数据 / 加租户

数据是 **一个 JSON 字符串**，包在 bundle 里（`_next/static/chunks/0wuztp2.9oz~8.js`）：

```js
89784,(e,t,o)=>{ t.exports = JSON.parse('{"banking":{…},"retail":{…},…}') }
```

所以改数据不需要碰 JS —— 取出、改 JSON、写回。用 `tenant_data.py`。

### 看有哪些租户

```bash
python3 tenant_data.py list
```

```
租户 id                企业名                        apps  覆盖文件
banking              Meridian Capital Bank      1195
best-buy-reference   Best Buy                    893
bunnings             Bunnings                    282
…
retail               Acme Retail                 282  ✓ retail.json
```

### 改节点数据

```bash
python3 tenant_data.py extract retail     # 导出到 tenant-data/retail.json（220 KB）
# 编辑那个 JSON —— apps[] 里的每一条就是一个节点
python3 tenant_data.py check              # 校验（照着页面里的 zod schema）
python3 make-offline-page.py              # 重建，自动注入
```

改完直接刷新页面即可。

**`snapshot.apps[]` 每条的结构**：

```jsonc
{
  "id": "app:pos",                    // 必须有 app: 前缀
  "appKey": "pos",
  "label": "POS",                     // 图上显示的名字
  "portfolioId": "portfolio:stores",  // 必须对得上 portfolios[] 里的 id
  "tier": 1,                          // 1|2|3
  "holidayCritical": true,            // 图上会给个高亮色
  "financeFreeze": false,
  "operationalStatus": "ok",          // ok | degraded | down
  "incidentsTotal": 317,
  "changeCount": 68,
  "riskScore": 86,
  "botResolutionRate": 0.62,
  "botMttrMin": 49.7,
  "humanMttrMin": 1824.4,
  "position": { "x": 19.4, "y": -479.6, "angle": -1.53 }
}
```

> 加点派生节点不用你操心 —— **team / codebase / wiki / incident-cluster /
> change-cluster 都是页面按规则从 apps 算出来的**，加一个 app 会自动多出对应的几个节点。
> 比如 `incidentsTotal > 100` 就自动生成 incident-cluster，`changeCount > 50` 生成
> change-cluster。

### 加一个租户

把现有租户的 JSON 复制一份，改名另存为 `tenant-data/<新id>.json`，然后改两处：

- `tenant.id` —— 必须是 kebab-case（小写字母开头，只含 `a-z0-9-`），**且和文件名一致**
- `snapshot.source.db` —— 随便一个标识字符串

其余字段照抄即可（这样能保证过 zod 校验）。然后：

```bash
python3 tenant_data.py check        # 会告诉你缺什么
python3 make-offline-page.py        # 构建时会提示「新增租户：xxx」
```

**切换租户不用改代码**，站点自带机制：

```
?tenant=<id>  →  localStorage["sip-active-tenant"]  →  兜底 "retail"
```

所以加完直接开 `http://localhost:8777/constellation-app.html?tenant=myco`。

现成的 10 个租户也可以这么切，比如 <http://localhost:8777/constellation-app.html?tenant=qantas>。

### 加租户必须过的校验

`tenant` 部分被 **zod 硬校验**（`f.parse(t)`），不过就抛异常、整页白屏：

| 字段 | 要求 |
|---|---|
| `id` | kebab-case，`^[a-z][a-z0-9-]*$` |
| `name` / `industry` / `demoTitle` | 非空字符串 |
| `client.displayName` | 非空字符串 |
| `brand.accentHex` / `accentInkHex` | `#RRGGBB` |
| `taxonomy.portfolios[]` | 至少 1 条，每条有 `id`/`name`/`tier`(1~3) |
| `taxonomy.appArchetypes[]` | 至少 1 条，`tier` 是 `"T1"`/`"T2"`/`"T3"` |
| `businessCase.*` | 三个正数 + `splitNarrative` |
| `talkTrack.*` | **9 个都必填**：constellation / serviceOps / engOps / businessOps / architecture / finops / securityOps / agents / valuePool |
| `highlightEntities.*` | stormIncident / anchorApp / anchorChange |
| `labels.*`、`nameFanout.*` | 可选；给了就要齐 |

`python3 tenant_data.py check` 会逐条报缺什么。

> **重建是可逆的。** 覆盖只写进 `public/` 里的副本，源文件不动 ——
> 删掉 `tenant-data/<id>.json` 重建就回到原样。别去改源文件，改一次叠一次，回不去。

---

## 目录

```
tools/
├── 启动 Constellation.command      ★ 双击这个
├── start-offline.sh                起服务（.command 会调它）
├── make-offline-page.py            离线构建（默认不联网）
├── tenant_data.py                  读写 bundle 里的租户数据
├── README.md                       本文件
│
├── vendor/                         构建缓存，128 K —— 别删
│   ├── server.html                   服务器原始外壳（能启动 React 的那份）
│   └── media/*.woff2 × 3             字体
│
├── tenant-data/                    你编辑的覆盖文件（空表示用原始数据）
│
├── SIP … Acme Retail.html          Chrome 保存的 —— **不能当入口**
├── SIP … Acme Retail_files/        同上的 JS/CSS，是好资源（6.4 M）
└── constellation-export/           数据导出 + 独立查看器
    ├── extract.py                    从线上抓全部租户快照
    ├── data/*.json                   产出（已 gitignore）
    └── viewer/index.html             表格化查看器
```

构建产物**不在 tools/ 下**，在仓库的 `public/`：

```
public/
├── constellation-app.html          ← 入口
└── _next/static/{chunks,media}/    ← chunk / css / 字体，6.5 M
```

**这份是入库的**，不是可弃的中间产物 —— 它是「克隆下来 `npm run dev` 就能用」的关键。

为什么放 `public/`：内层的 chunk 路径 `/_next/…` 是 turbopack **硬编码的根绝对路径**，
而 Vite 的 `public/` 正好按根伺服，dev 和 build 都对得上，不需要任何 Vite 插件。

---

## 重新构建

```bash
python3 make-offline-page.py              # 离线，只读 vendor/
python3 make-offline-page.py --refresh    # 站点更新后刷新 vendor/（唯一联网的操作）
```

`--refresh` 会重新抓两样东西：服务器原始 HTML 和 3 个字体。其余资源一直来自本地
`_files/`。

---

## 数据是怎么来的

整份 estate 快照（apps / portfolios / journeys / 边 / valuePool…）**打包在客户端
JS 里**随页面下发，不是从接口取的。所以：

- 不需要密码（PasswordGate 只挡渲染，chunk 是公开静态资源）
- 不需要点界面
- 没有任何写操作

另有一个 `constellation-export/extract.py` 可以直接从线上抓全部 10 个租户存成 JSON，
用于比对或喂给别的分析。

---

## 排查

| 现象 | 原因 |
|---|---|
| 双击 html 白屏 / 点不动 | 见开头 —— 必须用 `.command` 起服务 |
| 图是空的但页面正常 | 大概率是浏览器缓存了旧的 html。硬刷新 **Cmd+Shift+R** |
| 改完数据没生效 | 忘了跑 `make-offline-page.py`；或没硬刷新 |
| 白屏且 console 报 zod 错误 | `tenant-data/` 里的租户没过校验，跑 `tenant_data.py check` |
| 端口 8777 被占 | `start-offline.sh` 会自动换到 8778 |
