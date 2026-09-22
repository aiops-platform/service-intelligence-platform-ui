#!/usr/bin/env python3
"""
内嵌页接线自检 —— 把「少一处就静默失败」的几条全查一遍。

用法：

    python3 .claude/skills/sip-embed-page/scripts/check-embed-wiring.py
    python3 .claude/skills/sip-embed-page/scripts/check-embed-wiring.py architecture

## 为什么需要它

内嵌页的错法**全都是静默的** —— 不报错、不白屏、构建输出「一切正常」：

  - 产出路径与内层面板表 `route` 对不上 → 内层 h1 变成 "SIP"（代码写的是 `d?.label ?? "SIP"`）；
  - 同名域漏了 `EMBED_PAGES` / nginx → 硬刷新拿到裸的内嵌页，没有导航；
  - 漏了 `DOMAIN_COMPONENTS` → 那个域还是空壳（落到 service-ops 概览），页面「不见了」；
  - 页面自己 chunk 里的数字写死 → 切租户时标题与 KPI 各说各话；
  - `public/_next/` 是四页共用的，改了 `tenant_copy.py` 却只重建一页 → 另外几页的
    文案表缺租户（`cf01394` 就这样漏过一次：otr 加进 bundle 后三个 HTML 没重跑）。

所以这里不查「文件在不在」，查的是**这几处彼此对不对得上**。

## 退出码

有 ✗ 时非零 —— 可以直接串进任何流程里当闸门。⚠ 只是提醒，不影响退出码。
"""

import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]      # .claude/skills/<name>/scripts/x.py → 仓根
TOOLS = ROOT / "tools"
PUBLIC = ROOT / "public"

# tenant_copy 要直接 import —— 租户文案的「已覆盖」判据必须与构建期**同一份** LEGACY，
# 抄一份副本迟早会与它漂移。
sys.path.insert(0, str(TOOLS))

# 内层面板表所在的 chunk（四页共用）。`panelByRoute` 在里面。
PANEL_CHUNK = PUBLIC / "_next" / "static" / "chunks" / "0wuztp2.9oz~8.js"

# 页面自己 chunk 里「写死的房地产数字」长什么样。
# ⚠️ 只认**复数**名词：单数的 "portfolio node"（图例解释）不算 —— 那条本来就不随租户变，
# 收进来只会淹掉真信号。
# ⚠️ `changes` 是 2026-09-21 补的：Engineering Ops 的 description 写死
#    「86,994 changes · 13mo · 96×」而这张表当时只有 apps/portfolios/journeys/…，
#    **一条都没报** —— 而这个数是 best-buy 的、默认租户的 KPI 同时写着 5.3K，
#    是扎眼的同屏矛盾。漏词比漏串更隐蔽，加词时宁多勿少（多报的会被人眼筛掉）。
ESTATE_NOUN = re.compile(
    r"\b(apps|portfolios|journeys|teams|nodes|incidents|changes)\b")


def iter_strings(t):
    """
    单遍词法扫描，依次产出 `(内容, 起始 offset)` 的**字符串字面量**。

    ## 为什么不能用 `"([^"\\\\]{10,300})"` 这种引号配对正则

    踩过（2026-09-21，Engineering Ops）：那种写法在**模板字面量**面前会整片错位 ——
    反引号里出现的 `"` 被当成字符串边界，于是从某处起配对全错，**它后面整片区域的
    文案一条都扫不到**，而报告仍然是「✓ 没有未覆盖的文案」。
    实测那个 chunk：错配的正则只认出 1303 条串、且**漏掉了那条真问题**；
    换成这个扫描器是 1715 条，那条 description 就出来了。

    静默漏扫比误报危险得多 —— 它让 ✓ 变成假信号。所以这里是**扫描器**而不是正则：
    正确跳过模板字面量（含 `${}` 嵌套里的引号）、`\\` 转义、`//` 与 `/* */` 注释。
    """
    i, n = 0, len(t)
    while i < n:
        c = t[i]
        if c == "/" and i + 1 < n:
            if t[i+1] == "/":
                j = t.find("\n", i); i = n if j < 0 else j + 1; continue
            if t[i+1] == "*":
                j = t.find("*/", i + 2); i = n if j < 0 else j + 2; continue
        if c == "`":
            i += 1
            while i < n:
                if t[i] == "\\": i += 2; continue
                if t[i] == "`": i += 1; break
                if t[i] == "$" and i + 1 < n and t[i+1] == "{":
                    depth, i = 1, i + 2
                    while i < n and depth:
                        ch = t[i]
                        if ch == "\\": i += 2; continue
                        if ch in "\"'`":                  # ${} 内层字符串整体跳过
                            q, i = ch, i + 1
                            while i < n:
                                if t[i] == "\\": i += 2; continue
                                if t[i] == q: i += 1; break
                                i += 1
                            continue
                        if ch == "{": depth += 1
                        elif ch == "}": depth -= 1
                        i += 1
                    continue
                i += 1
            continue
        if c in "\"'":
            q, start, i = c, i + 1, i + 1
            buf = []
            while i < n:
                if t[i] == "\\": buf.append(t[i:i+2]); i += 2; continue
                if t[i] == q or t[i] == "\n": break
                buf.append(t[i]); i += 1
            yield "".join(buf), start
            i += 1
            continue
        i += 1


def _load(path: Path, name: str):
    """按路径加载一个连字符命名的 .py（`make-offline-page.py` 不是合法模块名）。"""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _ok(msg):
    print(f"  \033[32m✓\033[0m {msg}")


def _bad(msg):
    print(f"  \033[31m✗\033[0m {msg}")
    return 1


def _warn(msg):
    print(f"  \033[33m⚠\033[0m {msg}")


# ── 单项检查 ────────────────────────────────────────────────────────

def panel_routes() -> set:
    """内层面板表里所有 route。`panelByRoute` 只剥一个尾斜杠，所以这是**精确**的路径集合。"""
    if not PANEL_CHUNK.is_file():
        return set()
    t = PANEL_CHUNK.read_text(encoding="utf-8", errors="replace")
    return set(re.findall(r'route:"(/[^"]*)"', t))


def vue_domain_keys() -> set:
    """NAV 里所有域的 key —— 它们各自会产出一条 `/<key>` 的 Vue 路由（空壳域走 emptyDomainRoutes）。"""
    t = (ROOT / "src" / "router" / "nav.js").read_text(encoding="utf-8")
    return set(re.findall(r"^\s{4}key: '([a-z0-9-]+)',", t, re.M))


def entry_path(page: dict) -> str:
    """
    该页**实际被请求的 URL 路径** —— iframe 的 src，也是内层 `usePathname()` 看到的值。

    目录索引页（`("architecture", "index.html")`）→ `/architecture/`；
    单文件页（`("constellation-app.html",)`）→ `/constellation-app.html`。
    """
    out = page["out"]
    return "/" + (out[0] + "/" if len(out) == 2 else out[0])


def registrations() -> list:
    """
    路由表里所有「渲染了某个内嵌页」的视图 → `[(登记块, 视图相对路径, {该视图提到的入口路径})]`。

    两个登记块都要看，而且**按视图里出现的入口路径反查**，不按路由名猜：
      - `DOMAIN_COMPONENTS`：空壳域（key 是域 key，如 architecture）
      - `STANDALONE_PAGES`：不在任何侧边栏里的独立页（如 service-ops，它是有侧边栏的域）

    两条都是踩出来的：
      - 按「route 的 basename 在不在 DOMAIN_COMPONENTS」判 → business-ops（域 key 是
        `biz-ops`）与 service-ops（走 STANDALONE_PAGES）被误报成「没登记」；
      - 只认 `<NextEmbed src="/x/">` 字面量 → **ServiceOpsView 是 `:src="src"` 绑定的**
        （它要把 `?portfolio=` 拼进查询串），于是被误报成「没有任何视图渲染它」。
        所以这里扫的是文件里所有「像入口路径」的字面量，绑定/拼接都覆盖得到。
    """
    t = (ROOT / "src" / "router" / "index.js").read_text(encoding="utf-8")
    blocks = []
    for name in ("DOMAIN_COMPONENTS", "STANDALONE_PAGES"):
        i = t.find(f"const {name} = ")
        if i < 0:
            continue
        j = t.find("\nconst ", i + 1)          # 到下一个顶层 const 为止
        blocks.append((name, t[i:j if j > 0 else len(t)]))

    out = []
    for view in sorted(set(re.findall(r"import\('@/(views/[^']+)'\)", t))):
        f = ROOT / "src" / view
        if not f.is_file():
            continue
        body = f.read_text(encoding="utf-8")
        paths = set(re.findall(r"""['"](/(?:[a-z0-9-]+/)+|/[a-z0-9-]+\.html)['"]""", body))
        if not paths:
            continue
        where = next((n for n, b in blocks if f"@/{view}" in b), "（未登记）")
        out.append((where, view, paths))
    return out


def scan_fixed_copy(page: dict) -> list:
    """
    扫该页**自己**的 chunk，找「带数字的房地产名词短语」。

    判据对着改写器的语义写：它在**渲染后的文本**里做子串替换，所以一条候选算「已覆盖」，
    当且仅当某条 LEGACY 原文是它的子串。

    ⚠ 扫的是**产出目录**（`public/_next/`），不是 `vendor/` —— 与 `scan_foreign_appkeys`
    同一个理由：构建期补丁改的是产出，vendor 永远是站点原样，扫它会对着已经改好的东西
    误报（FinOps 那轮就报了一条已被补丁覆盖的 `Selling portfolio …`）。
    改写器的替换发生在**运行时**（渲染后的文本节点），所以走改写器的那些串在产出里
    仍然是原文 —— 扫产出一样抓得到。
    """
    import tenant_copy

    own = PUBLIC / "_next" / "static" / "chunks"
    names = None
    vown = TOOLS / "vendor" / page["vendor_sub"] / "chunks" if page["vendor_sub"] else None
    if not own.is_dir():
        own = vown                                     # 还没构建过 → 退回原始副本
    if not own or not own.is_dir():
        return None                                    # 该页没有独有 chunk（constellation）→ 跳过
    if vown and vown.is_dir() and own != vown:
        names = {p.name for p in vown.iterdir() if p.is_file()}

    covered = list(tenant_copy.LEGACY.values())
    hits = []
    for f in sorted(own.glob("*.js")):
        if names is not None and f.name not in names:
            continue                                   # 不是这一页的 chunk
        t = f.read_text(encoding="utf-8", errors="replace")
        for s, _off in iter_strings(t):
            if not 12 <= len(s) <= 320:
                continue
            if not any(c.isdigit() for c in s) or not ESTATE_NOUN.search(s):
                continue
            if any(c in s for c in "(){}:;"):        # CSS 值 / JS 表达式，不是文案
                continue
            if any(c in s for c in covered):         # 已被某条 LEGACY 覆盖
                continue
            hits.append((f.name, s))
    return hits


# 写死的 appKey（如 `appKey:"manhattan wms"`）。改写器的裸串替换**够不着**它
# —— 它不渲染成文本，是数据。识别方式是「`appKey:` 紧跟的字符串字面量」，
# 用 iter_strings() 取字面量再回看前缀（见 scan_foreign_appkeys）。


def appkeys_by_tenant() -> dict:
    """每个租户的 estate 里有哪些 appKey。读不到就返回 {}。"""
    try:
        import tenant_data
        _, data, _ = tenant_data.read_bundle(PANEL_CHUNK)
    except Exception:
        return {}
    out = {}
    for tid, d in data.items():
        s = d.get("snapshot", {}) or {}
        out[tid] = {a.get("appKey") for a in (s.get("apps") or []) if a.get("appKey")}
    return out


def scan_foreign_appkeys(page: dict) -> list:
    """
    扫该页**写死的 appKey**，逐个租户快照看能不能查到 —— 返回 [(文件, appKey, 命中租户数, 总租户数)]。

    ## 为什么单独查这一条（v2.4.0 接 Security Ops 时补）

    它是**前面所有检查都漏掉**的一类，而且失败方式最隐蔽：

        let s = e.appKey ? i.snapshot.apps.find(t => t.appKey === e.appKey) : null;
        …  s && (…jsx(…"Linked app"…)…)      ← 查不到就短路

    appKey 落空时那一整节**静默消失** —— 不报错、不留空态、只是少了内容。
    文案错了是「说了错话」，这个连话都不说。

    两个已有的检查都够不着它：
      - `scan_fixed_copy()` 要求「带数字 + 房地产名词」，appKey 两样都没有；
      - `tenant_copy` 的改写器只认**渲染后的文本/属性**，而 appKey 是数据。

    实测代价：Security Ops 的 5 个 appKey 有 4 个在 11/12 个租户里都不存在 ——
    页面是照着 best-buy-reference 写的，**在作者那个租户上一切正常**，
    所以很容易一路 ✓ 过去。

    ⚠ 报成 ⚠ 而不是 ✗：appKey 查不到**不一定**是 bug（页面可能有意回落），
    但必须让人看见，由人判断该改成运行期派生还是保持原样。

    ⚠ 扫的是**产出目录**（`public/_next/`）而不是 `vendor/` —— appKey 是构建期补丁
    改的（见 `patch_security_ops_linked_app`），vendor 那份永远是站点原样，
    扫它会对着已经在产出里改好的东西误报。
    """
    own = PUBLIC / "_next" / "static" / "chunks"
    if not own.is_dir():
        own = TOOLS / "vendor" / page["vendor_sub"] / "chunks" if page["vendor_sub"] else None
    if not own or not own.is_dir():
        return None
    # 只看该页独有的 chunk（产出目录是所有页的并集）
    names = None
    vown = TOOLS / "vendor" / page["vendor_sub"] / "chunks" if page["vendor_sub"] else None
    if vown and vown.is_dir():
        names = {p.name for p in vown.iterdir() if p.is_file()}
    per_tenant = appkeys_by_tenant()
    if not per_tenant:
        return None
    n_all = len(per_tenant)
    hits = []
    for f in sorted(own.glob("*.js")):
        if names is not None and f.name not in names:
            continue                                  # 不是这一页的 chunk
        t = f.read_text(encoding="utf-8", errors="replace")
        keys = set()
        for s, off in iter_strings(t):
            # 只认**紧跟在 `appKey:` 后面的那个字符串字面量**。
            # 已改成运行期派生的写法（`appKey:(i.snapshot…).appKey`）不是字面量，
            # 这里天然认不到，不需要额外过滤。
            if not 2 <= len(s) <= 80:
                continue
            if not t[:off - 1].endswith("appKey:"):
                continue
            keys.add(s)
        for key in sorted(keys):
            n_ok = sum(1 for k in per_tenant.values() if key in k)
            if n_ok < n_all:                          # 有一个租户查不到就值得看一眼
                hits.append((f.name, key, n_ok, n_all))
    return hits


def copy_map_of(html: Path) -> dict:
    """页面里注入的 __SIPCOPY__（租户 → 替换表）。没有就返回 None。"""
    if not html.is_file():
        return None
    m = re.search(r"window\.__SIPCOPY__=(\{.*?\});</script>",
                  html.read_text(encoding="utf-8", errors="replace"), re.S)
    return json.loads(m.group(1)) if m else {}


def bundle_tenants() -> set:
    """bundle（内嵌页取数的那份数据）里的租户清单。"""
    try:
        import tenant_data
        _, data, _ = tenant_data.read_bundle(PANEL_CHUNK)
        return set(data)
    except Exception:
        return set()


# ── 单页检查 ────────────────────────────────────────────────────────

def check(page_name: str, page: dict, failures: list):
    out = page["out"]
    entry = entry_path(page)
    route = entry.rstrip("/") if len(out) == 2 else None   # 目录索引才受面板表约束
    print(f"\n── {page_name}  （部署站 {page['site_path']}）")

    # 1. 产出路径 ↔ 面板表 route
    routes = panel_routes()
    if route and routes:
        if route in routes:
            _ok(f"产出路径 {route} 在内层面板表里（{routes and 'panelByRoute 解析得到 label'}）")
        else:
            failures.append(_bad(
                f"产出路径 {route} **不在**面板表里 → 内层 h1 会静默变成 \"SIP\"。"
                f"表里有：{', '.join(sorted(routes))}"))
    elif not routes:
        _warn("读不到面板表（chunk 不在或站点改版）→ 跳过路径核对")

    # 2. 同名域：三处必须成对
    basename = route.lstrip("/") if route else None
    same_name = bool(basename and basename in vue_domain_keys())

    # 2a. EMBED_PAGES —— **所有**目录索引页都要有，不只是同名域。
    #     那个列表的另一半职责是给 dev/preview 补「Vite 不解析 public/ 目录索引」。
    #     少了它，`/x/` 落进 SPA 兜底、iframe 里渲染出 Vue 应用自己 —— 与同名冲突无关。
    #     原先只在同名分支里查，于是 business-ops / engineering-ops 这类**不同名**的页
    #     漏了也没人报（2026-09-21 补）。
    if route:
        cfg = (ROOT / "vite.config.js").read_text(encoding="utf-8")
        if re.search(rf"EMBED_PAGES = \[[^\]]*'{re.escape(route)}'", cfg):
            _ok(f"vite.config.js 的 EMBED_PAGES 已登记 {route}"
                + ("（只拦带尾斜杠）" if same_name else "（不同名域，仅为 dev 补目录索引）"))
        else:
            failures.append(_bad(
                f"vite.config.js 的 EMBED_PAGES 缺 {route} → dev/preview 下 "
                f"{entry} 会落进 SPA 兜底，iframe 里渲染出 Vue 应用自己"))

    if same_name:
        print(f"     （同名域：Vue 路由与内嵌页都是 {route}）")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        if re.search(rf"location = {re.escape(route)} \{{", readme):
            _ok(f"README 的 nginx 片段有 location = {route}")
        else:
            failures.append(_bad(
                f"README 的 nginx 片段缺 `location = {route} {{ try_files /index.html =404; }}` "
                f"→ 生产硬刷新会拿到裸的内嵌页"))

    # 3. 有没有视图在渲染它（按视图里出现的入口路径反查）
    hit = next(((w, v) for w, v, paths in registrations() if entry in paths), None)
    if hit:
        _ok(f"{hit[0]} 已登记 → src/{hit[1]}（入口 {entry}）")
    else:
        failures.append(_bad(
            f"没有任何视图渲染 {entry} —— 这一页接不进来"
            + ("（那个域还是空壳，落到 service-ops 概览）" if route else "")))

    # 4. 产物存在
    f = PUBLIC.joinpath(*out)
    if f.is_file():
        _ok(f"产物存在 public/{'/'.join(out)}（{f.stat().st_size:,} 字节）")
    else:
        failures.append(_bad(f"产物不存在：public/{'/'.join(out)} —— 跑 make-offline-page.py --page {page_name}"))

    # 5. 页面自己 chunk 里的写死数字
    if route:
        hits = scan_fixed_copy(page)
        if hits is None:
            _warn("该页没有独有 chunk，跳过写死文案扫描")
        elif hits:
            _warn(f"疑似未跟随租户的固定文案 {len(hits)} 条（也可能是无关的图例/阈值，逐个判断）：")
            for fn, s in hits:
                print(f"        [{fn}] {s[:110]}")
        else:
            _ok("页面独有 chunk 里没有未覆盖的「数字 + 房地产名词」文案")

    # 6. 页面自己 chunk 里的写死 appKey（数据，不是文本 —— 改写器够不着）
    if route:
        ak = scan_foreign_appkeys(page)
        if ak:
            _warn(f"写死的 appKey 有 {len(ak)} 个在部分租户的 estate 里查不到 ——")
            print("        查不到时该处会**静默消失**（`s && (…)` 短路，不报错不留空态）。")
            print("        要么改成本租户的派生写法（见 tenant_copy 的 SEC_APPKEY_REPL），")
            print("        要么确认有意回落：")
            for fn, key, n_ok, n_all in ak:
                print(f"        [{fn}] appKey:{key!r} 命中 {n_ok}/{n_all} 个租户")
        elif ak is not None:
            _ok("页面独有 chunk 里没有「部分租户查不到」的写死 appKey")


def check_shared_outputs(pages: dict, failures: list):
    """
    四页共用 public/_next/，文案表也是全局一份 —— 所以「只重建了一页」会让另外几页
    的租户表过期。这里直接比**租户清单**，比 mtime 可靠。
    """
    print("\n── 共用产出：各页的租户表是否与 bundle 同步")
    want = bundle_tenants()
    if not want:
        _warn("读不到 bundle 租户清单 → 跳过")
        return
    for name, page in pages.items():
        f = PUBLIC.joinpath(*page["out"])
        if not f.is_file():
            continue
        got = set(copy_map_of(f) or {})
        missing = want - got
        if missing:
            failures.append(_bad(
                f"{name}：文案表缺租户 {', '.join(sorted(missing))} "
                f"→ 这一页没跟着 bundle 重建（跑 --page {name}）"))
        else:
            _ok(f"{name}：{len(got)} 个租户，与 bundle 一致")


def main():
    mop = _load(TOOLS / "make-offline-page.py", "mop")
    pages = mop.PAGES
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    targets = args or sorted(pages)
    for name in targets:
        if name not in pages:
            print(f"✗ 未知页面 {name!r}。可选：{', '.join(sorted(pages))}", file=sys.stderr)
            return 2

    failures = []
    for name in targets:
        check(name, pages[name], failures)
    if len(targets) == len(pages):
        check_shared_outputs(pages, failures)

    print()
    if failures:
        print(f"✗ {len(failures)} 处接线不完整 —— 都会**静默**表现为「页面看着在、行为不对」。")
        return 1
    print("✓ 接线完整。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
