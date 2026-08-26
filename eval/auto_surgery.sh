#!/usr/bin/env bash
# auto_surgery.sh — 매일 아침 수술을 무인 Claude Code로 돌린다(운영자 요청 2026-08-26:
# "매일 같은 작업하는데 말하는 것도 지겹다").
#
# 흐름: 03시 평가 → 04:40 분석서·브리핑 → **10시 이 스크립트** → 관문 → autosurgery/<날짜>
#       브랜치에 커밋 → Slack 한 줄 + LATEST-SURGERY.md(세션이 읽는 보고서)
#
# ⛔ dev/main에는 절대 커밋하지 않는다. 무인 수술의 위험은 "조용한 자기 채점 조작"이다 —
#    잘 맞히는 문항을 지우거나 게이트를 무르게 해 점수만 올리는 변경. 그래서
#    ① 프롬프트(지시) ② 결정적 관문(강제) ③ 별도 브랜치(사람 머지) 3중으로 막는다.
#    maint_executor.py(오토픽스)와 같은 구조이되, 이쪽은 측정·회귀를 돌려야 해 Bash를 허용하고
#    대신 변경 파일 화이트리스트를 eval/ 로 좁게 잡는다.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
DATE="${1:-$(date +%F)}"
LOG="$HOME/kei-backups/auto-surgery.log"
BR_FILE="eval/daily/${DATE}.surgery.md"
REPORT="eval/daily/LATEST-SURGERY.md"   # 세션이 읽는 최신 보고서(항상 덮어씀)
BRANCH="autosurgery/${DATE}"
PY="$ROOT/tools/.venv/bin/python"
say() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
notify() { "$PY" "$ROOT/eval/auto_surgery_notify.py" --status "$1" --date "$DATE" --detail "$2" || true; }
revert() { git checkout -- . 2>/dev/null; git clean -fdq eval/ 2>/dev/null; }

# ── 선행 조건 ────────────────────────────────────────────────────────────────
# ⚠ 디스크를 먼저 본다(2026-08-26 실측: 루트 100%로 Bash조차 못 돌았다).
#   여유가 없으면 시작하지 않는다 — 절반만 쓰인 파일이 안 하느니만 못하다.
AVAIL_G=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if [ "${AVAIL_G:-0}" -lt 10 ]; then
  say "⛔ 디스크 여유 ${AVAIL_G}G(<10G) — 생략"; notify blocked "디스크 여유 ${AVAIL_G}G"; exit 0
fi
[ -f "$BR_FILE" ] || { say "브리핑 없음 — 수술대기 0건이거나 평가 미완료"; exit 0; }
command -v claude >/dev/null || { say "⛔ claude CLI 없음"; notify blocked "claude CLI 없음"; exit 1; }
git diff --quiet || { say "⛔ 미커밋 변경 있음 — 사람이 작업 중으로 보고 생략"; exit 0; }

START_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BASE=$(git rev-parse HEAD)

PROMPT="$(cat <<EOP
오늘(${DATE}) 자가평가 수술을 수행하라. 브리핑: ${BR_FILE}
맥락은 eval/daily/ 의 가장 최근 *.surgery-result.md 를 먼저 읽어 잡아라.

## 반드시 지킬 원칙 (실측으로 확립 — 어기면 관문이 전량 폐기한다)
1. **가설을 그대로 붙이지 마라.** 패턴을 발견하면 그 패턴 문항의 미정답률 vs 기저를 재고,
   유의미할 때만 게이트를 붙여라. 기각되면 **주석에 기각 근거를 남겨라**(그것도 성과다).
   최근 9개 가설 중 8개가 데이터에 기각됐다.
2. **잘 맞히는 문항을 지우지 마라.** 정답 이력이 있으면 은퇴 금지 — 자기 채점 조작이다.
   은퇴는 eval/golden_repair.py --retire 정본 도구로만.
3. **볼트(KEI-행정가이드/)·검수상태·tools/rag_core.py·web/ 을 건드리지 마라.** 원문 결함은
   검수 큐 소관이고 답변 경로 변경은 A/B 없이 금지다. 이번 수술의 사정거리는 eval/ 뿐이다.
4. **과거 회차 파일 재작성 금지** — 오늘 날짜 파일만 쓴다(전방 적용).
5. 지표가 움직였으면 **분모와 신뢰구간을 먼저 보라**(재시험 n≈46은 ±14%p). 구간 안이면 잡음이다.
   평일(≈200)과 주말(≈460)의 정답률을 직접 비교하지 마라 — 유형 구성이 달라 구성보정치를 쓴다.

## 할 일
- 브리핑 항목별 원인 분류(검색/생성/게이트/출제/채점) → 조치.
- 새로깨짐(🔻)이 있으면 최우선 — 어제 맞히던 게 오늘 깨진 것이다. 배포 인과를 실물 diff로 확인하라.
- 회귀를 돌려 통과를 확인하라(eval/test_*.py · python은 tools/.venv/bin/python).
- 결과를 eval/daily/${DATE}.surgery-result.md 에 남겨라(전날 형식: 지표표·핵심발견·조치·남은것·검증).
- **추가로 ${REPORT} 에 사람이 5줄로 읽을 요약을 써라**: 오늘 지표 한 줄 · 무엇을 고쳤나 ·
  무엇을 기각했나 · 사람이 봐야 할 것 · 다음 표적. (이 파일은 매일 덮어쓴다)
- ⛔ git commit/push 하지 마라. 커밋은 이 스크립트가 관문 통과 후 별도 브랜치에 한다.
EOP
)"

say "▶ 수술 시작 ${DATE} (base ${BASE:0:7})"
claude -p "$PROMPT" --output-format json --max-turns 120 \
       --allowedTools "Read,Glob,Grep,Edit,Write,Bash" 2>&1 | tail -c 3000 >> "$LOG"

# ── 결정적 관문 ──────────────────────────────────────────────────────────────
CHANGED=$( { git diff --name-only "$BASE"; git ls-files -o --exclude-standard; } | sed '/^$/d' | sort -u )
[ -z "$CHANGED" ] && { say "변경 없음 — 진단만 했거나 수술할 것이 없었다"; notify ok "변경 없음(진단만)"; exit 0; }

OUTSIDE=$(echo "$CHANGED" | grep -v '^eval/' || true)                       # ⓐ 사정거리 eval/
PAST=$(echo "$CHANGED" | grep '^eval/daily/' | grep -v "$DATE" \
        | grep -v 'LATEST-SURGERY' || true)                                  # ⓑ 과거 회차 불변
if [ -n "$OUTSIDE$PAST" ]; then
  say "⛔ 관문 위반 — 되돌림 · 밖:$(echo $OUTSIDE) 과거:$(echo $PAST)"
  revert; notify blocked "사정거리 밖/과거회차 변경: $(echo $OUTSIDE $PAST | cut -c1-160)"; exit 1
fi

FAIL=""                                                                      # ⓒ 회귀 전량 통과
for t in "$ROOT"/eval/test_*.py; do
  "$PY" "$t" >/dev/null 2>&1 || FAIL="$FAIL $(basename "$t")"
done
if [ -n "$FAIL" ]; then
  say "⛔ 회귀 실패 —$FAIL · 되돌림"; revert; notify blocked "회귀 실패:$FAIL"; exit 1
fi

# ── 별도 브랜치에 커밋(dev·main 무접촉) ──────────────────────────────────────
git checkout -q -B "$BRANCH" 2>/dev/null || { say "⛔ 브랜치 생성 실패"; revert; exit 1; }
git add eval/
git -c user.name="Horong AutoSurgery" -c user.email="noreply@anthropic.com" commit -q -m \
"fix(eval): ${DATE} 자동 수술

무인 Claude Code(claude -p)가 수행한 일일 수술. 관문 통과분만 담긴다
(사정거리 eval/ · 과거 회차 불변 · 회귀 전량 통과). ⛔ 사람이 검토·머지할 것.
상세: eval/daily/${DATE}.surgery-result.md · 요약: ${REPORT}

Co-Authored-By: Claude <noreply@anthropic.com>" || { say "커밋할 것 없음"; git checkout -q "$START_BRANCH"; exit 0; }

N=$(echo "$CHANGED" | wc -l)
git checkout -q "$START_BRANCH"     # 작업 브랜치는 원위치 — 사람 작업을 방해하지 않는다
say "✅ 완료 — ${N}건 변경 → ${BRANCH} (머지는 사람이)"
notify ok "파일 ${N}건 · 브랜치 ${BRANCH} · 회귀 전량 통과 — 검토 후 머지하세요"
