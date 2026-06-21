#!/usr/bin/env python3
"""feedback_export.py — 인앱 답변 피드백(app.db)을 검수 우선순위 '신호'로 내보낸다 (읽기 전용).

⛔ 가드레일: 이 신호는 "무엇부터 다시 볼지" 순서만 바꾼다. 검수상태(미검수→검수완료)를
   자동으로 바꾸지 않는다(사람만). 부정(👎) 피드백이 달린 답변의 근거 규정을 집계해서
   review_queue.py 가 --feedback 으로 소비 → 자주 틀리는 규정이 검수 큐 상단으로 올라온다.

데이터 흐름:  app.db(Feedback↔Message.sources_json)  →  .feedback_signals.json  →  review_queue.py
출력: tools/.feedback_signals.json (로컬 전용·gitignore. 규정 스니펫/사용자 텍스트 포함).
실행:  python tools/feedback_export.py [--db tools/app.db] [--out tools/.feedback_signals.json]

sqlite3로 직접 읽는다(읽기 전용, init_db/모델 로드 같은 부작용 없음).
"""
import argparse
import json
import os
import sqlite3
from collections import defaultdict


def empty_signal():
    return {"totals": {"up": 0, "down": 0}, "by_regulation": {}}


def build(db_path: str) -> dict:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        tabs = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "feedback" not in tabs:
            return empty_signal()
        by_reg = defaultdict(lambda: {"down": 0, "up": 0, "조": set(), "사유": []})
        totals = {"up": 0, "down": 0}
        for f in con.execute("SELECT message_id, rating, reason FROM feedback"):
            r = f["rating"]
            totals[r] = totals.get(r, 0) + 1
            m = con.execute("SELECT sources_json FROM message WHERE id=?", (f["message_id"],)).fetchone()
            srcs = json.loads(m["sources_json"]) if (m and m["sources_json"]) else []
            seen = set()  # 한 답변에 같은 규정이 여러 번 인용돼도 1회만 가산
            for sdat in srcs:
                reg = (sdat.get("규정명") or "").strip()
                if not reg or reg in seen:
                    continue
                seen.add(reg)
                slot = by_reg[reg]
                slot[r] += 1
                jo = (sdat.get("조") or "").strip()
                if jo:
                    slot["조"].add(jo)
                if r == "down" and f["reason"] and len(slot["사유"]) < 5:
                    slot["사유"].append(f["reason"][:120])
        return {
            "totals": totals,
            "by_regulation": {
                reg: {"down": v["down"], "up": v["up"], "조": sorted(v["조"]), "사유": v["사유"]}
                for reg, v in sorted(by_reg.items(), key=lambda kv: -kv[1]["down"])
            },
        }
    finally:
        con.close()


def main():
    here = os.path.dirname(__file__)
    ap = argparse.ArgumentParser(description="인앱 피드백 → 검수 신호(읽기 전용)")
    ap.add_argument("--db", default=os.path.join(here, "app.db"))
    ap.add_argument("--out", default=os.path.join(here, ".feedback_signals.json"))
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print(f"app.db 없음({args.db}) — 아직 피드백 데이터가 없습니다. 빈 신호를 기록합니다.")
        sig = empty_signal()
    else:
        sig = build(args.db)

    with open(args.out, "w", encoding="utf-8") as fp:
        json.dump(sig, fp, ensure_ascii=False, indent=2)

    nu, nd = sig["totals"].get("up", 0), sig["totals"].get("down", 0)
    print(f"피드백 신호: 👍 {nu} · 👎 {nd} · 영향 규정 {len(sig['by_regulation'])}개")
    top = [(k, v["down"]) for k, v in sig["by_regulation"].items() if v["down"]][:5]
    if top:
        print("  👎 상위:", ", ".join(f"{k}({n})" for k, n in top))
    print(f"저장(로컬 전용) → {args.out}")
    print("⛔ 검수 '완료'는 사람만. 이 신호는 review_queue.py 우선순위에만 반영된다.")


if __name__ == "__main__":
    main()
