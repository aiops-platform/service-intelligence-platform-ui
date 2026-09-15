#!/usr/bin/env python3
"""
把 SIP · Constellation 页面做成本地可跑、可交互的离线副本。

**默认完全离线** —— 所有需要的东西都在 `vendor/` 里，不碰网络。
只有显式加 `--refresh` 才会去线上更新缓存。

    python3 make-offline-page.py                  # 离线构建（默认）
    python3 make-offline-page.py --refresh        # 先去线上刷新 vendor/，再构建

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


## 目录

    <保存的页面>.html + <保存的页面>_files/   ← Chrome 保存的，提供 JS/CSS
    vendor/server.html                        ← 服务器原始外壳（可启动的那份）
    vendor/media/*.woff2                      ← 字体
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

# 产出文件名。默认输出到 public/，于是路径就是 /constellation-app.html，
# 而内层 chunk 走 /_next/…（turbopack 硬编码的**根绝对路径**）——
# Vite 的 public/ 正好按根伺服，dev 与 build 都对得上。
PAGE_NAME = "constellation-app.html"

# 嵌入 Vue 应用时要剥掉的内层外壳。
# 这三条由宿主外壳（AppHeader / AppFooter）提供，内层是重复的 ——
# 不剥就会出现两条菜单栏（第一版 iframe 方案就是栽在这里）。
# 选择器对着 Next 那边的 class 写，站点改版后要跟着改；剥错了不会报错，只是少了点东西。
STRIP_CSS = """
<style id="sip-embed-shell-strip">
/* 顶栏：9 个域的导航 —— 与宿主 AppHeader 完全重复（同一份 NAV）。剥掉。 */
header.fixed.top-0 { display: none !important; }

/* 底栏之一：Live · SNAPSHOT · SCOPE · TOTAL NODES · PANEL 1/9 —— 宿主 AppFooter
   就是照它做的（逐字），剥掉。 */
footer.fixed.bottom-0 { display: none !important; }

/* 底栏之二 footer.estate-status-bar **保留**。
   它和上面那条内容不同：多了「0 agents online / 2 in queue / ⌘K to search」，
   宿主没有。早先一并剥掉是判断失误（看着名字像就顺手藏了），
   用户直接指出「为什么这个内容没展示」。
   它是 position:absolute 覆盖在图底部，不占布局高度。 */

/* 面板原本是 calc(100vh - 92px)，给顶栏那 52px 让位。
   顶栏剥掉后还回来，否则底部会空一条。内联样式，必须 !important。 */
main.flex.w-full.flex-col.overflow-hidden { height: 100vh !important; }
</style>
"""


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


def refresh_vendor(vendor: Path):
    """
    从线上刷新 `vendor/`。**这是唯一会联网的路径**，且必须显式 `--refresh`。

    vendor 里只放两样在网上、又无法从保存文件里得到的东西：
      - server.html：服务器渲染的原始外壳。保存版是 DOM 快照，启动不了（见文件头）
      - media/*.woff2：字体。Chrome 保存 `_files/` 时不收字体
    其余（JS/CSS）都在 `_files/` 里，不用联网。
    """
    vendor.mkdir(parents=True, exist_ok=True)
    (vendor / "media").mkdir(exist_ok=True)

    html = _get(SITE + "/").decode("utf-8", errors="replace")
    (vendor / "server.html").write_text(html, encoding="utf-8")
    print(f"    server.html  {len(html):,} 字节")

    for name in sorted(set(re.findall(
            r"/_next/static/media/([A-Za-z0-9._\-]+\.woff2)", html))):
        data = _get(f"{SITE}/_next/static/media/{name}")
        (vendor / "media" / name).write_bytes(data)
        print(f"    media/{name}  {len(data):,} 字节")


def load_vendor(vendor: Path):
    """读本地缓存。缺东西就报清楚缺什么，而不是默默去联网。"""
    srv = vendor / "server.html"
    if not srv.is_file():
        raise FileNotFoundError(
            f"缺少 {srv}\n"
            "  vendor/ 是离线构建的缓存，首次需要联网生成一次：\n"
            "      python3 make-offline-page.py --refresh")
    media = vendor / "media"
    fonts = {p.name: p for p in sorted(media.glob("*.woff2"))} if media.is_dir() else {}
    return srv.read_text(encoding="utf-8", errors="replace"), fonts


# ── 构建 ────────────────────────────────────────────────────────────

def build(src_files: Path, out_dir: Path, server_html: str, fonts: dict, embed_strip=True):
    chunks_dir = out_dir / "_next" / "static" / "chunks"
    media_dir = out_dir / "_next" / "static" / "media"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)

    # 1. 搬资源：_files/* → _next/static/chunks/*
    moved = 0
    for f in src_files.iterdir():
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

    # 4. 万一外壳里还留着 _files 的引用（换用保存版时才可能），一并改掉
    suffix = re.escape(src_files.name)
    html, n_ref = re.subn(rf"\./{suffix}/([^\"']+)", r"./_next/static/chunks/\1", html)

    # 5. 导航离线化：服务器版顶栏是客户端渲染的，通常没有静态 <a href>；
    #    有的话也只是防误点跳走。
    html, n_nav = re.subn(
        r'href="(?:https://sip-platform\.web\.app)?/(agents|architecture|business-ops|'
        r'engineering-ops|finops|security-ops|service-ops)/?"',
        r'href="#\1"', html)

    (out_dir / PAGE_NAME).write_text(html, encoding="utf-8")
    return {"moved": moved, "fonts": copied, "rewritten": n_ref, "navs": n_nav,
            "size": len(html), "overrides": overrides, "stripped": embed_strip}


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="构建离线可跑的 Constellation 页面")
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
                    help="★ 唯一会联网的操作：从线上刷新 vendor/ 后再构建")
    args = ap.parse_args()

    if args.refresh:
        print(f"→ 刷新 vendor/（联网）：{SITE}/")
        refresh_vendor(args.vendor)
    else:
        print(f"→ 离线构建，不碰网络（缓存：{args.vendor}）")

    src_html = args.src
    src_files = None
    if src_html:
        src_files = src_html.with_name(f"{src_html.stem}_files")
    else:
        src_html, src_files = find_saved_page(here)

    if not src_html or not src_html.exists():
        print("✗ 没找到 Chrome 保存的页面。用 --src 指定。", file=sys.stderr)
        return 1
    if not src_files or not src_files.is_dir():
        print(f"✗ 找不到资源目录 {src_files}", file=sys.stderr)
        return 1

    try:
        server_html, fonts = load_vendor(args.vendor)
    except FileNotFoundError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1

    print(f"→ 外壳：{args.vendor.name}/server.html（{len(server_html):,} 字节）")
    print(f"→ 资源：{src_files.name}/（{len(list(src_files.iterdir()))} 项）")
    print(f"→ 字体：{args.vendor.name}/media/（{len(fonts)} 个）")

    # 清掉上一次的 _next/（只删自己产出的那份，不动 public/ 里别的东西）
    stale = args.out / "_next"
    if stale.is_dir():
        shutil.rmtree(stale)
    args.out.mkdir(parents=True, exist_ok=True)

    r = build(src_files, args.out, server_html, fonts, embed_strip=not args.standalone)

    print(f"\n✓ 输出到 {args.out.resolve()}")
    print(f"  {PAGE_NAME} + _next/（{r['moved']} 个资源 + {r['fonts']} 个字体）")
    if r["rewritten"]:
        print(f"  改写 {r['rewritten']} 处 _files 引用")
    print(f"  导航离线化 {r['navs']} 处")
    print(f"  内层外壳：{'已剥离（嵌入模式）' if r['stripped'] else '保留（standalone）'}")
    ov = r.get("overrides") or {}
    if ov.get("added"):
        print(f"  新增租户：{', '.join(ov['added'])}")
        for tid in ov["added"]:
            print(f"    → http://localhost:8777/constellation-app.html?tenant={tid}")
    if ov.get("replaced"):
        print(f"  覆盖租户：{', '.join(ov['replaced'])}")
    print("\n  打开方式：")
    print("    npm run dev          → 顶栏点 Constellation（内嵌在 Vue 应用里）")
    print(f"    ./start-offline.sh   → http://localhost:8777/{PAGE_NAME}（单独看）")
    print("\n  ⚠ 不要双击 html 用 file:// 打开，也不要拿 Chrome 保存的那份 html 当入口：")
    print("     前者 turbopack 会去找文件系统根的 /_next/，后者 React 根本不会启动。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
