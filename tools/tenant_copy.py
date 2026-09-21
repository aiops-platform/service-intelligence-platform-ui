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

    ?tenant=<id>  →  localStorage["sip-active-tenant"]  →  兜底 DT_DEFAULT（站点原生是 "retail"）

构建时烤死任何一个租户的值，切到别的租户就是错的。所以改成：
构建时把**每个租户**的文案算好注入 `window.__SIPCOPY__`，运行时按 active tenant 改写 DOM。

> ⚠️ 那个兜底有**两个消费方**：内嵌页自己的取数（`patch_default_tenant` 把它从
> 站点原生的 `retail` 改成了 `otr`）和本文件的改写器。两者必须是同一个值 ——
> 否则「没设过租户」时数据按 otr 渲染、文案按 retail 改写，同一页出现两套数字。
> 现在两边都取 `DT_DEFAULT`（改写器里是 `__DT_DEFAULT__` 占位符，由 inject() 填）。

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
    # Business Ops 的 "Avg Journey XLA" KPI 副标题 —— `across 6 journeys · N incidents/day`
    # 后半段是算出来的，前半段的 6 写死
    "xla_sub": "across 6 journeys",
    # 拼写形式的数字（不是阿拉伯数字）—— 光扫 \d+ 会漏掉这类
    "six_card": "Six journeys · click to inspect · column headers sort",
    "all_six": "All six journeys · the full estate",

    # ── Architecture 面板（/architecture）────────────────────────────────
    # 这三条同样是**写死的 data-sicg 数字**，且都是 DOM 里的文本/属性，走同一套改写器。
    # 页面其余部分（KPI 四格、6R 分布、Tech stack、Wave plan）都读 snapshot，本来就是
    # 按租户算的 —— 只有这三处不跟着变，于是切到别的租户会出现
    # 「标题说 893 apps / 22 portfolios，正下方的 KPI 说 50 apps / 11 portfolios」。
    # 字面量在页面自己的 chunk `01d8-2wl~-f7r.js` 里（PanelContainer 的 description
    # 与 Estate graph 小节），**不在** server.html 的 RSC payload 里 —— 但改写器只认
    # 渲染后的 DOM 文本/属性，源码在哪儿都无所谓。
    "arch_desc": ("893 apps · 22 portfolios · 6 journeys · the estate as one canvas. "
                  "Architecture decisions, modernization wave plan, ADR drift — "
                  "agent-augmented."),
    "arch_sub": ("22 portfolios · click any node to inspect · "
                 "KPIs / 6R / journeys filter the graph"),
    # 图的 aria-label。改写器的属性白名单里有 aria-label，所以能改到（见 REWRITER）。
    "arch_aria": "Estate graph · 22 portfolios with edge layers",

    # Security Ops 面板：case 列表 / agent feed / With-Without-agents 对照条里写死的是
    # **best-buy 那次告警风暴**（`INC13075702`，1,809 个子事件）。
    # 这两条是**裸串**而不是整句 —— 见 tenant_pairs() 里那段说明：在这一页里
    # 这两个串每一次出现都指同一场风暴（逐条核对过：事故号 5 处、数字 4 处），
    # 所以裸串替换就是全覆盖，含那个渲染成裸数字的 `childEvents` chip。
    "sec_storm": "INC13075702",
    "sec_storm_kids": "1,809",
}

# 拼写数字：用词而不是阿拉伯数字，这样 retail（6 条）不会被从 "Six" 改成 "6" ——
# 替换值等于原文时该条就不产出，retail 的文案原样保留。
_WORDS = {1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six",
          7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten"}


def _word(n):
    return _WORDS.get(n, str(n))


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

    if pj:
        pairs.append((LEGACY["xla_sub"], f"across {pj} journeys"))
        pairs.append((LEGACY["six_card"],
                      f"{_word(pj)} journeys · click to inspect · column headers sort"))
        pairs.append((LEGACY["all_six"],
                      f"All {_word(pj).lower()} journeys · the full estate"))

    # Architecture 面板：三段写死的 sicg 数字换成该租户自己的三个数。
    # 三个数缺一不可 —— 只换一部分会拼出「50 apps · 22 portfolios · 2 journeys」这种
    # 自相矛盾的句子，比不换更糟，所以整条一起产出。
    if apps and pf and pj:
        pairs.append((LEGACY["arch_desc"],
                      f"{apps} apps · {pf} portfolios · {pj} journeys · the estate as one "
                      f"canvas. Architecture decisions, modernization wave plan, ADR drift — "
                      f"agent-augmented."))
        pairs.append((LEGACY["arch_sub"],
                      f"{pf} portfolios · click any node to inspect · "
                      f"KPIs / 6R / journeys filter the graph"))
        pairs.append((LEGACY["arch_aria"], f"Estate graph · {pf} portfolios with edge layers"))

    # Security Ops 面板：把写死的那场风暴换成本租户自己的。
    #
    # 这一页的 KPI 格「Top alert storm」**读的是 REAL**（运行期从 snapshot 算），
    # 而它正下方的 case 列表 / agent feed 是写死的 best-buy 数据 —— 于是切到任何
    # 别的租户，一格之内就会出现「KPI 说 INC-MBR-77104 · 159」+「下面的 case 说
    # INC13075702 · 1,809 个子事件」这种自相矛盾。这里修的就是这个。
    #
    # ⚠ 用**裸串**而不是整句，是因为这两串在本页每一次出现都是同一场风暴：
    #     事故号 5 处：SEC-1809 的 description / rootCause、SEC-2034 的 description、
    #                 agent feed 两条 action
    #     数字   4 处：SEC-1809 的 childEvents（渲染成裸「1,809」chip）、
    #                 agent feed 一条 action、With/Without-agents 对照条两个 <strong>
    #   整句替换只能覆盖其中一部分，裸串一次全覆盖；两串互不包含，所以顺序无关。
    #   逐句列出反而更脆：站点改一个字就静默失配（本文件的原则是「不唯一就跳过」）。
    #
    # 保留不动的：`pricing-batch deadlock cascade`（SEC-1809 的 root cause）——
    #   它在**任何**租户的 estate 里都不是 app，是叙事文案，不是写死的租户数据。
    if storm_id and storm_kids:
        pairs.append((LEGACY["sec_storm"], storm_id))
        pairs.append((LEGACY["sec_storm_kids"], f"{storm_kids:,}"))

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


# journey 槽位写死成 6 个 —— 见 patch_journey_slots()
#
# 同一根因在本仓出现过**两处**，症状不同、文件不同，所以做成表驱动而不是两个函数：
#   1. Business Ops 的 journey 表  → 多出 4 行空行
#   2. 服务概览页顶部筛选框的 chip  → 多出 4 个 `JOURNEY 3…6 · 0`
# 每一项是 (标签, 文件, 原串, 替换串)。
JOURNEY_SLOTS = [
    ("Business Ops journey 表", "0pfw3-ib1qee0.js",
     "let h=[1,2,3,4,5,6].map(",
     "let h=e.snapshot.journeys.map((_,i)=>i+1).map("),
    ("服务概览页筛选框", "0t1fyt7wcotiz.js",
     "let p=[1,2,3,4,5,6].map(e=>c(u(e)",
     "let p=t.snapshot.journeys.map((_,i)=>i+1).map(e=>c(u(e)"),
]


def patch_journey_slots(chunks_dir) -> list:
    """
    页面把 journey 槽位写死成 6 个，两处都改成按 `snapshot.journeys` 自适应。

    两处的代码形状完全一样（只是 minify 后的变量名不同）：

        function u(t){ let n=….snapshot.journeys.find(e=>e.id===`journey:${t}`); return n?.label??`Journey ${t}` }
        let h=[1,2,3,4,5,6].map(t=>…)        // ← 写死 6 个槽位

    原有 10 个租户**恰好都是 6 条 journey**，所以从没暴露。租户少于此数时，多出来的槽位
    在 `snapshot.journeys` 里查不到，就退回字面量 `` `Journey ${n}` `` —— 于是：

    - Business Ops 的 journey 表渲染出 4 行空的 `Journey 3`…`Journey 6`（各 0 apps）
    - 服务概览页顶部筛选框渲染出 4 个 `JOURNEY 3 · 0` … `JOURNEY 6 · 0` 的 chip

    **不改数据去迁就硬编码** —— 编造 journey 会伪造客户的业务结构。
    改成按 `snapshot.journeys.length` 自适应，对任何租户都成立：租户有几条就渲染几条。

    返回**已修补的标签列表**（空列表 = 都没打）。每一项都是幂等的：
    已打过就跳过；站点改版导致原串不唯一也静默跳过，不会把页面改坏。
    """
    done = []
    for label, name, find, repl in JOURNEY_SLOTS:
        f = chunks_dir / name
        if not f.is_file():
            continue
        t = f.read_text(encoding="utf-8", errors="surrogateescape")
        if repl in t:
            continue                                # 已打过
        if t.count(find) != 1:
            continue                                # 站点改版/已不是唯一 → 静默跳过
        f.write_text(t.replace(find, repl),
                     encoding="utf-8", errors="surrogateescape")
        done.append(label)
    return done


# Business Ops / Constellation 的域选择器：Cross-Journey 兜底桶 —— 见 patch_cross_journey()
CJ_FILE = "0pfw3-ib1qee0.js"
CJ_FIND = ',{id:"cross-journey",label:"Cross-Journey"}]'
CJ_REPL = (',...(e.snapshot.portfolios.some(p=>!p.journeyId||"journey:null"===p.journeyId)'
           '?[{id:"cross-journey",label:"Cross-Journey"}]:[])]')


def patch_cross_journey(chunks_dir) -> bool:
    """
    域选择器里有一项 `Cross-Journey`，它是**兜底桶** —— 装 `journeyId` 为
    `null` / `"journey:null"` / `""` 的组合（企业级支撑组合，本来就不挂客户旅程）：

        m = d("cross-journey", …, t => null==t || "journey:null"===t || ""===t)

    但这一项**永远显示**，即使桶里 0 个组合。mb-retail 的 11 个组合全部挂了 journey，
    点进去是空的。原有租户里 bunnings(5)/qantas(4)/data-sicg(1) 有内容，
    retail 也有（`portfolio:real-estate`）—— 所以**不能无条件删**。

    改成按数据判断：桶空才不显示，对任何租户都成立。

    判据直接内联原来那句（`!x` 覆盖 null/undefined/""），不依赖 `m` 的返回结构。
    """
    f = chunks_dir / CJ_FILE
    if not f.is_file():
        return False
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    if CJ_REPL in t:
        return False                                # 已打过
    if t.count(CJ_FIND) != 1:
        return False                                # 站点改版/不唯一 → 静默跳过
    f.write_text(t.replace(CJ_FIND, CJ_REPL),
                 encoding="utf-8", errors="surrogateescape")
    return True


# Business Ops 面板末尾的 "Ask SIP · Operational executive view" 卡片 —— 见 patch_ask_sip()
AS_FILE = "00tsl~72wvlrr.js"
AS_FIND = (',(0,t.jsxs)(n.Card,{className:"mt-4",children:[(0,t.jsx)(n.CardTitle,'
           '{icon:"\U0001f4ac",children:"Ask SIP · Operational executive view"})')
AS_REPL = (',null&&(0,t.jsxs)(n.Card,{className:"mt-4",children:[(0,t.jsx)(n.CardTitle,'
           '{icon:"\U0001f4ac",children:"Ask SIP · Operational executive view"})')


def patch_ask_sip(chunks_dir) -> bool:
    """
    隐藏 Business Ops 面板末尾的 "Ask SIP · Operational executive view" 卡片。

    组件 `g()` 的返回是个**逗号表达式**（不是普通的 `return jsx`）：

        return (0,r.useEffect)(…),[e,l]),(0,t.jsxs)(n.Card,{className:"mt-4",…})

    所以往第二个操作数前面插 `null&&` 即可 —— 逗号表达式整体返回 null，卡片不渲染：

        return (useEffect(…), null && Card)   →   null

    **React hooks 仍然照常执行**（它们在 return 之前），不破坏 hooks 顺序 ——
    比「让组件整体 return null」更稳。

    只在 Business Ops 出现（实测 Constellation 页面的 DOM 里 Ask SIP 为 0 次），
    但 `00tsl~72wvlrr.js` 是两页共享 chunk，所以这个替换对两页都生效 ——
    对 Constellation 无影响（它本来就不渲染这个卡片）。
    """
    f = chunks_dir / AS_FILE
    if not f.is_file():
        return False
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    if AS_REPL in t:
        return False                                # 已打过
    if t.count(AS_FIND) != 1:
        return False                                # 站点改版/不唯一 → 静默跳过
    f.write_text(t.replace(AS_FIND, AS_REPL),
                 encoding="utf-8", errors="surrogateescape")
    return True


# Business Ops journey 表的行内「名字」单元格 —— 见 patch_journey_name_drill()
JND_FILE = "00tsl~72wvlrr.js"       # 与 AS_FILE 同一个文件（两页共享 chunk）
JND_FIND = (
    '(0,t.jsxs)("div",{children:[(0,t.jsx)("div",{style:{fontFamily:"var(--font-display)",'
    'fontSize:13,fontWeight:600,color:"var(--text-primary)",lineHeight:1.2},'
    'children:e.isCrossJourney?"Cross-Journey":e.domain.label})'
)
JND_REPL = (
    '(0,t.jsxs)("div",{onClick:e=>{e.stopPropagation(),i()},'
    'title:"Drill into "+e.domain.label,style:{cursor:"pointer"},children:['
    '(0,t.jsx)("div",{style:{fontFamily:"var(--font-display)",'
    'fontSize:13,fontWeight:600,color:"var(--text-primary)",lineHeight:1.2},'
    'children:e.isCrossJourney?"Cross-Journey":e.domain.label})'
)


def patch_journey_name_drill(chunks_dir) -> bool:
    """
    把 journey 表行内**名字**的点击行为从「选中」改成「下钻」。

    行组件 `w()` 收到 `onSelect` 和 `onDrill` 两个回调，三个点击面分工如下：

        <div role="button" onClick={onSelect}>            ← 整行：选中 → 右侧 inspector
          <span/>                                          ← 胶囊（HC / HT / ⊙）
          <div>名字 + 副标题</div>                          ← ★ 本次改这里
          …XLA / Apps / Inc/d / Bot %…
          <span role="button" onClick={stopPropagation,onDrill}>›</span>   ← 行尾箭头：下钻
        </div>

    名字本来是个普通 div，点击冒泡到整行 → 只选中，顶部筛选框仍停在 Enterprise。
    改法是把行尾箭头那一套**原样搬过来**：`onClick:e=>{e.stopPropagation(),i()}`，
    `i` 就是这个组件已经收到的 `onDrill` —— 不新增状态、不新增回调。

    ## 为什么改 JS，而不是像租户文案那样做 DOM 改写

    下钻要用**该行的 domain id**（`onDrill` 内部就是按 id 调 `findDomain`）。DOM 层要复现，
    只能拿名字文本去顶部筛选框里找同名按钮再 `.click()` —— 那等于把「文案」当成「标识」，
    改标签/换语言就断；而 id 是数据里现成的。这里要接的是事件，不是文案，DOM 改写没有优势。

    ## 锚点

    必须带上 `children:e.isCrossJourney?…` 才唯一 —— 同一个 style 前缀在组件 `A()`
    （组合行）里还有一份。`title` 里的 `e` 是渲染作用域的（此时仍是行 prop；箭头参数 `e`
    只在箭头体内遮蔽），文案与行尾箭头逐字一致，所以**不必给 cross-journey 行分支**。

    返回是否打过。幂等：已打过跳过；站点改版导致原串不唯一也静默跳过
    （行为退回改动前，不会把页面改坏）。
    """
    f = chunks_dir / JND_FILE
    if not f.is_file():
        return False
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    if JND_REPL in t:
        return False                                # 已打过
    if t.count(JND_FIND) != 1:
        return False                                # 站点改版/不唯一 → 静默跳过
    f.write_text(t.replace(JND_FIND, JND_REPL),
                 encoding="utf-8", errors="surrogateescape")
    return True


# Service Ops 里指向 `/entity/app/<slug>/` 的两个链接 —— 见 patch_service_ops_entity_links()
#
# 该路径是**部署站**的实体详情页，从来没被导出进离线副本（public/ 下只有
# constellation-app.html / business-ops/ / service-ops/）。点它会掉进宿主的 SPA 兜底，
# 于是 Service Ops 的 iframe 里渲染出 Vue 应用自己 —— 自己套自己。
SEL_FILE = "0t1fyt7wcotiz.js"
SEL_ROW_FIND = (
    '(0,n.jsx)("a",{href:`/entity/app/${(0,u.appKeySlug)(e.appKey)}/`,'
    'onClick:e=>e.stopPropagation(),title:`Open ${e.label} detail page`,'
    'style:{textAlign:"center",color:"var(--text-tertiary)",fontSize:14,fontWeight:600,'
    'textDecoration:"none"},children:"›"})'
)
# `i` 是行组件 `({app:e,rank:t,selected:r,onSelect:i,…})` 的 onSelect ——
# 就是整行 `onClick:i` 用的那个。改成点一下开 inspector，与点行同效。
SEL_ROW_REPL = (
    '(0,n.jsx)("a",{href:"#",onClick:e=>{e.preventDefault(),e.stopPropagation(),i()},'
    'title:`Show ${e.label} details`,'
    'style:{textAlign:"center",color:"var(--text-tertiary)",fontSize:14,fontWeight:600,'
    'textDecoration:"none"},children:"›"})'
)
SEL_FOOT_FIND = (
    '(0,n.jsxs)("a",{href:`/entity/app/${(0,u.appKeySlug)(e.appKey)}/`,'
    'style:{color:"var(--electric-500, #3b82f6)"},'
    'children:["→ Open detail · /entity/app/",e.appKey]})'
)
# 这一条在 inspector 页脚，此时该 app **已经**选中、面板已经开着 —— 没有可跳的目标，
# 也没有可再选中的东西。所以整条去掉，而不是留一个「点了没反应」的死链。
SEL_FOOT_REPL = 'null'


def patch_service_ops_entity_links(chunks_dir) -> str:
    """
    拆掉 Service Ops 里两个指向 `/entity/app/<slug>/` 的链接 —— 那条路由**离线副本里没有**。

    ## 症状：多层 Vue 应用自己套自己

    行尾 `›` 本来是个普通 `<a href="/entity/app/<slug>/">`（不是 Next 的 `<Link>`，
    所以走的是**整页导航**）。点击后 iframe 导航到该路径，而：

        public/ 下只有 constellation-app.html / business-ops/ / service-ops/
        `sipEmbedPageIndex` 只拦尾斜杠的 /business-ops/ 与 /service-ops/

    → `/entity/app/xentry-work-order/` 落进 Vite 的 **SPA 兜底**，返回 Vue 应用自己的
    index.html；vue-router 的 catch-all (`/:pathMatch(.*)*`) 再重定向到 `/service-ops`
    → ServiceOpsView 又渲染一个 `/service-ops/` 的 iframe。**在 Service Ops 里看到了
    Service Ops**，每点一次多套一层。生产 nginx 的 `try_files $uri $uri/ /index.html`
    一模一样。

    ## 两个锚点的处置不同

    ① 表格行尾 `›`（`title: Open … detail page`）：改成 `preventDefault` + 调本行已有的
       `onSelect`（`i`）→ 打开右侧 inspector。**不跳转**，所以用户设的筛选
       （journey / portfolio / tier / HC / bot）不会因为整页重载丢掉。
       没有换成 `/service-ops/?app=<key>` 那条深链，就是为了这个：那条会重载 iframe。

    ② inspector 页脚的 `→ Open detail · /entity/app/…`：此时面板**已经**开着，
       既没有可跳的目标也没有可再选中的东西 —— 整条去掉。留一个点了没反应的死链
       比没有更糟（正是本仓 CLAUDE.md 反复点名的「静默失败」）。

    ## 为什么改 JS 而不是在宿主侧拦

    宿主侧只能靠「猜哪些路径算外部路由」来 404（`/entity/` 只是今天已知的那一个），
    而链接在编译产物里是明摆着的。宿主那条兜底另有其事 —— 见 `NextEmbed.vue`
    的 `inSameOriginFrame()`：**任何**原因导致宿主被套进自己的 iframe，它都不再往下渲染。

    返回状态字符串（同 SPF 约定）：`"applied"` / `"already"` / 其它为跳过原因。
    """
    f = chunks_dir / SEL_FILE
    if not f.is_file():
        return f"找不到 {SEL_FILE}"
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    # 幂等判据：行尾 › 已换成新版，**且**页脚那条锚点已经不在（换成了 `null`）。
    # 不能拿 SEL_FOOT_REPL（就是字面量 `null`）去判断在不在 —— 它处处都在。
    if SEL_ROW_REPL in t and SEL_FOOT_FIND not in t:
        return "already"
    bad = []
    if t.count(SEL_ROW_FIND) != 1:
        bad.append("行尾 ›")
    if t.count(SEL_FOOT_FIND) != 1:
        bad.append("inspector 页脚")
    if bad:
        return "锚点失效（站点改版？）：" + "、".join(bad)
    t = t.replace(SEL_ROW_FIND, SEL_ROW_REPL, 1).replace(SEL_FOOT_FIND, SEL_FOOT_REPL, 1)
    f.write_text(t, encoding="utf-8", errors="surrogateescape")
    return "applied"


# Service Ops 筛选条的 Portfolio 筛选 —— 见 patch_service_ops_portfolio_filter()
#
# ★ 本仓**唯一的多点补丁**：下面 9 处必须整组生效，所以不走「不唯一就静默跳过」那套，
#   改成「9 个锚点全部校验通过才落笔」—— 只打一半会 ReferenceError 整页白屏。
SPF_FILE = "0t1fyt7wcotiz.js"
SPF_SITES = [
    (
        "① 新增 portfolio 选中态",
        '[$,E]=(0,o.useState)(new Set)',
        '[$,E]=(0,o.useState)(new Set),[pfSel,pfToggle]=(0,o.useState)(new Set)',
    ),
    (
        "② 谓词：选中 journey 内再按 portfolio 过滤",
        'if($.size>0){let t=x.get(e.portfolioId);if(!t||!$.has(t))return!1}return!0}',
        'if($.size>0){let t=x.get(e.portfolioId);if(!t||!$.has(t))return!1;'
        'if(pfSel.size>0&&!pfSel.has(e.portfolioId))return!1}return!0}',
    ),
    (
        "③ useMemo 依赖数组补 pfSel",
        ',[w,F,I,$])',
        ',[w,F,I,$,pfSel])',
    ),
    (
        "④ anyActive 带上 portfolio 筛选",
        'W=w.size>0||F||I||$.size>0',
        'W=w.size>0||F||I||$.size>0||pfSel.size>0',
    ),
    (
        "⑤ onReset 一并清空 portfolio 选择",
        'onReset:()=>{M(new Set),A(!1),L(!1),E(new Set)}',
        'onReset:()=>{M(new Set),A(!1),L(!1),E(new Set),pfToggle(new Set)}',
    ),
    (
        "⑥ 切 journey 时清空 portfolio 选择",
        'onToggleJourney:e=>E(t=>{let r=new Set(t);return r.has(e)?r.delete(e):r.add(e),r})',
        'onToggleJourney:e=>{E(t=>{let r=new Set(t);return r.has(e)?r.delete(e):r.add(e),r}),'
        'pfToggle(new Set)}',
    ),
    (
        "⑦ 调用处传两个新 prop（toggle 要在父组件里包一层 Set 更新）",
        'lowBotOnly:I,journeyFilter:$,',
        'lowBotOnly:I,journeyFilter:$,portfolioFilter:pfSel,'
        'onTogglePortfolio:e=>pfToggle(t=>{let r=new Set(t);'
        'return r.has(e)?r.delete(e):r.add(e),r}),',
    ),
    (
        "⑧ 筛选条解构接这两个 prop",
        'onToggleJourney:l,anyActive:d,onReset:u,filteredCount:p}){',
        'onToggleJourney:l,anyActive:d,onReset:u,filteredCount:p,'
        'portfolioFilter:pfP,onTogglePortfolio:pfT}){',
    ),
    (
        "⑨ journey chips 之后渲染 portfolio chips",
        'b.map(e=>(0,n.jsx)(h,{label:e.label,active:i.has(e.id),'
        'count:k.byJourney.get(e.id)??0,onClick:()=>l(e.id)},e.id))',
        'b.map(e=>(0,n.jsx)(h,{label:e.label,active:i.has(e.id),'
        'count:k.byJourney.get(e.id)??0,onClick:()=>l(e.id)},e.id)),'
        'i.size>0&&(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)(w,{}),'
        'g.JOURNEY_DOMAINS.filter(e=>i.has(e.id)).flatMap(e=>e.portfolios)'
        '.map(e=>(0,n.jsx)(h,{label:e.label,active:pfP.has(e.id),count:e.appCount,'
        'onClick:()=>pfT(e.id)},e.id))]})',
    ),
]


def patch_service_ops_portfolio_filter(chunks_dir) -> str:
    """
    在 Service Ops 概览页的筛选条里，journey 那组 chip **后面**加一组 portfolio chip：
    只列出**当前选中 journey 名下的** portfolio，点它就在该 journey 内再按 portfolio 过滤。

        Filter │ All · 50 │ T1 T2 T3 │ PS · 21  Bot<50% · 0 │ Sales… · 28  Customer… · 22
                                                             └─ 选中 Sales… 之后 ↓
        Filter │ … │ Sales… · 28 │ ─── Lead · 7  Offer&Order · 5  Handover · 5 …

    ## 三条产品口径（已确认）

    1. **没选任何 journey 时不渲染这组 chip**（严格「由 journey 决定有哪些 portfolio」）；
    2. **切换 journey 时清空已选 portfolio**（⑥）—— 否则会出现「chip 看不见、却仍在筛」的
       幽灵筛选，最坏情况列表直接变空；
    3. 组前只加一根现有分隔符，不加组标签。

    ## 数据与控件都是复用，不是新造

    - portfolio 列表：模块级 `g.JOURNEY_DOMAINS[].portfolios[]`（域构造函数里从
      `snapshot.portfolios` 现算的），每项自带 `id` / `label` / `appCount`，
      且**已按 incidentsTotal 降序**，与 journey chip 的顺序口径一致；
    - chip 组件是本文件里的 `h`（`{label,active,count,onClick}`），分隔符是 `w`，
      都与左邻右舍同一套；
    - 计数口径与 journey chip 一致：静态的「该 portfolio 有几个 app」（`k` 那套计数同样是静态的）。

    ## 为什么必须 9 处一起改

    `pfSel` 这个新状态要穿过「定义 → 过滤谓词 → useMemo 依赖 → anyActive 徽标 → 重置 →
    journey 联动 → 父组件传参 → 子组件解构 → 渲染」。**只打一半的后果不一样**：

        / 少 ①（状态没定义）→ `pfSel is not defined` → **整页白屏**
        / 少 ③（依赖没补）  → 筛选生效但列表不重算（要等别的状态变化才刷新）
        / 少 ⑤（All 没清）  → 幽灵筛选：UI 看着全清空了，列表却还是被 portfolio 卡着

    所以本函数**先全量校验 9 个锚点、全部命中才落笔**，任一缺失就整组跳过 —— 与单点补丁
    「不唯一就静默跳过」的约定不同（那里是「功能不见了」，这里是「页面坏了」）。

    ## ⑦ 为什么要包一层：`useState` 的 setter 不能直接喂 id（踩过）

    最初 ⑦ 图省事写成 `onTogglePortfolio:pfToggle`，chip 里 `pfT(e.id)` 于是调用
    `pfToggle("portfolio:lead")` —— setter 收到**非函数值就整体替换 state**，
    state 从 Set 变成字符串，下一次渲染 `pfP.has(...)` 立刻 `TypeError` 崩。

    既有那几个 toggle 全都在**父组件**里包一层，正是这个原因：

        onToggleJourney:e=>E(t=>{let r=new Set(t);return r.has(e)?r.delete(e):r.add(e),r})

    —— id 进、Set 内的增删在 updater 里做，setter 永远只收到函数。新加的这一处必须照抄
    这个形状。（静态检查、`node --check` 都发现不了这个错：它只在真点上那一下才炸。）

    ## 为什么不做 DOM 改写

    这是个**有状态**的筛选：点 chip 要驱动 React 的筛选谓词重算。DOM 层注入的 chip 没有
    任何途径去改 React state（既不能伪造出「选中某个 portfolio」的既有事件，也没有 id 可传），
    所以只能改 JS。这与「租户文案」那类纯文本改写不同。

    ## 已知边界

    若某个 journey 名下 0 个 portfolio（12 个租户实测均无），选中它时会多出一根**孤立的
    分隔符** —— 纯外观、无害。为它加守卫要在压缩代码里引入一个 IIFE 或重复一遍域名过滤
    表达式，不划算，故不加。

    返回状态字符串：`"applied"` / `"already"` / 其它为跳过原因（构建脚本会把非 already
    的情况打出来 —— 这个补丁**不能静默失效**，否则功能会凭空消失且无人察觉）。
    """
    f = chunks_dir / SPF_FILE
    if not f.is_file():
        return f"找不到 {SPF_FILE}"
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    if all(repl in t for _, _, repl in SPF_SITES):
        return "already"
    missing = [label for label, find, repl in SPF_SITES
               if repl not in t and t.count(find) != 1]
    if missing:
        return "锚点失效（站点改版？）：" + "、".join(missing)
    for _, find, repl in SPF_SITES:
        t = t.replace(find, repl, 1)
    f.write_text(t, encoding="utf-8", errors="surrogateescape")
    return "applied"


# Business Ops 组合表的「名字」→ 跳到 Service Ops —— 见 patch_business_ops_portfolio_jump()
BPJ_FILE = "00tsl~72wvlrr.js"
# 组合 label 里带零宽空格（页面上不显示），原串必须逐字带上，少一个字符就匹配不上
BPJ_ZW = "​"
BPJ_LABEL = 'e.label.replace(/' + BPJ_ZW + '/g,"")'
BPJ_NAME = ('(0,t.jsx)("div",{style:{fontFamily:"var(--font-display)",fontSize:13,'
            'fontWeight:600,color:"var(--text-primary)",lineHeight:1.2},'
            'children:' + BPJ_LABEL + '})')
# 名字那个 div（父 div 的开头）—— 带 children:…replace 才唯一：
# 同一个 style 前缀在 journey 行（组件 w）里还有一份
BPJ_FIND = '(0,t.jsxs)("div",{children:[' + BPJ_NAME
BPJ_REPL = (
    '(0,t.jsxs)("div",{onClick:q=>{q.stopPropagation();window.parent!==window'
    '?window.parent.postMessage({type:"sip:open-service-ops",portfolio:e.id},location.origin)'
    ':location.assign("/service-ops/?portfolio="+encodeURIComponent(e.id))},'
    'title:"Open in Service Ops · "+' + BPJ_LABEL +
    ',style:{cursor:"pointer"},children:[' + BPJ_NAME
)


def patch_business_ops_portfolio_jump(chunks_dir) -> bool:
    """
    Business Ops 的 journey 视图（点 journey 后出现的那张**组合**表）里，
    点**组合名字** → 跳到 Service Ops，并让那边的列表预先按这个 portfolio 过滤。

        <div role="button" onClick={onSelect}>        ← 整行：选中 → 右侧组合 inspector
          <div>名字 + max risk…</div>                 ← ★ 本次改这里
          …XLA / Apps / Inc/d / Bot %…
        </div>

    名字本来是普通 div，点击冒泡到整行只选中。现在改成 stopPropagation + 发消息给父窗口：

        {type:"sip:open-service-ops", portfolio:"portfolio:lead"}

    外壳（`src/composables/useEmbedBridge.js`）收下并 `router.push('/service-ops?portfolio=…')`，
    Service Ops 内嵌页再从这个 query 里把筛选器预置好 —— 三段各自单一职责。

    ## 为什么走 postMessage 而不是 iframe 直接改 parent.location

    后者要整页刷新：Vue 应用重启、legacy 世界（js/app.js 的 17 个 init）重跑、
    其它视图的 KeepAlive 缓存全丢。postMessage + 外壳路由只重载 Service Ops 那一个 iframe。

    ## 单独打开时（没被嵌入）的兜底

    `window.parent === window` 时 postMessage 等于发给自己、没人听，所以退化成整页跳转
    `/service-ops/?portfolio=…`。离线单独看时两个页面同根目录（tools/README 的快速开始
    就是这么用的），这条真能走通。

    ⚠️ 零宽空格：组合 label 里带 U+200B，锚点里那两个字符少一个就匹配不上 —— 所以用
    `BPJ_ZW` 拼出来，不手打。

    返回是否打过。幂等；锚点不唯一（站点改版）则静默跳过 —— 行为退回「点名字只选中」，
    页面不会坏。
    """
    f = chunks_dir / BPJ_FILE
    if not f.is_file():
        return False
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    if BPJ_REPL in t:
        return False                                # 已打过
    if t.count(BPJ_FIND) != 1:
        return False                                # 站点改版/不唯一 → 静默跳过
    f.write_text(t.replace(BPJ_FIND, BPJ_REPL),
                 encoding="utf-8", errors="surrogateescape")
    return True


# Service Ops 的 Portfolio 深链（`?portfolio=`）—— 见 patch_service_ops_portfolio_deeplink()
SDL_FILE = "0t1fyt7wcotiz.js"
SDL_SITES = [
    (
        "① 读 ?portfolio= 参数（复用同一次 useSearchParams）",
        'let e=(0,a.useSearchParams)().get("app"),',
        'let pfU=(0,a.useSearchParams)(),e=pfU.get("app"),pfQ=pfU.get("portfolio"),',
    ),
    (
        "② 落地时预置「所属 journey + 该 portfolio」两项筛选",
        '(0,o.useEffect)(()=>{e&&e!==m&&b(e)},[e])',
        '(0,o.useEffect)(()=>{e&&e!==m&&b(e)},[e]),'
        '(0,o.useEffect)(()=>{if(!pfQ)return;let pfJ=x.get(pfQ);'
        'pfJ&&(E(new Set([pfJ])),pfToggle(new Set([pfQ])))},[pfQ])',
    ),
]


def patch_service_ops_portfolio_deeplink(chunks_dir) -> str:
    """
    让 Service Ops 支持深链 `?portfolio=<portfolioId>`：落地时把筛选器预置成
    「它的 journey + 它自己」，列表于是直接是这个 portfolio 的 app。

    Business Ops 点组合名跳过来时带的就是这个参数（见 `patch_business_ops_portfolio_jump`）。
    之所以**顺带选中它所属的 journey**，是因为 portfolio 筛选按既定口径只在选中 journey 时
    生效（`SPF_SITES` ②）；同时选中也是准确的上下文标记 —— 用户一眼看得出数据来自哪条 journey。

    参数从哪儿来：内层页面自己的 URL。外壳把 query 拼进 iframe 的 src（`ServiceOpsView.vue`），
    所以**路径仍是 `/service-ops/`**，只是多了查询串 —— 实测内层 h1 仍解析成 "Service Ops"，
    不会掉进 `d?.label ?? "SIP"` 那个静默分支。

    ## 前置依赖

    ② 引用了 portfolio 筛选补丁（`patch_service_ops_portfolio_filter`）装上的 `pfToggle`，
    所以本函数**先确认那个补丁已打**（`pfToggle` 在文本里）才动手 —— 否则会打出一个引用
    未定义变量的页面（整页白屏）。构建脚本里两个补丁的调用顺序也是 SPF 在前。

    返回状态字符串，与 SPF 同约定：`"applied"` / `"already"` / 其它为跳过原因。
    """
    f = chunks_dir / SDL_FILE
    if not f.is_file():
        return f"找不到 {SDL_FILE}"
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    if all(repl in t for _, _, repl in SDL_SITES):
        return "already"
    if "pfToggle" not in t:
        return "前置补丁未打（portfolio 筛选）→ 整组跳过"
    missing = [label for label, find, repl in SDL_SITES
               if repl not in t and t.count(find) != 1]
    if missing:
        return "锚点失效（站点改版？）：" + "、".join(missing)
    for _, find, repl in SDL_SITES:
        t = t.replace(find, repl, 1)
    f.write_text(t, encoding="utf-8", errors="surrogateescape")
    return "applied"


# 服务概览页底部 "Daily incident volume · last 30 days" 热力图的配色 —— 见 patch_heatmap_palette()
HM_FILE = "100pim9o6kpoy.js"
HM_FIND = (
    'background:o<.3?"rgba(16,185,129,0.40)"'
    ':o<.5?"rgba(16,185,129,0.65)"'
    ':o<.7?"rgba(245,158,11,0.55)"'
    ':o<.85?"rgba(245,158,11,0.85)"'
    ':o<.95?"rgba(244,63,94,0.85)"'
    ':"rgba(244,63,94,0.95)"'
)
HM_REPL = (
    'background:o<.5?"rgba(16,185,129,0.40)"'
    ':o<.9?"rgba(16,185,129,0.65)"'
    ':o<.95?"rgba(245,158,11,0.55)"'
    ':"rgba(245,158,11,0.85)"'
)


def patch_heatmap_palette(chunks_dir) -> bool:
    """
    把热力图的三档配色（绿 / 黄 / 红）改成**只有绿和黄**，让整行看上去是健康的。

    ## 为什么不能只改数据

    `Heatmap` 组件把 30 个值按**本序列自己的 min-max 归一化**再分档上色：

        let c = Math.min(...e), l = Math.max(...e) - c || 1
        … let o = (e - c) / l          // 每格的相对位置，0 = 最小值，1 = 最大值

    所以**最大值那一格恒等于 1.0，永远是最高档**。原配色最高两档是红色，
    于是无论数据怎么调，那一格都是红的 —— 光改数据永远去不掉红色。
    （唯一的例外是 30 个值全相等：此时 `l = 0 || 1`，全部 `o = 0` → 全绿，但那也就没有黄了。）

    要达到「几乎全绿 + 1~2 个黄 + 零红」，只能改**分档阈值**。

    ## 改法

        o < .5   → 绿（浅）
        o < .9   → 绿（深）
        o < .95  → 黄
        else     → 黄（深）        ← 原来是红

    阈值 0.9 是配合当前数据选的：实测那 30 个值的 `o` 里只有 2 个 ≥ 0.9
    （1.000 与 0.970），于是正好 2 格黄、28 格绿、0 格红。
    注意这是**相对**刻度，换租户后数据分布变了，黄的格数会在 1~3 之间浮动 ——
    但最大值那格恒为黄，所以**永远不会再出现红色**。

    ## 影响范围

    组件定义在共享 chunk `100pim9o6kpoy.js` 里，但**只有服务概览页引用它**
    （实测：`0t1fyt7wcotiz.js` 引用 1 次，Business Ops 的 `00tsl~72wvlrr.js`
    与 Constellation 的分享池都零引用；两页的 DOM 里也都没有第二处这种网格）。
    所以这个替换实际上只作用于服务概览页。
    """
    f = chunks_dir / HM_FILE
    if not f.is_file():
        return False
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    if HM_REPL in t:
        return False                                # 已打过
    if t.count(HM_FIND) != 1:
        return False                                # 站点改版/不唯一 → 静默跳过
    f.write_text(t.replace(HM_FIND, HM_REPL),
                 encoding="utf-8", errors="surrogateescape")
    return True


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


# 内嵌页的**兜底租户** —— 见 patch_default_tenant()。必须与 src/api/config.js 的
# DEFAULT_TENANT 一致（那边是 Vue 侧发 X-Tenant-ID 用的）。
DT_FILE = "0wuztp2.9oz~8.js"
DT_DEFAULT = "otr"
# 锚点必须带上 `if(t&&t in tg)return t}catch{}` 才唯一 —— 裸的 return"retail" 别处也可能有。
DT_RE = re.compile(r'(if\(t&&t in tg\)return t\}catch\{\}return")[A-Za-z0-9._-]+("\}\(\))')


def patch_default_tenant(chunks_dir) -> str:
    """
    把内嵌页的**兜底租户**改成 `otr`，与 Vue 侧的 `src/api/config.js` 的 `DEFAULT_TENANT` 对齐。

        ?tenant=<id>  →  localStorage["sip-active-tenant"]  →  兜底 "otr"

    站点自带的那份兜底是 `"retail"`（Next 应用的原生租户）。但 agentflow 侧统一用的是
    `otr`（`src/api/config.js` 的 `DEFAULT_TENANT`、后端 `--tenant otr`），两边不一致时
    **看同一份数据要换名字** —— 所以内嵌页也兜底到 `otr`。

    ## 为什么必须做成补丁，不能手改 bundle

    这一处原先就是**手改**在 `public/` 那份产物里的（见 `cf01394`：「数据 + 默认租户」）。
    后果是**重建即回退**：`make-offline-page.py` 每次都从 `tools/vendor/` 的原始外壳
    重新铺 `public/_next/`，手改的那一处没有任何工具会再写回去，于是默认租户悄悄变回
    `retail` —— 而构建输出一切正常、不报错。本文件里所有补丁都是为这个理由存在的。

    返回状态字符串（同 SPF 约定）：`"applied"` / `"already"` / 其它为跳过原因。
    """
    f = chunks_dir / DT_FILE
    if not f.is_file():
        return f"找不到 {DT_FILE}"
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    hits = DT_RE.findall(t)
    if len(hits) != 1:
        return f"锚点不唯一（{len(hits)} 处，站点改版？）"
    if hits[0][0].endswith(f'"{DT_DEFAULT}"'):
        return "already"
    f.write_text(DT_RE.sub(lambda m: m.group(1) + DT_DEFAULT + m.group(2), t, count=1),
                 encoding="utf-8", errors="surrogateescape")
    return "applied"


# Security Ops 的 case inspector「Linked app」—— 见 patch_security_ops_linked_app()
SEC_FILE = "15zvtls0y9kdc.js"
SEC_APPKEY_FIND = 'appKey:"manhattan wms"'
SEC_APPKEY_REPL = 'appKey:(i.snapshot.topStorm||{}).appKey'


def patch_security_ops_linked_app(chunks_dir) -> str:
    """
    把 Security Ops 的 case inspector「Linked app」从写死的 `manhattan wms` 改成
    **本租户自己的风暴锚点 app**（`snapshot.topStorm.appKey`）。

    ## 为什么必须改

    case 列表是模块级的静态数组，两条 case 写死了 `appKey:"manhattan wms"`：

        {id:"SEC-1809", …, appKey:"manhattan wms", …}   // Alert Triage 那次风暴
        {id:"SEC-2034", …, appKey:"manhattan wms", …}   // 该风暴的 PIR

    inspector 用 `i.snapshot.apps.find(t=>t.appKey===e.appKey)` 反查，而
    **`manhattan wms` 只存在于 best-buy-reference 租户**（893 apps 那个，页面就是照着它写的）。
    其余 11 个租户（含默认租户 `otr`）都查不到，于是渲染时走 `s && (…)` 的短路 ——
    「Linked app」整块**静默消失**：不报错、不留空态、只是少了那一节。

    这两条 case 讲的就是「Top alert storm」那格 KPI 指向的同一次风暴（KPI 读 REAL、
    本来就是按租户算的），所以锚到本租户的 `topStorm.appKey` 语义**完全正确**：
    点开 KPI、点开 case、Linked app 三处指向同一个 app。

    ## 为什么写成运行期派生，而不是把某个租户的值烤死

    `patch_default_tenant` 那类补丁是**静态**换字面量，但这里每个租户的值不同，
    烤死任何一个都会让其余 11 个错。改写成读 snapshot 的表达式，12 个租户一次成立。

    ## 为什么安全（改坏的话整页白屏，比原问题更糟）

      - 位置：`h` 与 `i.snapshot` **同一条 `let` 声明**（`let u=i.snapshot.apps…,h=[{…}]`），
        同一作用域，`i` 就是数据模块命名空间 —— 无遮蔽，已用括号配平核过；
      - 兜底：`(…||{})` 保证 `topStorm` 缺失时得到 `undefined` 而不是抛异常，
        渲染回落到「没有 Linked app」，与今天的行为一致；
      - 实测 12 个租户的 `snapshot.topStorm.appKey` **全部存在**，兜底只是保险。

    ## 不动的

    其余三条 case 的 appKey（`anchor-app` / `order management` / `enterprise teradata`
    / `repair workbench`）在**任何**租户里都不存在，没有语义对得上的映射可做 ——
    硬凑成别的 app 就是编数据，所以保持原样（那几条的 Linked app 仍然不显示）。

    返回状态字符串：`"applied"` / `"already"` / 其它为跳过原因。
    """
    f = chunks_dir / SEC_FILE
    if not f.is_file():
        return f"找不到 {SEC_FILE}"
    t = f.read_text(encoding="utf-8", errors="surrogateescape")
    if SEC_APPKEY_REPL in t:
        return "already"
    n = t.count(SEC_APPKEY_FIND)
    if n != 2:
        return f"锚点 {n} 处 ≠ 2（站点改版？）"
    f.write_text(t.replace(SEC_APPKEY_FIND, SEC_APPKEY_REPL),
                 encoding="utf-8", errors="surrogateescape")
    return "applied"


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
    /* ★ 兜底必须与内嵌页**数据**的兜底是同一个值（见 patch_default_tenant）。
       这里原来写死 'retail'，而 patch_default_tenant 把数据兜底改成了 'otr' ——
       于是「没设过租户」这个最常见的情况下，数据按 otr 渲染、文案按 retail 改写：
       标题写「282 apps · 9 portfolios · 6 journeys」，正下方的 KPI 写 50 apps。
       站点自带的兜底两处都是 retail，所以原样搬过来时看不出问题；改成 otr 之后就
       只剩这一处没跟上。占位符由 inject() 填成 DT_DEFAULT，单一真源。 */
    return '__DT_DEFAULT__';
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
        # 改写器的兜底租户跟 patch_default_tenant 用**同一个常量** —— 两处不一致时
        # 会出现「数据 otr / 文案 retail」，见 activeId() 里的说明。
        + ";</script>" + REWRITER.replace("__DT_DEFAULT__", DT_DEFAULT)
    )
    html = re.sub(r"(</head>)", blob + r"\1", html, count=1)
    return html, n
