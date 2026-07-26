#!/usr/bin/env python3
"""test_axes.py — 평가 축 회귀(specs/07 §4-3 "결정적 축 정확도 100%").

축 문항은 **정답을 인덱스에서 그대로 가져온다**. 따라서 다음이 깨지면 그건 버그다:
  ① 출제한 문항의 판정키가 원 인덱스(룰·그래프)와 100% 일치
  ② 정답문/오답문/거부문을 넣었을 때 채점기가 각각 정답/오답/오답(검색실패)을 낸다
  ③ 출제 게이트 — 잘린 anchor·역산 기한·미완결 정의는 나오지 않는다
실행: .venv/bin/python eval/test_axes.py
"""
import json
import random
import re
import sys

import axes

FAIL = []


def ck(cond, msg):
    print(("  ✅ " if cond else "  ❌ ") + msg)
    if not cond:
        FAIL.append(msg)


def main() -> int:
    rng = random.Random(20260726)
    avail = axes.available()
    print(f"사용 가능 축: {avail}")
    items = axes.sample_all(rng, {a: 6 for a in axes.AXES})
    by = {}
    for it in items:
        by.setdefault(it["축"], []).append(it)
    print(f"표본 {len(items)}건 — {dict((k, len(v)) for k, v in by.items())}\n")

    # ── ① 판정키 ↔ 원 인덱스 일치 ──────────────────────────────────────────────
    print("① 판정키 = 인덱스 원값 (불일치 = 버그)")
    if by.get("amount"):
        sys.path.insert(0, str(axes.ROOT / "tools"))
        import amount_judge
        bad = [it for it in by["amount"]
               if amount_judge.judge(it["판정키"]["업무키"], it["판정키"]["금액"]).get("전결권자")
               != it["판정키"]["전결권자"]]
        ck(not bad, f"amount {len(by['amount'])}건 — 룰 판정기와 전결권자 일치")
    if by.get("impact"):
        ib = json.loads((axes.IDX / "graph_analytics.json").read_text(encoding="utf-8"))["impact_by_article"]
        bad = [it for it in by["impact"] if it["판정키"]["기대"] != ib[it["판정키"]["기준"]]["direct"][:6]]
        ck(not bad, f"impact {len(by['impact'])}건 — 그래프 direct와 일치")
    if by.get("defterm"):
        tm = json.loads((axes.IDX / "defterms.json").read_text(encoding="utf-8"))["terms"]
        bad = [it for it in by["defterm"]
               if it["판정키"]["정의"] not in [b["정의"] for b in tm.get(it["판정키"]["용어"], [])]]
        ck(not bad, f"defterm {len(by['defterm'])}건 — 정의 원문과 일치")
    if by.get("deadline"):
        bad = [it for it in by["deadline"]
               if f"{it['판정키']['n']}" not in it["골든"].replace(",", "")]
        ck(not bad, f"deadline {len(by['deadline'])}건 — 오프셋 값이 골든 원문에 실존")

    # ── ② 채점기 왕복 ────────────────────────────────────────────────────────
    print("\n② 채점기 — 정답문/오답문/거부문")
    REFUSE = "제공된 규정에서 확인되지 않습니다. 담당 부서에 문의해 주세요."
    if by.get("amount"):
        it = by["amount"][0]
        exp = it["판정키"]["전결권자"]
        exp_atoms = axes._ranks_in(exp)
        other = next(r for r in ["부원장", "원장", "팀장", "부서장"] if axes._ranks_in(r) != exp_atoms)
        ck(axes.grade(it, f"**{exp}** 전결입니다.")[0] == "정답", f"amount 정답문 → 정답({exp})")
        v = axes.grade(it, f"**{other}** 전결입니다.")
        ck(v[0] == "오답" and v[2] == "생성환각", f"amount 오답문({other}) → 오답/생성환각")
        ck(axes.grade(it, REFUSE)[:1] + axes.grade(it, REFUSE)[2:] == ("오답", "검색실패"), "amount 거부문 → 오답/검색실패")
        # 부분문자열 함정: '부원장'이 '원장'으로 오검출되면 안 된다
        ck(axes._ranks_in("부원장 전결") == {"부원장"}, "직급 검출 — '부원장'이 '원장'을 오검출하지 않음")
    if by.get("deadline"):
        it = by["deadline"][0]
        n, u = it["판정키"]["n"], it["판정키"]["unit"]
        ck(axes.grade(it, f"{n}{u} 이내에 하셔야 합니다.")[0] == "정답", f"deadline 정답문 → 정답({n}{u})")
        v = axes.grade(it, f"{n + 3}{u} 이내입니다.")
        ck(v[0] == "오답", f"deadline 오답문({n+3}{u}) → 오답")
        ck(axes.grade(it, REFUSE)[0] == "오답", "deadline 거부문 → 오답")
        ck(axes.grade(it, "규정을 참고하세요.")[0] == "검토필요", "deadline 기간값 없음 → 검토필요(보수적)")
    if by.get("defterm"):
        it = by["defterm"][0]
        ck(axes.grade(it, it["판정키"]["정의"])[0] == "정답", "defterm 정의 그대로 → 정답")
        ck(axes.grade(it, "그런 용어는 규정에서 확인되지 않습니다.")[0] == "오답", "defterm 거부문 → 오답")
    if by.get("impact"):
        it = by["impact"][0]
        lab = it["판정키"]["기대"][0]
        reg, _, jo = lab.partition("#")
        ck(axes.grade(it, f"「{reg}」 {jo}를 함께 보셔야 합니다.")[0] == "정답", "impact 정답문 → 정답")
        ck(axes.grade(it, REFUSE)[0] == "오답", "impact 거부문 → 오답")
        ck(axes.grade(it, "특별히 없습니다.")[0] == "검토필요", "impact 미언급 → 검토필요(보수적, 오답 아님)")

    # ── ③ 출제 게이트 ────────────────────────────────────────────────────────
    print("\n③ 출제 게이트")
    for it in by.get("deadline", []):
        if "역산" in it["골든"] or len(it["판정키"]["anchor"]) < 6:
            FAIL.append(f"deadline 게이트 누수: {it['질문']}")
    ck(not [f for f in FAIL if "deadline 게이트" in f], "deadline — 잘린 anchor·역산(소급요건) 미출제")
    bad_def = [it for it in by.get("defterm", []) if not it["판정키"]["정의"].rstrip().endswith("말한다")]
    ck(not bad_def, "defterm — 미완결 정의 미출제")
    # 조사 오류(실측: '공사･수리은', "'관리'이란"). ⚠ 문장 전체를 훑으면 동사 활용('영향을 받는')을
    # 오검출한다 — **템플릿 치환 지점만** 본다(슬롯 뒤 조사).
    SLOTS = [r"'(?:[^']+)([가-힣])'(이란|란) ", r"(제\d+조(?:의\d+)?)()", r"([가-힣])(은|는) 누구 전결"]
    def bad_josa(q):
        for pat, parts in ((SLOTS[0], ("이란", "란")), (SLOTS[2], ("은", "는"))):
            m = re.search(pat, q)
            if m and m.group(2) != axes._josa(m.group(1), parts):
                return f"{m.group(0).strip()} ← {q}"
        m = re.search(r"(제\d+조(?:의\d+)?)(을|를|이|가) ", q)
        if m:
            want = axes._josa(m.group(1), ("을", "를") if m.group(2) in "을를" else ("이", "가"))
            if m.group(2) != want:
                return f"{m.group(0).strip()} ← {q}"
        return None
    bad = [b for b in (bad_josa(it["질문"]) for it in items) if b]
    ck(not bad, "템플릿 조사 보정 — 슬롯 뒤 조사 오류 0건" + (f" (예: {bad[0][:70]})" if bad else ""))
    ck(axes._josa("수리") == "는" and axes._josa("공사") == "는" and axes._josa("관리", ("이란", "란")) == "란"
       and axes._josa("제17조", ("을", "를")) == "를" and axes._josa("제5항", ("을", "를")) == "을",
       "_josa 단위 — 받침 유무 판정")

    # ── ④ 은행 스키마 호환 ───────────────────────────────────────────────────
    print("\n④ 스키마 — 은행/채점이 요구하는 필드")
    need = {"질문", "유형", "정량여부", "출처", "분류", "주제", "골든", "축", "판정키"}
    ck(all(need <= set(it) for it in items), f"필수 필드 {len(need)}종 전건 보유")
    ck(all(it["출처"].get("청크id") is None for it in items),
       "청크id=None — 축 문항은 청크가 아닌 파생 인덱스가 근거")

    print()
    if FAIL:
        print(f"⛔ 실패 {len(FAIL)}건")
        for f in FAIL:
            print("  -", f)
        return 1
    print("🎉 축 회귀 통과")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
