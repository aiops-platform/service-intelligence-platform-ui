#!/usr/bin/env python3
"""
按「和已知能跑的租户做结构差分」校验新租户。

## 为什么不用手写 schema

第一版校验（照 zod schema 手抄一份 Python）漏掉了 `portfolios[].journey` 的类型 ——
实测是 `z.string().nullable()`，而输入给的是整数序号，原样透传 → ZodError → 整页白屏。
手抄 schema 会漏，差分不会：**已知能跑的租户就是活的标准答案。**

用法：
    python3 validate.py mb-retail [--ref retail]
"""

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import tenant_data  # noqa: E402

# schema 里标了 .optional() 的字段 —— 基准有、新租户没有是合法的。
# ★ 前缀约定要和 ENUMS 一致：都不含 tenant/snapshot 这个 part 前缀。
OPTIONAL = (".client.ticker", ".client.logo", ".labels", ".nameFanout")

# 基准数据里有、但**不在 zod schema 里**的字段（parse 时被剥掉）。
# retail 的 replay-storm 写了这两个，data-sicg 干脆没写 —— 写不写都不影响运行。
KNOWN_DEAD = (".scenarios.replay-storm.anchor", ".scenarios.replay-storm.timeline")

# 枚举字段：路径(不含 part 前缀) → 合法值
ENUMS = {
    ".agents.itil-run[].mode": {"Shadow", "Suggest", "Live"},
    ".agents.sdlc[].mode": {"Shadow", "Suggest", "Live"},
    ".agents.governance[].mode": {"Shadow", "Suggest", "Live"},
}
# zod 里是 z.string()（**非** nullable）—— 给 null 会炸
NON_NULL_STRING = {".portfolios[].journeyId"}


def shape(o, p="", acc=None, depth=0):
    """嵌套结构 → {字段路径: 类型}。空数组单独记，避免和「有元素的数组」误判。"""
    if acc is None:
        acc = {}
    if depth > 12:
        return acc
    if isinstance(o, dict):
        for k, v in o.items():
            shape(v, f"{p}.{k}", acc, depth + 1)
    elif isinstance(o, list):
        acc[p] = "empty-array" if not o else None
        if o:
            acc.pop(p, None)
            shape(o[0], f"{p}[]", acc, depth + 1)
    else:
        acc[p] = "null" if o is None else (
            "bool" if isinstance(o, bool) else
            "number" if isinstance(o, (int, float)) else
            "string" if isinstance(o, str) else type(o).__name__)
    return acc


MISSING = object()


def value_at(o, path):
    """按 '.a[].b' 取实际值（数组取第一个元素）。路径不存在返回 MISSING。"""
    cur = o
    for seg in [s for s in path.split(".") if s]:
        is_arr = seg.endswith("[]")
        key = seg[:-2] if is_arr else seg
        if not isinstance(cur, dict) or key not in cur:
            return MISSING
        cur = cur[key]
        if is_arr:
            if not cur:
                return MISSING
            cur = cur[0]
    return cur


def _matches(path, group):
    return any(path == o or path.startswith(o + ".") or path.startswith(o + "[")
               for o in group)


def is_optional(path):
    return _matches(path, OPTIONAL)


def is_dead(path):
    return _matches(path, KNOWN_DEAD)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tenant")
    ap.add_argument("--ref", default="retail")
    a = ap.parse_args()

    f = HERE.parent / "tenant-data" / f"{a.tenant}.json"
    if not f.is_file():
        raise SystemExit(f"✗ 找不到 {f}")
    mine = json.loads(f.read_text(encoding="utf-8"))

    bundle = tenant_data.find_bundle(HERE.parent)
    _, data, _ = tenant_data.read_bundle(bundle)
    if a.ref not in data:
        raise SystemExit(f"✗ 基准租户 {a.ref!r} 不在 bundle 里")
    ref = data[a.ref]

    errs, warns = [], []
    for part in ("tenant", "snapshot"):
        rs = shape(ref.get(part, {}))
        ms = shape(mine.get(part, {}))
        # 「基准是空数组，新租户填了内容」不是缺失
        for k in sorted(set(rs) - set(ms)):
            if rs[k] == "empty-array" and any(x.startswith(k + "[]") for x in ms):
                continue
            msg = f"{part}{k} 基准有（{rs[k]}）而新租户没有"
            if is_dead(k):
                continue                        # 不在 schema 里，缺了无所谓
            if is_optional(k):
                warns.append(msg + "（schema 标了 optional）")
            else:
                errs.append(msg)
        for k in sorted(set(ms) - set(rs)):
            if k.endswith("[]") or "[]" in k:
                base = k.split("[]")[0]
                if rs.get(base) == "empty-array":
                    continue          # 基准是空数组，新租户填了内容
            warns.append(f"{part}{k} 基准里没有（zod 会剥掉，不影响运行）")
        for k in sorted(set(rs) & set(ms)):
            if rs[k] == ms[k] or {rs[k], ms[k]} <= {"number"}:
                continue
            errs.append(f"{part}{k} 类型不符：基准 {rs[k]}，实际 {ms[k]}")

    # 非 nullable 的字符串不能是 None
    for path in NON_NULL_STRING:
        for part in ("tenant", "snapshot"):
            v = value_at(mine.get(part, {}), path)
            if v is not MISSING and v is None:
                errs.append(f"{part}{path} 不能是 null（schema 是 z.string()）")

    # 枚举值（取实际值，不是类型）
    for path, allowed in ENUMS.items():
        for part in ("snapshot", "tenant"):
            v = value_at(mine.get(part, {}), path)
            if v is not MISSING and v is not None and v not in allowed:
                errs.append(f"{part}{path} 非法值 {v!r}，应为 {sorted(allowed)}")

    # 业务不变量
    snap = mine.get("snapshot", {})
    apps = snap.get("apps", [])
    pids = {p["id"] for p in snap.get("portfolios", [])}
    orph = [x.get("appKey") for x in apps if x.get("portfolioId") not in pids]
    if orph:
        errs.append(f"{len(orph)} 个 app 的 portfolioId 悬空：{orph[:3]}")
    ids = [x.get("id") for x in apps]
    if len(ids) != len(set(ids)):
        errs.append(f"app id 有重复：{[i for i in set(ids) if ids.count(i) > 1][:3]}")
    keys = [x.get("appKey") for x in apps]
    if len(keys) != len(set(keys)):
        errs.append(f"appKey 有重复：{[i for i in set(keys) if keys.count(i) > 1][:3]}")
    tax = {p["id"]: p["tier"]
           for p in mine.get("tenant", {}).get("taxonomy", {}).get("portfolios", [])}
    for p in snap.get("portfolios", []):
        if tax.get(p["id"].split(":")[-1]) != p["tier"]:
            errs.append(f"{p['id']} 在 taxonomy 与 snapshot 里的 tier 不一致")
    # taxonomy.appArchetypes[].tier 必须是字符串 T1/T2/T3
    for i, x in enumerate(mine.get("tenant", {}).get("taxonomy", {}).get("appArchetypes", [])):
        if x.get("tier") not in ("T1", "T2", "T3"):
            errs.append(f"taxonomy.appArchetypes[{i}].tier 非法 {x.get('tier')!r}（要字符串 T1/T2/T3）")

    print(f"基准：{a.ref}（{len(ref.get('snapshot', {}).get('apps', []))} apps）")
    print(f"待验：{a.tenant}（{len(apps)} apps）\n")
    if warns:
        print(f"⚠ {len(warns)} 条提示（不影响运行）：")
        for w in warns[:6]:
            print(f"   - {w}")
        if len(warns) > 6:
            print(f"   … 还有 {len(warns)-6} 条")
        print()
    if errs:
        print(f"✗ {len(errs)} 条错误 —— 会白屏：")
        for e in errs[:20]:
            print(f"   - {e}")
        return 1
    print("✓ 结构差分通过：与基准逐字段同构")
    return 0


if __name__ == "__main__":
    sys.exit(main())
