#!/usr/bin/env python3
"""golden_repair.py — 골든 보수 사이클: 후보 추출(자동) → 사람 판정 → 반영(명시 명령만).

⛔ 원칙(docs/58 §6d와 동일): 골든 퇴출·교체 **확정은 사람만** 한다. 이 도구는
   ⓐ --list  : 채점이 막힌 문항(골든품질·판정불가 이력 + golden_suspect)을 빈도순으로 나열
   ⓑ --retire <hash> --why "..."      : 사람이 결정한 퇴출을 은행에 기록(상태=retired)
   ⓒ --regolden <hash> "새 골든 문장"  : 사람이 고른 원문 한 문장으로 교체
   자동 판단으로 은행을 고치는 경로는 없다 — 채점기가 어려워하는 문항부터 지우면
   자기 채점 조작이 된다.
쓰기 전 은행 백업(question_bank.jsonl.bak-<ts>) 자동.
실행: cd eval && ../tools/.venv/bin/python golden_repair.py --list
"""
import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BANK = HERE / "question_bank.jsonl"
DAILY = HERE / "daily"

sys.path.insert(0, str(HERE))
from daily_grade import golden_suspect  # noqa: E402  결함 감지 단일 정본 재사용


def _bank() -> list:
    return [json.loads(l) for l in BANK.read_text(encoding="utf-8").splitlines() if l.strip()]


def _save(rows: list) -> None:
    bak = BANK.with_suffix(f".jsonl.bak-{time.strftime('%m%d-%H%M')}")
    bak.write_text(BANK.read_text(encoding="utf-8"), encoding="utf-8")
    BANK.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    print(f"저장(백업 {bak.name})")


def list_candidates() -> int:
    # 최근 채점 파일들에서 골든 기인 실패유형의 hash → 빈도
    freq: dict = {}
    for f in sorted(DAILY.glob("*.graded.json")):
        try:
            for r in json.loads(f.read_text(encoding="utf-8")).get("문항", []):
                if r.get("실패유형") in ("골든품질", "판정불가-기타") or r.get("판정") == "판정불가":
                    freq[r.get("hash")] = freq.get(r.get("hash"), 0) + 1
        except Exception:  # noqa: BLE001 — 손상 파일은 건너뜀(목록 도구가 죽으면 안 됨)
            continue
    rows = _bank()
    cand = []
    for q in rows:
        if q.get("상태") == "retired":
            continue
        if q.get("유형") == "거부형":
            continue  # 거부형은 골든이 빈 것이 정상(정답=거부) — 보수 대상 아님
        n = freq.get(q.get("hash"), 0)
        suspect = golden_suspect(q.get("골든", ""))
        if n or suspect:
            cand.append((n, suspect, q))
    cand.sort(key=lambda x: (-x[0], not x[1]))
    print(f"골든 보수 후보 {len(cand)}건 (은행 {len(rows)}문항 · 빈도=채점막힘 횟수 · S=파편 의심)\n")
    for n, sus, q in cand:
        mark = "S" if sus else " "
        print(f"[{n}회|{mark}] {q['hash']}  {q['질문'][:52]}")
        print(f"         골든: {q.get('골든','')[:76]}")
    print("\n판정: --retire <hash> --why '사유'  |  --regolden <hash> '원문 한 문장'")
    return 0


def mutate(args) -> int:
    rows = _bank()
    hit = [q for q in rows if q.get("hash") == (args.retire or args.regolden)]
    if not hit:
        print(f"⛔ hash 없음: {args.retire or args.regolden}")
        return 1
    q = hit[0]
    if args.retire:
        if not args.why:
            print("⛔ --why '사유' 필수 — 퇴출 근거 없는 퇴출은 기록이 아니다")
            return 1
        q["상태"] = "retired"
        q["retire_사유"] = args.why
        q["retire_일자"] = time.strftime("%Y-%m-%d")
        print(f"퇴출: {q['질문'][:50]} — {args.why}")
    else:
        new = (args.golden or "").strip()
        if len(new) < 10:
            print("⛔ 골든이 너무 짧다(문장이어야 함)")
            return 1
        q["골든_이전"] = q.get("골든", "")
        q["골든"] = new
        q["regolden_일자"] = time.strftime("%Y-%m-%d")
        print(f"교체: {q['질문'][:50]}")
        print(f"  구: {q['골든_이전'][:60]}\n  신: {new[:60]}")
    _save(rows)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--retire", metavar="HASH")
    ap.add_argument("--why")
    ap.add_argument("--regolden", metavar="HASH")
    ap.add_argument("golden", nargs="?", help="--regolden의 새 골든 문장")
    a = ap.parse_args()
    if a.retire or a.regolden:
        return mutate(a)
    return list_candidates()


if __name__ == "__main__":
    raise SystemExit(main())
