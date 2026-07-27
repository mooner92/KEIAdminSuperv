#!/usr/bin/env python3
"""audit_refusal_seeds.py — 거부형 시드 감사(2026-07-26).

**왜 필요한가**: 거부형 문항은 "정답 = 거부"라고 **가정**한다. 그 가정이 틀리면 정상 답변이
오답이 되고, 거부율·정답률·개선 방향이 통째로 왜곡된다(07-24의 T7·T9와 같은 계열의 측정 오류).

실측 2026-07-26: 시드 20개 중 **16개가 코퍼스에 언급이 있었다**. '탕비실 커피머신 수리'는
물품 지침 제15조가 실제로 규율해, 모델이 정확히 인용해 답했는데 오답으로 집계됐다.

이 도구는 **볼트 전수 grep**으로 시드별 언급을 보고한다. ⛔판정하지 않는다 — 언급이 있다고
규율하는 것은 아니고(예: 패치노트에 단어가 스쳤을 뿐), 없다고 안전한 것도 아니다(상위 개념이
규율할 수 있다 — '커피머신'은 없어도 '물품'이 규율한다). **사람이 읽고 시드를 고르라는 자료**다.

실행: .venv/bin/python eval/audit_refusal_seeds.py [--keys "주차장,주차"]
"""
import argparse
import pathlib
import sys

from daily_common import REFUSAL_SEEDS, ROOT

VAULT = ROOT / "KEI-행정가이드"
# 시드 → 검색어. 시드 문구 그대로는 잘 안 맞으므로 핵심 명사로 편다(사람이 유지).
KEYS = {
    "사내 주차장 배정": ["주차장", "주차"], "구내식당 외부인 이용": ["구내식당"],
    "통근버스 노선": ["통근버스"], "사내 어린이집 입소": ["어린이집", "보육"],
    "체력단련실(헬스장) 이용": ["체력단련", "헬스"], "사내 카페 운영시간": ["카페"],
    "흡연구역 위치": ["흡연"], "탕비실 비품": ["탕비실"], "사옥 냉난방 온도": ["냉난방"],
    "엘리베이터 점검 일정": ["엘리베이터"], "직원 기숙사 배정": ["기숙사", "관사"],
    "반려동물 동반 출근": ["반려동물"],
    "옥상 정원 이용": ["옥상"], "전기차 충전소 이용": ["충전소"], "택배 보관": ["택배"],
    "사내 이발소": ["이발"], "은행 지점 입점": ["은행 지점"],
    "우편물 발송 대행": ["발송 대행", "우편물 대행"], "회의실 음식물 반입": ["음식물 반입"],
}
# ⛔ 시드에서 뺀 것과 이유(되돌리지 말 것 — 실측 근거)
RETIRED = {
    "탕비실 비품": "물품 구매·관리 지침이 물품의 수리·보수·구매를 규율(제15조) — '정답=거부' 가정 오류",
    "사내 도서관 야간 개방": "KEI Library Guide에 이용시간(월~금)·휴관일이 실재 — 모델이 정확히 인용해 "
                        "'야간 명시 없음'을 답했는데 오답 집계됨(2026-07-27). 감사 검색어가 좁아 놓쳤다",
    "우편물 발송 대행": "문서관리규정 제32조가 인편·우편 발송을 규율 — 경계가 모호해 시드 부적합",
}


def scan(keys: list) -> list:
    hits = []
    for p in VAULT.rglob("*.md"):
        if "_changelog" in p.parts or "_bugreport" in p.parts:
            continue  # 패치노트는 규정이 아니다(내가 쓴 문서가 근거로 잡히는 오탐 방지)
        try:
            t = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:  # noqa: BLE001
            continue
        for k in keys:
            if k in t:
                hits.append((k, p.stem, t.count(k)))
                break
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", help="임의 검색어(쉼표) — 새 시드 후보 검증용")
    args = ap.parse_args()

    if args.keys:
        ks = [k.strip() for k in args.keys.split(",") if k.strip()]
        h = scan(ks)
        print(f"검색어 {ks} → {'언급 ' + str(len(h)) + '건' if h else '코퍼스 무언급 ✅ (시드 후보 적합)'}")
        for k, n, c in h[:10]:
            print(f"   '{k}' → {n} ({c}회)")
        return 0

    print(f"볼트 전수 감사 — 시드 {len(REFUSAL_SEEDS)}개 (⛔판정 아님, 사람이 읽는 자료)\n")
    flagged = 0
    for s in REFUSAL_SEEDS:
        h = scan(KEYS.get(s, [s]))
        flagged += bool(h)
        mark = "⚠" if h else "  "
        detail = " · ".join(f"'{k}'→{n}({c}회)" for k, n, c in h[:2]) if h else "코퍼스 무언급 ✅"
        print(f"{mark} {s:20} {detail}")
    print(f"\n언급 있음 {flagged}/{len(REFUSAL_SEEDS)} — 언급≠규율이므로 실물 확인 후 판단할 것")
    if RETIRED:
        print("\n■ 시드에서 제외된 것(실측 근거)")
        for k, why in RETIRED.items():
            print(f"   ✗ {k} — {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
