#!/usr/bin/env python3
"""01q — 볼트 규정 MD의 별지(서식) 블록 전수 감사 (docs/50).

HWP→MD 변환에서 깨진 별지를 자동 분류해 복원 우선순위를 만든다(⛔ 자동 수정 없음 — 리포트만).

분류(심각도순):
  A empty        : 별지 라벨만 있고 내용이 사실상 없음(<40자)
  B no-structure : 표(|…|)도 항목 라인도 없는 긴 산문 덩어리(양식 구조 소실 의심)
  C broken-table : 표가 있으나 행별 칸 수 불일치/한 칸 표/빈 행 과다
  D short        : 내용 있으나 원문 대비 빈약 의심(<160자, 표 없음)
  OK             : 구조 존재(표 or 항목 라인 다수)

출력: tools/index/byeolji_audit.json + 콘솔 요약.
manifest(01p)가 있으면 PDF 페이지 수와 대조해 '원문은 N페이지인데 md는 빈약' 신호 강화.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
LABEL_LINE = re.compile(r"^[\[〔［(<【]?\s*별\s*지\s*(제?\s*\d+(?:-\d+)?\s*호(?:의\s*\d+)?)?")


def norm_label(raw: str) -> str:
    m = re.search(r"(\d+(?:-[0-9A-Za-z]+)?)\s*호?(의\s*\d+)?", raw or "")
    if not m:
        return "별지"
    return f"별지 제{m.group(1)}호{(m.group(2) or '').replace(' ', '')}"


def classify(block: str) -> tuple:
    # 삭제된 서식(라벨 줄에 '삭제 <YYYY…>')은 내용 없음이 정상 — 복원 대상 아님(워크플로 실측 오탐 26건)
    first = block.splitlines()[0] if block.splitlines() else ""
    if re.search(r"삭\s*제", first):
        return "OK", "삭제된 서식(원문도 라벨만)"
    if "byeolji-restored" in block:
        return "OK", "복원됨(비전 전사 — 검수 대기)"
    body = "\n".join(block.splitlines()[1:]).strip()
    compact = re.sub(r"\s+", "", body)
    table_rows = [l for l in body.splitlines() if l.strip().startswith("|")]
    field_lines = len(re.findall(r"^[^\n|]{0,30}[:：]\s*$|^[^\n|]{0,30}[:：]\s", body, re.M))
    if len(compact) < 40:
        return "A", "라벨만 있고 내용 없음"
    if table_rows:
        widths = [l.count("|") for l in table_rows if not re.match(r"^\|[\s:-]+\|$", l.strip())]
        if widths and (max(widths) - min(widths) >= 3):
            return "C", f"표 칸수 불일치({min(widths)}~{max(widths)})"
        if widths and max(widths) <= 2 and len(table_rows) >= 3:
            return "C", "1칸 표(구조 평탄화 의심)"
        empty_cells = sum(1 for l in table_rows if re.match(r"^\|[\s|]*\|$", l.strip()))
        if table_rows and empty_cells / len(table_rows) > 0.5:
            return "C", "빈 셀 행 과다"
        return "OK", f"표 {len(table_rows)}행"
    if field_lines >= 3:
        return "OK", f"항목 라인 {field_lines}개"
    if len(compact) < 160:
        return "D", f"짧음({len(compact)}자)·표 없음"
    return "B", f"구조 없음(산문 {len(compact)}자)"


def main() -> int:
    vault = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE.parent / "KEI-행정가이드") / "20_규정원문"
    manifest = {}
    mpath = HERE / "index" / "byeolji_manifest.json"
    if mpath.exists():
        manifest = json.loads(mpath.read_text(encoding="utf-8"))

    report = {}
    counts = {"A": 0, "B": 0, "C": 0, "D": 0, "OK": 0}
    for md in sorted(vault.rglob("*.md")):
        if md.name == "README.md":
            continue
        lines = md.read_text(encoding="utf-8").splitlines()
        # 별지 라벨 줄 인덱스(본문 인용 제외 — 줄 시작 + 짧은 줄)
        idxs = [i for i, l in enumerate(lines)
                if LABEL_LINE.match(l.strip()) and len(l.strip()) < 60
                and not re.search(r"(에|의)\s*따라|서식으로|참조", l)]
        if not idxs:
            continue
        entries = []
        for n, i in enumerate(idxs):
            end = idxs[n + 1] if n + 1 < len(idxs) else len(lines)
            block = "\n".join(lines[i:end])
            label = norm_label(lines[i])
            grade, why = classify(block)
            pdf_pages = None
            for b in manifest.get(md.stem, {}).get("별지", []):
                if b["label"] == label:
                    pdf_pages = b["pages"][1] - b["pages"][0] + 1
                    # 원문이 여러 페이지인데 md가 빈약 → 심각도 승격
                    if (grade in ("D", "OK") and pdf_pages >= 2
                            and len(re.sub(r"\s+", "", block)) < 400
                            and "byeolji-restored" not in block):  # 복원본은 원문 대조 전사 — 승격 제외
                        grade, why = "B", f"원문 {pdf_pages}p인데 md 빈약"
                    break
            counts[grade] += 1
            entries.append({"label": label, "grade": grade, "why": why,
                            "line": i + 1, "chars": len(re.sub(r"\s+", "", block)),
                            "pdf_pages": pdf_pages})
        if entries:
            report[md.stem] = entries

    # 원문(PDF manifest)엔 있는데 md에 라벨조차 없는 별지 — 변환에서 통째로 소실(서식찾기 미노출)
    missing_in_md = []
    for stem, mf in manifest.items():
        md_labels = {e["label"] for e in report.get(stem, [])}
        for b in mf.get("별지", []):
            if b["label"] not in md_labels:
                missing_in_md.append({"stem": stem, "label": b["label"], "name": b.get("name", "")})

    out = HERE / "index" / "byeolji_audit.json"
    out.write_text(json.dumps({"counts": counts, "missing_in_md": missing_in_md, "regs": report},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(counts.values())
    print(f"⚠ md 누락 별지(원문 PDF엔 존재): {len(missing_in_md)}건")
    for x in missing_in_md[:12]:
        print(f"   • {x['stem']} {x['label']} — {x['name'][:40]}")
    print(f"별지 블록 {total}건 — A(빈){counts['A']} B(구조소실){counts['B']} "
          f"C(표깨짐){counts['C']} D(빈약){counts['D']} OK {counts['OK']} → {out}")
    worst = [(s, e) for s, es in report.items() for e in es if e["grade"] in ("A", "B", "C")]
    print(f"\n복원 우선(A/B/C) {len(worst)}건 — 상위 20:")
    for s, e in worst[:20]:
        print(f"  [{e['grade']}] {s} {e['label']} — {e['why']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
