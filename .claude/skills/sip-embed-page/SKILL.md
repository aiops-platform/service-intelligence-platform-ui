---
name: sip-embed-page
description: 把部署站 sip-platform.web.app 的页面接进本仓作为内嵌页（Next.js 离线副本 → NextEmbed → 路由/nginx 分流 → 租户文案），也用于重建、更新、排查已有的内嵌页。当用户要求「复刻/接入/内嵌某个页面」「把 Architecture / FinOps / Security Ops 这类空壳域接上真实页面」「重建或更新内嵌页产物」「内嵌页的文案/数字不跟着租户变」时使用。
---

# 接入一个内嵌页（部署站 → 本仓）

本仓的 4 个域（Constellation / Business Ops / Service Ops / Architecture）不是 Vue 写的，
而是**另一套 Next.js 应用**的离线副本，由 `NextEmbed.vue` 用同源 iframe 嵌进来。
这个 skill 是接第 5 个（或维护前 4 个）的完整流程。

## 0. 先判断：内嵌，还是 Vue 重写

| 判据 | 结论 |
|---|---|
| 该 URL 打开的是 Next 应用（HTML 里有 `/_next/static/chunks/…`） | 内嵌 |
| 页面核心靠**运行时算出来的**视觉：three.js / cytoscape / 力导向 / canvas | **只能内嵌** |
| 一页里塞了整块交互（inspector、可排序表、筛选联动） | 内嵌 |
| 只是个静态表格，数据来自本仓 API | 走 Vue 迁移（见 CLAUDE.md「迁移一个新视图的步骤」） |

> Constellation 试过用 Vue 重写那张力导向图，**做出来不像**，记录在
> `changelogs/v2.0.0-constellation-embed.md`。别重复这条路。

## 1. 侦察

```bash
# 该域在 NAV 里叫什么、有没有侧边栏（sidebar: null = 空壳域，走 DOMAIN_COMPONENTS）
grep -n "key: 'architecture'" -A6 src/router/nav.js

# 内层面板表里这一页的条目 —— route 必须与产出路径**逐字相同**
grep -o 'route:"/architecture"[^}]*' public/_next/static/chunks/0wuztp2.9oz~8.js
#   → route:"/architecture",subtitle:"6R classification · modernization queues",pool:"VP4"

# 线上这一页引用了哪些 chunk（哪些是它独有的）
python3 tools/make-offline-page.py --page <name> --refresh    # 会打印「独有 chunk」
```

⚠️ **不要拿 Chrome「网页，完整」保存的 html 当入口**。那是 DOM 快照，React 不会启动
（工具文件头有实测：`bodyFiberKeys` 0 vs 2）—— 表现为「整页看着都对、就是点不动」。
它只能当 `_files/` 的资源来源。外壳必须用服务器原始 HTML。

## 2. 加 PAGES 条目：`tools/make-offline-page.py`

```python
    "<name>": {
        "site_path": "/<name>/",
        # ⚠️ 目录索引：内层用 usePathname() 查面板表决定 h1，路径对不上时
        #    代码写的是 d?.label ?? "SIP" —— 不报错，只是 h1 静默变成 "SIP"
        "out": ("<name>", "index.html"),
        "vendor_sub": "<name>",
        "shared_chunks": True,
    },
```

## 3. 拉外壳（**唯一会联网的一步**）

```bash
python3 tools/make-offline-page.py --page <name> --refresh
```

产出 `tools/vendor/<name>/server.html` + 独有的 chunk（都入库）。
之后重建都不碰网络。末尾的「产出校验」会列缺失资源 —— **必须 0 缺失**。

## 4. 扫写死的文案，补 `tools/tenant_copy.py`

这一页是另一套应用，它有自己的**写死数字**（`893 apps · 22 portfolios` 之类），
不跟着租户变。页面其余部分读 snapshot、本来就按租户算 —— 于是切租户时
「标题说 893 apps、正下方 KPI 说 50 apps」。

```bash
python3 .claude/skills/sip-embed-page/scripts/check-embed-wiring.py <name>   # 「疑似」那几条就是
```

两处要改（`LEGACY` 加原文，`tenant_pairs()` 加替换值）：

```python
# LEGACY：原文必须是**渲染后的 DOM 文本**（不是 JS 源码里的转义形式）
"<页>_desc": "893 apps · 22 portfolios · 6 journeys · …",
# tenant_pairs()：三个数缺一不可 —— 只换一部分会拼出自相矛盾的句子
if apps and pf and pj:
    pairs.append((LEGACY["<页>_desc"], f"{apps} apps · {pf} portfolios · {pj} journeys · …"))
```

改写器认**文本节点 + `title` / `placeholder` / `aria-label`**，做子串替换，所以
`aria-label` 里的数字也改得到；而 `input` 的 `value` 不在白名单里。

## 5. Vue 接线

```bash
# a. 视图（照抄 BusinessOpsView.vue 的骨架，文件头写清「为什么内嵌 / 路径为什么不能改」）
src/views/<name>/<Name>View.vue          # <NextEmbed src="/<name>/" title="…" label="正在载入 …" />

# b. 路由登记 —— 空壳域走 DOMAIN_COMPONENTS，有侧边栏的域走 STANDALONE_PAGES
src/router/index.js

# c. 与 Vue 路由**同名**时才要（architecture / service-ops 属此类，constellation / business-ops 不同名）
vite.config.js      → EMBED_PAGES 加 '/<name>'（插件只拦**带尾斜杠**的请求）
README.md           → nginx 补 location = /<name> { try_files /index.html =404; }
```

c 的三处为什么必须成对：`/architecture` 是 Vue 路由、`/architecture/` 是内嵌页，
少了 nginx 那条，通用 `try_files $uri $uri/ /index.html` 会把 `/architecture` 经 `$uri/`
解成目录索引，**硬刷新返回裸的内嵌页**（没有 AppHeader / 侧边栏，Vue 应用根本没启动）。

## 6. 重建**全部**页面

`public/_next/` 与 `__SIPCOPY__` 是四页**共用**的。只重建新那页，另外几页的租户表就停在旧状态。

```bash
for p in constellation business-ops service-ops <name>; do
  python3 tools/make-offline-page.py --page $p | grep -E '✓ 输出|✗'
done
```

## 7. 自检 + 人眼确认

```bash
python3 .claude/skills/sip-embed-page/scripts/check-embed-wiring.py      # 有 ✗ 就非零退出

git status --short && git diff --stat public/     # ★ 必看：重建有没有冲掉别的东西

npm run dev
#   http://localhost:5173/<route>      → 该域显示内嵌页、页脚 PANEL n/8 · 域名
#   http://localhost:5173/<name>/      → 裸的内嵌页（内层 h1 应是域名，不是 "SIP"）
#   硬刷新 /<route>                     → 仍是 SPA（有导航）
```

截图（headless）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --window-size=1680,1050 --virtual-time-budget=22000 \
  --screenshot=/tmp/x.png "http://localhost:5173/<route>"
```

⚠️ **WebGL 页（three.js）在 headless 下会渲染成 Next 自己的错误页**
（`<html id="__next_error__">`，"This page couldn't load"）—— 看着像被改坏了，其实只是没 GPU。
加 `--enable-unsafe-swiftshader` 即正常。**别据此判断改动有问题**，先拿 `git stash` 或
HEAD 版对照一次。

## 8. 文档 + changelog

按 `CONTRIBUTING.md` 写 `changelogs/vX.Y.Z-<slug>.md`（新功能 = MINOR）。
连带要同步的：`CLAUDE.md` 的内嵌页一节（域的数量）、`src/components/NextEmbed.vue` 文件头的
资源清单、`README.md` 的 nginx 片段。

## 坑位速查

| 坑 | 症状（都**不报错**） | 处置 |
|---|---|---|
| 产出路径 ≠ 面板表 `route` | 内层 h1 变成 `SIP` | 目录索引必须 `public/<name>/index.html` |
| 漏 `EMBED_PAGES` / nginx | 硬刷新拿到裸内嵌页 | 只拦带尾斜杠；生产补 nginx |
| 漏 `DOMAIN_COMPONENTS` | 那个域还是空壳（落到 service-ops 概览） | 登记一次即可（空壳域不走 MIGRATED） |
| 只重建了一页 | 另外几页的租户表缺租户 | `public/_next/` 是共用的，全量重建 |
| 写死数字没进 `LEGACY` | 标题与 KPI 各说各话 | 见第 4 步 |
| 改写器兜底租户 ≠ `DT_DEFAULT` | 没设租户时数据走 otr、文案走 retail | 两处同取 `DT_DEFAULT`（已修，别写死字面量） |
| 手改 `public/` | 下次重建**静默回退** | 一律做成 `tenant_copy.py` 的声明式补丁 |

## 相关文件（不确定时读这几处）

- `tools/make-offline-page.py` 文件头 —— 为什么必须起 HTTP、为什么保存的 HTML 不能用、路径为什么不能改
- `src/components/NextEmbed.vue` 文件头 —— 高度链、两条菜单栏怎么剥、加载检测为什么有三层
- `src/views/<name>/<Name>View.vue` —— 每个域自己的理由（尤其 `ArchitectureView.vue` / `ServiceOpsView.vue` 把同名冲突写全了）
- `CLAUDE.md`「内嵌页」一节 —— 必须遵守的不变量
