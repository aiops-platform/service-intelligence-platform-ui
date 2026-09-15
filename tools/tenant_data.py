#!/usr/bin/env python3
"""
读 / 写离线 bundle 里的租户数据（Constellation 的节点数据）。

## 数据住在哪

`_next/static/chunks/0wuztp2.9oz~8.js` 里有一个模块（编号 89784）：

    t.exports = JSON.parse('{"banking":{…},"retail":{…},…}')

**整份数据就是一个 JSON 字符串**，包在 JS 单引号字面量里。所以改数据不需要
解析/重写 JS —— 取出字符串、解码、改 JSON、编码、写回。

每个租户的结构：

    {
      "tenant":   { id, name, client, brand, taxonomy, businessCase,
                    talkTrack, highlightEntities, labels?, nameFanout? },
      "snapshot": { apps, portfolios, journeys, agents, portfolioEdges,
                    valuePool, topStorm, scenarios, facts, … }
    }

`tenant` 会被 **zod 校验**（不过就抛异常，页面白屏），必需字段见 `validate_tenant()`。
`snapshot` 是自由结构，但节点数据全在里面（`apps[]` 的每一条就是一个节点）。

## 切换租户不用改代码

站点自带机制（在同一个 bundle 里）：

    ?tenant=<id>  →  localStorage["sip-active-tenant"]  →  兜底 "retail"

所以加完租户直接开 `http://localhost:8777/?tenant=myco` 就行。

## 用法

    python3 tenant_data.py list                  # 看有哪些租户、哪些有覆盖文件
    python3 tenant_data.py extract retail        # 导出到 tenant-data/retail.json 去编辑
    python3 tenant_data.py extract --all         # 全部导出（约 4.5 MB）
    python3 tenant_data.py check                 # 校验 tenant-data/ 下的覆盖文件
    python3 tenant_data.py apply [bundle]        # 写回 bundle（一般由构建脚本调用）

## 增删节点 vs 加租户

- **改节点**（应用名、事件数、层级…）：`extract` 一个租户 → 改 `snapshot.apps[]` → 构建时自动写回
- **加租户**：把某个租户的 JSON 复制一份，改 `tenant.id` 和 `snapshot.source.db`，另存为
  `tenant-data/<新id>.json`。文件名就是租户 id。
"""

import argparse
import json
import re
import sys
from pathlib import Path

# bundle 里那个模块的定位锚点。换构建版本时如果找不到，改这里。
ANCHOR = re.compile(r"89784,\s*\(e,t,o\)\s*=>\s*\{\s*t\.exports\s*=\s*JSON\.parse\('")
BUNDLE_NAME = "0wuztp2.9oz~8.js"

KEBAB = re.compile(r"^[a-z][a-z0-9-]*$")
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


# ── JS 字符串字面量编解码 ────────────────────────────────────────────

def js_decode(s: str) -> str:
    """
    把 JS 单引号字面量的内容解码成真实字符。

    **顺序很要紧**：`\\` 必须最先处理，否则 `\\'` 会被误读成 `\\` + `'`
    而提前结束字符串。
    """
    out, i, n = [], 0, len(s)
    simple = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
    while i < n:
        c = s[i]
        if c != "\\":
            out.append(c)
            i += 1
            continue
        if i + 1 >= n:
            out.append("\\")
            break
        e = s[i + 1]
        if e in simple:
            out.append(simple[e]); i += 2
        elif e == "u":
            out.append(chr(int(s[i + 2:i + 6], 16))); i += 6
        elif e == "x":
            out.append(chr(int(s[i + 2:i + 4], 16))); i += 4
        elif e == "\n":
            i += 2                                  # 行继续
        else:
            out.append(e); i += 2                   # \\ \' \" 等
    return "".join(out)


def js_encode(s: str) -> str:
    """反过来：真实字符 → JS 单引号字面量内容。"""
    return (s.replace("\\", "\\\\")
             .replace("'", "\\'")
             .replace("\n", "\\n")
             .replace("\r", "\\r"))


# ── bundle 读写 ─────────────────────────────────────────────────────

def read_bundle(path: Path):
    """返回 (整份文件文本, ALL_TENANTS 字典, 字符串在文件中的起止下标)。"""
    text = path.read_text(encoding="utf-8", errors="surrogateescape")
    m = ANCHOR.search(text)
    if not m:
        raise SystemExit(
            f"✗ 在 {path.name} 里找不到数据模块的锚点。\n"
            "  说明站点换了构建版本 —— 改 tenant_data.py 里的 ANCHOR 正则。")

    start = m.end()
    i, buf = start, []
    while i < len(text):
        if text[i] == "\\":
            buf.append(text[i:i + 2]); i += 2; continue
        if text[i] == "'":
            break
        buf.append(text[i]); i += 1
    else:
        raise SystemExit("✗ 字符串没有结束引号，文件可能损坏。")

    raw = "".join(buf)
    data = json.loads(js_decode(raw))
    return text, data, (start, i)


def write_bundle(path: Path, text: str, data: dict, span):
    """用 data 替换掉原来的 JSON 字符串。只在 span 范围内动，其余字节原样保留。"""
    start, end = span
    payload = json.dumps(data, ensure_ascii=True, separators=(",", ":"))
    encoded = js_encode(payload)
    new_text = text[:start] + encoded + text[end:]
    path.write_text(new_text, encoding="utf-8", errors="surrogateescape")
    return len(payload)


# ── 校验（对齐页面里的 zod schema）──────────────────────────────────

TALK_KEYS = ["constellation", "serviceOps", "engOps", "businessOps",
             "architecture", "finops", "securityOps", "agents", "valuePool"]


def validate_tenant(t: dict):
    """
    照着 bundle 里的 zod schema 检查 `tenant` 部分。

    **一定要过** —— 页面是 `f.parse(t)` 硬校验，不过直接抛异常、整页白屏，
    而且报错在压缩过的代码里很难看懂。
    """
    errs = []

    def need(d, k, path=""):
        if not isinstance(d, dict) or k not in d or d[k] in (None, ""):
            errs.append(f"{path}{k} 缺失或为空")

    def s(d, k, path=""):
        need(d, k, path)
        if isinstance(d, dict) and not isinstance(d.get(k), str):
            errs.append(f"{path}{k} 必须是字符串")

    need(t, "id")
    if isinstance(t.get("id"), str) and not KEBAB.match(t["id"]):
        errs.append(f"id 必须是 kebab-case（小写字母开头，只含 a-z0-9-）：{t['id']!r}")
    s(t, "name"); s(t, "industry"); s(t, "demoTitle")

    c = t.get("client") or {}
    s(c, "displayName", "client.")
    if "ticker" in c and not isinstance(c["ticker"], str):
        errs.append("client.ticker 必须是字符串")

    b = t.get("brand") or {}
    for k in ("accentHex", "accentInkHex"):
        s(b, k, "brand.")
        if isinstance(b.get(k), str) and not HEX.match(b[k]):
            errs.append(f"brand.{k} 必须是 #RRGGBB：{b[k]!r}")

    tax = t.get("taxonomy") or {}
    for k in ("portfolios", "appArchetypes"):
        if not isinstance(tax.get(k), list) or not tax[k]:
            errs.append(f"taxonomy.{k} 必须是非空数组")
    for i, p in enumerate(tax.get("portfolios") or []):
        need(p, "id", f"taxonomy.portfolios[{i}].")
        need(p, "name", f"taxonomy.portfolios[{i}].")
        ti = p.get("tier")
        if not isinstance(ti, int) or not 1 <= ti <= 3:
            errs.append(f"taxonomy.portfolios[{i}].tier 必须是 1~3 的整数")
    for i, a in enumerate(tax.get("appArchetypes") or []):
        for k in ("name", "portfolio"):
            need(a, k, f"taxonomy.appArchetypes[{i}].")
        if a.get("tier") not in ("T1", "T2", "T3"):
            errs.append(f'taxonomy.appArchetypes[{i}].tier 必须是 "T1"/"T2"/"T3"')

    bc = t.get("businessCase") or {}
    for k in ("baselineUsdM", "opportunityUsdM", "roiMultiplier"):
        v = bc.get(k)
        if not isinstance(v, (int, float)) or v <= 0:
            errs.append(f"businessCase.{k} 必须是正数")
    s(bc, "splitNarrative", "businessCase.")

    tt = t.get("talkTrack") or {}
    for k in TALK_KEYS:
        s(tt, k, "talkTrack.")

    he = t.get("highlightEntities") or {}
    for k in ("stormIncident", "anchorApp", "anchorChange"):
        s(he, k, "highlightEntities.")

    if "labels" in t:
        for k in ("criticalLong", "criticalShort", "criticalCaption",
                  "freezeLong", "freezeShort", "peakSeasonNoun"):
            s(t["labels"], k, "labels.")

    return errs


def validate_snapshot(snap: dict):
    """snapshot 没有 zod 校验，但缺这些页面会画不出来。"""
    errs = []
    for k in ("apps", "portfolios", "journeys", "facts"):
        if not isinstance(snap.get(k), (list, dict)) or not snap.get(k):
            errs.append(f"snapshot.{k} 缺失或为空")
    apps = snap.get("apps") or []
    pids = {p.get("id") for p in (snap.get("portfolios") or [])}
    orphan = [a.get("appKey") for a in apps if a.get("portfolioId") not in pids]
    if orphan:
        errs.append(f"{len(orphan)} 个 app 的 portfolioId 找不到对应 portfolio"
                    f"（前几个：{orphan[:3]}）—— 它们不会出现在图上")
    return errs


# ── 命令 ────────────────────────────────────────────────────────────

def find_bundle(here: Path, explicit=None) -> Path:
    if explicit:
        return Path(explicit)
    # 产物在仓库的 public/（Vite 按根伺服，/_next/… 才对得上）；
    # 源在 Chrome 保存的 _files/。前者优先 —— 那是当前生效的那份。
    for cand in [here.parent / "public/_next/static/chunks" / BUNDLE_NAME,
                 here / "SIP · The Constellation · Acme Retail_files" / BUNDLE_NAME]:
        if cand.is_file():
            return cand
    raise SystemExit(f"✗ 找不到 {BUNDLE_NAME}。用参数指定路径。")


def cmd_list(args):
    bundle = find_bundle(Path(__file__).parent, args.bundle)
    _, data, _ = read_bundle(bundle)
    tdir = Path(__file__).parent / "tenant-data"
    print(f"bundle: {bundle}")
    print(f"\n{'租户 id':<20} {'企业名':<24} {'apps':>6}  覆盖文件")
    print("-" * 66)
    for k in sorted(data):
        t = data[k].get("tenant", {})
        n = len(data[k].get("snapshot", {}).get("apps", []))
        ov = "✓ " + f"{k}.json" if (tdir / f"{k}.json").is_file() else ""
        print(f"{k:<20} {str(t.get('client',{}).get('displayName'))[:23]:<24} {n:>6}  {ov}")
    extra = [f.stem for f in sorted(tdir.glob("*.json"))] if tdir.is_dir() else []
    new = [x for x in extra if x not in data]
    if new:
        print(f"\n覆盖文件里还有 bundle 中没有的租户（构建时会新增）：{new}")


def cmd_extract(args):
    bundle = find_bundle(Path(__file__).parent, args.bundle)
    _, data, _ = read_bundle(bundle)
    tdir = Path(__file__).parent / "tenant-data"
    tdir.mkdir(exist_ok=True)

    ids = sorted(data) if args.all else args.tenants
    if not ids:
        raise SystemExit("✗ 指定租户 id，或用 --all")
    for k in ids:
        if k not in data:
            print(f"✗ 没有租户 {k!r}。可选：{', '.join(sorted(data))}", file=sys.stderr)
            continue
        p = tdir / f"{k}.json"
        p.write_text(json.dumps(data[k], ensure_ascii=False, indent=2), encoding="utf-8")
        n = len(data[k].get("snapshot", {}).get("apps", []))
        print(f"✓ {p}  ({p.stat().st_size/1024:.0f} KB, {n} apps)")


def cmd_check(args):
    tdir = Path(__file__).parent / "tenant-data"
    files = sorted(tdir.glob("*.json"))
    if not files:
        print("（tenant-data/ 是空的，没有覆盖文件）")
        return 0
    bad = 0
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"✗ {f.name}: JSON 解析失败 —— {e}"); bad += 1; continue
        if f.stem != (d.get("tenant") or {}).get("id"):
            print(f"✗ {f.name}: 文件名和 tenant.id 不一致"
                  f"（文件名 {f.stem!r}，tenant.id {d.get('tenant',{}).get('id')!r}）")
            bad += 1
        errs = validate_tenant(d.get("tenant") or {}) + validate_snapshot(d.get("snapshot") or {})
        if errs:
            bad += 1
            print(f"✗ {f.name}:")
            for e in errs[:12]:
                print(f"    - {e}")
            if len(errs) > 12:
                print(f"    … 还有 {len(errs)-12} 条")
        else:
            n = len((d.get("snapshot") or {}).get("apps") or [])
            print(f"✓ {f.name}  ({n} apps)")
    print(f"\n{len(files)} 个覆盖文件，{bad} 个有问题")
    return 1 if bad else 0


def apply_overrides(bundle: Path, tdir: Path, verbose=True):
    """
    把 tenant-data/*.json 写回 bundle。

    构建脚本调用这个 —— 注意要传**输出目录里那份**，别改源文件，
    这样重建才是可重复的。
    """
    files = sorted(tdir.glob("*.json")) if tdir.is_dir() else []
    if not files:
        if verbose:
            print("  （tenant-data/ 为空，数据保持原样）")
        return {"replaced": [], "added": []}

    text, data, span = read_bundle(bundle)
    replaced, added = [], []
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        tid = (d.get("tenant") or {}).get("id") or f.stem
        (replaced if tid in data else added).append(tid)
        data[tid] = d

    size = write_bundle(bundle, text, data, span)
    if verbose:
        if replaced:
            print(f"  覆盖租户：{', '.join(replaced)}")
        if added:
            print(f"  新增租户：{', '.join(added)}")
        print(f"  数据体积 {size/1024/1024:.2f} MB")
    return {"replaced": replaced, "added": added}


def cmd_apply(args):
    bundle = find_bundle(Path(__file__).parent, args.bundle)
    tdir = Path(__file__).parent / "tenant-data"
    r = apply_overrides(bundle, tdir)
    if not r["replaced"] and not r["added"]:
        return 0
    print(f"\n✓ 已写回 {bundle}")
    for tid in r["added"]:
        print(f"  新租户可用： http://localhost:8777/?tenant={tid}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="读写离线 bundle 里的租户节点数据")
    ap.add_argument("--bundle", help=f"{BUNDLE_NAME} 的路径（默认自动找）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="列出 bundle 里的租户").set_defaults(func=cmd_list)

    e = sub.add_parser("extract", help="导出到 tenant-data/ 去编辑")
    e.add_argument("tenants", nargs="*", help="租户 id")
    e.add_argument("--all", action="store_true", help="全部导出")
    e.set_defaults(func=cmd_extract)

    sub.add_parser("check", help="校验 tenant-data/ 下的覆盖文件").set_defaults(func=cmd_check)
    sub.add_parser("apply", help="写回 bundle").set_defaults(func=cmd_apply)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
