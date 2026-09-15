#!/usr/bin/env python3
"""
从 sip-platform.web.app 的公开 JS bundle 里抽出 Constellation 页面的全部数据。

## 为什么是这条路

那个站是 Next.js 应用，Constellation 页的内容**不是**从接口取的 —— 整份 estate
快照（apps / portfolios / journeys / 边 / valuePool …）以对象字面量的形式**打包在
客户端 JS 里**，随页面一起下发。也就是说：

  - 不需要密码（chunk 是公开静态资源，PasswordGate 只挡渲染）
  - 不需要点界面（数据本来就在，点只是把它显示出来）
  - 不产生任何写操作，对站点零负担

比抓 DOM 更完整：DOM 只渲染当前视口和当前选中的实体，而这里是全量。

## 用法

    python3 extract.py                      # 抓全部租户
    python3 extract.py --tenant retail      # 只要某个租户
    python3 extract.py --out ./data         # 指定输出目录
    python3 extract.py --list               # 只列出租户和规模，不写文件

只用标准库，无需 pip install。
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

SITE = "https://sip-platform.web.app"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
TIMEOUT = 60


# ── 网络 ────────────────────────────────────────────────────────────

def fetch(url, *, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", errors="replace")


def discover_chunks():
    """
    从首页 HTML 里发现本次构建的 chunk 列表。

    **不要硬编码 chunk 文件名** —— Next.js 的 chunk 名带内容哈希，站点一重新部署
    就全变了。每次从 HTML 现读，脚本才活得久。
    """
    html = fetch(SITE + "/")
    chunks = sorted(set(re.findall(r'/_next/static/chunks/[A-Za-z0-9._~\-]+\.js', html)))
    return html, chunks


# ── 从压缩过的 JS 里抠对象字面量 ──────────────────────────────────────

def match_brace(s, i):
    """
    从 s[i] == '{' 起做括号配对，**跳过字符串字面量**。

    不跳字符串的话，任何一个内容里带 `{` 或 `}` 的字符串都会让配对提前结束或跑飞。
    反斜杠转义也要一并处理，否则 \" 会被误判成字符串结尾。
    """
    if s[i] != "{":
        raise ValueError("expected {")
    depth = 0
    j = i
    n = len(s)
    while j < n:
        c = s[j]
        if c in "\"'":
            q = c
            j += 1
            while j < n:
                if s[j] == "\\":
                    j += 2
                    continue
                if s[j] == q:
                    break
                j += 1
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return j
        j += 1
    raise ValueError("unbalanced braces")


def relax_escapes(raw):
    """
    把 JS 合法但 JSON 非法的转义降级成字面量。

    典型的是 `\\'` —— JS 里合法，JSON 里 "\\'" 是非法转义序列，json.loads 直接抛
    Invalid \\escape。放宽之后这些字符串按原样保留。
    """
    out = []
    i = 0
    n = len(raw)
    while i < n:
        c = raw[i]
        if c == "\\" and i + 1 < n:
            nxt = raw[i + 1]
            if nxt in '"\\/bfnrtu':
                out.append(raw[i:i + 2])
                i += 2
                continue
            out.append(nxt)
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def extract_snapshots(js):
    """从一份 JS 源码里抠出所有 `"snapshot": {...}`。"""
    found = []
    for m in re.finditer(r'"snapshot":\s*\{', js):
        start = js.index("{", m.start())
        try:
            end = match_brace(js, start)
        except ValueError:
            continue
        raw = js[start:end + 1]
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            try:
                obj = json.loads(relax_escapes(raw))
            except json.JSONDecodeError:
                continue  # 真的抠不动就跳过，别让一个坏块毁掉整轮
        found.append((len(raw) + start, obj))  # 用位置做稳定排序键
    return found


def slug_for(snapshot):
    """
    给租户起个短名字。
    `synthetic:retail@42` → `retail`；`data/sicg.db` → `sicg`。
    """
    db = (snapshot.get("source") or {}).get("db") or "unknown"
    if ":" in db:
        db = db.split(":", 1)[1]
    db = db.split("@", 1)[0]
    db = db.replace("/", "-")
    if db.endswith(".db"):
        db = db[:-3]
    return re.sub(r"[^A-Za-z0-9._-]", "-", db).strip("-") or "unknown"


# ── 主流程 ──────────────────────────────────────────────────────────

def detect_active(chunks_js):
    """
    找出站点当前展示的是哪个租户。

    那段代码长这样（minify 后）：
        ACTIVE_TENANT_ID = (() => { try { ... return t } catch {} return "retail" })()

    **注意它在 JS chunk 里，不在 HTML 里** —— 第一版去 HTML 里找，永远匹配不到，
    结果就是列表里死活不出现那个 `*` 标记。
    """
    for js in chunks_js:
        if "ACTIVE_TENANT_ID" not in js:
            continue
        m = re.search(r'return\s*"([a-z0-9-]+)"\s*\}\s*\(\s*\)', js)
        if m:
            return m.group(1)
    return None


def collect(verbose=True):
    if verbose:
        print(f"→ 读取 {SITE}/")
    html, chunks = discover_chunks()
    if verbose:
        print(f"  发现 {len(chunks)} 个 chunk")

    by_tenant = {}
    scanned = []
    for i, path in enumerate(chunks, 1):
        try:
            js = fetch(SITE + path)
        except Exception as e:
            if verbose:
                print(f"  [{i}/{len(chunks)}] {path} 拉取失败：{e}")
            continue
        scanned.append(js)
        if '"snapshot"' not in js:
            if verbose:
                print(f"  [{i}/{len(chunks)}] {path:40} —")
            continue

        snaps = extract_snapshots(js)
        if verbose:
            print(f"  [{i}/{len(chunks)}] {path:40} 找到 {len(snaps)} 个快照")
        for order, snap in snaps:
            by_tenant[slug_for(snap)] = snap

    return html, by_tenant, detect_active(scanned)


def summarize(snap):
    f = snap.get("facts") or {}
    return {
        "db": (snap.get("source") or {}).get("db"),
        "generatedAt": snap.get("generatedAt"),
        "asOf": (snap.get("source") or {}).get("asOf"),
        "apps": f.get("apps"),
        "portfolios": f.get("portfolios"),
        "journeys": f.get("journeys"),
        "teams": f.get("teams"),
        "enterprise": (snap.get("enterprise") or {}).get("label"),
        "counts": {
            k: len(v) for k, v in snap.items() if isinstance(v, list)
        },
    }


def main():
    ap = argparse.ArgumentParser(description="导出 SIP Constellation 页面数据")
    ap.add_argument("--out", default="data", help="输出目录（默认 ./data）")
    ap.add_argument("--tenant", action="append", help="只要指定租户，可重复")
    ap.add_argument("--list", action="store_true", help="只列出租户，不写文件")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    html, tenants, active = collect(verbose=not args.quiet)
    if not tenants:
        print("✗ 没抽到任何快照。站点可能改版了 —— 检查是否还有 '\"snapshot\":{' 这种结构。", file=sys.stderr)
        return 1

    names = sorted(tenants)
    if args.tenant:
        want = {t.lower() for t in args.tenant}
        names = [n for n in names if n.lower() in want]
        if not names:
            print(f"✗ 没有匹配的租户。可选：{', '.join(sorted(tenants))}", file=sys.stderr)
            return 1

    print(f"\n{'租户':<18} {'企业':<18} {'apps':>6} {'folio':>6} {'jour':>5} {'teams':>6}  生成时间")
    print("-" * 92)
    for n in names:
        s = summarize(tenants[n])
        mark = " *" if n == active else "  "
        print(f"{n:<18} {str(s['enterprise'])[:17]:<18} {s['apps']:>6} {s['portfolios']:>6} "
              f"{s['journeys']:>5} {s['teams']:>6}  {s['generatedAt']}{mark}")
    if active:
        print(f"\n  * = 站点当前展示的租户（{active}）")

    if args.list:
        return 0

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    index = {"site": SITE, "activeTenant": active, "tenants": {}}
    for n in names:
        snap = tenants[n]
        (out / f"{n}.json").write_text(
            json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        index["tenants"][n] = summarize(snap)

    (out / "_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n✓ 写入 {len(names)} 个文件到 {out.resolve()}")
    print(f"  打开 viewer/index.html，载入 {out / (active or names[0])}.json" if active
          else f"  打开 viewer/index.html 载入数据")
    return 0


if __name__ == "__main__":
    sys.exit(main())
