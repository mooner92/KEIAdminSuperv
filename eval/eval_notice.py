#!/usr/bin/env python3
"""eval_notice.py — 자가평가 크론의 상태를 관리자 🔔(MaintNotice)로 알린다 (docs/58 §7b).

배경(2026-07-25): 크론이 실패하거나 아예 안 돌면 로그에만 남아 **아무도 몰랐다**("동작 안 한 줄
알았다"가 실제로 반복). 이메일 발송 경로가 없으므로, 이미 있는 인앱 알림(관리자 🔔 배지 +
브라우저 알림)에 태운다.

두 가지 모드:
  --fail "<사유>"   크론 스크립트가 exit≠0으로 끝날 때(trap) 즉시 실패 알림
  --deadman         품질 데이터가 N시간(기본 30) 넘게 갱신되지 않았으면 알림
                    ← 크론이 **아예 안 뜬 경우**는 실패 알림조차 안 나므로 이 감시가 필요

⛔ API(04_rag_api)에 의존하지 않는다 — API가 죽어 있어도 알림은 남아야 하므로 app.db에 직접 쓴다.
   같은 사유의 알림은 창(기본 20시간) 안에 1건만(스팸 방지).
실행: ../tools/.venv/bin/python eval_notice.py --deadman   (크론 마지막 줄에서 호출)
"""
import argparse
import os
import pathlib
import sqlite3
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
APP_DB = os.environ.get("APP_DB", str(ROOT / "tools" / "app.db"))
QUALITY_INDEX = ROOT / "web" / "public" / "quality" / "index.json"
DEDUP_SEC = int(os.environ.get("EVAL_NOTICE_DEDUP_SEC", str(20 * 3600)))


def notice(kind: str, summary: str, detail: str = "") -> bool:
    """MaintNotice 1건 기록. 같은 summary가 창 안에 있으면 생략(True=기록함)."""
    try:
        c = sqlite3.connect(APP_DB, timeout=10)
        cols = {r[1] for r in c.execute("PRAGMA table_info(maintnotice)")}
        if not cols:
            print("[eval_notice] maintnotice 테이블 없음 — 스킵")
            return False
        now = time.time()
        recent = c.execute(
            "SELECT created_at FROM maintnotice WHERE summary=? ORDER BY created_at DESC LIMIT 1",
            (summary[:200],)).fetchone()
        if recent and (now - (recent[0] or 0)) < DEDUP_SEC:
            print(f"[eval_notice] 중복 억제(창 {DEDUP_SEC}s): {summary[:60]}")
            c.close()
            return False
        fields = {"kind": kind, "summary": summary[:200], "created_at": now}
        if "detail_path" in cols:
            fields["detail_path"] = detail[:500]
        if "unread" in cols:
            fields["unread"] = 1   # 관리자 🔔 배지에 미확인으로 표시
        keys = ",".join(fields)
        c.execute(f"INSERT INTO maintnotice({keys}) VALUES({','.join('?' * len(fields))})",
                  tuple(fields.values()))
        c.commit()
        c.close()
        print(f"[eval_notice] 알림 기록: {summary[:70]}")
        return True
    except Exception as e:  # noqa: BLE001 — 알림 실패가 크론을 죽이면 안 된다
        print(f"[eval_notice] 실패({type(e).__name__}: {e}) — 무시")
        return False


def deadman(max_hours: float) -> int:
    """품질 데이터 신선도 감시 — 크론이 아예 안 뜬 경우를 잡는 유일한 장치."""
    if not QUALITY_INDEX.exists():
        notice("eval", "🚨 자가평가 결과 없음 — 품질 게시판 데이터 파일이 없습니다",
               "eval/daily_run.sh 실행 여부와 crontab 등록을 확인하세요.")
        return 1
    age_h = (time.time() - QUALITY_INDEX.stat().st_mtime) / 3600
    if age_h > max_hours:
        notice("eval", f"🚨 자가평가 {age_h:.0f}시간째 미갱신 — 크론이 돌지 않았을 수 있어요",
               "확인: crontab -l · 로그 ~/kei-backups/daily-eval.log · 수동 실행 eval/daily_run.sh")
        return 1
    print(f"[eval_notice] 정상 — 마지막 갱신 {age_h:.1f}시간 전")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fail", help="크론 실패 사유(즉시 알림)")
    ap.add_argument("--deadman", action="store_true", help="데이터 신선도 감시")
    ap.add_argument("--max-hours", type=float,
                    default=float(os.environ.get("EVAL_DEADMAN_HOURS", "30")))
    a = ap.parse_args()
    if a.fail:
        notice("eval", f"🚨 자가평가 크론 실패 — {a.fail}",
               "로그: ~/kei-backups/daily-eval.log (마지막 실행 구간 확인)")
        return 0
    if a.deadman:
        return deadman(a.max_hours)
    ap.error("--fail 또는 --deadman 필요")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
