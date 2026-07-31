#!/usr/bin/env python3
"""eval_notice.py — 자가평가 크론의 상태를 관리자 🔔(MaintNotice)로 알린다 (docs/58 §7b).

배경(2026-07-25): 크론이 실패하거나 아예 안 돌면 로그에만 남아 **아무도 몰랐다**("동작 안 한 줄
알았다"가 실제로 반복). 이메일 발송 경로가 없으므로, 이미 있는 인앱 알림(관리자 🔔 배지 +
브라우저 알림)에 태운다.

세 가지 모드:
  --fail "<사유>"   크론 스크립트가 exit≠0으로 끝날 때(trap) 즉시 실패 알림
  --deadman         품질 데이터가 N시간(기본 30) 넘게 갱신되지 않았으면 알림
                    ← 크론이 **아예 안 뜬 경우**는 실패 알림조차 안 나므로 이 감시가 필요
  --digest --date   당일 결과 다이제스트(SEV3) + 재시험 코호트 급락 감지(SEV2, docs/66 §3.3)
                    → 🔔 + Slack #horong. 전체 정답률이 아니라 **재시험 코호트**로 급락을
                    판정한다 — 표본 85%가 매일 교체돼 전체 비교는 회귀를 증명 못 함(docs/58 §6d).

⛔ API(04_rag_api)에 의존하지 않는다 — API가 죽어 있어도 알림은 남아야 하므로 app.db에 직접 쓴다.
   같은 사유의 알림은 창(기본 20시간) 안에 1건만(스팸 방지).
실행: ../tools/.venv/bin/python eval_notice.py --deadman   (크론 마지막 줄에서 호출)
"""
import argparse
import json
import os
import pathlib
import re
import sqlite3
import sys
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


def _slack_token() -> str:
    """SLACK_BOT_TOKEN — env 우선, 없으면 tools/ecosystem.local.js에서 정규식 추출.
    크론은 PM2 env 밖에서 돌므로 gitignore된 로컬 파일이 정본이다. ⛔ 값을 출력하지 않는다."""
    t = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    if t:
        return t
    try:
        s = (ROOT / "tools" / "ecosystem.local.js").read_text(encoding="utf-8")
        m = re.search(r'SLACK_BOT_TOKEN\s*:\s*"([^"]+)"', s)
        return m.group(1) if m else ""
    except Exception:  # noqa: BLE001 — 파일 없음 = 미설정과 동일(발송 생략)
        return ""


def _cohort(d: dict, name: str) -> dict:
    return (d.get("코호트별") or {}).get(name) or {}


def digest(date: str) -> int:
    """일일 다이제스트(SEV3) + 재시험 코호트 급락(SEV2, 전일 대비 ≥10%p) — docs/66 §3.3.

    🔔은 이 파일의 notice()(dedup 내장·API 무의존)로, Slack은 tools/alerts로 보낸다.
    alerts.notify에 engine을 안 넘기는 이유: MaintNotice를 여기서 이미 기록했다(이중 기록 방지)."""
    f = HERE / "daily" / f"{date}.graded.json"
    if not f.exists():
        print(f"[eval_notice] {f.name} 없음 — 다이제스트 생략")
        return 0
    d = json.loads(f.read_text(encoding="utf-8"))
    rc, nc = _cohort(d, "재시험"), _cohort(d, "신규")
    fmt = lambda c: f"{c.get('정답률', '?')}%({c.get('문항수', 0)}건)" if c else "—"  # noqa: E731
    summary = f"📊 {date} 자가평가: 전체 {d.get('정답률', '?')}% · 재시험 {fmt(rc)} · 신규 {fmt(nc)}"
    notice("quality", summary, "품질 게시판(/quality)에서 실패유형·문항 상세 확인")

    os.environ.setdefault("SLACK_BOT_TOKEN", _slack_token())
    sys.path.insert(0, str(ROOT / "tools"))
    import alerts  # noqa: PLC0415
    print(f"[eval_notice] Slack 다이제스트: {alerts.notify('quality_digest', summary)}")

    # 급락 판정 — 직전 측정 파일(이름 정렬상 바로 앞)과 재시험 코호트 비교.
    # ⛔ 문항수 10건 미만이면 판정하지 않는다: 한두 문항으로 10%p가 움직인다(런북 quality-drop §1).
    prevs = sorted(p for p in (HERE / "daily").glob("*.graded.json") if p.name < f.name)
    if prevs and rc.get("문항수", 0) >= 10:
        pr = _cohort(json.loads(prevs[-1].read_text(encoding="utf-8")), "재시험")
        if pr.get("문항수", 0) >= 10:
            drop = float(pr.get("정답률", 0)) - float(rc.get("정답률", 0))
            if drop >= float(os.environ.get("EVAL_DROP_PCT", "10")):
                s2 = (f"📉 재시험 코호트 {pr['정답률']}% → {rc['정답률']}% "
                      f"(-{drop:.1f}%p, {rc['문항수']}건) — 회귀 의심 [{prevs[-1].stem.split('.')[0]} 대비]")
                notice("quality", s2, "런북 quality-drop.md — 최근 커밋·재색인·실패유형 분포 확인")
                print(f"[eval_notice] Slack 급락: {alerts.notify('quality_drop', s2)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fail", help="크론 실패 사유(즉시 알림)")
    ap.add_argument("--deadman", action="store_true", help="데이터 신선도 감시")
    ap.add_argument("--digest", action="store_true", help="당일 다이제스트+급락 감지(🔔+Slack)")
    ap.add_argument("--date", default=time.strftime("%Y-%m-%d"))
    ap.add_argument("--max-hours", type=float,
                    default=float(os.environ.get("EVAL_DEADMAN_HOURS", "30")))
    a = ap.parse_args()
    if a.fail:
        notice("eval", f"🚨 자가평가 크론 실패 — {a.fail}",
               "로그: ~/kei-backups/daily-eval.log (마지막 실행 구간 확인)")
        return 0
    if a.digest:
        return digest(a.date)
    if a.deadman:
        return deadman(a.max_hours)
    ap.error("--fail, --deadman 또는 --digest 필요")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
