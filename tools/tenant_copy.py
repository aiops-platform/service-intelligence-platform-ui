#!/usr/bin/env python3
"""
把页面里**写死的外壳文案**改成按租户动态显示。

## 问题

Constellation 页面有一批文案是写死在客户端代码里的，锚定在 Acme Retail / data-sicg
的数据上，切租户时不会变。最明显的是副标题：

    The Acme Retail operational fabric · 282 apps across 9 portfolios + 6 journeys…

`operational fabric` 这个字符串**不在任何 JS chunk 里** —— 它只在 `vendor/server.html`
的 RSC payload 里，由服务端渲染成静态文本，客户端从不构造它，所以永远不会变。
筛选面板那一批则是写死在 `0p_dozb5cvong.js` 的字面量。

## 为什么不能构建时替换

租户是**运行时**选的：

    ?tenant=<id>  →  localStorage["sip-active-tenant"]  →  兜底 "retail"

构建时烤死任何一个租户的值，切到别的租户就是错的。所以改成：
构建时把**每个租户**的文案算好注入 `window.__SIPCOPY__`，运行时按 active tenant 改写 DOM。

## 改成 DOM 改写而不是补丁 JS

筛选面板那批字符串是 React 渲染的，DOM 里就是普通文本节点 / `title` 属性 ——
文本级替换能覆盖全部，还不用碰压缩过的 JS（站点更新后字面量变了也只是静默失效，
不会把页面搞坏）。用 MutationObserver 兜住 React 的重渲染。
"""

import re

# 页面源码里写死的原文 → 生成各租户的替换值。
# key 是「在 DOM 里实际渲染出来的文本」（不是 JS 源码里的字面量形式）。
LEGACY = {
    "title": "SIP · The Constellation · Acme Retail",
    "meta": ("The 3D estate constellation · 282 apps · 9 portfolios · 6 journeys · "
             "54 teams. The substrate the agent fleet operates on."),
    "subtitle": ("The Acme Retail operational fabric · 282 apps across 9 portfolios + "
                 "6 journeys, the support team layer, the agent fleet, and the "
                 "cross-cutting events. Click any node to inspect."),
    "pf_all": "All 22",
    "pf_desc": "22 portfolios across 6 journeys",
    "top_inc": "Top 10 by incidents · 18M",
    "top_chg": "Top 10 by changes · 18M",
    "wms_label": "Manhattan WMS spotlight",
    "wms_desc": "The 1,809-child storm origin",
    "wms_view": "Manhattan WMS · the spotlight node",
    "storm_view": "INC13075702 · 1,809-child blast radius",
    "hol_label": "Holiday-critical",
    "hol_desc": "Apps in the holiday-peak path",
    "backout": ("Emergency changes back out at 2.34% vs Standard 0.02% — "
                "the canonical 96× differential."),
    # 加载页副标题 + 搜索框 placeholder 共用这一串（data-sicg 的数字，最显眼）
    "counts": "893 apps · 22 portfolios · 6 journeys · 156 agents",
    # 顶栏九个域的 tooltip —— 同一批数字但结尾是 teams 不是 agents，是**另一条**字面量
    "counts_nav": "893 apps · 22 portfolios · 6 journeys · 173 teams",
    # 保存视图 "Tier 1 · Holiday" 的说明
    "t1h_desc": "Highest-criticality + holiday-peak apps",
}


def _num(n):
    """3.3M / 665K / 1,240"""
    if n is None:
        return "—"
    n = float(n)
    if n >= 1e6:
        return f"{n/1e6:.1f}".rstrip("0").rstrip(".") + "M"
    if n >= 1e3:
        return f"{n/1e3:.0f}K"
    return f"{n:,.0f}"


def _pct(x, digits=2):
    return f"{x*100:.{digits}f}%"


def tenant_pairs(d):
    """
    单个租户的 [[原文, 替换值], …]。`d` 是 bundle 里的 {tenant, snapshot}。

    原文 = 现值时不产出（retail 因此几乎为空 → 它显示原始文案，本来就是对它的）。
    """
    t, s = d.get("tenant", {}), d.get("snapshot", {})
    f = s.get("facts", {}) or {}
    lb = t.get("labels", {}) or {}
    name = (t.get("client") or {}).get("displayName") or t.get("name") or ""

    apps, pf, pj, tm = f.get("apps"), f.get("portfolios"), f.get("journeys"), f.get("teams")
    storm_id = f.get("topAlertStormId")
    storm_kids = f.get("topAlertStormChildren")

    # 风暴锚点应用：优先 topStorm.appName，退回事件量最高的那个
    anchor = (s.get("topStorm") or {}).get("appName")
    if not anchor and s.get("apps"):
        anchor = max(s["apps"], key=lambda a: a.get("incidentsTotal", 0)).get("label")

    crit = lb.get("criticalCaption") or "Critical"
    pairs = [
        (LEGACY["title"], f"SIP · The Constellation · {name}"),
        (LEGACY["meta"],
         f"The 3D estate constellation · {apps} apps · {pf} portfolios · "
         f"{pj} journeys · {tm} teams. The substrate the agent fleet operates on."),
        (LEGACY["subtitle"],
         f"The {name} operational fabric · {apps} apps across {pf} portfolios + "
         f"{pj} journeys, the support team layer, the agent fleet, and the "
         f"cross-cutting events. Click any node to inspect."),
        (LEGACY["pf_all"], f"All {pf}"),
        (LEGACY["pf_desc"], f"{pf} portfolios across {pj} journeys"),
        (LEGACY["top_inc"], f"Top 10 by incidents · {_num(f.get('incidents'))}"),
        (LEGACY["top_chg"], f"Top 10 by changes · {_num(f.get('changes'))}"),
        (LEGACY["wms_desc"], f"The {storm_kids:,}-child storm origin" if storm_kids else None),
        (LEGACY["wms_view"], f"{anchor} · the spotlight node" if anchor else None),
        (LEGACY["storm_view"],
         f"{storm_id} · {storm_kids:,}-child blast radius" if storm_id and storm_kids else None),
        (LEGACY["hol_label"], crit),
        (LEGACY["hol_desc"],
         f"Apps in the {lb['peakSeasonNoun']} path" if lb.get("peakSeasonNoun") else None),
    ]
    if f.get("emergencyBackoutRate") and f.get("standardBackoutRate"):
        mult = f.get("emergencyBackoutMultiplier")
        pairs.append((LEGACY["backout"],
                      f"Emergency changes back out at {_pct(f['emergencyBackoutRate'])} vs "
                      f"Standard {_pct(f['standardBackoutRate'])}"
                      + (f" — the canonical {mult:.0f}× differential." if mult else "")))

    # WMS 按钮标签：租户没有 WMS 就指向它自己的风暴锚点
    if anchor:
        pairs.append((LEGACY["wms_label"], f"{anchor} spotlight"))

    # 加载页 / 搜索框的「N apps · N portfolios · N journeys · N agents」
    ag = s.get("agents") or {}
    n_ag = sum(len(v) for v in ag.values() if isinstance(v, list))
    counts = f"{apps} apps · {pf} portfolios · {pj} journeys"
    if n_ag:
        counts += f" · {n_ag} agents"
    pairs.append((LEGACY["counts"], counts))
    pairs.append((LEGACY["counts_nav"],
                  f"{apps} apps · {pf} portfolios · {pj} journeys · {tm} teams"))

    if lb.get("criticalCaption") and lb.get("peakSeasonNoun"):
        pairs.append((LEGACY["t1h_desc"],
                      f"Highest-criticality + {lb['peakSeasonNoun']} apps"))

    out = []
    for a, b in pairs:
        if a and b and a != b:
            out.append([a, b])
    return out


def build_map(all_tenants: dict) -> dict:
    return {tid: tenant_pairs(d) for tid, d in all_tenants.items()}


# ── 切换面板的租户清单（必须改 JS，DOM 改写够不着）─────────────────────

SWITCHER_FILE = "0aed4f89z1emu.js"
SWITCHER_HEAD = 'let c=[{id:"best-buy-reference"'


def _array_span(t: str, start: int) -> int:
    """从 `[` 开始做括号配对，返回匹配的 `]` 下标（跳过字符串字面量）。"""
    i, depth, q = start, 0, None
    while i < len(t):
        ch = t[i]
        if q:
            if ch == "\\":
                i += 2
                continue
            if ch == q:
                q = None
        elif ch in "\"'":
            q = ch
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def patch_switcher(chunks_dir, all_tenants: dict) -> list:
    """
    切换面板（Shift+S）的租户清单是**写死的 10 条**，新租户不在里面就选不到 ——
    `?tenant=<新id>` 能打开，但面板里找不到它。把缺的补到数组末尾。

    已有条目的 label 是手写的（如 "Best Buy · reference"），无法从数据推导，
    所以只**追加**缺失的，不动现有的。
    """
    import json
    f = chunks_dir / SWITCHER_FILE
    if not f.is_file():
        return []
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    k = t.find(SWITCHER_HEAD)
    if k < 0:
        return []                                   # 站点改版了 → 静默跳过
    br = t.index("[", k)
    end = _array_span(t, br)
    if end < 0:
        return []
    have = set(re.findall(r'\{id:"([^"]+)"', t[br:end]))
    missing = []
    for tid, d in all_tenants.items():
        if tid in have:
            continue
        nt = d.get("tenant", {})
        disp = ((nt.get("client") or {}).get("displayName")
                or nt.get("name") or tid)
        missing.append({"id": tid, "label": disp,
                        "industry": nt.get("industry") or "",
                        "client": disp})
    if not missing:
        return []
    add = "".join("," + json.dumps(x, ensure_ascii=False, separators=(",", ":"))
                  for x in missing)
    f.write_text(t[:end] + add + t[end:], encoding="utf-8",
                 errors="surrogateescape")
    return [x["id"] for x in missing]


# ── 注入到页面的运行时改写器 ─────────────────────────────────────────

REWRITER = r"""
<script id="sip-tenant-copy">
/* 按 active tenant 改写写死的外壳文案。见 tools/tenant_copy.py 的说明。 */
(function () {
  var MAP = window.__SIPCOPY__ || {};
  var ATTRS = ['title', 'placeholder', 'aria-label'];
  function activeId() {
    try {
      var t = localStorage.getItem('sip-active-tenant');
      if (t && MAP[t]) return t;
    } catch (e) {}
    return 'retail';
  }
  function sub(s, pairs) {
    for (var i = 0; i < pairs.length; i++) {
      var f = pairs[i][0], r = pairs[i][1];
      /* 替换值里若含原文会自我循环 —— 用 indexOf 判存，天然幂等 */
      if (f && s.indexOf(f) !== -1) s = s.split(f).join(r);
    }
    return s;
  }
  function run() {
    var pairs = MAP[activeId()];
    if (!pairs || !pairs.length) return;
    try {
      /* <title> 和 meta description —— 不需要 body */
      if (document.title) {
        var nt = sub(document.title, pairs);
        if (nt !== document.title) document.title = nt;
      }
      var md = document.querySelector('meta[name="description"]');
      if (md) {
        var nm = sub(md.getAttribute('content') || '', pairs);
        if (nm !== md.getAttribute('content')) md.setAttribute('content', nm);
      }
      /* ★ 本脚本注入在 <head>，首次执行时 body 还不存在 ——
         createTreeWalker(null) 会抛 TypeError。必须挡在这里。 */
      if (!document.body) return;
      /* 文本节点 */
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var n, hits = [];
      while ((n = w.nextNode())) {
        if (n.nodeValue && n.nodeValue.length > 3) hits.push(n);
      }
      for (var i = 0; i < hits.length; i++) {
        var v = sub(hits[i].nodeValue, pairs);
        if (v !== hits[i].nodeValue) hits[i].nodeValue = v;
      }
      /* 属性 —— placeholder 也是文案（搜索框那句 "Search 893 apps …" 就在这儿，
         不是文本节点，只走 TreeWalker 会漏） */
      var els = document.querySelectorAll('[title],[placeholder],[aria-label]');
      for (var j = 0; j < els.length; j++) {
        for (var k = 0; k < ATTRS.length; k++) {
          var an = ATTRS[k], a = els[j].getAttribute(an);
          if (!a) continue;
          var b = sub(a, pairs);
          if (b !== a) els[j].setAttribute(an, b);
        }
      }
    } catch (e) { /* 单次失败不能影响后续重试 */ }
  }
  /* ★ 先注册全部兜底，再跑第一次 ——
     顺序反过来的话，第一次抛异常会把注册代码整段带走（踩过）。 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  }
  window.addEventListener('load', run);
  /* React 水合后还会渲染一次，且筛选面板会重渲染 —— 观察兜住。
     替换是幂等的（原文替换完就没了），所以不会自激。 */
  var pending = null;
  new MutationObserver(function () {
    if (pending) return;
    pending = setTimeout(function () { pending = null; run(); }, 120);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  [0, 150, 400, 900, 1800, 3500].forEach(function (ms) { setTimeout(run, ms); });
  run();
})();
</script>
"""


def inject(html: str, all_tenants: dict) -> tuple:
    """
    往 <head> 里注入 __SIPCOPY__ + 改写器。返回 (新 html, 是否有改动)。

    __SIPCOPY__ 用 json 内联 —— 11 个租户 × 十几条，体积可忽略。
    """
    import json
    if "sip-tenant-copy" in html:
        return html, False
    m = build_map(all_tenants)
    n = sum(len(v) for v in m.values())
    blob = (
        "<script>window.__SIPCOPY__="
        + json.dumps(m, ensure_ascii=False).replace("</", "<\\/")
        + ";</script>" + REWRITER
    )
    html = re.sub(r"(</head>)", blob + r"\1", html, count=1)
    return html, n
