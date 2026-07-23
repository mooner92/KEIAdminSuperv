#!/usr/bin/env bash
# daily_run.sh — 일일 자가평가 크론 진입(docs/58 §7). 06:00 KST crontab에서 호출.
# GPU 가드 → 생성 → 답변 → 채점 → 공개. 실패 시 exit≠0(로그로 원인 추적).
set -e
cd "$(dirname "$0")"
PY=../tools/.venv/bin/python
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
echo "[$(date)] 완료"
