#!/usr/bin/env bash
#
# PreToolUse hook：**提交前查 changelog 版本号有没有撞车**，撞了就拦。
#
# ## 为什么需要它
#
# 本仓 changelogs/ 有 134 个文件，命名是 `v<X.Y.Z>-<slug>.md` —— **版本号在文件名里，
# 而文件名不同 ⇒ git 合并时不会冲突**。实测踩过：我写了 `v2.6.2-…`，
# 同事也在 main 上写了 `v2.6.2-…`，**git 全程静默**，两个文件并存，
# 谁都没收到任何提示，直到有人去数版本号。
#
# 这是典型的"两个绿信号互相矛盾"：提交成功、push 成功、CI 绿 —— 但版本号已经重了。
#
# ## 两条判据
#
#   1. **工作区**：`changelogs/` 下已存在同版本号、不同文件名的文件
#   2. **git 历史（含所有分支）**：任何分支上新增过同版本号的文件
#
# 判据 2 的必要性：撞车往往发生在我还没 fetch 的时候 —— 同事的文件在 origin/main 上，
# 我的工作区里根本看不到。`--all` 覆盖已 fetch 的远端分支。
#
# ⚠️ **已知覆盖边界**：若同事的提交尚未 fetch，判据 2 也看不到。
# 那种情况由同目录的 `git-push-guard.sh` 在 push 时兜住（落后的 push 会被拦）。
# 两个 hook 是互补的，不是一个的冗余。
#
# ## 退出码契约（**实测确认**）
#
#   exit 0 → 放行（stdout/stderr 都不显示）
#   exit 2 → 阻断，stderr 喂回模型
#   exit 1 → **不阻断**（fail-open）—— 所以本脚本刻意不用 `set -e`，
#           所有"查不出来"的分支显式 exit 0，只有一个地方 exit 2。

set -uo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
[ -d changelogs ] || exit 0

# 只看本次**新增**的 changelog（改动已有文件不算撞号）
added=$(git diff --cached --name-only --diff-filter=A -- 'changelogs/*.md' 2>/dev/null)
[ -n "$added" ] || exit 0

# 两条判据会**同时命中同一个文件**（工作区里那个，也一定在 git 历史里），
# 所以先收集到一起去重，再格式化 —— 否则同一行会打印两遍，读起来像是两个冲突。
pairs=""
for f in $added; do
  base=$(basename "$f")
  ver=$(printf '%s' "$base" | sed -nE 's/^(v[0-9]+\.[0-9]+\.[0-9]+).*/\1/p')
  [ -n "$ver" ] || continue

  # 判据 1：工作区里已有同版本的**别的**文件
  hit=$(find changelogs -maxdepth 1 -name "${ver}-*" -type f 2>/dev/null | grep -v "/${base}$")

  # 判据 2：git 历史（含已 fetch 的所有分支）里新增过同版本的文件
  hist=$(git log --all --diff-filter=A --name-only --format= -- 'changelogs/*' 2>/dev/null \
         | grep -E "^changelogs/${ver}-" | grep -v "^${f}$")

  for h in $hit $hist; do
    [ -n "$h" ] && pairs="${pairs}${ver}\t${h}\n"
  done
done

[ -n "$pairs" ] || exit 0

conflicts=$(printf "$pairs" | sort -u | awk -F'\t' '{ printf "  · %s 已被 %s 占用\n", $1, $2 }')

# 给出当前最大版本，省得人去数 134 个文件名
maxv=$(ls changelogs/ 2>/dev/null \
       | sed -nE 's/^(v[0-9]+\.[0-9]+\.[0-9]+).*/\1/p' \
       | sort -V | tail -1)

cat >&2 <<EOF
拦截：changelog 版本号撞车。

$(printf "$conflicts")
版本号写在文件名里，**文件名不同 → git 合并时不会冲突**，所以这种撞车
全程静默：提交成功、push 成功、CI 绿，但版本号已经重了（实测踩过）。

当前仓库最大版本：${maxv:-（读不出）}
改用下一个版本号，或把这次的改动并进已存在的那个 changelog。
EOF

exit 2
