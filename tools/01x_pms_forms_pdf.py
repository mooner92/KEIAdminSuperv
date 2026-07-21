#!/usr/bin/env python3
"""01x_pms_forms_pdf.py — PMS 연구관리양식 PDF 미리보기를 별지 파이프라인 품질로 (재)변환.

서식 찾기의 PMS 양식 미리보기는 처음에 naive `soffice --convert-to pdf`로 만들어 페이지 팽창이
났다(HWP 전용 서체가 서버에 없어 LO가 다른 서체로 치환→줄높이 커짐→내용이 다음 페이지로).
01p_byeolji_pdf.convert_pdf(HWP→ODT→서체 치환+비율 줄간격 보정→PDF)를 그대로 재사용해 고친다.

대상: web/public/forms-pdf/pms/<카테고리>/의 .hwp/.hwpx (docx/xlsx/pdf는 미리보기 생성 안 함).
manifest.json의 pdf 필드도 결과에 맞춰 갱신. 원본 파일은 그대로 둔다(다운로드용).

실행: cd tools && .venv/bin/python 01x_pms_forms_pdf.py [--force]
"""
import argparse
import importlib.util
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent

# 01p는 파일명이 숫자로 시작해 import 불가 → importlib로 로드
_spec = importlib.util.spec_from_file_location("byeolji", HERE / "01p_byeolji_pdf.py")
_bz = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bz)

PMS_DIR = HERE.parent / "web" / "public" / "forms-pdf" / "pms"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="캐시 무시하고 전부 재변환")
    args = ap.parse_args()

    mf_path = PMS_DIR / "manifest.json"
    items = json.loads(mf_path.read_text(encoding="utf-8"))
    by_file = {(it["카테고리"], it["파일"]): it for it in items}

    ok = fail = skip = 0
    for cat_dir in sorted(PMS_DIR.iterdir()):
        if not cat_dir.is_dir():
            continue
        for src in sorted(cat_dir.glob("*")):
            ext = src.suffix.lower()
            if ext not in (".hwp", ".hwpx"):
                continue
            out_pdf = src.with_suffix(".pdf")
            success, cached = _bz.convert_pdf(src, out_pdf, args.force)
            it = by_file.get((cat_dir.name, src.name))
            if success:
                if cached:
                    skip += 1
                else:
                    ok += 1
                    print(f"  ✓ {cat_dir.name}/{src.stem[:40]}")
                if it is not None:
                    it["pdf"] = out_pdf.name
            else:
                fail += 1
                if it is not None:
                    it["pdf"] = None

    mf_path.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n재변환 {ok} · 캐시 {skip} · 실패 {fail} → manifest 갱신")
    print("다음: pms_forms_raw/manifest.json에도 반영하려면 복사 · web 재빌드 불필요(server.js 직서빙)")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
