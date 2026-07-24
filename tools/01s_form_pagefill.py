#!/usr/bin/env python3
"""01s — 별지 미리보기 PDF의 '꼬리넘침' 판정 → byeolji_manifest.json 보강 (docs/50 §8d).

배경(2026-07-24 실측): 다쪽 별지 중 일부는 서식 본문이 첫 장에 다 담기고 **마지막 장에
서명란·날짜 한 줄만 넘친** 경계 케이스다(끝 장 거의 빔). 줄간격(0.42까지)·여백(0.3in) 두
압축 레버로도 접히지 않음이 실측으로 확정 — 표의 고정 행높이에 잠긴 **구조적** 스필이라
더 압축하면 서식이 뭉개진다(충실도 훼손). 내용은 온전하므로 접지 않되, 서식 찾기 배지가
'N장(주황 주의)'로 **과잉 경고**하지 않도록 이 서식들에 `꼬리넘침=true`를 표시한다.

판정: 다쪽(pages span≥2) & **마지막 장이 거의 빔**(공백 제외 텍스트 ≤80자 & 이미지 0).
   ⟶ 01p `_blank_page` 휴리스틱과 동일 기준. 진짜 다쪽(끝 장 실내용)은 제외.
⛔ 리포트/메타 보강만 — PDF·볼트 불변, 재변환 없음(기존 PDF 재판독).
실행: python tools/01s_form_pagefill.py  [--manifest tools/index/byeolji_manifest.json] [--dry]
"""
import argparse
import json
import pathlib

import fitz  # PyMuPDF

HERE = pathlib.Path(__file__).resolve().parent
FORMS_PUB = HERE.parent / "web" / "public"
TAIL_MAX_CHARS = 80  # 01p _blank_page(thresh=80)과 동일


def last_page_blank(pdf: pathlib.Path) -> bool:
    doc = fitz.open(pdf)
    try:
        last = doc[-1]
        txt = last.get_text().replace(" ", "").strip()
        return len(txt) <= TAIL_MAX_CHARS and not last.get_images()
    finally:
        doc.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=str(HERE / "index" / "byeolji_manifest.json"))
    ap.add_argument("--dry", action="store_true", help="기록하지 않고 판정만 출력")
    args = ap.parse_args()

    mpath = pathlib.Path(args.manifest)
    man = json.loads(mpath.read_text(encoding="utf-8"))

    spill, genuine, single, missing = [], 0, 0, 0
    for reg, meta in man.items():
        for it in meta.get("별지", []):
            pg = it.get("pages")
            n = (pg[1] - pg[0] + 1) if isinstance(pg, list) and len(pg) == 2 else None
            if not n or n < 2:
                single += 1
                it.pop("꼬리넘침", None)  # 1장은 플래그 불필요(과거값 정리)
                continue
            pdf = FORMS_PUB / (it.get("pdf") or "")
            if not it.get("pdf") or not pdf.exists():
                missing += 1
                continue
            if last_page_blank(pdf):
                it["꼬리넘침"] = True
                spill.append((reg, it.get("label"), n, it.get("name", "")[:30]))
            else:
                it.pop("꼬리넘침", None)
                genuine += 1

    print(f"단일 1장: {single} · 진짜 다쪽: {genuine} · 꼬리넘침: {len(spill)} · PDF누락: {missing}")
    print("\n=== 꼬리넘침(실질 한 장, 배지 초록 처리) ===")
    for reg, label, n, name in sorted(spill, key=lambda x: (-x[2], x[0])):
        print(f"  {n}장 | {reg[:26]} {label} — {name}")

    if args.dry:
        print("\n[dry] manifest 미기록")
    else:
        mpath.write_text(json.dumps(man, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n✅ manifest 보강 기록: {mpath}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
