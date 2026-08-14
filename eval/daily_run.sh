#!/usr/bin/env bash
# daily_run.sh — 일일 자가평가 크론 진입(docs/58 §7). 06:00 KST crontab에서 호출.
# GPU 가드 → 생성 → 답변 → 채점 → 공개. 실패 시 exit≠0(로그로 원인 추적).
set -e
# 겹침 방지(2026-08-02, 주말 8시간 주기 도입과 함께): 이전 실행이 아직 돌면 스킵.
# 500문항 실행이 ~5시간이라 GPU 경합 시 다음 주기와 겹칠 수 있다 — 겹치면 같은 날짜
# 파일을 두 실행이 덮어쓴다(08-01 저녁 재실행 사고와 동형). 락이 그 경로를 차단한다.
exec 9>/tmp/kei-daily-eval.lock
flock -n 9 || { echo "[$(date)] 이전 실행 진행 중 — 이번 주기 스킵"; exit 0; }
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

# 아침 분석서(1단, LLM 0회 — specs/12). daily_publish 다음: 채점 결과를 사람이 읽는 분석으로.
# ⛔ 실패해도 크론은 계속 — 정본은 graded.json·게시판이고 분석서는 파생이다.
$PY daily_report.py --date "$DATE" || true

# prod 게시판 동기화(docs/58 — dev 크론이 유일 평가원, prod는 결과만 미러). PROD_QUALITY_DIR
# 미설정/미존재 시 조용히 skip(dev 단독 운용 안전). server.js가 web/public/quality를 직서빙 →
# 재빌드 불필요. ⛔ quality 데이터만 복사(코드·볼트 무관).
PROD_Q="${PROD_QUALITY_DIR:-/KEIAdminSuperv/web/public/quality}"
if [ -d "$(dirname "$PROD_Q")" ]; then
  # ⚠ 스크립트는 eval/에서 실행된다(cd "$(dirname "$0")") — 소스는 반드시 상위 경로.
  #    실측 2026-07-27: 상대경로 'web/...'가 eval/web/...을 가리켜 **prod 동기화가 매일 조용히 실패**했다.
  rsync -a --delete ../web/public/quality/ "$PROD_Q"/ && echo "[$(date)] prod 게시판 동기화 → $PROD_Q"
fi
# MLflow 병행 기록(specs/10 — 실패해도 크론 정상. 정본은 graded.json·게시판 그대로)
MLFLOW_TRIGGER=cron $PY mlflow_log.py --date "$DATE" || true
# 수술 브리핑 — 수술대기를 Claude Code가 바로 수술할 자족 md로(Slack엔 붙여넣기 한 줄만)
$PY surgery_brief.py --date "$DATE" || true
# 일일 다이제스트+재시험 급락 감지 → 🔔+Slack #horong (docs/66 §3.3. 실패해도 크론은 정상 종료)
$PY eval_notice.py --digest --date "$DATE" || true
# 데드맨 해제 겸 신선도 확인(정상 종료 시 갱신 시각이 갱신되므로 여기선 통과만 확인)
$PY eval_notice.py --deadman || true
echo "[$(date)] 완료"
