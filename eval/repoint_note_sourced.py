#!/usr/bin/env python3
"""repoint_note_sourced.py — 질문은행의 '출처=용어 노트' 문항을 **원문 조문**으로 재지정.

배경(specs/02 §6): 30_용어집/규정정의 노트는 규정 조문을 복사해온 **파생 뷰**다. 자동 생성
파이프라인이 이 노트 청크에서도 문항을 만들어, 15문항의 `출처`가 원문이 아니라 노트를 가리킨다.
파생 뷰를 RAG 색인에서 제외하면(Full-Vault 원칙) 이 문항들은 구조적으로 회수 불가가 되어
지표를 왜곡한다 — 그래서 출처를 **정의가 실제로 실린 원문 조문**으로 옮긴다.

⛔ 지표를 유리하게 만들려는 조작이 아님을 코드로 보장한다:
  · defterms.json(01j) 바인딩으로 후보 조문을 찾고,
  · **골든 문장이 그 조문 원문에 실제로 존재할 때만** 재지정한다(2-그램 ≥0.9 또는 부분 문자열).
  · 검증 실패 문항은 **건드리지 않고 보고**한다(사람이 판단).
  · 원본은 .bak으로 백업하고, 변경 문항에 `출처재지정` 감사 필드를 남긴다.

실행: cd eval && ../tools/.venv/bin/python repoint_note_sourced.py [--write]
      (기본 dry-run — 무엇이 바뀌는지 먼저 보고)
"""
import argparse
import json
import pathlib
import re
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from daily_common import BANK, CHROMA_DIR, COLLECTION, norm_q  # noqa: E402

NOTE_DIR = ROOT / "KEI-행정가이드" / "30_용어집" / "규정정의"
DEFTERMS = ROOT / "tools" / "index" / "defterms.json"


def golden_in(doc: str, golden: str) -> float:
    """골든이 조문 원문에 있는가 — 정규화 부분문자열이면 1.0, 아니면 2-그램 포함률."""
    g, d = norm_q(golden), norm_q(doc)
    if not g:
        return 0.0
    if g in d:
        return 1.0
    gg = {g[i:i + 2] for i in range(len(g) - 1)}
    return sum(1 for x in gg if x in d) / max(1, len(gg))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="실제 기록(기본 dry-run)")
    ap.add_argument("--min-cover", type=float, default=0.9, help="골든 존재 판정 임계(2-그램)")
    args = ap.parse_args()

    import chromadb
    col = chromadb.PersistentClient(path=CHROMA_DIR).get_collection(COLLECTION)
    got = col.get(include=["documents", "metadatas"])
    # (규정명, 조 prefix) → [(id, doc)] 인덱스
    idx: dict = {}
    for cid, doc, m in zip(got["ids"], got["documents"], got["metadatas"]):
        key = ((m.get("규정명") or "").strip(), (m.get("조") or "").strip())
        idx.setdefault(key, []).append((cid, doc))

    terms = json.loads(DEFTERMS.read_text(encoding="utf-8"))["terms"]
    notes = {p.stem for p in NOTE_DIR.glob("*.md")}
    rows = [json.loads(l) for l in BANK.open(encoding="utf-8") if l.strip()]

    moved, failed, untouched = [], [], 0
    for r in rows:
        src = r.get("출처") or {}
        name = (src.get("규정명") or "").strip()
        if name not in notes:
            untouched += 1
            continue
        golden = r.get("골든") or ""
        best = None  # (cover, reg, jo, cid)
        # 정의형·약칭형 바인딩 모두 후보 — 어느 쪽이든 **골든 실재 검증**이 최종 관문이라 안전하다
        # (초과사례금·외부강의등처럼 '이하 …라 한다' 형태로만 잡힌 용어가 7건 있었다, 2026-07-25 실측)
        for b in terms.get(name, []):
            reg, jo = (b.get("규정명") or "").strip(), (b.get("조") or "").strip()
            for cid, doc in idx.get((reg, jo), []):
                cov = golden_in(doc, golden)
                if best is None or cov > best[0]:
                    best = (cov, reg, jo, cid)
        if best and best[0] >= args.min_cover:
            cov, reg, jo, cid = best
            r.setdefault("출처재지정", {
                "이전": {"규정명": name, "조": src.get("조", ""), "청크id": src.get("청크id", "")},
                "사유": "용어 노트(파생 뷰) → 정의 원문 조문(specs/02 §6)",
                "골든검증": round(cov, 3),
            })
            r["출처"] = {"규정명": reg, "조": jo, "청크id": cid}
            moved.append((name, reg, jo, round(cov, 3), r["질문"][:38]))
        else:
            failed.append((name, round(best[0], 3) if best else 0.0, r["질문"][:38]))

    print(f"대상(출처=용어 노트) {len(moved) + len(failed)}문항 · 그 외 {untouched}문항 불변\n")
    print(f"✅ 재지정 {len(moved)}건 (골든이 새 출처 조문에 실재)")
    for n, reg, jo, cov, q in moved:
        print(f"   [{n}] → {reg} {jo} (검증 {cov}) · {q}")
    if failed:
        print(f"\n⚠ 미재지정 {len(failed)}건 — 골든을 원문에서 확인 못 함(사람 판단 필요)")
        for n, cov, q in failed:
            print(f"   [{n}] 최대 일치 {cov} · {q}")

    if args.write and moved:
        shutil.copy(BANK, str(BANK) + ".bak")
        with BANK.open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"\n기록 완료 → {BANK} (백업: {BANK}.bak)")
    elif moved:
        print("\n[dry-run] --write 를 붙이면 기록합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
