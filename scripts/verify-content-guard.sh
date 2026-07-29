#!/usr/bin/env bash
# 내부 콘텐츠 차단 가드 회귀 검증 (보안 스캔 F11)
#   CI 기본 설정(core.quotepath=true)에서 한글 볼트 경로가 실제로 차단되는지 본다.
set -uo pipefail
WT="${1:-$(git rev-parse --show-toplevel)}"   # 검사할 워크트리(기본: 현재 레포)
LAB=$(mktemp -d)
cd "$LAB" || exit 1
git init -q .
git config core.quotepath true            # ← CI 기본값. 로컬 false 설정에 기대지 않는다.
git config user.email t@t; git config user.name t

mkdir -p KEI-행정가이드 rule_files research_rule_files
echo "제1조(목적) 이 규정은…" > KEI-행정가이드/급여규정.md
echo x > rule_files/원본.hwp
echo x > research_rule_files/연구행정.pdf
echo ok > 정상파일.md
git add -A 2>/dev/null

pass=0; fail=0
say() { if [ "$1" = ok ]; then echo "  ✅ $2"; pass=$((pass+1)); else echo "  ❌ $2"; fail=$((fail+1)); fi; }

# ── ① CI 워크플로의 ls-files 가드
CI_CMD=$(grep -oE "git ls-files[^;]*grep -E '[^']*'" "$WT/.github/workflows/security-scan.yml" | head -1)
if eval "$CI_CMD" >/dev/null 2>&1; then
  say ok "CI 가드: 한글 볼트 커밋을 차단"
else
  say no "CI 가드: 한글 볼트가 통과함 (fail-open)"
fi

# ── ② pre-commit 훅
if (cd "$LAB" && bash "$WT/.githooks/pre-commit" >/dev/null 2>&1); then
  say no "pre-commit: 한글 볼트가 통과함 (fail-open)"
else
  say ok "pre-commit: 한글 볼트 스테이징을 차단"
fi

# ── ③ 오탐 없어야: 내부 콘텐츠가 없으면 통과해야 한다
rm -rf KEI-행정가이드 rule_files research_rule_files
git rm -rq --cached KEI-행정가이드 rule_files research_rule_files 2>/dev/null
git add -A 2>/dev/null
if eval "$CI_CMD" >/dev/null 2>&1; then
  say no "CI 가드: 깨끗한 트리를 오탐으로 차단"
else
  say ok "CI 가드: 깨끗한 트리는 통과(오탐 없음)"
fi
if (cd "$LAB" && bash "$WT/.githooks/pre-commit" >/dev/null 2>&1); then
  say ok "pre-commit: 깨끗한 트리는 통과(오탐 없음)"
else
  say no "pre-commit: 깨끗한 트리를 오탐으로 차단"
fi

rm -rf "$LAB"
echo "  → ${pass}통과 / ${fail}실패"
[ "$fail" -eq 0 ]
