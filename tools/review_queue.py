#!/usr/bin/env python3
"""review_queue.py — 미검수 노트 검수 우선순위 큐 (P1.2).

⛔ 가드레일: 이 도구는 **읽기 전용**이다. 검수 '완료' 표시는 사람만 한다(프론트매터 변경 없음).
에이전트는 "무엇부터 검수하면 좋은지" 후보·순서만 만든다. 자동 확정 절대 금지.

우선순위 점수(높을수록 먼저):
  - 유형 가중치: regulation 30(진실원천) > guide 12 > system 8 > term 6
  - 별표/별지/별첨 포함 +15 (표 깨짐 위험 + P1.3 대상)
  - 미분류/규정번호 없음 +8 (사람이 현행 규정번호 배정 필요)
  - 피인용(그래프 인바운드 [[링크]]) +min(n,10) (많이 참조되는 노트 = 중요)
  - 👎 인앱 피드백 +min(2·down, 20) (실사용에서 자주 틀린/부족한 규정 — feedback_export.py 신호)

⛔ 가드레일: 읽기 전용. 검수 '완료'는 사람만. 피드백은 순서만 바꾸고 검수상태를 건드리지 않는다.
출력: 콘솔 요약(상위 N + 유형/분류별 집계) + 전체 큐 JSON(로컬 전용, gitignore).
실행:  python tools/review_queue.py --vault KEI-행정가이드 [--top 30] [--type regulation]
       (피드백 신호 있으면 자동 반영. 먼저 `python tools/feedback_export.py` 실행)
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
    ap.add_argument("--feedback", default="tools/.feedback_signals.json",
                    help="인앱 피드백 신호 JSON(있으면 👎 받은 규정 우선순위↑). feedback_export.py가 생성")
    ap.add_argument("--tables", default="tools/index/table_integrity.json",
                    help="표 무결성 스캔 JSON(있으면 손상 표 문서 +25 — 실사고 위험 최우선). 01o가 생성")
    ap.add_argument("--conflicts", default="tools/index/conflict_audit.json",
                    help="정합성 감사 JSON(실충돌·낙후 문서 +20). 01s→검증 파이프라인이 생성")
    args = ap.parse_args()

    # 인앱 피드백 신호(선택): {규정명: down 수}. 파일 없으면 조용히 건너뜀(opt-in, graceful).
    fb_down = {}
    fbp = Path(args.feedback)
    if fbp.exists():
        try:
            sig = json.loads(fbp.read_text(encoding="utf-8"))
            fb_down = {k: v.get("down", 0) for k, v in sig.get("by_regulation", {}).items() if v.get("down")}
        except Exception as e:
            print(f"⚠ 피드백 신호 로드 실패({type(e).__name__}) — 무시하고 계속")

    # 표 무결성 신호(선택, P0-3): {상대경로: 손상행 수}. 깨진 표는 수치 오답의 직접 원인 — 최우선 검수.
    broken_tables = {}
    tbp = Path(args.tables)
    if tbp.exists():
        try:
            tj = json.loads(tbp.read_text(encoding="utf-8"))
            broken_tables = {d["path"]: d.get("손상행", 1) for d in tj.get("docs", [])}
        except Exception as e:
            print(f"⚠ 표 무결성 신호 로드 실패({type(e).__name__}) — 무시하고 계속")

    # 정합성 감사 신호(선택): 실충돌·낙후 판정 문서는 낡은 값을 답할 위험 — 우선 검수.
    conflict_paths = {}
    cfp = Path(args.conflicts)
    if cfp.exists():
        try:
            cj = json.loads(cfp.read_text(encoding="utf-8"))
            for v in cj.get("verdicts", []):
                if v.get("verdict") in ("실충돌", "낙후"):
                    for pth in v.get("paths", []):
                        conflict_paths[pth] = conflict_paths.get(pth, 0) + 1
        except Exception as e:
            print(f"⚠ 정합성 감사 신호 로드 실패({type(e).__name__}) — 무시하고 계속")

    vault = Path(args.vault)
    notes = []  # (meta, body, path, stem)
    inbound = Counter()
    for md in vault.rglob("*.md"):
        if md.name == "README.md":
            continue
        if "90_관리" in md.parts:  # 관리 문서(업데이트 노트·감사 보고서 등)는 검수 큐 대상 아님
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
        down = fb_down.get(name, 0)  # 인앱 👎 피드백 수(규정명/제목 일치)
        rel = str(md.relative_to(vault))
        n_broken = broken_tables.get(rel, 0)  # 표 무결성 스캔(P0-3) — 실사고 위험 최우선
        n_conflict = conflict_paths.get(rel, 0)  # 정합성 감사(01s) — 실충돌·낙후
        score = (TYPE_W.get(typ, 5) + (15 if has_byeolpyo else 0)
                 + (8 if unclassified else 0) + min(inb, 10) + min(2 * down, 20)
                 + (25 if n_broken else 0) + (20 if n_conflict else 0))
        rows.append({
            "score": score, "type": typ, "name": name, "분류": cat,
            "검수상태": reviewed or "미검수", "별표": has_byeolpyo,
            "미분류": unclassified, "인바운드": inb, "피드백_down": down,
            "표손상행": n_broken,
            "충돌판정": n_conflict,
            "path": rel,
        })

    rows.sort(key=lambda r: (-r["score"], r["type"], r["name"]))

    # 콘솔 요약
    n_fb = sum(1 for r in rows if r["피드백_down"])
    print(f"검수 큐: 미검수 {len(rows)}건"
          + (f" (유형={args.type})" if args.type else "")
          + f" · 별표포함 {sum(r['별표'] for r in rows)} · 미분류 {sum(r['미분류'] for r in rows)}"
          + (f" · 👎피드백 {n_fb}" if fb_down else " · 👎피드백 신호 없음(feedback_export.py 먼저 실행)")
          + (f" · ⚠표손상 {sum(1 for r in rows if r['표손상행'])}" if broken_tables
             else " · 표손상 신호 없음(01o_table_integrity.py 먼저 실행)"))
    by_type = Counter(r["type"] for r in rows)
    print("  유형별:", ", ".join(f"{k} {v}" for k, v in sorted(by_type.items())))
    print(f"\n=== 상위 {min(args.top, len(rows))} (점수 내림차순) ===")
    print(f"{'점수':>4} {'유형':<11} {'별표':^4} {'미분류':^5} {'인바':>4} {'👎':>3}  제목 / 분류")
    for r in rows[:args.top]:
        flag_b = "별표" if r["별표"] else " · "
        flag_u = "미분류" if r["미분류"] else "  · "
        dn = str(r["피드백_down"]) if r["피드백_down"] else " ·"
        print(f"{r['score']:>4} {r['type']:<11} {flag_b:^4} {flag_u:^5} {r['인바운드']:>4} {dn:>3}  "
              f"{r['name'][:34]}  ({r['분류'] or '-'})")

    out = Path(args.out)
    out.write_text(json.dumps({"n": len(rows), "queue": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n전체 큐 저장(로컬 전용) → {out}  ·  검수 도구가 이 큐를 소비한다")
    print("⛔ 검수 '완료'는 사람만. 이 도구는 순서 제안만 한다.")


if __name__ == "__main__":
    main()
