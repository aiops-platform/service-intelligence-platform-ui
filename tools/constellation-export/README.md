# SIP · Constellation 数据导出

把 `https://sip-platform.web.app/` 上 **Constellation** 页面的内容抓到本地，离线浏览。

```bash
python3 extract.py                  # 抓全部租户
python3 extract.py --list           # 只看有哪些租户，不写文件
python3 extract.py --tenant retail  # 只要一个

python3 -m http.server 8777         # 起个服务器
# 打开 http://localhost:8777/viewer/
```

只用 Python 标准库，不需要 `pip install`。

---

## 原理：数据本来就在公开的 JS 里

那个站是 Next.js 应用。Constellation 页的内容**不是**从接口取的 —— 整份 estate 快照
（apps / portfolios / journeys / 边 / valuePool …）以对象字面量的形式**打包在客户端 JS
chunk 里**，随页面一起下发。

于是：

- **不需要密码** —— PasswordGate 只挡渲染，chunk 是公开静态资源
- **不需要点界面** —— 数据本来就在，点界面只是把它显示出来
- **不产生写操作** —— 对站点零负担
- **比抓 DOM 完整** —— DOM 只渲染当前视口和当前选中的实体，这里是全量

`extract.py` 从首页 HTML 里现读 chunk 列表（**不硬编码文件名** —— Next.js 的 chunk 名带
内容哈希，站点一重新部署就全变），下载后把 `"snapshot":{…}` 抠出来。

> 抠的时候要跳过字符串字面量做括号配对，否则内容里带 `{`/`}` 的字符串会让配对跑飞。
> 另外 JS 的 `\'` 在 JSON 里是非法转义，要降级成字面量（`relax_escapes`）。

## 产出

`data/` 下每个租户一个 JSON，外加 `_index.json` 索引：

| 租户 | 企业 | apps | portfolios | journeys | teams |
|---|---|---|---|---|---|
| banking | Meridian Capital | 1195 | 10 | 6 | 230 |
| bunnings | Bunnings | 282 | 11 | 6 | 54 |
| consumer-goods | Harborline Brands | 695 | 12 | 6 | 134 |
| data-sicg | Best Buy | 893 | 22 | 6 | 173 |
| healthcare | Northwind Health | 992 | 12 | 6 | 191 |
| insurance | Cascadia Mutual | 912 | 10 | 6 | 175 |
| life-sciences | Argentum Therapeutics | 1800 | 9 | 6 | 346 |
| qantas | Qantas | 340 | 10 | 6 | 65 |
| **retail** ★ | **Acme Retail** | **282** | **9** | **6** | **54** |
| telecom | Helio Communications | 1392 | 9 | 6 | 268 |

★ = 站点当前展示的租户（脚本从 `ACTIVE_TENANT_ID` 的兜底分支里读出来）。

每个 snapshot 的字段：`enterprise` · `journeys` · `portfolios` · `apps` ·
`portfolioEdges`（技术重叠 / 变更级联 / 事件共现三种边） · `topTechnologies` ·
`appTechnologies` · `valuePool` · `scenarios` · `agents` · `topStorm` · `facts` ·
`sparkline90d`。

### 单个应用有哪些字段

```jsonc
{
  "id": "app:pos", "appKey": "pos", "label": "POS",
  "portfolioId": "portfolio:stores", "tier": 1,
  "holidayCritical": true, "financeFreeze": false,
  "operationalStatus": "ok",
  "incidentsTotal": 317, "changeCount": 68, "riskScore": 86,
  "botResolutionRate": 0.6249462128463201,
  "botMttrMin": 49.67496761446819,
  "humanMttrMin": 1824.393275968032      // → 人工比机器人慢 37×
}
```

## 查看器

`viewer/index.html`，单文件、无依赖、全程离线。四个页签：

- **浏览** —— enterprise → journey → portfolio → app 的树 + inspector 式详情。
  portfolio / journey 的聚合指标按页面 inspector 的同一套算法算（下属 app 求和/平均）。
- **应用清单** —— 全部应用一张表，点列头排序，可筛选。
- **关系** —— `portfolioEdges` 三种边，按权重排序带条形图。
- **附录** —— facts、告警风暴、技术分布、价值池、scenario。

起服务器时自动加载并能切租户；直接双击打开（`file://`）时 `fetch` 会被 CORS 挡掉，
走拖拽或文件选择。

---

## 两个数据口径的坑（查看器里都有处理）

### 1. `facts.portfolios` ≠ `portfolios` 列表长度

retail 是 9 vs 10 —— `portfolio:real-estate` 有 **0 个 app**。`facts` 数的是「有应用的
组合」，列表里含空组合。两者都对，只是口径不同。

### 2. `journeyId` 可能是字符串 `"journey:null"`

有些 portfolio 是**企业级支撑组合**（Data/AI、基础设施、安全、财务、战略架构），
本来就不挂在任何客户旅程下。bunnings 有 5 个、qantas 4 个、data-sicg 1 个。

**按 `journeyId` 过滤时它们会一个都不显示** —— 在 bunnings 那是 144 个 app、qantas 115 个。
查看器把它们收进「Enterprise services（未归属 journey）」组。已用覆盖率测试验证：
10 个租户的树里每个 app 恰好出现一次、零重复。

## 文件

```
extract.py           抓取 + 解析（标准库，无依赖）
data/                产出：每租户一个 JSON + _index.json
viewer/index.html    离线查看器（单文件）
```

## 免责

数据取自公开可访问的静态资源，只读、不写、不改。`synthetic:*` 是合成的演示数据。
