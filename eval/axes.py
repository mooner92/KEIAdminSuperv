#!/usr/bin/env python3
"""axes.py — 평가 축 레지스트리(specs/07 B).

**문제**: 새 데이터(개정영향·금액전결·정의어·기한)가 생겨도 평가 문항은 옛 축(청크 1개)만 봤다.
기능이 늘 때마다 사람이 문항을 손으로 붙이는 건 지속 불가능하고, 실제로 그 기능들은
자가평가에서 한 번도 검증되지 않았다.

**설계**: 축 = (파생 인덱스, 표본 추출기, 결정적 채점기, 최소 쿼터).
- 질문은 **템플릿 + 인덱스 실값**으로 만든다(LLM 0회) — 상황 창작이 원천 불가.
- 정답도 인덱스가 이미 가지고 있다 ⟹ **채점에 LLM이 필요 없다**.
  T7·T9 계열(채점기 오판이 개선 방향을 오도)이 이 축들에서는 구조적으로 발생하지 않는다.
- 데이터가 없으면(인덱스 미생성) 그 축은 조용히 생략 — 크론이 깨지지 않는다.

⛔ 규약: 새 파생 인덱스를 만들면 여기에 축을 등록한다(docs/53 마감 매트릭스).

채점 판정은 기존 3단 채점과 같은 어휘(정답|부분|오답|검토필요|판정불가)를 쓰고,
**오답 선언은 보수적으로** — 기대값이 없고 경합값도 없으면 오답이 아니라 '검토필요'다.
"""
from __future__ import annotations

import json
import pathlib
import random
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
IDX = ROOT / "tools" / "index"
sys.path.insert(0, str(ROOT / "tools"))
from refusal_detect import is_refusal  # noqa: E402  단일 정본(specs/01 P0)

# 축별 최소 쿼터(일일 신규 문항 중) — 데이터 없으면 자동 0
AXIS_QUOTA = {"amount": 2, "impact": 2, "defterm": 2, "deadline": 2}


def _load(name: str):
    p = IDX / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def _n(s: str) -> str:
    """대조용 정규화 — 공백·구두점 제거(모델 표기 흔들림 흡수)."""
    return re.sub(r"[\s·ㆍ・･,\.\-~/()「」『』\[\]'\"]+", "", str(s))


def _josa(word: str, pair: tuple = ("은", "는")) -> str:
    """받침 유무로 조사 선택 — 템플릿 문장이 어색해지지 않게(실측: '공사･수리은')."""
    ch = (word or " ")[-1]
    if "가" <= ch <= "힣":
        return pair[0] if (ord(ch) - 0xAC00) % 28 else pair[1]
    return pair[1]


# ────────────────────────────── ① amount — 금액 전결 판정 ──────────────────────────────
# 별표의 전결권자 실값은 7종이고 **같은 직급의 다른 표기**가 섞여 있다(실측):
#   부원장6 · 부서장5 · 실･팀장3 · 부서장/센터장3 · 원장3 · 팀장3 · 과제책임자1
# 라벨을 그대로 비교하면 '부서장'과 '부서장/센터장'이 서로 오답이 된다 ⟹ **직급 원자**로 환원한다.
# 마스킹 순서 = 긴 표기 먼저 — '부원장'이 '원장'으로, '감사실장'이 '실장'으로 새는 것을 막는다.
# ('감사'는 답변 본문의 '내부감사·감사결과' 오검출 위험이 커서 원자에서 제외 — 별표 값에도 없음)
RANK_ALIASES = [
    ("과제책임자", "과제책임자"), ("연구책임자", "과제책임자"),
    ("부원장", "부원장"), ("본부장", "본부장"),
    ("감사실장", "팀장"),                        # 선소비(아래 '실장'에 먹히지 않게)
    ("부서장", "부서장"), ("센터장", "부서장"),
    ("실팀장", "팀장"), ("실장", "팀장"), ("팀장", "팀장"),
    ("원장", "원장"),                             # 항상 마지막(부원장 소비 후)
]


def _ranks_in(text: str) -> set:
    """텍스트에 등장한 직급 원자 집합 — 긴 표기부터 지워가며 부분문자열 오검출을 막는다."""
    t = _n(text)
    found = set()
    for alias, canon in RANK_ALIASES:
        a = _n(alias)
        if a in t:
            found.add(canon)
            t = t.replace(a, "◇")  # 소비 — '부원장' 소비 후엔 '원장'이 남지 않는다
    return found


def _round_won(v: int) -> int:
    """읽기 좋은 금액으로 — 만원 단위 절사(구간 밖으로 나가지 않게 호출부가 검사)."""
    return max(10_000, (v // 10_000) * 10_000)


def sample_amount(rng: random.Random, n: int) -> list:
    data = _load("amount_rules.json")
    if not data or not data.get("rules"):
        return []
    import amount_judge  # noqa: PLC0415  결정적 판정기(단일 정본) 재사용

    keys = list(data["rules"])
    rng.shuffle(keys)
    out = []
    for key in keys:
        if len(out) >= n:
            break
        ent = data["rules"][key]
        gs = [g for g in ent["구간"] if g.get("전결권자")]
        if not gs:
            continue
        g = rng.choice(gs)
        lo = g["min"] if g["min"] is not None else 0
        hi = g["max"] if g["max"] is not None else lo * 2 + 10_000_000
        won = _round_won(lo + int((hi - lo) * rng.uniform(0.25, 0.75)))
        # ⛔ 자기검증: 만든 금액이 정말 그 구간인지 결정적 판정기로 되묻는다(불일치=버그, 폐기)
        v = amount_judge.judge(key, won)
        if v.get("상태") != "판정" or v.get("전결권자") != g["전결권자"]:
            continue
        업무 = ent["업무경로"].split(">")[-1].strip()
        업무 = re.sub(r"^\d+\)\s*|^[가-힣]\.\s*", "", 업무)
        q = rng.choice([
            f"{업무} 건으로 {won // 10_000:,}만원을 집행하려는데 전결권자는 누구인가요?",
            f"{won // 10_000:,}만원짜리 {업무}{_josa(업무)} 누구 전결로 처리하나요?",
            f"{업무}에서 금액이 {won // 10_000:,}만원이면 결재는 어디까지 받나요?",
        ])
        out.append({
            "질문": q, "유형": "조건형", "정량여부": False,
            "출처": {"규정명": "위임전결규정", "조": "별표", "청크id": None},
            "분류": "결재·전결", "주제": ["결재·전결"],
            "골든": f"{ent['업무경로']} / {g['표기']} → 전결권자 {g['전결권자']}"
                    + (f" (협의 {g['협의']})" if g.get("협의") else ""),
            "축": "amount",
            "판정키": {"업무키": key, "금액": won, "전결권자": g["전결권자"], "구간": g["표기"],
                     "원문행": (g.get("근거") or {}).get("원문행", "")},
        })
    return out


def grade_amount(item: dict, 답변: str) -> tuple:
    label = item["판정키"]["전결권자"]
    exp = _ranks_in(label)          # 라벨도 원자로 환원('부서장/센터장' → {부서장})
    got = _ranks_in(답변)
    if not exp:                     # 별표에 새 표기가 생긴 경우 — 오답 선언 금지
        return "검토필요", f"전결권자 표기 '{label}'를 직급 원자로 환원하지 못함(축 갱신 필요)", None
    if exp <= got and got <= exp:
        return "정답", "", None
    if exp & got:
        others = ", ".join(sorted(got - exp))
        return "부분", f"전결권자 {label}는 맞았으나 다른 직급({others})도 함께 제시함", None
    if is_refusal(답변):
        return "오답", f"별표에 {item['판정키']['구간']} → {label}로 명시돼 있는데 확인 불가로 답변함", "검색실패"
    if got:
        return "오답", f"기대 전결권자 {label} · 답변 {', '.join(sorted(got))} (근거 행: {item['판정키']['원문행'][:60]})", "생성환각"
    return "검토필요", f"답변에서 전결권자를 특정하지 못함(기대 {label})", None


# ────────────────────────────── ② impact — 개정 영향 조문 ──────────────────────────────
def sample_impact(rng: random.Random, n: int) -> list:
    g = _load("graph_analytics.json")
    ib = (g or {}).get("impact_by_article") or {}
    keys = [k for k, v in ib.items() if v.get("direct")]
    if not keys:
        return []
    rng.shuffle(keys)
    out = []
    for k in keys[: n * 4]:
        if len(out) >= n:
            break
        reg, _, jo = k.partition("#")
        direct = ib[k]["direct"]
        q = rng.choice([
            f"「{reg}」 {jo}{_josa(jo, ('을', '를'))} 개정하면 함께 검토해야 할 조문은 무엇인가요?",
            f"「{reg}」 {jo}{_josa(jo, ('이', '가'))} 바뀌면 영향을 받는 다른 조문이 있나요?",
        ])
        out.append({
            "질문": q, "유형": "조건형", "정량여부": False,
            "출처": {"규정명": reg, "조": jo, "청크id": None},
            "분류": "규정관리", "주제": ["규정관리"],
            "골든": " / ".join(direct[:6]),
            "축": "impact",
            "판정키": {"기준": k, "기대": direct[:6]},
        })
    return out


def grade_impact(item: dict, 답변: str) -> tuple:
    a = _n(답변)
    hit = []
    for lab in item["판정키"]["기대"]:
        reg, _, jo = lab.partition("#")
        # 조 번호가 답변에 있고, 규정명이 답변에 있거나 기준 조문과 같은 규정이면 인정
        same_reg = reg == item["출처"]["규정명"]
        if _n(jo) in a and (same_reg or _n(reg) in a):
            hit.append(lab)
    if hit:
        return "정답", "", None
    if is_refusal(답변):
        return "오답", f"참조 그래프상 관련 조문({', '.join(item['판정키']['기대'][:3])})이 있는데 확인 불가로 답변함", "검색실패"
    return "검토필요", f"기대 조문 미언급(기대 {', '.join(item['판정키']['기대'][:3])})", None


# ────────────────────────────── ③ defterm — 규정 정의어 ──────────────────────────────
STOP = {"다음", "각호", "각목", "경우", "말한다", "위하여", "관한", "대한", "이하", "같다", "포함한다"}


def _keywords(text: str) -> list:
    ws = [w for w in re.findall(r"[가-힣]{2,}", str(text)) if w not in STOP]
    seen, out = set(), []
    for w in sorted(ws, key=len, reverse=True):
        if w in seen:
            continue
        seen.add(w)
        out.append(w)
    return out[:8]


def sample_defterm(rng: random.Random, n: int) -> list:
    data = _load("defterms.json")
    terms = (data or {}).get("terms") or {}
    cands = []
    for term, binds in terms.items():
        for b in binds:
            정의 = b.get("정의", "")
            # ⛔ 출제 게이트: '…을 말한다'로 끝나는 **온전한 정의문**만.
            #    실측 결함 — 파서가 중간에서 끊은 정의('…법 제3조')로 문항을 만들면 정답이 없다.
            if (b.get("form") == "정의" and len(term) >= 2
                    and 25 <= len(정의) <= 400 and 정의.rstrip().endswith("말한다")):
                cands.append((term, b))
    if not cands:
        return []
    rng.shuffle(cands)
    out = []
    for term, b in cands[: n * 3]:
        if len(out) >= n:
            break
        q = rng.choice([
            f"「{b['규정명']}」에서 말하는 '{term}'{_josa(term, ('이란', '란'))} 무엇인가요?",
            f"규정상 '{term}'의 정의를 알려주세요.",
        ])
        out.append({
            "질문": q, "유형": "조건형", "정량여부": False,
            "출처": {"규정명": b["규정명"], "조": b.get("조", ""), "청크id": None},
            "분류": b.get("분류", ""), "주제": ["용어"],
            "골든": b["정의"],
            "축": "defterm",
            "판정키": {"용어": term, "정의": b["정의"], "키워드": _keywords(b["정의"])},
        })
    return out


def grade_defterm(item: dict, 답변: str) -> tuple:
    d = _n(item["판정키"]["정의"])
    a = _n(답변)
    gg = {d[i:i + 2] for i in range(len(d) - 1)}
    bg = sum(1 for x in gg if x in a) / max(1, len(gg))
    kws = item["판정키"]["키워드"]
    kw = sum(1 for w in kws if w in 답변) / max(1, len(kws))
    if bg >= 0.4 or kw >= 0.7:  # 2축(regress_refusal과 동일 철학 — 의역에 강함)
        return "정답", "", None
    if is_refusal(답변):
        return "오답", f"규정 제{item['출처']['조']} 정의가 실재하는데 확인 불가로 답변함", "검색실패"
    if bg >= 0.2 or kw >= 0.4:
        return "부분", f"정의 일부만 일치(2그램 {bg:.0%} · 키워드 {kw:.0%})", None
    return "검토필요", f"정의와 겹침 낮음(2그램 {bg:.0%} · 키워드 {kw:.0%})", None


# ────────────────────────────── ④ deadline — 기한 오프셋 ──────────────────────────────
UNIT_ALIAS = {"개월": ["개월", "달"], "일": ["일"], "년": ["년", "연"], "주": ["주", "주일"]}
PERIOD_RE = re.compile(r"(\d[\d,]*)\s*(일|개월|달|년|주)")


def sample_deadline(rng: random.Random, n: int) -> list:
    data = _load("deadlines.json")
    dl = (data or {}).get("deadlines") or {}
    cands = []
    for reg, items in dl.items():
        for e in items:
            원문 = e.get("원문", "")
            anchor = e.get("anchor") or ""
            # ⛔ 출제 게이트(실측 결함 2종):
            #   ① anchor가 '날부터'처럼 잘린 조각이면 질문이 성립하지 않는다 → 6자 이상 + 기준 어미
            #   ② '역산하여 N년 이내'는 **소급 요건**이지 마감이 아니다 → '얼마 이내에 처리?'는 오출제
            if (e.get("type") == "마감" and e.get("n") and e.get("unit")
                    and len(anchor) >= 6 and re.search(r"(부터|이후|후|받은\s*날|완료된\s*날|다음\s*날)$", anchor)
                    and "역산" not in 원문 and "이내" in 원문):
                cands.append((reg, e))
    if not cands:
        return []
    rng.shuffle(cands)
    out, seen = [], set()
    for reg, e in cands[: n * 4]:
        if len(out) >= n:
            break
        key = (reg, e["조"], e["anchor"])
        if key in seen:
            continue
        seen.add(key)
        q = rng.choice([
            f"「{reg}」 {e['조']}에 따르면 {e['anchor']} 얼마 이내에 해야 하나요?",
            f"{e['anchor']} 언제까지 해야 하나요? (「{reg}」 {e['조']} 기준)",
        ])
        out.append({
            "질문": q, "유형": "값형", "정량여부": True,
            "출처": {"규정명": reg, "조": e["조"], "청크id": None},
            "분류": "기한", "주제": ["기한"],
            "골든": e.get("원문", "")[:300],
            "축": "deadline",
            "판정키": {"n": int(e["n"]), "unit": e["unit"], "anchor": e["anchor"]},
        })
    return out


def grade_deadline(item: dict, 답변: str) -> tuple:
    n, unit = item["판정키"]["n"], item["판정키"]["unit"]
    aliases = UNIT_ALIAS.get(unit, [unit])
    got = [(int(m[0].replace(",", "")), m[1]) for m in PERIOD_RE.findall(답변)]
    if any(v == n and u in aliases for v, u in got):
        return "정답", "", None
    if is_refusal(답변):
        return "오답", f"원문에 '{n}{unit} 이내'가 명시돼 있는데 확인 불가로 답변함", "검색실패"
    if got:
        shown = ", ".join(f"{v}{u}" for v, u in got[:3])
        return "오답", f"기대 {n}{unit} · 답변 {shown}", "생성환각"
    return "검토필요", f"답변에 기간 값이 없음(기대 {n}{unit})", None


# ────────────────────────────── 레지스트리 ──────────────────────────────
AXES = {
    "amount": {"인덱스": "amount_rules.json", "sample": sample_amount, "grade": grade_amount,
               "설명": "금액 → 전결권자(별표 룰 조회, 결정적)"},
    "impact": {"인덱스": "graph_analytics.json", "sample": sample_impact, "grade": grade_impact,
               "설명": "조문 개정 → 함께 검토할 조문(참조 그래프, 결정적)"},
    "defterm": {"인덱스": "defterms.json", "sample": sample_defterm, "grade": grade_defterm,
                "설명": "규정 정의어 → 정의 원문(결정적 대조)"},
    "deadline": {"인덱스": "deadlines.json", "sample": sample_deadline, "grade": grade_deadline,
                 "설명": "기준시점 → N일 이내(오프셋 값, 결정적)"},
}


def available() -> list:
    return [k for k, v in AXES.items() if (IDX / v["인덱스"]).exists()]


def sample_all(rng: random.Random, quota: dict | None = None) -> list:
    """축별 쿼터만큼 문항 표본 — 인덱스 없는 축은 조용히 생략."""
    q = quota or AXIS_QUOTA
    out = []
    for name in available():
        k = q.get(name, 0)
        if k <= 0:
            continue
        try:
            out += AXES[name]["sample"](rng, k)
        except Exception as ex:  # noqa: BLE001
            print(f"  ⚠ 축 {name} 표본 실패: {ex}", file=sys.stderr)
    return out


def grade(item: dict, 답변: str) -> tuple:
    """(판정, 증거, 원인) — 축 문항 전용 결정적 채점. LLM 미사용."""
    ax = AXES.get(item.get("축"))
    if not ax:
        return "판정불가", f"미등록 축: {item.get('축')}", None
    try:
        return ax["grade"](item, 답변)
    except Exception as ex:  # noqa: BLE001
        return "판정불가", f"축 채점 오류: {ex}", None


if __name__ == "__main__":  # 수동 점검: python eval/axes.py [개수]
    k = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    r = random.Random(7)
    for it in sample_all(r, {a: k for a in AXES}):
        print(f"[{it['축']}] {it['질문']}\n    골든: {it['골든'][:110]}")
