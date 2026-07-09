#!/usr/bin/env python3
"""01o_table_integrity.py — 볼트 전수 표 무결성 스캔 (P0-3, docs/22 §2).

HWP 변환에서 구조가 무너진 표(셀 병합·행 붕괴)를 찾아 `tools/index/table_integrity.json`에 기록한다.
실측 사고: 상조회규약 별표(경조금 전 항목이 한 셀 → "부모상 300만원" 오답), 복무규정 별표1("51"=5/1 병합).

산출물 소비처:
  - review_queue.py: 손상 표 문서 검수 우선순위 가산(+25) — 위험한 문서부터 사람 검수
  - (참고) 런타임 격리는 rag_core._table_broken이 회수 시점에 같은 휴리스틱으로 직접 수행
    (오버레이라 재임베딩·인덱스 매칭 불필요 — 이 파일은 전수 현황·검수용)

⛔ 읽기 전용 — 볼트 내용을 절대 변경하지 않는다(검수·복원은 사람/VLM 트랙의 몫).
실행: python tools/01o_table_integrity.py --vault KEI-행정가이드
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rag_core import _table_broken  # noqa: E402 — 런타임 격리와 동일 휴리스틱(단일 진실원천)


def split_fm(text: str):
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
    ap = argparse.ArgumentParser(description="표 무결성 전수 스캔(읽기 전용)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--out", default="tools/index/table_integrity.json")
    args = ap.parse_args()

    vault = Path(args.vault)
    rows = []
    for md in sorted(vault.rglob("*.md")):
        if md.name == "README.md":
            continue
        meta, body = split_fm(md.read_text(encoding="utf-8", errors="ignore"))
        if not meta.get("type"):
            continue
        # 문서 단위 판정(평탄화 표처럼 여러 줄에 걸친 손상 포함) + 손상 라인 표본(검수자용)
        doc_reason = _table_broken(body)
        reasons, samples = [], []
        for line in body.splitlines():
            if "|" not in line:
                continue
            r = _table_broken(line)
            if r:
                reasons.append(r)
                if len(samples) < 3:
                    samples.append(line.strip()[:160])
        if doc_reason and not reasons:
            reasons = [doc_reason]  # | 없는 평탄화 손상 — 라인 표본 대신 사유만
        if not reasons:
            continue
        rows.append({
            "path": str(md.relative_to(vault)),
            "name": (meta.get("규정명") or meta.get("제목") or md.stem).strip(),
            "type": meta.get("type", ""),
            "검수상태": meta.get("검수상태", "미검수"),
            "손상행": len(reasons),
            "사유": sorted(set(reasons)),
            "표본": samples,
        })

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"docs": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"표 무결성 스캔: 손상 의심 {len(rows)}개 문서 → {out}")
    for r in rows[:15]:
        print(f"  [{r['type']:10s}] {r['name'][:36]:38s} 손상행 {r['손상행']:3d} · {'; '.join(r['사유'])}")
    if len(rows) > 15:
        print(f"  … 외 {len(rows) - 15}건 (전체는 JSON 참조)")


if __name__ == "__main__":
    main()
