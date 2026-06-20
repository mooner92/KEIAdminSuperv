#!/usr/bin/env python3
"""review_queue.py — 미검수 노트 검수 우선순위 큐 (P1.2).

⛔ 가드레일: 이 도구는 **읽기 전용**이다. 검수 '완료' 표시는 사람만 한다(프론트매터 변경 없음).
에이전트는 "무엇부터 검수하면 좋은지" 후보·순서만 만든다. 자동 확정 절대 금지.

우선순위 점수(높을수록 먼저):
  - 유형 가중치: regulation 30(진실원천) > guide 12 > system 8 > term 6
  - 별표/별지/별첨 포함 +15 (표 깨짐 위험 + P1.3 대상)
  - 미분류/규정번호 없음 +8 (사람이 현행 규정번호 배정 필요)
  - 피인용(그래프 인바운드 [[링크]]) +min(n,10) (많이 참조되는 노트 = 중요)

출력: 콘솔 요약(상위 N + 유형/분류별 집계) + 전체 큐 JSON(로컬 전용, gitignore).
실행:  python tools/review_queue.py --vault KEI-행정가이드 [--top 30] [--type regulation]
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

WIKILINK = re.compile(r"\[\[([^\]|#]+)")
TYPE_W = {"regulation": 30, "guide": 12, "system": 8, "term": 6}


def split_fm(text):
    if text.startswith("---"):
        try:
            _, fm, body = text.split("---", 2)
        except ValueError:
            return {}, text
        meta = {}
        for ln in fm.strip().splitlines():
            if ":" in ln:
                k, v = ln.split(":", 1)
                meta[k.strip()] = v.strip().strip('"').strip("'")
        return meta, body
    return {}, text


def main():
    ap = argparse.ArgumentParser(description="미검수 검수 우선순위 큐 (읽기 전용)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--top", type=int, default=30, help="콘솔에 보일 상위 건수")
    ap.add_argument("--type", default="", help="유형 필터(regulation|guide|system|term)")
    ap.add_argument("--out", default="tools/.review_queue.json", help="전체 큐 JSON(로컬 전용)")
    args = ap.parse_args()

    vault = Path(args.vault)
    notes = []  # (meta, body, path, stem)
    inbound = Counter()
    for md in vault.rglob("*.md"):
        if md.name == "README.md":
            continue
        meta, body = split_fm(md.read_text(encoding="utf-8"))
        if not meta.get("type"):
            continue
        notes.append((meta, body, md, md.stem))
        for m in WIKILINK.finditer(body):
            inbound[m.group(1).strip()] += 1

    rows = []
    for meta, body, md, stem in notes:
        typ = meta.get("type", "")
        reviewed = meta.get("검수상태", "")
        if reviewed == "검수완료":
            continue  # 이미 사람이 확정한 것은 큐에서 제외
        if args.type and typ != args.type:
            continue
        name = (meta.get("규정명") or meta.get("제목") or meta.get("용어") or stem).strip()
        cat = (meta.get("분류") or "").strip()
        has_byeolpyo = bool(re.search(r"별표|별지|별첨", body))
        unclassified = (cat in ("", "0000_미분류")) or (typ == "regulation" and not (meta.get("규정번호") or "").strip())
        inb = inbound.get(stem, 0)
        score = (TYPE_W.get(typ, 5) + (15 if has_byeolpyo else 0)
                 + (8 if unclassified else 0) + min(inb, 10))
        rows.append({
            "score": score, "type": typ, "name": name, "분류": cat,
            "검수상태": reviewed or "미검수", "별표": has_byeolpyo,
            "미분류": unclassified, "인바운드": inb,
            "path": str(md.relative_to(vault)),
        })

    rows.sort(key=lambda r: (-r["score"], r["type"], r["name"]))

    # 콘솔 요약
    print(f"검수 큐: 미검수 {len(rows)}건"
          + (f" (유형={args.type})" if args.type else "")
          + f" · 별표포함 {sum(r['별표'] for r in rows)} · 미분류 {sum(r['미분류'] for r in rows)}")
    by_type = Counter(r["type"] for r in rows)
    print("  유형별:", ", ".join(f"{k} {v}" for k, v in sorted(by_type.items())))
    print(f"\n=== 상위 {min(args.top, len(rows))} (점수 내림차순) ===")
    print(f"{'점수':>4} {'유형':<11} {'별표':^4} {'미분류':^5} {'인바':>4}  제목 / 분류")
    for r in rows[:args.top]:
        flag_b = "별표" if r["별표"] else " · "
        flag_u = "미분류" if r["미분류"] else "  · "
        print(f"{r['score']:>4} {r['type']:<11} {flag_b:^4} {flag_u:^5} {r['인바운드']:>4}  "
              f"{r['name'][:34]}  ({r['분류'] or '-'})")

    out = Path(args.out)
    out.write_text(json.dumps({"n": len(rows), "queue": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n전체 큐 저장(로컬 전용) → {out}  ·  검수 도구가 이 큐를 소비한다")
    print("⛔ 검수 '완료'는 사람만. 이 도구는 순서 제안만 한다.")


if __name__ == "__main__":
    main()
