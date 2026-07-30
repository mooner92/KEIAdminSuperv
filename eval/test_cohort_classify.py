#!/usr/bin/env python3
"""test_cohort_classify.py — 코호트 분리 + 실패유형 자동 분류 회귀 (docs/58 §6d).

⛔ 채점 LLM을 다시 돌리지 않고, 이미 채점된 실측 데이터(2026-07-29·30)를 재생해 검증한다.
   문항 은행을 건드리지 않는다(순수 함수만 호출·읽기 전용).

배경(2026-07-30 실측): 29일↔30일 공통 문항이 60건 중 9건뿐 — 표본 85%가 매일 교체된다.
그래서 합산 정답률의 일별 비교(80.7→91.2)는 대부분 표본 구성이고 개선을 증명하지 못한다.

실행: cd eval && ../tools/.venv/bin/python test_cohort_classify.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daily_grade import classify_failure, cohort_of, golden_suspect  # noqa: E402

DAILY = Path(__file__).resolve().parent / "daily"


# ── ① 코호트 판정 ────────────────────────────────────────────────────────────────
def test_cohort_new_when_no_history():
    assert cohort_of(None) == "신규"
    assert cohort_of({}) == "신규"
    assert cohort_of({"판정이력": []}) == "신규"


def test_cohort_retry_when_history_exists():
    assert cohort_of({"판정이력": [{"date": "2026-07-29", "판정": "오답"}]}) == "재시험"


# ── ② 골든 결함 감지 — 실측 골든으로 고정 ─────────────────────────────────────────
def test_golden_suspect_catches_real_defects():
    """30일 실측: 근거를 정확히 회수했는데도 채점이 불가능했던 골든들."""
    assert golden_suspect("15. 연구안내게시판의 게시글 등록·수정 권한과 게시종료 기능.")
    assert golden_suspect("-회의 개최경비는 당해 연구 또는 행사 수행과 직접적으로 관련된 소요경비")
    assert golden_suspect("")
    assert golden_suspect(None)


def test_golden_suspect_no_false_positive_on_valid():
    """⛔ 정상 골든을 결함으로 몰면 실제 결함을 가린다 — 표에서 뽑은 골든 포함."""
    ok = [
        "제3조(기간) ① 연구연수기간은 1년 이내로 한다.",
        '"지리정보자료"이라 함은 연구원 내부에서 활용되는 지리정보데이터를 합한 것을 말한다.',
        "Executive Summary 작성이 완료되면 영문에디터에게 원고를 송부하여 검독을 요청한다.",
        # 표 유래 골든(전결 매트릭스) — 문장 종결이 없어도 정상이다
        "가.원인행위 > 3) 물품구입 및 매각(도서포함) > 구입 / 전결권자 실･팀장",
    ]
    for g in ok:
        assert not golden_suspect(g), f"오탐: {g[:40]}"


# ── ③ 실패유형 분류 ──────────────────────────────────────────────────────────────
def test_classify_failure_buckets():
    assert classify_failure({"판정": "정답"}) == ""
    assert classify_failure({"판정": "폐기", "골든": "아무거나 한다."}) == "출제결함"
    # 골든 결함이 원인보다 앞선다 — 채점 자체가 불가능하면 검색·생성을 고쳐도 안 오른다
    assert classify_failure({"판정": "판정불가", "골든": "15. 목차 항목."}) == "골든품질"
    assert classify_failure({"판정": "오답", "골든": "정상 골든이다.", "원인": "검색실패"}) == "검색실패"
    assert classify_failure({"판정": "오답", "골든": "정상 골든이다.", "원인": "생성환각"}) == "생성환각"
    assert classify_failure({"판정": "판정불가", "골든": "정상 골든이다."}) == "판정불가-기타"
    assert classify_failure({"판정": "부분", "골든": "정상 골든이다."}) == "부분정답"


# ── ④ 실측 재생 — 30일 데이터에 분류기를 걸어 성격별 규모를 고정 ───────────────────
def test_replay_20260730():
    f = DAILY / "2026-07-30.graded.json"
    if not f.exists():
        print("     skip: 2026-07-30.graded.json 없음")
        return
    items = json.loads(f.read_text(encoding="utf-8"))["문항"]
    lab = {}
    for r in items:
        t = classify_failure(r)
        if t:
            lab[t] = lab.get(t, 0) + 1
    total = sum(lab.values())
    print(f"     30일 미정답 {total}건 실패유형: {lab}")
    assert total == 8, f"미정답 8건이어야 함(실측): {total}"
    # 검색 실패는 소수 — '별칭 사전보다 측정 분리가 먼저'라는 판단의 근거를 고정한다
    assert lab.get("검색실패", 0) == 1, f"검색실패 1건이어야 함: {lab}"
    assert lab.get("생성환각", 0) == 2, f"생성환각 2건이어야 함: {lab}"
    assert lab.get("골든품질", 0) == 2, f"골든품질 2건이어야 함: {lab}"


def test_replay_sample_churn():
    """표본 교체율 — 크면 합산 정답률의 일별 비교는 의미가 없다."""
    fa, fb = DAILY / "2026-07-29.graded.json", DAILY / "2026-07-30.graded.json"
    if not (fa.exists() and fb.exists()):
        print("     skip: 29/30일 데이터 없음")
        return
    A = json.loads(fa.read_text(encoding="utf-8"))["문항"]
    B = json.loads(fb.read_text(encoding="utf-8"))["문항"]
    common = {q["hash"] for q in A} & {q["hash"] for q in B}
    print(f"     29일 {len(A)}건 · 30일 {len(B)}건 · 공통 {len(common)}건 "
          f"(교체율 {100 * (1 - len(common) / len(B)):.0f}%)")
    assert len(common) == 9, f"공통 9건이어야 함(실측): {len(common)}"
    va = {q["hash"]: q["판정"] for q in A}
    vb = {q["hash"]: q["판정"] for q in B}
    wa = sum(1 for h in common if va[h] == "오답")
    wb = sum(1 for h in common if vb[h] == "오답")
    print(f"     공통(재시험) 오답: 29일 {wa}건 → 30일 {wb}건  ← 개선 신호")
    assert (wa, wb) == (7, 1), f"오답 7→1이어야 함(실측): {wa}→{wb}"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    bad = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except AssertionError as e:
            bad += 1
            print(f"  ❌  {fn.__name__}: {e}")
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 테스트 통과 — 코호트 분리·실패유형 분류") or 0)
