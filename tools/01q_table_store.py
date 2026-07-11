#!/usr/bin/env python3
"""01q_table_store.py — 검수 완료 표의 수치를 결정적 조회용 스토어로 적재 (지렛대 ③, docs/24 §2).

볼트 md의 표에서 (규정명, 표 헤더, 행 라벨, 열 라벨, 값)을 추출해 value_store.json에 쓴다.
⛔ 적재 조건(무환각·검수 원칙): 프론트매터 `검수상태: 검수완료` + 표가 손상 판정(_table_broken) 아님 +
   셀에 수치 존재. 미검수 문서의 값은 절대 서빙하지 않는다 — 스토어가 비면 조회 기능은 무동작(no-op).

실행: .venv/bin/python tools/01q_table_store.py --vault KEI-행정가이드
산출: tools/index/value_store.json  {rows: [{규정명, 파일, 표, 행, 열, 값}]}
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rag_core import _table_broken  # noqa: E402

OUT = Path(__file__).resolve().parent / "index" / "value_store.json"
_NUM = re.compile(r"\d")


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


def table_blocks(lines):
    blocks, i = [], 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|"):
            j = i
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                j += 1
            blocks.append(lines[i:j])
            i = j
        else:
            i += 1
    return blocks


def cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def extract_rows(name: str, rel: str, block: list):
    """표 블록 → 값 레코드. 행 라벨 = 숫자 없는 선행 셀들, 열 라벨 = 헤더의 해당 열."""
    rows = [cells(ln) for ln in block if not re.fullmatch(r"[|\s:-]+", ln.strip())]
    if len(rows) < 2:
        return []
    header = rows[0]
    out = []
    for r in rows[1:]:
        labels = []
        for c in r:
            if c and not _NUM.search(c):
                labels.append(c)
            else:
                break
        row_label = " · ".join(x.replace("<br>", "/") for x in labels) or (r[0] if r else "")
        for ci, c in enumerate(r):
            if ci < len(labels) or not c or not _NUM.search(c):
                continue
            col = header[ci] if ci < len(header) else ""
            out.append({
                "규정명": name, "파일": rel,
                "표": " / ".join(h for h in header if h)[:60],
                "행": row_label[:80], "열": col[:40],
                "값": c.replace("<br>", " / ")[:120],
            })
    return out


def main():
    ap = argparse.ArgumentParser(description="검수 완료 표 → 수치 스토어(결정적 조회)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    vault = Path(args.vault)
    rows, n_docs, n_skip_unreviewed, n_skip_broken = [], 0, 0, 0
    for md in sorted(vault.rglob("*.md")):
        meta, body = split_fm(md.read_text(encoding="utf-8", errors="ignore"))
        if not meta.get("type"):
            continue
        if meta.get("검수상태") != "검수완료":
            n_skip_unreviewed += 1
            continue
        name = (meta.get("규정명") or meta.get("제목") or md.stem).strip()
        rel = str(md.relative_to(vault))
        doc_rows = []
        for block in table_blocks(body.splitlines()):
            btxt = "\n".join(block)
            if _table_broken(btxt):
                n_skip_broken += 1
                continue
            doc_rows.extend(extract_rows(name, rel, block))
        if doc_rows:
            n_docs += 1
            rows.extend(doc_rows)

    outp = Path(args.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps({"rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"수치 스토어: {n_docs}개 검수완료 문서에서 {len(rows)}행 적재 → {outp}")
    print(f"  (미검수 제외 {n_skip_unreviewed}문서 · 손상 표 제외 {n_skip_broken}블록 — ⛔검수 전 값은 서빙 금지)")


if __name__ == "__main__":
    main()
