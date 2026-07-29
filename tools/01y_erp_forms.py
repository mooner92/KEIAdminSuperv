#!/usr/bin/env python3
"""01y_erp_forms.py — ERP 회계·연구 서식을 '서식 찾기'에 추가 (docs/64 §9).

기존 서식 찾기는 **규정 별지**(규정 → 별지 N호)만 담는다. ERP에서 받은 회계·연구 서식은
어느 규정의 별지가 아니라 **독립 양식**이라 같은 구조에 억지로 넣을 수 없다.
→ manifest에 `출처: "erp"` 그룹으로 추가하고, 별지 항목은 손대지 않는다(기존 62개 불변).

변환: HWP/HWPX → PDF 미리보기는 01p_byeolji_pdf의 convert_pdf 재사용(함초롬 치환·줄간격 보정).
      DOCX/XLSX는 변환기가 없어 원본 다운로드만 제공(미리보기 없음).

  cd tools && .venv/bin/python 01y_erp_forms.py --src /tmp/kei-load/forms [--apply]
"""
import argparse
import json
import re
import shutil
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "index" / "byeolji_manifest.json"
WEB_FORMS = HERE.parent / "web" / "public" / "forms-pdf" / "erp"

# 서식 → 업무 섹션(서식 찾기 필터용). 파일명 키워드 우선순위 순.
SECTIONS = [
    ("법인카드", r"법인카드"),
    ("지급·정산", r"개인지급정보|면접비|영수증|receipt|경비집행|사유서|선지급|소액현금|전도자금"),
    ("세무", r"조세조약|비거주자|비과세|면제신청"),
    ("계좌·통장", r"통장"),
    ("근무", r"연장근로|근무"),
    ("해외", r"invoice|해외송금"),
]
PREVIEWABLE = {".hwp", ".hwpx"}


def section_of(name: str) -> str:
    low = name.lower()
    for sec, pat in SECTIONS:
        if re.search(pat, low, re.I):
            return sec
    return "기타"


def clean_title(name: str) -> str:
    """파일명 → 사람이 읽는 서식명."""
    t = Path(name).stem
    t = re.sub(r"^\(양식\)|^\(환경\s*양식\)|^KEI양식\s*", "", t)
    t = re.sub(r"^\d{2}(-\d)?\.\s*", "", t)          # "01-2." 순번
    t = re.sub(r"\(?\d{4}[.\-]\d{2}[.\-]\d{2}\)?", "", t)   # 날짜
    t = re.sub(r"\(?\d{6}\s*적용\)?|\(안\)", "", t)
    return re.sub(r"\s+", " ", t).strip(" _-.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    src = Path(args.src)
    files = sorted(f for f in src.iterdir() if f.is_file())
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    before = len(man)

    entries, skipped = [], []
    for f in files:
        ext = f.suffix.lower()
        e = {
            "서식명": clean_title(f.name),
            "원본파일": f.name,
            "섹션": section_of(f.name),
            "형식": ext.lstrip("."),
            "미리보기": ext in PREVIEWABLE,
        }
        (entries if ext in PREVIEWABLE or ext in {".pdf", ".docx", ".xlsx"} else skipped).append(e)

    print(f"ERP 서식 {len(files)}개 → 등록 {len(entries)}개 · 제외 {len(skipped)}개")
    by_sec = {}
    for e in entries:
        by_sec.setdefault(e["섹션"], []).append(e)
    for sec, lst in sorted(by_sec.items()):
        print(f"\n  [{sec}] {len(lst)}개")
        for e in lst:
            mark = "🖼" if e["미리보기"] else "📎"
            print(f"      {mark} {e['서식명'][:40]:42} ({e['형식']})")
    prev = sum(1 for e in entries if e["미리보기"])
    print(f"\n  미리보기 가능(HWP/HWPX) {prev}개 · 원본 다운로드만 {len(entries)-prev}개")

    if not args.apply:
        print("\n(dry-run — 실제 반영은 --apply)")
        return

    WEB_FORMS.mkdir(parents=True, exist_ok=True)
    for f in files:
        if any(e["원본파일"] == f.name for e in entries):
            shutil.copy2(f, WEB_FORMS / f.name)
    # ⛔ 기존 별지 항목은 건드리지 않는다 — 별도 키로만 추가
    man["_erp_forms"] = {
        "설명": "ERP 회계·연구 서식(규정 별지 아님). 독립 양식이라 별도 그룹.",
        "생성": "tools/01y_erp_forms.py",
        "항목": [{**e, "경로": f"forms-pdf/erp/{e['원본파일']}"} for e in entries],
    }
    MANIFEST.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n[APPLY] manifest 갱신 — 기존 별지 {before}개 불변 + ERP 서식 {len(entries)}개")
    print(f"        파일 → {WEB_FORMS}")


if __name__ == "__main__":
    main()
