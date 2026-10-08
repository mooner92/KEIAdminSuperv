#!/usr/bin/env python3
"""auto_surgery_notify.py — 자동 수술 결과를 🔔+Slack으로 알린다(docs/66 `auto_surgery`).

호출: auto_surgery.sh 의 notify() 만. 단독 실행도 가능(수동 확인용).
  auto_surgery_notify.py --status ok|blocked --date 2026-08-26 --detail "파일 3건 · 브랜치 …"

⛔ Slack에는 **규정 내용을 싣지 않는다**(절대규칙 5 · docs/66 §6). 여기 나가는 건 건수·브랜치명·
   관문 사유 같은 메타뿐이고, 수술 상세는 로컬 `eval/daily/LATEST-SURGERY.md`가 갖는다.
   eval_notice.py의 '붙여넣기 한 줄' 관례를 그대로 따른다 — 사람이 세션에 옮길 문장을 준다.
"""
import argparse
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def _slack_token() -> str:
    """env 우선, 없으면 gitignore된 ecosystem.local.js에서 추출(크론은 PM2 env 밖에서 돈다).
    ⛔ 값을 출력하지 않는다."""
    t = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    if t:
        return t
    try:
        s = (ROOT / "tools" / "ecosystem.local.js").read_text(encoding="utf-8")
        m = re.search(r'SLACK_BOT_TOKEN\s*:\s*"([^"]+)"', s)
        return m.group(1) if m else ""
    except Exception:  # noqa: BLE001
        return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", required=True, choices=("ok", "blocked"))
    ap.add_argument("--date", required=True)
    ap.add_argument("--detail", default="")
    a = ap.parse_args()

    if a.status == "ok":
        key, head = "auto_surgery", f"🤖 {a.date} 자동 수술 완료"
    else:
        key, head = "auto_surgery_blocked", f"🤖⛔ {a.date} 자동 수술 관문 차단"
    # 세션 보고 경로: 사람이 이 한 줄을 Claude Code에 붙여넣으면 세션이 요약·diff를 읽고
    # 검토 결과를 말해 준다(수술 브리핑의 '붙여넣기 한 줄'과 같은 관례).
    summary = (f"{head} — {a.detail}"
               f"\n📋 Claude Code에 붙여넣기: 「자동 수술 {a.date} 검토해」")

    os.environ.setdefault("SLACK_BOT_TOKEN", _slack_token())
    sys.path.insert(0, str(ROOT / "tools"))
    import alerts  # noqa: PLC0415
    print(f"[auto_surgery_notify] {alerts.notify(key, summary)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
