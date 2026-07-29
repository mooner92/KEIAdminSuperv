#!/usr/bin/env python3
"""organize_forms.py — 양식·가이드 원본을 ERP 화면의 정본 섹션 체계로 구조화 (docs/64 §8).

규정집(organize_sources.py)과 같은 원리인데 기준이 다르다:
  규정집  → 규정집구조.xlsx (규정번호 8편 체계)
  양식·가이드 → ERP 화면 스크린샷에서 판독한 섹션 (index/form_taxonomy.json)

⛔ 원본은 수정하지 않는다 — 기본 dry-run, --apply로만 복사.

  cd tools && .venv/bin/python organize_forms.py --src ~/kei-sources [--apply]
"""
import argparse
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
TAXONOMY = HERE / "index" / "form_taxonomy.json"

# 구조화 대상: 저장소 디렉터리 → taxonomy 키
TARGETS = {"회계양식": "회계양식", "연구양식": "연구양식", "연구행정가이드": "연구행정가이드"}


# 같은 것을 다르게 적은 표기 — 파일명과 정본 항목명의 어휘가 어긋나는 실측 사례.
# ⚠ 유사도만으로는 못 잡는다(이지바로↔Ezbaro는 문자 겹침이 0).
ALIASES = [
    ("이지바로", "ezbaro"), ("통합이지바로", "통합ezbaro"),
    ("면접비지급정보", "면접비지급을위한개인지급정보"),
    ("영수증양식", "영수증현금수령확인증"), ("receipt", "영수증현금수령확인증"),
    ("법인회원가입신청서", "법인카드가입신청서신한카드"),
    ("연구원재무정보", "기관재무정보현황자료"), ("현황자료", "기관재무정보현황자료"),
    ("비거주자인적용역소득비과세관련안내문", "소득별원천징수방법안내문"),
    ("지급신청관련주요유의사항안내", "예산집행시필요한주요증빙안내문"),
    ("공용법인카드사용대장", "법인카드관리대장"),
    ("연구연수자법인카드사용대상여부", "자율연구자법인카드사용대상여부양식"),
    ("통합ezbaro회원가입", "통합ezbaro시스템회원가입안내"),
    # 연구양식 — 파일이 정본보다 잘게 나뉜 경우(기본/일반 × 착수/중간/최종)
    ("자문회의점검표", "자문회의점검양식"),
    ("자문회의중간점검표서면", "자문회의점검양식"), ("자문회의착수점검표서면", "자문회의점검양식"),
    ("자문회의최종점검표서면", "자문회의점검양식"),
    ("평가의견반영결과양식", "평가감수의견반영결과서양식"),
    ("자문의견반영결과양식", "자문의견반영결과서양식"),
    ("저자확인검토서저자표기확인서", "저자표기관련양식"),
    ("성과물계획서및자체점검표", "일반연구사업연구형성과물계획서및자체점검표"),
    ("수당지급기준", "각종수당회의원고등지급기준"),
    ("개인지급정보", "수당지급을위한개인지급정보양식"),
    ("연구윤리자체준수여부체크리스트양식", "연구윤리자체준수여부체크리스트"),
    ("최종보고서제출체크리스트확인서", "최종보고서제출체크리스트확인서"),
    ("원고집필계약서국문", "원고집필계약서국문"), ("과제자문계약서국문", "과제자문계약서국문"),
    ("연구윤리동의서", "연구윤리동의서국문"),
    ("연구윤리준수확인서", "연구윤리준수확인서국문"),
    ("수의계약체결제한여부확인서", "신규수의계약체결제한여부확인서"),
    ("kei근무사실확인서", "신규kei근무사실확인서"),
    ("과제자문의견서", "과제자문의견서국문"),
    ("출판업무편람", "kei출판업무편람"),
    ("국문보고서편집양식", "국문보고서편집양식"), ("영문보고서편집양식", "영문보고서편집양식"),
    ("보고서인쇄비계산기", "보고서발간비용관련안내사항"),
    ("인쇄등록업체", "기타출판관련양식"), ("인쇄물납품확인서양식", "기타출판관련양식"),
    ("수탁보고서표지디자인제공안내", "수탁보고서표지디자인제공"),
    ("수탁표지", "수탁보고서표지디자인제공"),
    ("생성형인공지능ai윤리가이드라인", "kei생성형인공지능ai윤리가이드라인국문"),
    ("기관생명윤리위원회등록증", "기관생명윤리위원회등록증"),
    ("자문위원선정양식", "자문위원선정양식"),
    ("관리추진계획안", "관리추진계획안"),
    ("상세사업계획서양식", "일반연구사업사업형상세사업계획서양식"),
]


def norm(s: str) -> str:
    """비교용 정규화 — 공백·기호·연도·확장자 제거 + 표기 별칭 통일."""
    s = re.sub(r"\.(hwpx?|pdf|docx?|xlsx?|pptx?|zip|png)$", "", s, flags=re.I)
    s = re.sub(r"\(?\d{4}[.\-_]?\d{0,2}[.\-_]?\d{0,2}\)?", "", s)  # 날짜
    s = re.sub(r"[\s·ㆍ_\-()<>\[\]{}.,'\"★「」&]", "", s)
    s = s.lower()
    for a, b in ALIASES:
        if a in s:
            s = s.replace(a, b)
    return s


def frags(s: str, n: int = 3) -> set:
    return {s[i:i + n] for i in range(max(0, len(s) - n + 1))}


def score(item: str, fname: str) -> float:
    """정본 항목명 ↔ 파일명 유사도. substring 우선, 아니면 3-gram 겹침 비율."""
    a, b = norm(item), norm(fname)
    if not a or not b:
        return 0.0
    if a in b:
        return 1.0 + len(a) / 100          # 통째 포함 = 최상
    fa, fb = frags(a), frags(b)
    if not fa:
        return 0.0
    return len(fa & fb) / len(fa)          # 항목명이 얼마나 파일명에 녹아있나


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(Path.home() / "kei-sources"))
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--threshold", type=float, default=0.55)
    args = ap.parse_args()

    src = Path(args.src)
    tax = json.loads(TAXONOMY.read_text(encoding="utf-8"))
    report = {}

    for dirname, taxkey in TARGETS.items():
        d = src / dirname
        if not d.exists():
            print(f"⚠ {dirname} 없음 — 건너뜀")
            continue
        files = sorted(f for f in d.iterdir() if f.is_file())
        sections = tax[taxkey]["섹션"]
        expected = tax[taxkey]["_총건수"]

        # 각 파일을 가장 잘 맞는 (섹션, 항목)에 배정 — 최고점 1개
        placed = defaultdict(list)   # 섹션 → [(파일, 항목, 점수)]
        unmatched = []
        for f in files:
            best = (0.0, None, None)
            for sec, items in sections.items():
                for item in items:
                    sc = score(item, f.name)
                    if sc > best[0]:
                        best = (sc, sec, item)
            if best[0] >= args.threshold:
                placed[best[1]].append((f, best[2], round(best[0], 2)))
            else:
                unmatched.append((f, round(best[0], 2), best[2]))

        # 정본에 있으나 파일이 안 붙은 항목
        hit_items = {it for lst in placed.values() for _, it, _ in lst}
        missing = [(sec, it) for sec, items in sections.items()
                   for it in items if it not in hit_items]

        report[dirname] = {
            "파일수": len(files), "정본건수": expected,
            "배정": sum(len(v) for v in placed.values()),
            "미배정": len(unmatched), "빈항목": len(missing),
        }

        print(f"\n{'='*66}\n■ {dirname} — 파일 {len(files)}개 / 정본 {expected}건")
        for sec in sections:
            lst = placed.get(sec, [])
            print(f"  [{sec}] {len(lst)}개")
            for f, item, sc in lst:
                print(f"      {f.name[:52]:54} ← {item[:26]} ({sc})")
        if unmatched:
            print(f"  ⚠ 미배정 {len(unmatched)}개(사람 확인):")
            for f, sc, near in unmatched:
                print(f"      ? {f.name[:52]:54} 최근접={str(near)[:22]} ({sc})")
        if missing:
            print(f"  ⚠ 파일 없는 정본 항목 {len(missing)}개:")
            for sec, it in missing:
                print(f"      ✗ [{sec}] {it}")

        if args.apply:
            for sec, lst in placed.items():
                sd = d / sec
                sd.mkdir(exist_ok=True)
                for f, _, _ in lst:
                    if f.parent == d:                     # 아직 평면에 있는 것만
                        shutil.move(str(f), str(sd / f.name))
            if unmatched:
                ud = d / "99_미분류"
                ud.mkdir(exist_ok=True)
                for f, _, _ in unmatched:
                    if f.parent == d:
                        shutil.move(str(f), str(ud / f.name))

    print(f"\n{'='*66}\n요약")
    for k, v in report.items():
        print(f"  {k:14} 파일 {v['파일수']:3} · 배정 {v['배정']:3} · "
              f"미배정 {v['미배정']:2} · 빈 정본항목 {v['빈항목']:2}")
    if args.apply:
        (src / "forms_manifest.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n[APPLY] 완료 — manifest: {src/'forms_manifest.json'}")
    else:
        print("\n(dry-run — 실제 배치는 --apply)")


if __name__ == "__main__":
    main()
