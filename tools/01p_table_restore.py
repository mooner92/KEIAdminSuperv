#!/usr/bin/env python3
"""01p_table_restore.py — 손상 표의 결정적 복원 '제안' 생성 (지렛대 ①, docs/23 §1).

01o가 찾은 손상 문서의 원본(HWP/HWPX/PDF)에서 표를 문단 보존 방식으로 재추출해
검수용 제안 문서를 스테이징에 쓴다. 복원은 파싱(무환각)이며 생성 모델을 쓰지 않는다.

⛔ 절대 규칙: 볼트에 자동 반영하지 않는다 — 산출물은 `tools/index/table_restore/*.md`(스테이징)이고
   반영·행 분리 재구성은 사람 검수로만 한다(원문층 의역 금지·검수상태 사람만).

실행: .venv/bin/python tools/01p_table_restore.py [--only 복무규정]
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hwp_tables import install_paragraph_preserving_tables  # noqa: E402
from rag_core import _table_broken  # noqa: E402 — 복원 후 손상 판정 재검사(수용기준 ⓒ)

install_paragraph_preserving_tables()
import hwp_hwpx_parser as hh  # noqa: E402

# 손상 문서(01o) → 원본 파일 명시 매핑(감사 가능하게 하드코딩 — 이름 휴리스틱 매칭 금지)
SOURCES = {
    "복무규정": "/KEIAdminSuperv/rule_files/복무규정(2025년12월22일개정).hwpx",
    "상조회규약": "/KEIAdminSuperv/rule_files/상조회규약.hwp",
    "비정규직사전심의실무가이드": "/KEIAdminSuperv/research_rule_files/비정규직사전심의실무가이드.hwpx",
    "대체인력활용심의및채용절차가이드": "/KEIAdminSuperv/research_rule_files/대체인력활용심의및채용절차가이드_20250123.hwpx",
    "퇴직자 활용에 관한 가이드라인": "/KEIAdminSuperv/rule_files/퇴직자_활용에_관한_가이드라인(안)_240719(1).hwp",
    "위탁연구사업비편성및집행·정산가이드라인": "/KEIAdminSuperv/rule_files/위탁연구사업비편성및집행·정산가이드라인_240213.hwp",
    "KEI경조사관련절차안내": "/KEIAdminSuperv/research_rule_files/KEI경조사관련절차안내(241120).pdf",
}

OUT_DIR = Path(__file__).resolve().parent / "index" / "table_restore"


def tables_from_pdf(path: str):
    """PDF 표 추출(PyMuPDF find_tables) — 셀 내 줄바꿈을 <br>로 보존."""
    import fitz
    out = []
    with fitz.open(path) as doc:
        for pno, page in enumerate(doc, 1):
            for tab in page.find_tables().tables:
                rows = [[("<br>".join((c or "").splitlines())).strip() for c in row]
                        for row in tab.extract()]
                if any(any(ch.isdigit() for ch in c) for row in rows for c in row):
                    out.append((f"p.{pno}", rows))
    return out


def tables_from_hwp(path: str):
    r = hh.read(path)
    out = []
    for i, t in enumerate(r.tables):
        rows = t.rows
        if any(any(ch.isdigit() for ch in c) for row in rows for c in row):
            out.append((f"표 {i + 1}", rows))
    return out


def render(rows) -> str:
    lines = []
    for ri, row in enumerate(rows):
        lines.append("| " + " | ".join(c.replace("\n", "<br>") for c in row) + " |")
        if ri == 0:
            lines.append("|" + " --- |" * len(row))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="손상 표 결정적 복원 제안 생성(스테이징 전용)")
    ap.add_argument("--integrity", default=str(Path(__file__).parent / "index" / "table_integrity.json"))
    ap.add_argument("--only", default="", help="특정 문서명만(부분 일치)")
    args = ap.parse_args()

    integ = json.loads(Path(args.integrity).read_text(encoding="utf-8"))["docs"]
    by_name = {}
    for d in integ:
        by_name.setdefault(d["name"], []).append(d)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    done, skipped = [], []
    for name, docs in sorted(by_name.items()):
        if args.only and args.only not in name:
            continue
        src = SOURCES.get(name)
        if not src or not Path(src).exists():
            skipped.append(name)
            continue
        tabs = tables_from_pdf(src) if src.lower().endswith(".pdf") else tables_from_hwp(src)
        buf = [
            f"# 표 복원 제안 — {name}",
            "",
            f"- 원본: `{src}`",
            f"- 방식: 결정적 재파싱(hwpx=OWPML XML·hwp=문단 센티널·pdf=find_tables) — 생성 모델 미사용",
            "- ⛔ 이 파일은 **검수용 제안**입니다. 볼트 반영·행 분리 재구성은 사람이 확인 후 수행하세요.",
            "",
            "## 기존 볼트의 손상 표본 (01o)",
        ]
        for d in docs:
            for s in d.get("표본", []) or ["(| 없는 평탄화 손상 — 사유: " + "; ".join(d["사유"]) + ")"]:
                buf.append(f"> {s}")
        buf.append("")
        buf.append("## 복원된 표 (숫자 포함 표 전체)")
        still_broken = 0
        for label, rows in tabs:
            md = render(rows)
            verdict = _table_broken(md)
            if verdict:
                still_broken += 1
            buf.append(f"\n### {label}" + (f"  ⚠ 원본 자체가 병합 구조({verdict}) — 사람 행 분리 필요" if verdict else "  ✅ 구조 복원"))
            buf.append(md)
        out = OUT_DIR / f"{re.sub(r'[/\\\\]', '_', name)}.md"
        out.write_text("\n".join(buf) + "\n", encoding="utf-8")
        done.append((name, len(tabs), still_broken))

    print(f"복원 제안 {len(done)}건 → {OUT_DIR}")
    for name, n, broken in done:
        mark = f" (원본 병합 구조 {broken}표 — 사람 행분리 필요)" if broken else ""
        print(f"  ✅ {name}: 표 {n}개{mark}")
    for name in skipped:
        print(f"  ⏭ {name}: 원본 미확보 — SOURCES에 경로 추가 필요")


if __name__ == "__main__":
    main()
