#!/usr/bin/env bash
# backup-appdb.sh — KEI 행정 LLM 사용자 데이터(app.db) + JWT 서명키(.app_secret) 백업 (v1 스펙 B1).
#
# - python3 sqlite3.Connection.backup(): 온라인 백업 API(WAL 중에도 일관 스냅샷) — 파일 cp보다 안전.
#   (이 서버에 sqlite3 CLI가 없어 python3 표준 모듈 사용 — 동일 API)
# - 대상: prod(/KEIAdminSuperv/tools)와 dev(/home/mhchoi/kei-dev-0703/tools) 모두(읽기 전용 — prod 동결 원칙과 무관).
# - 저장: ~/kei-backups/YYYY-MM-DD/ (⛔ repo 밖 — 사용자 데이터 커밋 금지), 기본 14일 보존 로테이션.
# - 설치: crontab -e →  10 3 * * * /home/mhchoi/kei-dev-0703/deploy/backup-appdb.sh >> ~/kei-backups/backup.log 2>&1
set -euo pipefail

DEST_ROOT="${KEI_BACKUP_DIR:-$HOME/kei-backups}"
KEEP_DAYS="${KEI_BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%F)"
DEST="$DEST_ROOT/$STAMP"
mkdir -p "$DEST"

backup_one() { # $1=라벨 $2=tools 디렉터리
  local label="$1" dir="$2"
  if [ -f "$dir/app.db" ]; then
    python3 - "$dir/app.db" "$DEST/app-$label.db" <<'PY'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect(src)
d = sqlite3.connect(dst)
with d:
    s.backup(d)          # 온라인 백업(일관 스냅샷)
ok = d.execute("PRAGMA integrity_check;").fetchone()[0]
s.close(); d.close()
print(f"integrity: {ok}")
assert ok == "ok", f"integrity_check 실패: {ok}"
PY
    echo "[$(date +%T)] $label app.db → $DEST/app-$label.db"
  else
    echo "[$(date +%T)] $label app.db 없음($dir) — 건너뜀"
  fi
  if [ -f "$dir/.app_secret" ]; then
    cp -p "$dir/.app_secret" "$DEST/app_secret-$label"
    chmod 600 "$DEST/app_secret-$label"
  fi
}

backup_one prod /KEIAdminSuperv/tools
backup_one dev  /home/mhchoi/kei-dev-0703/tools

# 로테이션: KEEP_DAYS 초과 백업 디렉터리 제거
find "$DEST_ROOT" -maxdepth 1 -type d -name '20??-??-??' -mtime +"$KEEP_DAYS" -exec rm -rf {} \; 2>/dev/null || true
echo "[$(date +%T)] 완료 — 보존 ${KEEP_DAYS}일, 대상 $DEST_ROOT"
