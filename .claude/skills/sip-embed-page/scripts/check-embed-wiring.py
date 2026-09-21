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
ESTATE_NOUN = re.compile(r"\b(apps|portfolios|journeys|teams|nodes|incidents)\b")


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
    """
    import tenant_copy

    own = TOOLS / "vendor" / page["vendor_sub"] / "chunks" if page["vendor_sub"] else None
    if not own or not own.is_dir():
        return None                                  # 该页没有独有 chunk（constellation）→ 跳过

    covered = list(tenant_copy.LEGACY.values())
    hits = []
    for f in sorted(own.glob("*.js")):
        t = f.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r'"([^"\\\n]{12,300})"', t):
            s = m.group(1)
            if not any(c.isdigit() for c in s) or not ESTATE_NOUN.search(s):
                continue
            if any(c in s for c in "(){}:;"):        # CSS 值 / JS 表达式，不是文案
                continue
            if any(c in s for c in covered):         # 已被某条 LEGACY 覆盖
                continue
            hits.append((f.name, s))
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
    if basename and basename in vue_domain_keys():
        print(f"     （同名域：Vue 路由与内嵌页都是 {route}）")
        cfg = (ROOT / "vite.config.js").read_text(encoding="utf-8")
        if re.search(rf"EMBED_PAGES = \[[^\]]*'{re.escape(route)}'", cfg):
            _ok(f"vite.config.js 的 EMBED_PAGES 已登记 {route}（只拦带尾斜杠）")
        else:
            failures.append(_bad(f"vite.config.js 的 EMBED_PAGES 缺 {route}"))
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
