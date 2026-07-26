#!/usr/bin/env python3
"""amount_judge.py — 금액 → 전결 판정 순수 함수 (specs/06 트랙 A).

⛔ LLM 무관 — amount_rules.json(01r2)의 결정적 조회만. 미커버 구간·모르는 업무는
'판정불가'를 반환한다(그럴듯한 근사 금지 — 룰 엔진의 오답은 환각보다 위험).
"""
import json
import pathlib
import re

IDX = pathlib.Path(__file__).resolve().parent / "index"
_cache = {}


def _rules():
    if "r" not in _cache:
        _cache["r"] = json.loads((IDX / "amount_rules.json").read_text(encoding="utf-8"))["rules"]
    return _cache["r"]


def _covers(g, x: int) -> bool:
    if g["min"] is not None and (x < g["min"] or (x == g["min"] and not g["min_incl"])):
        return False
    if g["max"] is not None and (x > g["max"] or (x == g["max"] and not g["max_incl"])):
        return False
    return True


def find_tasks(text: str) -> list:
    """질의 텍스트에서 업무키 후보 — 업무경로의 **한글 명사 덩어리**(2자+)를 부분 토큰까지 풀어
    매칭(공백·조사 개입 무시: '가지급금집행' ↔ '가지급금 …집행'), 매칭 점수 내림차순."""
    norm = lambda s: re.sub(r"[\s>().･·\-0-9]+", "", s)  # noqa: E731
    tnorm = norm(text)
    scored = []
    for key, ent in _rules().items():
        words = re.findall(r"[가-힣]{2,}", ent["업무경로"])
        # 복합어는 2~4자 서브토큰으로도 분해('가지급금집행'→'가지급금'+'집행')
        subs = set(words)
        for w in words:
            for size in (4, 3, 2):
                subs |= {w[i:i + size] for i in range(0, max(1, len(w) - size + 1))}
        score = sum(len(t) for t in subs if len(t) >= 2 and t in tnorm)
        if score >= 4:  # 최소 유의미 매칭(2자 토큰 2개 또는 4자 1개)
            scored.append((score, key))
    scored.sort(reverse=True)
    return [k for _, k in scored]


def judge(task_key: str, amount_won: int) -> dict:
    """업무키+금액 → {상태, 전결권자, 협의, 원장, 구간표기, 근거} — 결정적."""
    ent = _rules().get(task_key)
    if not ent:
        return {"상태": "판정불가", "사유": f"업무 미등록: {task_key}"}
    hits = [g for g in ent["구간"] if _covers(g, amount_won)]
    if not hits:
        return {"상태": "판정불가", "사유": f"{amount_won:,}원을 커버하는 구간 없음(별표 원문 확인 필요)",
                "업무": ent["업무경로"]}
    if len(hits) > 1:  # 01r2 무결성 검사상 불가능하지만 방어(대상 축이 다른 병존 등)
        hits.sort(key=lambda g: (g["max"] if g["max"] is not None else 1 << 62))
    g = hits[0]
    return {"상태": "판정", "업무": ent["업무경로"], "금액": amount_won,
            "전결권자": g["전결권자"], "협의": g.get("협의", ""), "원장": g.get("원장", False),
            "구간표기": g["표기"], "근거": g["근거"],
            "병존": [h["전결권자"] for h in hits[1:]] if len(hits) > 1 else []}


def parse_amount(text: str):
    """질의 텍스트에서 금액(원) 추출 — '370만원', '1,000만 원', '3억'. 없으면 None."""
    m = re.search(r"([\d,]+(?:\.\d+)?)\s*(억|만)?\s*원?", text)
    if not m or (not m.group(2) and len(m.group(1).replace(",", "")) < 4):
        # 단위 없는 3자리 이하 숫자는 금액으로 안 본다(조문 번호·수량 오탐 방지)
        return None
    v = float(m.group(1).replace(",", ""))
    return int(v * (100_000_000 if m.group(2) == "억" else 10_000 if m.group(2) == "만" else 1))
