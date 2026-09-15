#!/usr/bin/env python3
"""
从 mb-retail.raw.json（用户给的四层节点）生成完整的 tenant-data/mb-retail.json。

## 为什么要这么写

snapshot 被页面用 zod 严格解析（见 0aed4f89z1emu.js 里的 `b.parse(h)`），
缺字段 / 类型错 → 抛异常 → 整页白屏。而 tenant_data.py 的 validate_snapshot()
只查 4 个键，**过 check 不代表页面能跑**。所以这里按真实 schema 逐个字段生成。

## 派生策略

- 坐标：replica 实测公式（极坐标网格：tier 定半径，portfolio 定角度）
- app 指标：按 tier 的分布生成，单调性对齐 retail 实测值
- valuePool：结构照抄 retail，只缩放金额字段（保证过 zod）
- scenarios/agents：照 data-sicg（唯一有内容的租户）的样子填

用法：  python3 build_mb_retail.py
"""

import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "tenant-data" / "mb-retail.json"
RETAIL_EXPORT = HERE.parent / "constellation-export" / "data" / "retail.json"

RNG = random.Random(20260915)
TENANT_ID = "mb-retail"

# ── 修正：用户确认的命名 + 降级 ──────────────────────────────────────
RENAME = {"accounting": "Accounting", "otr-parts stock": "OTR Parts Stock"}

# (label, portfolio) → 新 tier。只降那些「在别的组合里本来就是 T2」的共享系统，
# 避免同一个应用在不同组合里落在不同半径上。
TIER_OVERRIDES = {
    ("VLMS", "Work Order"): 2, ("VLMS", "Workshop"): 2,
    ("EVA", "Work Order"): 2,
    ("BMS", "Workshop"): 2,
    ("VDOC", "Work Order"): 2,
    ("BLM", "Workshop"): 2, ("BLM", "Parts"): 2,
}

# ── 技术栈目录（汽车经销商口径）────────────────────────────────────
TECHS = [
    "SAP", "Java", "C#/.NET", "Oracle DB", "SQL Server", "Node.js", "Python",
    "Kafka", "Kubernetes", "Azure", "Angular", "React", "MuleSoft", "IBM MQ",
    "Power BI", "Xentry Protocol", "REST API", "PostgreSQL", "Terraform", "Splunk",
]
TECH_ID = {n: i + 1 for i, n in enumerate(TECHS)}

# label 关键词 → 技术栈
TECH_MAP = [
    (("xentry",), ["Xentry Protocol", "C#/.NET", "SQL Server"]),
    (("sap", "accounting", "dmp"), ["SAP", "Oracle DB", "Power BI"]),
    (("crm", "campaign", "mystar", "ebadge"), ["C#/.NET", "SQL Server", "Azure"]),
    (("ofe", "dcp", "sop", "cesar", "vega", "spm", "dpts"), ["Java", "Oracle DB", "Kafka"]),
    (("otr", "vlms", "vDoc".lower(), "jobcard", "order"), ["Java", "PostgreSQL", "Kubernetes"]),
    (("dsr", "metouch", "odp", "bms", "blm", "piston", "rv"), ["Node.js", "PostgreSQL", "Azure"]),
]

# 财季结算期禁止变更的应用 —— 判据是「会不会往总账写数」。
# retail 的 18 个全在 Finance 组合；这些对应到经销商的记账链路。
FINANCE_FREEZE = {
    "Accounting",          # 财务系统本体
    "OTR Parts Sales",     # 配件销售 —— 直接开票过账
    "OTR Parts Purchase",  # 配件采购 —— 应付
    "OTR Warranty",        # 保修索赔 —— 厂商回款
    "OTR Vehicle",         # 车辆计价 —— 资产入账
}

# ── 事件量整体缩放 ─────────────────────────────────────────────────
# `inc` 的均值来自 retail 实测（139 / 79 / 30），但那是 **282 个应用**的零售集团。
# 50 个应用的经销商集团套同一套数值，算出来天均 ~1100、峰值 ~1460（Business Ops
# 热力图上看得见），量级不合理。0.5 让它落在天均 ~550、峰值 ~730。
#
# 下游全部跟着走，不用分别改：
#   应用级 incidentsTotal  →  求和 × INC_MULT(123) = facts.incidents  →  sparkline90d
# 乘 123 这个口径与 retail 一致，缩放不影响「应用级 : 全量告警」的比例关系。
INCIDENT_SCALE = 0.5
STORM_CHILDREN = round(318 * INCIDENT_SCALE)        # 风暴子事件数，同样缩放

# ── app 指标：retail 实测的 per-tier 分布 ───────────────────────────
TIER_PROFILE = {
    1: dict(inc=139, chg=28.8, risk=82.9, botres=0.62, hc=0.70, deg=0.20),
    2: dict(inc=79,  chg=15.4, risk=59.6, botres=0.48, hc=0.20, deg=0.12),
    3: dict(inc=30,  chg=5.2,  risk=39.2, botres=0.31, hc=0.00, deg=0.06),
}


def slug(s):
    """标签 → kebab id。Offer&Order → offer-order"""
    out = s.lower().replace("&", "-").replace("·", "-").replace(" ", "-")
    return "".join(c for c in out if c.isalnum() or c == "-").strip("-")


def rep(v, spread=0.18):
    """带抖动的正数（对数正态感），用于让指标不全一样"""
    return max(1.0, v * math.exp(RNG.gauss(0, spread)))


def load_input():
    d = json.loads((HERE / "mb-retail.raw.json").read_text(encoding="utf-8"))
    for a in d["apps"]:
        a["label"] = RENAME.get(a["label"], a["label"])
        ov = TIER_OVERRIDES.get((a["label"], a["portfolio"]))
        if ov:
            a["tier"] = ov
    return d


def build_ids(d):
    """
    appKey 规则 = 用户自己的习惯：label 唯一时只用 slug，跨组合时加 -<组合> 后缀。

    用户显式给的 appKey 优先采纳 —— 但只在它不冲突的前提下。
    原始数据里 `otr-lead-lead` 在 Lead 和 Consulation 两条上都写了（复制粘贴漏改），
    那种情况退回派生规则，得到 `otr-lead-lead` / `otr-lead-consulation`。
    """
    from collections import Counter
    seen = Counter(a["label"] for a in d["apps"])
    for a in d["apps"]:
        base = slug(a["label"])
        a["_derived"] = base if seen[a["label"]] == 1 else f"{base}-{slug(a['portfolio'])}"

    explicit = Counter(a["appKey"] for a in d["apps"] if "appKey" in a)
    for a in d["apps"]:
        ek = a.get("appKey")
        # 显式 key 只在自己唯一、且没被别人派生占用时才采纳
        a["_key"] = a["_derived"]
        if ek and explicit[ek] == 1:
            a["_key"] = ek
        a["_id"] = "app:" + a["_key"]

    dup = [k for k, n in Counter(a["_key"] for a in d["apps"]).items() if n > 1]
    if dup:
        raise SystemExit(f"✗ appKey 仍然冲突：{dup}")


def build_positions(d):
    """实测公式：journeys/portfolios 等分角度起点 270°；app 半径由 tier 定、角度由组合定。"""
    def pol(r, deg):
        a = math.radians(deg)
        return {"x": r * math.cos(a), "y": r * math.sin(a), "angle": a}

    d["enterprise_pos"] = pol(0, 0)

    n = len(d["journeys"])
    for i, j in enumerate(d["journeys"]):
        j["id"] = f"journey:{i+1}"
        j["position"] = pol(180, 270 + i * 360 / n)

    n = len(d["portfolios"])
    for i, p in enumerate(d["portfolios"]):
        p["id"] = "portfolio:" + slug(p["label"])
        ang = 270 + i * 360 / n                  # 局部变量 —— 不要写进 p（schema 里没有）
        p["position"] = pol(360, ang)
        jn = p.get("journey")                    # 输入里是「第几条 journey」的序号
        # ★ journeyId 的 schema 是 z.string()（非 nullable）。企业级支撑组合必须写
        #   **字符串** "journey:null"，写 null 会 zod 抛异常 → 白屏。
        p["journeyId"] = f"journey:{jn}" if jn else "journey:null"
        # ★ journeys 的 schema 是 z.string().nullable() —— 输入给的序号是**数字**，
        #   原样透传会 ZodError。实测 11 个租户里这个字段是 null(102) 或旅程名字符串(21)，
        #   从没有整数。跟 retail 保持一致用 null（journeyId 已经承载了归属关系）。
        p["journey"] = None
        p.pop("angle", None)

    by_pf = {}
    for a in d["apps"]:
        by_pf.setdefault(a["portfolio"], []).append(a)
    for p in d["portfolios"]:
        ang = math.degrees(math.atan2(p["position"]["y"], p["position"]["x"]))
        for a in by_pf.get(p["label"], []):
            r = 480 + (a["tier"] - 1) * 90 + RNG.uniform(0, 150)
            a["position"] = pol(r, ang + RNG.uniform(-11, 11))


def build_app_metrics(d):
    for a in d["apps"]:
        pr = TIER_PROFILE[a["tier"]]
        a["incidentsTotal"] = max(1, round(rep(pr["inc"]) * INCIDENT_SCALE))
        a["changeCount"] = int(rep(pr["chg"]))
        a["riskScore"] = min(99, int(rep(pr["risk"], 0.09)))
        a["botResolutionRate"] = round(min(0.95, rep(pr["botres"], 0.15)), 4)
        a["holidayCritical"] = RNG.random() < pr["hc"]
        # ★ financeFreeze 不能随机撒 —— retail 的口径是「往总账写数的系统」，
        #   18 个全集中在 Finance 组合且全是 tier 2。随机撒会得到 24%（全场最高，
        #   别的租户最多 9.4%），一眼是假的。MB Retail 没有 Finance 组合，
        #   锚定真正过账的那几个：财务本体 + 配件进出货 + 保修索赔 + 车辆计价。
        a["financeFreeze"] = a["label"] in FINANCE_FREEZE
        a["operationalStatus"] = "degraded" if RNG.random() < pr["deg"] else "ok"
        # 两个 MTTR 跨 tier 基本是平的（retail 实测），所以不吃 tier
        a["botMttrMin"] = round(rep(42, 0.20), 1)
        a["humanMttrMin"] = round(rep(1840, 0.18), 1)


def build_tech(d):
    catalog, apptech = {}, []
    for a in d["apps"]:
        low = a["label"].lower()
        names = ["REST API", "Splunk", "Kubernetes"]          # 底座
        for keys, ts in TECH_MAP:
            if any(k in low for k in keys):
                names = ts + names[:1]
                break
        names = list(dict.fromkeys(names))
        apptech.append({"appKey": a["_key"],
                        "techIds": sorted(TECH_ID[t] for t in names),
                        "techNames": names})
        for t in names[:1]:
            catalog[t] = catalog.get(t, 0) + 1
    top = sorted(catalog.items(), key=lambda kv: -kv[1])[:5]
    return apptech, [{"techId": TECH_ID[n], "name": n, "appCount": c} for n, c in top]


# retail 实测的换算比例（282 apps: sum(app.incidentsTotal)=27,048 → facts.incidents=3,326,840）
# facts 统计的是「全部告警量」，不是应用级事件之和 —— 差 123 倍。照抄这个口径才逼真。
INC_MULT = 123      # facts.incidents      / sum(app.incidentsTotal)
CHG_MULT = 5        # facts.changes        / sum(app.changeCount)
INFRA_RATIO = 0.250  # facts.infraIncidents / facts.incidents
PROB_RATIO = 0.101   # facts.problems       / facts.changes
APPS_PER_TEAM = 5.2  # retail: 282 apps / 54 teams


def build_facts(d, apps):
    inc = sum(a["incidentsTotal"] for a in apps)
    chg = sum(a["changeCount"] for a in apps)
    tot_inc, tot_chg = inc * INC_MULT, chg * CHG_MULT
    return {
        "apps": len(apps),
        "portfolios": len([p for p in d["portfolios"]
                           if any(a["portfolio"] == p["label"] for a in apps)]),
        "journeys": len(d["journeys"]),
        "teams": round(len(apps) / APPS_PER_TEAM),
        "incidents": tot_inc,
        "changes": tot_chg,
        "problems": round(tot_chg * PROB_RATIO),
        "infraIncidents": round(tot_inc * INFRA_RATIO),
        "monthsCovered": 18,
        "mttrBotMin": 42, "mttrHumanMin": 1850, "mttrGapMultiplier": 44,
        "topAlertStormId": "INC-MBR-77104", "topAlertStormChildren": STORM_CHILDREN,
        "emergencyBackoutRate": 0.019, "standardBackoutRate": 0.0003,
        "emergencyBackoutMultiplier": 63.3,
        "mondayNormalBackoutRate": 0.0009, "sundayNormalBackoutRate": 0.0002,
        "mondayNormalMultiplier": 4.5,
        "issueGenericPct": 0.89, "changeUnlinkedPct": 0.31,
    }


def build_edges(d):
    """两两算。共享应用越多的组合对，权重越高 —— 共享系统本来就该有相关性。"""
    by_pf = {}
    for a in d["apps"]:
        by_pf.setdefault(a["portfolio"], set()).add(a["label"])
    polys = [p["label"] for p in d["portfolios"]]
    pid = {p["label"]: p["id"] for p in d["portfolios"]}
    tech, casc, coin = [], [], []
    for i in range(len(polys)):
        for j in range(i + 1, len(polys)):
            x, y = polys[i], polys[j]
            shared = by_pf[x] & by_pf[y]
            if not shared:
                continue
            tech.append({"source": pid[x], "target": pid[y],
                         "sharedTechs": min(15, 4 + 3 * len(shared))})
            pc = 6 + 4 * len(shared) + RNG.randint(0, 6)
            casc.append({"source": pid[x], "target": pid[y], "pairCount": pc})
            coin.append({"source": pid[x], "target": pid[y],
                         "weight": round(min(0.95, 0.55 + 0.08 * len(shared)), 4),
                         "pairCount": pc * 3})
    return {"techOverlap": tech, "changeCascade": casc, "incidentCoincidence": coin}


def build_sparkline(total_inc):
    """90 天曲线：工作日高、周末低，年末旺季一个尖峰（经销商 12 月冲量 + 春季上牌）"""
    import datetime
    base = total_inc / 18 / 30
    out, day = [], datetime.date(2026, 2, 11)
    for i in range(91):
        d0 = day + datetime.timedelta(days=i)
        w = 0.55 if d0.weekday() >= 5 else 1.0
        season = 1.6 if (d0.month == 12 and d0.day > 15) else 1.0
        out.append({"day": d0.isoformat(),
                    "n": int(base * w * season * RNG.uniform(0.82, 1.18))})
    return out


def build_topstorm(apps):
    a = max((x for x in apps if x["tier"] == 1), key=lambda x: x["incidentsTotal"])
    return {"incidentNumber": "INC-MBR-77104", "appKey": a["_key"], "appName": a["label"],
            "portfolioName": slug(a["portfolio"]), "journey": "Sales Customer Journey",
            "openedAt": "2026-11-27T08:42:00", "resolvedAt": "2026-11-27T09:15:00",
            "priority": "1 - Critical", "severity": "3 - Low", "childCount": STORM_CHILDREN}


def build_valuepool():
    """结构照抄 retail，只缩放金额字段 —— 保证过 zod"""
    vp = json.loads(RETAIL_EXPORT.read_text(encoding="utf-8"))["valuePool"]
    k = 50 / 282

    def scale(o):
        if isinstance(o, dict):
            return {kk: (round(vv * k, 1) if isinstance(vv, (int, float))
                         and (kk.endswith("M") or kk in ("datTotalM",)) else scale(vv))
                    for kk, vv in o.items()}
        if isinstance(o, list):
            return [scale(x) for x in o]
        return o
    return scale(vp)


def build_scenarios(apps):
    """照 data-sicg 的样子填（唯一有内容的租户）。acts/agentSuggestions 是必填。"""
    anchor = max((x for x in apps if x["tier"] == 1), key=lambda x: x["incidentsTotal"])
    rid = "INC-MBR-77104"
    return {
        "replay-storm": {
            "label": f"Replay {rid}", "hostPanel": "service-ops",
            "acts": [
                {"id": "without-sip", "title": "Without SIP", "duration": 4000,
                 "counterTarget": STORM_CHILDREN, "mttrMinutes": 33, "rootIncident": rid},
                {"id": "with-sip", "title": "With SIP", "duration": 4000,
                 "counterTarget": STORM_CHILDREN, "mttrMinutes": 4, "rootIncident": rid},
            ],
            "agentSuggestions": [
                {"agent": "Storm Detector", "confidence": 0.96,
                 "action": f"Correlate {STORM_CHILDREN} child alerts under {rid} on {anchor['label']}",
                 "eta": "immediate", "impact": "Containment", "provenance": "demo-illustrative"},
                {"agent": "Probable Cause Agent", "confidence": 0.83,
                 "action": "Attribute to the overnight dealer-master data sync, not the app tier",
                 "eta": "2 min", "impact": "Diagnosis", "provenance": "demo-illustrative"},
                {"agent": "Recovery Agent", "confidence": 0.91,
                 "action": "Restart the integration worker pool behind the affected queue",
                 "eta": "3 min", "impact": "Recovery", "provenance": "demo-illustrative"},
                {"agent": "Closure Agent", "confidence": 0.88,
                 "action": "Auto-close the 291 duplicate child incidents with a shared RCA",
                 "eta": "1 min", "impact": "Toil reduction", "provenance": "demo-illustrative"},
            ],
        },
        "run-cab-review": {
            "label": "Run CAB review", "hostPanel": "engineering-ops",
            "session": [
                {"delay": 600, "text": "CAB opened · 14 change requests across Sales and Aftersales."},
                {"delay": 900, "text": "Risk scoring flags 2 changes touching shared services used by 3+ portfolios."},
                {"delay": 900, "text": "Collision check: both target the same integration weekend window."},
                {"delay": 1200, "text": "Recommendation: stagger. One moves to the following window."},
            ],
        },
        "ask-sip": {
            "label": "Ask SIP", "hostPanel": "business-ops",
            "thread": [
                {"role": "user", "text": "Which portfolios depend on the shared systems, and how exposed is Handover?"},
                {"role": "assistant",
                 "text": "Four systems are shared across portfolios. Handover draws every one of its applications from that shared set, so it has no independent failure domain.",
                 "chips": [{"phrase": "shared services", "source": "portfolioEdges"},
                           {"phrase": "Handover exposure", "source": "snapshot"}]},
            ],
            "suggested": ["Show shared-system blast radius",
                          "Which changes touch shared services this quarter?",
                          "Compare Handover MTTR to the group average"],
        },
    }


def build_agents():
    """mode 只能是 Shadow / Suggest / Live；threshold 是 number。"""
    itil = [("Storm Detector", "Live", 0.95), ("Severity Classifier", "Live", 0.90),
            ("Probable Cause Agent", "Live", 0.78), ("Recovery Agent", "Suggest", 0.92),
            ("Closure Agent", "Live", 0.85), ("Runbook Selector", "Suggest", 0.80),
            ("Major Incident Scribe", "Live", 0.88), ("Knowledge Miner", "Shadow", 0.72),
            ("Change Risk Scorer", "Live", 0.87), ("Backout Advisor", "Suggest", 0.83)]
    sdlc = [("Test Selector", "Live", 0.86), ("Release Notes Writer", "Suggest", 0.79),
            ("Deploy Guard", "Live", 0.93), ("Regression Triager", "Shadow", 0.74)]
    gov = [("CAB Reviewer", "Suggest", 0.81), ("Policy Drift Detector", "Live", 0.89),
           ("Audit Evidence Collector", "Shadow", 0.76)]
    mk = lambda rows: [{"name": n, "mode": m, "threshold": t} for n, m, t in rows]
    return {"itil-run": mk(itil), "sdlc": mk(sdlc), "governance": mk(gov)}


def build_tenant(d, apps):
    """zod 硬校验的部分。九段 talkTrack 全部必填。"""
    polys = [{"id": slug(p["label"]), "name": p["label"], "tier": p["tier"]}
             for p in d["portfolios"]]
    seen, arch = set(), []
    for a in apps:                                   # 每个组合挑一个代表做 archetype
        s = slug(a["portfolio"])
        if s in seen:
            continue
        seen.add(s)
        arch.append({"name": a["label"], "portfolio": s,
                     "tier": f"T{a['tier']}"})       # ★ 字符串 T1/T2/T3
    return {
        "id": TENANT_ID, "name": "MB Retail", "industry": "Automotive Retail",
        "demoTitle": "Service Intelligence Platform · MB Retail",
        "client": {"displayName": "MB Retail", "ticker": "MBR"},
        "brand": {"accentHex": "#00adef", "accentInkHex": "#00263a"},
        # ★ labels 是可选的（schema 标了 .optional()），但**建议给** ——
        #   retail 的 peakSeasonNoun 是 "the Q4 holiday peak"（圣诞），
        #   经销商旺季是上牌月，不给的话话术是错的。给了就要 6 个全给。
        "labels": {
            "criticalLong": "Peak-Season-Critical apps",
            "criticalShort": "PS",
            "criticalCaption": "Peak-Season-Critical",
            "freezeLong": "Finance Freeze",
            "freezeShort": "FF",
            "peakSeasonNoun": "the plate-change peak",
        },
        "taxonomy": {"portfolios": polys, "appArchetypes": arch},
        "businessCase": {"baselineUsdM": 42.5, "opportunityUsdM": 18.4,
                         "roiMultiplier": 3.8,
                         "splitNarrative": "Roughly two thirds of the opportunity sits in "
                                           "aftersales — workshop throughput, parts availability "
                                           "and warranty recovery — with the remainder in the "
                                           "sales journey and shared integration estate."},
        "talkTrack": {
            "constellation": "MB Retail's operating fabric: 50 applications across 11 business "
                             "portfolios and two customer journeys — Sales and Customer Service — "
                             "serving dealerships across three markets.",
            "serviceOps": "Aftersales carries the incident load. Workshop and Parts together "
                          "generate the majority of volume, and a single dealer-master sync "
                          "failure fans out into hundreds of child alerts within minutes.",
            "engOps": "Change risk concentrates on the shared estate. Four systems are used by "
                      "three or more portfolios, so a routine deploy can put the sales journey "
                      "and the workshop at risk in the same window.",
            "businessOps": "Handover is the exposure. Every application it depends on is shared "
                           "with an upstream portfolio, which means it has no independent "
                           "failure domain of its own.",
            "architecture": "The estate grew by acquisition. DCP, VLMS and Xentry each appear in "
                            "three portfolios, integration runs on a mix of MuleSoft and IBM MQ, "
                            "and Oracle and SQL Server both carry master data.",
            "finops": "Spend is concentrated in the ERP and diagnostic layers, with a long tail "
                      "of portfolio-specific tooling that never reaches scale.",
            "securityOps": "Identity sprawl across dealer-facing systems is the standing finding; "
                           "third-party workshop tooling is the least governed surface.",
            "agents": "The ITIL run fleet handles detection through closure. Recovery and runbook "
                      "selection stay in suggest mode pending sign-off; storm detection and "
                      "severity classification already run live.",
            "valuePool": "The value case is built bottom-up from the workshop and parts "
                         "bottlenecks rather than from a top-down cost baseline.",
        },
        "highlightEntities": {
            "stormIncident": "INC-MBR-77104",
            "anchorApp": max((x for x in apps if x["tier"] == 1),
                             key=lambda x: x["incidentsTotal"])["_key"],
            "anchorChange": "CHG2026-11-27-118",
        },
    }


def main():
    d = load_input()
    build_ids(d)
    build_positions(d)
    build_app_metrics(d)
    apps = sorted(d["apps"], key=lambda a: (a["portfolio"], a["_key"]))

    apptech, toptech = build_tech(d)
    facts = build_facts(d, apps)
    snapshot = {
        "schemaVersion": 1, "generatedAt": "2026-09-15T00:00:00.000Z",
        "source": {"db": f"design:mb-retail@1", "asOf": "2026-09-01T00:00:00"},
        "facts": facts,
        "enterprise": {"id": "enterprise", "label": d["enterprise"],
                       "position": d["enterprise_pos"]},
        "journeys": d["journeys"], "portfolios": d["portfolios"],
        "apps": [{"id": a["_id"], "appKey": a["_key"], "label": a["label"],
                  "portfolioId": "portfolio:" + slug(a["portfolio"]), "tier": a["tier"],
                  "holidayCritical": a["holidayCritical"], "financeFreeze": a["financeFreeze"],
                  "operationalStatus": a["operationalStatus"],
                  "incidentsTotal": a["incidentsTotal"],
                  "botResolutionRate": a["botResolutionRate"],
                  "changeCount": a["changeCount"], "riskScore": a["riskScore"],
                  "botMttrMin": a["botMttrMin"], "humanMttrMin": a["humanMttrMin"],
                  "position": a["position"]} for a in apps],
        "topStorm": build_topstorm(apps),
        "sparkline90d": build_sparkline(facts["incidents"]),
        "portfolioEdges": build_edges(d),
        "topTechnologies": toptech, "appTechnologies": apptech,
        "valuePool": build_valuepool(),
        "scenarios": build_scenarios(apps), "agents": build_agents(),
    }
    out = {"tenant": build_tenant(d, apps), "snapshot": snapshot}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    from collections import Counter
    tc = Counter(a["tier"] for a in apps)
    print(f"✓ {OUT}  ({OUT.stat().st_size/1024:.0f} KB)")
    print(f"  {len(apps)} apps · {len(d['portfolios'])} portfolios · "
          f"{len(d['journeys'])} journeys")
    print(f"  tier 分布 {dict(sorted(tc.items()))} = "
          f"{[f'{tc[t]/len(apps)*100:.0f}%' for t in (1,2,3)]}")
    e = snapshot["portfolioEdges"]
    print(f"  边：techOverlap {len(e['techOverlap'])} · changeCascade "
          f"{len(e['changeCascade'])} · incidentCoincidence {len(e['incidentCoincidence'])}")
    print(f"  facts.incidents = {facts['incidents']:,}")
    print(f"  topStorm 锚在 {snapshot['topStorm']['appName']} ({snapshot['topStorm']['appKey']})")


if __name__ == "__main__":
    main()
