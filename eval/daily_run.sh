#!/usr/bin/env bash
# daily_run.sh — 일일 자가평가 크론 진입(docs/58 §7). 06:00 KST crontab에서 호출.
# GPU 가드 → 생성 → 답변 → 채점 → 공개. 실패 시 exit≠0(로그로 원인 추적).
set -e
cd "$(dirname "$0")"
PY=../tools/.venv/bin/python

# 실패 알림(2026-07-25, docs/58 §7b): exit≠0으로 끝나면 관리자 🔔에 즉시 알린다.
# 이메일 경로가 없어 인앱 알림(MaintNotice)에 태운다 — 조용히 죽는 것을 막는 장치.
trap 'rc=$?; [ $rc -ne 0 ] && $PY eval_notice.py --fail "단계 실패(exit $rc) — 로그 확인 필요" || true' EXIT
DATE=${1:-$(date +%F)}

# GPU 가드 — 두 GPU 모두 임계(21GB) 초과 점유면 당일 스킵(서비스 우선)
FREE=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | sort -n | head -1)
if [ "${FREE:-0}" -gt 21000 ]; then
  echo "[$(date)] GPU 과점유(${FREE}MiB) — 당일 스킵"; exit 0
fi

echo "[$(date)] 일일 자가평가 시작 ($DATE)"
$PY daily_gen.py --sync          # 0) 골든 자가검증(재색인 대응: 재바인딩·stale·retire)
$PY daily_gen.py --date "$DATE"
$PY daily_answer.py --date "$DATE"
$PY daily_grade.py --date "$DATE"
$PY daily_publish.py --date "$DATE"

# prod 게시판 동기화(docs/58 — dev 크론이 유일 평가원, prod는 결과만 미러). PROD_QUALITY_DIR
# 미설정/미존재 시 조용히 skip(dev 단독 운용 안전). server.js가 web/public/quality를 직서빙 →
# 재빌드 불필요. ⛔ quality 데이터만 복사(코드·볼트 무관).
PROD_Q="${PROD_QUALITY_DIR:-/KEIAdminSuperv/web/public/quality}"
if [ -d "$(dirname "$PROD_Q")" ]; then
  rsync -a --delete web/public/quality/ "$PROD_Q"/ && echo "[$(date)] prod 게시판 동기화 → $PROD_Q"
fi
# 데드맨 해제 겸 신선도 확인(정상 종료 시 갱신 시각이 갱신되므로 여기선 통과만 확인)
$PY eval_notice.py --deadman || true
echo "[$(date)] 완료"
