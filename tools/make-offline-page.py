#!/usr/bin/env python3
"""
把部署站的页面做成本地可跑、可交互的离线副本。

五个页面，同一套 Next.js 外壳、同一批 chunk，只是入口路由不同：

    --page constellation   部署站 `/`              → public/constellation-app.html
    --page business-ops    部署站 `/business-ops/`  → public/business-ops/index.html
    --page service-ops     部署站 `/service-ops/`   → public/service-ops/index.html
    --page architecture    部署站 `/architecture/`  → public/architecture/index.html
    --page security-ops    部署站 `/security-ops/`  → public/security-ops/index.html

> 除 constellation 外，产出路径都是**目录索引**（`<页>/index.html`）而不是随手起的
> 文件名 —— 内层用 `usePathname()` 查面板表决定 h1，路径必须精确等于面板表里的
> `route`。理由见各自在 PAGES 里的注释。

**默认完全离线** —— 所有需要的东西都在 `vendor/` 和 `*_files/` 里，不碰网络。
只有显式加 `--refresh` 才会去线上更新缓存。

    python3 make-offline-page.py                          # Constellation（默认）
    python3 make-offline-page.py --page business-ops      # Business Ops
    python3 make-offline-page.py --refresh                # 先去线上刷新 vendor/，再构建

然后：

    ./start-offline.sh
    # 或：python3 -m http.server 8777 --directory ../public


## 根因：Chrome「网页，完整」保存的 HTML 启动不了这个应用

这是踩了很久才定位到的，写清楚免得以后重走。

Chrome 保存下来的是**运行时渲染完的 DOM 快照** —— 里面包含 `.scene-container`、
一个 `<canvas>`、以及 three.js / force-graph 运行时注入的 `<style>`。
拿它当页面打开，结果是：

  - 整页**看起来是对的**（那都是静态快照）
  - 但 **React 从未启动** —— 实测 `document.body` 上 0 个 `__reactFiber$` 键
  - 于是「点不动」（没有任何事件处理器）
  - 图永远是空的：three.js 没运行，那个 canvas 是保存下来的死元素，
    尺寸位置都正常，只是从来没被绘制过

对照实验（同样的资源、同样的本地服务器）：

    服务器原始 HTML    → bodyFiberKeys 2，React 正常启动，WebGL 创建成功
    Chrome 保存的 HTML → bodyFiberKeys 0，React 从未启动

所以**必须用服务器原始 HTML 作外壳**（已固化到 `vendor/server.html`），
配上从 `_files/` 搬过来的资源。`_files/` 里的 JS/CSS 是好的（原样下载的静态资源），
坏的只是那份 DOM 快照。


## 为什么必须起 HTTP、不能双击

turbopack 运行时里：

    function N(e){ return `${t}${e.split("/").map(encodeURIComponent).join("/")}${r}` }
    //                            t = "/_next/" ← 硬编码，不随页面位置变

懒加载 chunk 一律被拼成从根算起的 `/_next/static/chunks/…`。
`file://` 下这会落到文件系统根（`file:///_next/…`），必然 404。
只有 HTTP、且服务根目录就是输出目录时才对得上。


## Business Ops 为什么必须服务在 `/business-ops/` 这个路径上

内层页面用 `usePathname()` 查面板表来决定标题（`0wuztp2.9oz~8.js` 的 `panelByRoute`，
`0pfw3-ib1qee0.js` 的 `PanelContainer` 消费它）：

    {id:"business-ops",index:2,label:"Business Ops",route:"/business-ops", …}

路径对不上时 `d` 是 undefined，而代码写的是 `d?.label ?? "SIP"` —— **不报错**，
只是 h1 从「Business Ops」悄悄变成「SIP」。所以产出文件名不能像 Constellation 那样
随便叫 `*-app.html`，必须是 `/business-ops/index.html`（`panelByRoute` 会剥掉尾部斜杠）。

这条路径是被 `panelByRoute` 逼出来的，不是随便起的；前端项目的 Vue 路由另走
**`/biz-ops`**（`NAV` 里 Business Ops 域的 key），两者不同名，所以不打架。

dev/preview 下 Vite **不解析 public/ 的目录索引** —— 实测 `/business-ops/` 会落到 SPA 兜底，
iframe 里就渲染出 Vue 应用自己了。由 `vite.config.js` 的 `sip-embed-page-index` 插件补上。
生产 nginx 用 `try_files $uri $uri/ /index.html` 就够了 —— 目录索引是它的默认行为。


## 目录

    <保存的页面>.html + <保存的页面>_files/   ← Chrome 保存的，提供 JS/CSS（分享池）
    vendor/server.html                        ← Constellation 的服务器原始外壳
    vendor/business-ops/server.html           ← Business Ops 的服务器原始外壳
    vendor/business-ops/chunks/               ← 只有 Business Ops 独有的 3 个 chunk
    vendor/service-ops/server.html            ← Service Ops 的服务器原始外壳
    vendor/architecture/server.html           ← Architecture 的服务器原始外壳
    vendor/architecture/chunks/               ← 只有 Architecture 独有的 2 个 chunk
    vendor/media/*.woff2                      ← 字体（各页共用）

> 除 Constellation 外都**不依赖**下载目录：外壳在自己的 `vendor/<页>/` 下，独有的 chunk
> 也在那儿，其余 chunk 与 Constellation 共用（md5 逐字节相同），从 `*_files/` 拿。
"""

import argparse
import re
import shutil
import sys
import urllib.request
from pathlib import Path

SITE = "https://sip-platform.web.app"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124 Safari/537.36")

# PasswordGate 把解锁标记写在 localStorage。新开一个浏览器 profile 时它是空的，
# 于是离线打开会卡在密码框。在应用启动前补上。
UNLOCK_KEY = "sip-platform-unlocked"

# 嵌入 Vue 应用时要剥掉的内层外壳。**两个页面通用** —— 同一套 Next 外壳、同样的 class。
# 这几条由宿主外壳（AppHeader / AppFooter）提供，内层是重复的 ——
# 不剥就会出现两条菜单栏（第一版 iframe 方案就是栽在这里）。
# 选择器对着 Next 那边的 class 写，站点改版后要跟着改；剥错了不会报错，只是少了点东西。
#
# ⚠️ Constellation 还有**第二条底栏** `footer.estate-status-bar`，它是**保留**的：
# 内容与上面那条不同（多了「0 agents online / 2 in queue / ⌘K to search」），宿主没有，
# 且它是 position:absolute 覆盖在图底部、不占布局高度。早先一并剥掉是判断失误
# （看着名字像就顺手藏了），用户直接指出「为什么这个内容没展示」。
# Business Ops 实测没有这条（grep 计数 0），所以只需下面三条。
STRIP_CSS = """
<style id="sip-embed-shell-strip">
/* 顶栏：9 个域的导航 —— 与宿主 AppHeader 完全重复（同一份 NAV）。剥掉。 */
header.fixed.top-0 { display: none !important; }

/* 底栏：Live · SNAPSHOT · SCOPE · TOTAL NODES · PANEL n/9 —— 宿主 AppFooter
   就是照它做的（逐字），剥掉。 */
footer.fixed.bottom-0 { display: none !important; }

/* 面板原本是 calc(100vh - 92px)，给顶栏那 52px 让位。
   顶栏剥掉后还回来，否则底部会空一条。内联样式，必须 !important。 */
main.flex.w-full.flex-col.overflow-hidden { height: 100vh !important; }
</style>
"""

# 四个页面。产出都进 public/ —— Vite 按根伺服，内层 chunk 走的
# `/_next/…`（turbopack 硬编码的**根绝对路径**）dev 与 build 才对得上。
PAGES = {
    "constellation": {
        "site_path": "/",
        # 名字随意：这个页面的内容不依赖 pathname（panelByRoute 落空时也不影响图）。
        "out": ("constellation-app.html",),
        # 资源来自 Chrome 保存的 `_files/`（与 `--src` 同一个目录）
        "vendor_sub": "",
        "shared_chunks": True,
    },
    "business-ops": {
        "site_path": "/business-ops/",
        # ⚠️ 名字**不能随意** —— 必须是 /business-ops/index.html，见文件头说明。
        "out": ("business-ops", "index.html"),
        "vendor_sub": "business-ops",
        "shared_chunks": True,
    },
    "service-ops": {
        "site_path": "/service-ops/",
        # ⚠️ 同样不能随意，理由同上：panelByRoute 只剥一个尾斜杠、不认 index.html，
        # 路径对不上时内层 h1 会**静默**变成 "SIP"（不报错、不白屏）。
        "out": ("service-ops", "index.html"),
        "vendor_sub": "service-ops",
        "shared_chunks": True,
    },
    "architecture": {
        "site_path": "/architecture/",
        # ⚠️ 同样不能随意：面板表里是 `route:"/architecture"`（subtitle 6R classification ·
        # modernization queues，pool VP4），对不上时内层 h1 静默变成 "SIP"。
        # 路径与 Vue 路由**同名**，冲突处置与 service-ops 完全一致（见 vite.config.js）。
        "out": ("architecture", "index.html"),
        "vendor_sub": "architecture",
        "shared_chunks": True,
    },
    "security-ops": {
        "site_path": "/security-ops/",
        # ⚠️ 同样不能随意：面板表里是
        #     `{id:"security-ops", index:7, label:"Security Ops", shortLabel:"Security",
        #       route:"/security-ops", subtitle:"Vulnerability heatmap · attack surface ·
        #       freeze risk"}`（**没有 pool**，与 finops 一样），
        # 对不上时内层 h1 静默变成 "SIP"。
        # 路径与 Vue 路由**同名**，冲突处置与 architecture / service-ops 完全一致
        # （见 vite.config.js 的 EMBED_PAGES 与 README 的 nginx 片段）。
        "out": ("security-ops", "index.html"),
        "vendor_sub": "security-ops",
        "shared_chunks": True,
    },
}


# ── 找源 ────────────────────────────────────────────────────────────

def find_saved_page(tools_dir: Path):
    """找 Chrome「网页，完整」保存出来的一对：xxx.html + xxx_files/。"""
    for html in sorted(tools_dir.glob("*.html")):
        side = tools_dir / f"{html.stem}_files"
        if side.is_dir():
            return html, side
    return None, None


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def refresh_vendor(page: dict, vendor_root: Path, shared_dir=None):
    """
    从线上刷新缓存。**这是唯一会联网的路径**，且必须显式 `--refresh`。

    vendor 里只放在网上、又无法从保存文件里得到的东西：
      - server.html：服务器渲染的原始外壳。保存版是 DOM 快照，启动不了（见文件头）
      - media/*.woff2：字体。Chrome 保存 `_files/` 时不收字体
      - <page>/chunks/*：该页独有的 chunk（Business Ops 有 3 个）。
        **与分享池里同名的跳过** —— 那些已经在 `*_files/` 里了，再存一份没意义
        （实测 30/31 逐字节相同）。
    其余（JS/CSS）都在 `_files/` 里，不用联网。
    """
    page_dir = vendor_root / page["vendor_sub"] if page["vendor_sub"] else vendor_root
    page_dir.mkdir(parents=True, exist_ok=True)

    base = SITE + page["site_path"]
    html = _get(base).decode("utf-8", errors="replace")
    (page_dir / "server.html").write_text(html, encoding="utf-8")
    print(f"    {page['vendor_sub'] or '.'}/server.html  {len(html):,} 字节")

    # 页面独有的 chunk：跳过**已经存在于本仓**的同名文件。
    #
    # 「已知」有两处，缺一不可：
    #   1. 分享池（Chrome 保存的 _files/）—— 绝大多数 chunk 在这
    #   2. **其它页面**的 vendor/<页>/chunks/ —— 少了这条，一个被两个页面
    #      共用的 chunk 会被下载两遍、在仓库里存两份
    #      （实测：100pim9o6kpoy.js 161KB 就这样重复过一次）
    known = set()
    if shared_dir and shared_dir.is_dir():
        known = {p.name for p in shared_dir.iterdir() if p.is_file()}
    for other in vendor_root.iterdir() if vendor_root.is_dir() else []:
        d = other / "chunks"
        if d.is_dir():
            known |= {p.name for p in d.iterdir() if p.is_file()}

    # ⚠️ 必须连 .css 一起抓。本仓已存在**按路由拆分的样式表**
    # （`0yiy_grop9liv.css` 是 constellation 独有的），而这里原来只匹配 `.js` ——
    # 下一个带自己样式表的页面会静默漏掉它，构建正常、不报错，
    # 打开才发现内嵌页没有样式。
    names = sorted(set(re.findall(r"/_next/static/chunks/([A-Za-z0-9._~\-]+\.(?:js|css))", html)))
    fresh = [n for n in names if n not in known]
    if fresh:
        (page_dir / "chunks").mkdir(exist_ok=True)
    for name in fresh:
        data = _get(f"{SITE}/_next/static/chunks/{name}")
        (page_dir / "chunks" / name).write_bytes(data)
        print(f"    {page['vendor_sub']}/chunks/{name}  {len(data):,} 字节")
    if names:
        print(f"    （另有 {len(names) - len(fresh)} 个 chunk 与分享池相同，跳过）")

    # 字体只有一套，两个页面共用，始终放 vendor_root/media
    if not page["vendor_sub"]:
        (vendor_root / "media").mkdir(exist_ok=True)
        for name in sorted(set(re.findall(
                r"/_next/static/media/([A-Za-z0-9._\-]+\.woff2)", html))):
            data = _get(f"{SITE}/_next/static/media/{name}")
            (vendor_root / "media" / name).write_bytes(data)
            print(f"    media/{name}  {len(data):,} 字节")


def load_vendor(page: dict, vendor_root: Path):
    """读本地缓存。缺东西就报清楚缺什么，而不是默默去联网。"""
    page_dir = vendor_root / page["vendor_sub"] if page["vendor_sub"] else vendor_root
    srv = page_dir / "server.html"
    if not srv.is_file():
        raise FileNotFoundError(
            f"缺少 {srv}\n"
            "  vendor/ 是离线构建的缓存，首次需要联网生成一次：\n"
            "      python3 make-offline-page.py --refresh")
    media = vendor_root / "media"
    fonts = {p.name: p for p in sorted(media.glob("*.woff2"))} if media.is_dir() else {}
    # 该页独有的 chunk（可能没有 —— Constellation 全在分享池里）
    own_chunks = page_dir / "chunks"
    return srv.read_text(encoding="utf-8", errors="replace"), fonts, (own_chunks if own_chunks.is_dir() else None)


# ── 构建 ────────────────────────────────────────────────────────────

def build(page: dict, chunk_srcs, out_dir: Path, server_html: str, fonts: dict, embed_strip=True):
    chunks_dir = out_dir / "_next" / "static" / "chunks"
    media_dir = out_dir / "_next" / "static" / "media"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)

    # 1. 搬资源 → _next/static/chunks/*
    #    多个来源依序覆盖：分享池（`*_files/`）+ 该页独有的 chunk。
    #    两个页面写的是**同一个** public/_next/，所以这里每次都是「并集」——
    #    后建的页面不会把先建的覆盖掉（除非同名，那本来就是同一份文件）。
    moved = 0
    for src in chunk_srcs:
        if not src or not src.is_dir():
            continue
        for f in src.iterdir():
            if f.is_file() and f.name != ".DS_Store":
                shutil.copy2(f, chunks_dir / f.name)
                moved += 1

    # 1b. 把 tenant-data/*.json 写回**输出目录那份** bundle。
    #     改源文件的话重建就不可重复了 —— 改一次叠一次，回不去。
    overrides = {"replaced": [], "added": []}
    bundle = chunks_dir / "0wuztp2.9oz~8.js"
    if bundle.is_file():
        try:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            import tenant_data
            overrides = tenant_data.apply_overrides(
                bundle, Path(__file__).resolve().parent / "tenant-data")
        except Exception as e:
            print(f"    ! 注入租户数据失败，跳过：{e}")

    # 2. 字体：从 vendor 拷贝。服务器 HTML 用的是根相对路径
    #    `/_next/static/media/…`，服务根目录设对就能命中，不用改 HTML。
    copied = 0
    for name, path in fonts.items():
        shutil.copy2(path, media_dir / name)
        copied += 1

    html = server_html

    # 3. 补解锁标记，放在 <head> 最前，早于任何 Next.js 脚本
    if UNLOCK_KEY not in html:
        inject = f"<script>try{{localStorage.setItem('{UNLOCK_KEY}','1')}}catch(e){{}}</script>"
        html = re.sub(r"(<head[^>]*>)", r"\1" + inject, html, count=1)

    # 3b. 嵌入 Vue 应用时剥掉内层外壳（顶栏 + 两条底栏），否则会有两条菜单栏。
    #     --standalone 时跳过 —— 单独打开那个页面时，顶栏是你唯一的导航。
    if embed_strip and "sip-embed-shell-strip" not in html:
        html = html.replace("</head>", STRIP_CSS + "</head>", 1)

    # 3c. 按租户改写**写死的外壳文案**（副标题、<title>、meta、筛选面板那批）。
    #     必须在 1b 之后读 bundle —— 那时输出目录那份才含全部租户（含新增的）。
    #     租户是运行时选的（localStorage），所以注入的是「全租户映射 + 运行时改写器」，
    #     不是把某个租户的值烤死。见 tenant_copy.py。
    n_copy = 0
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import tenant_data, tenant_copy          # 显式导入 —— 不依赖 1b 那个 try 成功
        if bundle.is_file():
            _, all_tenants, _ = tenant_data.read_bundle(bundle)
            html, n_copy = tenant_copy.inject(html, all_tenants)
            # 切换面板的租户清单写死在 chunk 里，DOM 改写够不着 —— 直接补数组
            extra = tenant_copy.patch_switcher(chunks_dir, all_tenants)
            if extra:
                print(f"  切换面板补入租户：{', '.join(extra)}")
            # journey 槽位写死成 6 —— 租户不足 6 条时多出来的槽位渲染成空占位。
            # 两处：Business Ops 的 journey 表、服务概览页顶部筛选框。
            for where in tenant_copy.patch_journey_slots(chunks_dir):
                print(f"  journey 槽位：6（写死）→ 按 snapshot.journeys 自适应 · {where}")
            # Cross-Journey 兜底桶没有内容时不该显示
            if tenant_copy.patch_cross_journey(chunks_dir):
                print("  Cross-Journey 选项：常显 → 仅当桶里有组合时显示")
            # 服务概览页底部热力图：去掉红色档，「几乎全绿 + 1~2 个黄」
            # （相对刻度导致最大值那格永远是最高档，所以只能改阈值，不能改数据）
            if tenant_copy.patch_heatmap_palette(chunks_dir):
                print("  热力图配色：三档（绿/黄/红）→ 两档（绿/黄），去掉红色")
            # Business Ops 末尾的 Ask SIP 卡片 —— 按需求隐藏
            if tenant_copy.patch_ask_sip(chunks_dir):
                print("  Ask SIP 卡片：已隐藏（Business Ops 面板末尾）")
            # journey 表行内的「名字」—— 点击从「选中」改成「下钻」（与行尾 › 一致）
            if tenant_copy.patch_journey_name_drill(chunks_dir):
                print("  journey 名字：点击 → 下钻（与行尾 › 一致）")
            # Service Ops 筛选条：journey 之后新增 portfolio 筛选（9 处，整组原子）
            spf = tenant_copy.patch_service_ops_portfolio_filter(chunks_dir)
            if spf == "applied":
                print("  Service Ops：journey 筛选后新增 portfolio 筛选（9 处已打）")
            elif spf != "already":
                print(f"  ! Service Ops portfolio 筛选未打：{spf}")
            # Business Ops 组合名 → 跳到 Service Ops（postMessage 给外壳）
            if tenant_copy.patch_business_ops_portfolio_jump(chunks_dir):
                print("  Business Ops：组合名 → 跳转 Service Ops（组合筛选）")
            # Service Ops 的 ?portfolio= 深链 —— 必须在 SPF 之后（依赖它装上的 pfToggle）
            sdl = tenant_copy.patch_service_ops_portfolio_deeplink(chunks_dir)
            if sdl == "applied":
                print("  Service Ops：支持 ?portfolio= 深链（落地预置 journey+portfolio）")
            elif sdl != "already":
                print(f"  ! Service Ops 深链未打：{sdl}")
            # Service Ops 里指向 /entity/app/<slug>/ 的两个链接 —— 那条路由没被导出，
            # 点它会掉进宿主 SPA 兜底 → 在 Service Ops 的 iframe 里套出 Vue 应用自己
            sel = tenant_copy.patch_service_ops_entity_links(chunks_dir)
            if sel == "applied":
                print("  Service Ops：/entity/app/ 链接拆除（行尾 › 改为开 inspector）")
            elif sel != "already":
                print(f"  ! Service Ops /entity/app/ 链接未拆：{sel}")
            # 内嵌页的兜底租户 → otr（与 src/api/config.js 的 DEFAULT_TENANT 一致）。
            # ⚠ 必须在这里打，**不能手改产物** —— 重建会把它冲掉。
            dt = tenant_copy.patch_default_tenant(chunks_dir)
            if dt == "applied":
                print(f"  兜底租户：retail（站点原生）→ {tenant_copy.DT_DEFAULT}")
            elif dt != "already":
                print(f"  ! 兜底租户未改：{dt}")
            # Security Ops 的 case inspector「Linked app」—— 写死的 appKey 只存在于
            # best-buy-reference 租户，其余租户下整块静默消失。改成读本租户的快照。
            sl = tenant_copy.patch_security_ops_linked_app(chunks_dir)
            if sl == "applied":
                print("  Security Ops：Linked app → 本租户的 topStorm.appKey"
                      "（原为写死的 best-buy app）")
            elif sl != "already":
                print(f"  ! Security Ops Linked app 未改：{sl}")
    except Exception as e:
        print(f"    ! 注入租户文案失败，跳过：{e}")

    # 4. 万一外壳里还留着 _files 的引用（换用保存版时才可能），一并改掉
    n_ref = 0
    for src in chunk_srcs:
        if not src:
            continue
        html, n = re.subn(rf"\./{re.escape(src.name)}/([^\"']+)", r"./_next/static/chunks/\1", html)
        n_ref += n

    # 5. 导航离线化：服务器版顶栏是客户端渲染的，通常没有静态 <a href>；
    #    有的话也只是防误点跳走。
    html, n_nav = re.subn(
        r'href="(?:https://sip-platform\.web\.app)?/(agents|architecture|business-ops|'
        r'engineering-ops|finops|security-ops|service-ops)/?"',
        r'href="#\1"', html)

    out_file = out_dir.joinpath(*page["out"])
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(html, encoding="utf-8")

    # 6. 产出校验：HTML 里引用的每个 /_next/… 都必须在输出目录下真实存在。
    #
    # 为什么必须有这一步：每次构建都先 rmtree 掉 <out>/_next 再从 vendor 重铺，
    # 所以 vendor 少一个文件的表现是**内嵌页静默 404、白屏、零报错** ——
    # 看着像后端或数据问题。与 load_vendor 自己的原则一致：
    # 「缺东西就报清楚缺什么，而不是默默去联网」。
    refs = sorted(set(re.findall(
        r"/_next/([A-Za-z0-9._~\-/]+\.(?:js|css|woff2))", html)))
    missing = [r for r in refs if not (out_dir / "_next" / r).is_file()]

    return {"moved": moved, "fonts": copied, "rewritten": n_ref, "navs": n_nav,
            "size": len(html), "overrides": overrides, "stripped": embed_strip,
            "out_file": out_file, "copy": n_copy,
            "refs": len(refs), "missing": missing}


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="构建离线可跑的 SIP 部署站页面")
    ap.add_argument("--page", choices=sorted(PAGES), default="constellation",
                    help="构建哪个页面（默认 constellation）")
    ap.add_argument("--src", type=Path, help="Chrome 保存的 html（用来定位 _files/ 目录）")
    ap.add_argument("--out", type=Path, default=here.parent / "public",
                    help="输出目录。默认仓库的 public/ —— Vite 按根伺服，"
                         "内层的 /_next/… 才对得上（dev 与 build 都适用）")
    ap.add_argument("--standalone", action="store_true",
                    help="保留内层顶栏/底栏。单独打开这个页面时用；"
                         "嵌进 Vue 应用时不要加（会变成两条菜单栏）")
    ap.add_argument("--vendor", type=Path, default=here / "vendor",
                    help="离线缓存目录（默认 tools/vendor）")
    ap.add_argument("--refresh", action="store_true",
                    help="★ 唯一会联网的操作：从线上刷新缓存后再构建")
    args = ap.parse_args()

    page = PAGES[args.page]

    # 分享池：Chrome 保存的 `_files/`。两个页面的公共 chunk 都从这里来
    # （实测 md5 逐字节相同，所以只留一份）。
    if args.src:
        shared_dir = args.src.with_name(f"{args.src.stem}_files")
    else:
        _, shared_dir = find_saved_page(here)
    if not shared_dir or not shared_dir.is_dir():
        print(f"✗ 找不到 Chrome 保存的资源目录（{shared_dir}）。用 --src 指定。", file=sys.stderr)
        return 1

    if args.refresh:
        print(f"→ 刷新缓存（联网）：{SITE}{page['site_path']}")
        refresh_vendor(page, args.vendor, shared_dir)
    else:
        print(f"→ 离线构建，不碰网络（缓存：{args.vendor}）")

    try:
        server_html, fonts, own_chunks = load_vendor(page, args.vendor)
    except FileNotFoundError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1

    where = page["vendor_sub"] or "."
    print(f"→ 页面：{args.page}（{SITE}{page['site_path']}）")
    print(f"→ 外壳：vendor/{where}/server.html（{len(server_html):,} 字节）")
    print(f"→ 分享池：{shared_dir.name}/（{len(list(shared_dir.iterdir()))} 项）")
    if own_chunks:
        print(f"→ 独有 chunk：vendor/{page['vendor_sub']}/chunks/（{len(list(own_chunks.iterdir()))} 项）")
    print(f"→ 字体：vendor/media/（{len(fonts)} 个）")

    # 清掉上一次的 _next/，再**把并集铺满**。
    #
    # 两个页面共用 public/_next/，所以每次构建都必须把**所有页面**的资源都铺上，
    # 不能只铺当前页的。这个坑真踩到了：先建 business-ops、再单独重建 constellation，
    # 后者的 chunk_srcs 里没有 business-ops 那 3 个独有 chunk，清空之后就再没铺回来
    # —— Business Ops 页面直接 404，而构建输出一切正常、不会报错。
    chunk_srcs = [shared_dir]
    for key, cfg in PAGES.items():
        # 当前页的独有目录用上面已经校验过的那份（load_vendor 检查过存在性）
        d = own_chunks if key == args.page else (
            args.vendor / cfg["vendor_sub"] / "chunks" if cfg["vendor_sub"] else None)
        if d and d.is_dir():
            chunk_srcs.append(d)

    stale = args.out / "_next"
    if stale.is_dir():
        shutil.rmtree(stale)
    args.out.mkdir(parents=True, exist_ok=True)

    r = build(page, chunk_srcs, args.out, server_html, fonts, embed_strip=not args.standalone)

    out_file = r["out_file"]
    rel = out_file.relative_to(args.out)
    print(f"\n✓ 输出到 {out_file}")
    print(f"  _next/ 共铺 {r['moved']} 个资源 + {r['fonts']} 个字体")
    if r["rewritten"]:
        print(f"  改写 {r['rewritten']} 处 _files 引用")
    print(f"  导航离线化 {r['navs']} 处")
    print(f"  内层外壳：{'已剥离（嵌入模式）' if r['stripped'] else '保留（standalone）'}")
    ov = r.get("overrides") or {}
    if ov.get("added"):
        print(f"  新增租户：{', '.join(ov['added'])}")
    if ov.get("replaced"):
        print(f"  覆盖租户：{', '.join(ov['replaced'])}")
    if r.get("copy"):
        print(f"  租户文案：已注入 {r['copy']} 条替换（副标题 / <title> / 筛选面板，按租户运行时生效）")
    print("\n  打开方式：")
    print(f"    npm run dev          → /{rel.parent if rel.parent.name else ''}（内嵌在 Vue 应用里）")
    print(f"    ./start-offline.sh   → http://localhost:8777/{rel}（单独看）")
    print("\n  ⚠ 不要双击 html 用 file:// 打开，也不要拿 Chrome 保存的那份 html 当入口：")
    print("     前者 turbopack 会去找文件系统根的 /_next/，后者 React 根本不会启动。")
    print(f"  ℹ 铺进共用的 public/_next/ 的来源：{len(chunk_srcs)} 个（含其它页面的独有 chunk）。")

    # 产出校验（build 步骤 6）。缺资源时构建本身一切正常，只有打开页面才会发现，
    # 所以这里必须响、且必须非零退出。
    if r["missing"]:
        print(f"\n✗ {len(r['missing'])}/{r['refs']} 个资源引用在输出目录里不存在：")
        for m in r["missing"]:
            print(f"    _next/{m}")
        print("\n  这个页面打开后会 404、白屏，且浏览器不一定报错。")
        print("  多半是 vendor 缓存里缺文件 —— 联网刷新一次：")
        print(f"      python3 make-offline-page.py --page {args.page} --refresh")
        return 1
    print(f"  ✓ 产出校验：{r['refs']} 个 /_next/ 引用全部存在")
    return 0


if __name__ == "__main__":
    sys.exit(main())
