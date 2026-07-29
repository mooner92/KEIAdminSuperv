#!/usr/bin/env bash
# backup-appdb.sh — KEI 행정 LLM 백업: 진실원천(볼트·원본) + 운영상태(app.db) + 시크릿.
#
# - python3 sqlite3.Connection.backup(): 온라인 백업 API(WAL 중에도 일관 스냅샷) — 파일 cp보다 안전.
#   (이 서버에 sqlite3 CLI가 없어 python3 표준 모듈 사용 — 동일 API)
# - 대상: prod(/KEIAdminSuperv)와 dev(/home/mhchoi/kei-dev-0703) 모두(읽기 전용 — prod 동결 원칙과 무관).
# - 저장: ~/kei-backups/YYYY-MM-DD/ (⛔ repo 밖 — 사용자 데이터·규정 원문 커밋 금지), 기본 14일 보존.
# - 설치: crontab -e →  10 3 * * * /home/mhchoi/kei-dev-0703/deploy/backup-appdb.sh >> ~/kei-backups/backup.log 2>&1
#
# ⛔ 권한 규약(2026-07-29, docs/63 §11): 백업 산출물은 **전부 0600/0700**이다.
#    원본 app.db를 0600으로 잠가도 백업이 0644면 보호가 무의미하다.
#    실제로 이 스크립트가 14일치 0644 사본을 만들고 있었다(30개 발견·교정).
#    → 새 파일은 만들자마자 chmod, 디렉터리는 0700. umask도 이중으로 건다.
umask 077
set -euo pipefail

DEST_ROOT="${KEI_BACKUP_DIR:-$HOME/kei-backups}"
KEEP_DAYS="${KEI_BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%F)"
DEST="$DEST_ROOT/$STAMP"
mkdir -p "$DEST"
chmod 700 "$DEST_ROOT" "$DEST"

# 원본 자료(rule_files·research_rule_files)는 크고 거의 안 바뀐다 → 월 1회만.
MONTH="$(date +%Y-%m)"
SRC_MARK="$DEST_ROOT/.sources-$MONTH.done"

backup_db() { # $1=라벨 $2=tools 디렉터리
  local label="$1" dir="$2"
  if [ -f "$dir/app.db" ]; then
    python3 - "$dir/app.db" "$DEST/app-$label.db" <<'PY'
import os, sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect(src)
d = sqlite3.connect(dst)
with d:
    s.backup(d)          # 온라인 백업(일관 스냅샷)
ok = d.execute("PRAGMA integrity_check;").fetchone()[0]
s.close(); d.close()
os.chmod(dst, 0o600)     # ⛔ 해시·전 사용자 채팅 — 소유자 전용
print(f"integrity: {ok}")
assert ok == "ok", f"integrity_check 실패: {ok}"
PY
    chmod 600 "$DEST/app-$label.db"
    echo "[$(date +%T)] $label app.db → $DEST/app-$label.db"
  else
    echo "[$(date +%T)] $label app.db 없음($dir) — 건너뜀"
  fi
  # JWT 서명키 — 분실 시 전체 세션 무효화
  if [ -f "$dir/.app_secret" ]; then
    cp -p "$dir/.app_secret" "$DEST/app_secret-$label"
    chmod 600 "$DEST/app_secret-$label"
  fi
  # 검증 계정 비밀번호(docs/63 §5) — 분실 시 픽스처 계정으로 로그인 불가
  if [ -f "$dir/.test_credentials" ]; then
    cp -p "$dir/.test_credentials" "$DEST/test_credentials-$label"
    chmod 600 "$DEST/test_credentials-$label"
  fi
}

backup_vault() { # $1=라벨 $2=레포 루트
  local label="$1" root="$2"
  # ⛔ 볼트가 진짜 진실원천이다. chroma·out은 여기서 재생성되지만, 볼트는 어디서도 재생성 못 한다
  #   (HWP 변환 + 사람 검수 + 가이드 집필이 들어간 결과물).
  #   git에는 절대 올라가지 않으므로(공개 레포) **파일 백업이 유일한 안전망**이다.
  if [ -d "$root/KEI-행정가이드" ]; then
    tar czf "$DEST/vault-$label.tar.gz" -C "$root" "KEI-행정가이드" 2>/dev/null
    chmod 600 "$DEST/vault-$label.tar.gz"
    local n; n=$(find "$root/KEI-행정가이드" -name '*.md' | wc -l)
    echo "[$(date +%T)] $label 볼트(md ${n}개) → $DEST/vault-$label.tar.gz ($(du -h "$DEST/vault-$label.tar.gz" | cut -f1))"
  fi
}

backup_sources() { # $1=레포 루트 — 월 1회
  local root="$1"
  [ -f "$SRC_MARK" ] && { echo "[$(date +%T)] 원본 자료: ${MONTH} 이미 백업됨 — 건너뜀"; return; }
  local any=0
  for d in rule_files research_rule_files; do
    if [ -d "$root/$d" ]; then
      tar czf "$DEST/source-$d.tar.gz" -C "$root" "$d" 2>/dev/null
      chmod 600 "$DEST/source-$d.tar.gz"
      echo "[$(date +%T)] 원본 $d → $DEST/source-$d.tar.gz ($(du -h "$DEST/source-$d.tar.gz" | cut -f1))"
      any=1
    fi
  done
  [ "$any" = 1 ] && : > "$SRC_MARK" && chmod 600 "$SRC_MARK"
}

backup_db    prod /KEIAdminSuperv/tools
backup_db    dev  /home/mhchoi/kei-dev-0703/tools
backup_vault prod /KEIAdminSuperv
backup_vault dev  /home/mhchoi/kei-dev-0703
backup_sources    /KEIAdminSuperv

# 로테이션: KEEP_DAYS 초과 백업 디렉터리 제거
find "$DEST_ROOT" -maxdepth 1 -type d -name '20??-??-??' -mtime +"$KEEP_DAYS" -exec rm -rf {} \; 2>/dev/null || true

# ⛔ 사후 방어: 어떤 경로로든 느슨한 산출물이 생기면 여기서 잡는다(위 chmod의 백스톱)
loose=$(find "$DEST_ROOT" -type f -perm /o+rwx -o -type f -perm /g+w 2>/dev/null | wc -l)
if [ "$loose" -gt 0 ]; then
  echo "[$(date +%T)] ⚠ 권한이 느슨한 백업 파일 ${loose}개 발견 — 0600으로 교정"
  find "$DEST_ROOT" -type f -exec chmod 600 {} \; 2>/dev/null || true
  find "$DEST_ROOT" -type d -exec chmod 700 {} \; 2>/dev/null || true
fi

echo "[$(date +%T)] 완료 — 보존 ${KEEP_DAYS}일, 대상 $DEST_ROOT ($(du -sh "$DEST" | cut -f1))"
