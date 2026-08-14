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


def _norm(s: str) -> str:
    return re.sub(r"[\s>().･·\-0-9]+", "", s)


def _subtokens(s: str) -> set:
    """한글 명사 덩어리(2자+) + 2~4자 서브토큰('가지급금집행'→'가지급금'+'집행')."""
    words = re.findall(r"[가-힣]{2,}", s)
    subs = set(words)
    for w in words:
        for size in (4, 3, 2):
            subs |= {w[i:i + size] for i in range(0, max(1, len(w) - size + 1))}
    return subs


def _sibling_leaves() -> dict:
    """같은 부모 경로를 공유하는 leaf 집합 — '구입'/'매각'처럼 **서로 배타적인 축**을 찾는다."""
    if "sib" not in _cache:
        parents = {}
        for ent in _rules().values():
            parts = ent["업무경로"].rsplit(">", 1)
            if len(parts) == 2:
                parents.setdefault(_norm(parts[0]), set()).add(_norm(parts[1]))
        _cache["sib"] = parents
    return _cache["sib"]


def find_tasks_scored(text: str) -> list:
    """(점수, 업무키) 내림차순. 점수는 rag_core가 **모호성 판정**에 쓴다(동점이면 단정 금지)."""
    tnorm = _norm(text)
    parents = _sibling_leaves()
    scored = []
    for key, ent in _rules().items():
        path = ent["업무경로"]
        parts = path.rsplit(">", 1)
        leaf_raw = parts[1] if len(parts) == 2 else ""
        leaf = _norm(leaf_raw)
        parent = _norm(parts[0]) if len(parts) == 2 else _norm(path)

        # ⛔ 형제 배제 — 별표에는 한 상위업무 밑에 반대 leaf가 붙는다
        #   (`물품구입 및 매각(도서포함) > 구입` / `> 매각`).
        #   경로의 대부분이 겹쳐 점수가 사실상 동점이 되므로, 이 배제가 없으면
        #   **구입을 물었는데 매각 판정**이 1위로 나간다(실측 결함 — rag_core는 tasks[0]을
        #   그대로 단정 판정으로 내보낸다. 회계 오답은 환각보다 위험하다).
        if leaf:
            others = parents.get(parent, set()) - {leaf}
            if any(o and o in tnorm for o in others) and leaf not in tnorm:
                continue

        base = sum(len(t) for t in _subtokens(path) if len(t) >= 2 and t in tnorm)
        # leaf는 구분자다 — 가중치를 줘야 형제 사이에서 올바른 쪽이 1위가 된다.
        leaf_hit = sum(len(t) for t in _subtokens(leaf_raw) if len(t) >= 2 and t in tnorm)
        score = base + 3 * leaf_hit
        # leaf가 정확히 걸리면 짧은 표현('매각'만)도 받는다 — 예전 절대 임계값(4)은
        # 2자 질의가 아무리 정확해도 통과 못 해 '중고 장비 …매각'이 0건이었다.
        if score >= 4 or leaf_hit >= 2:
            scored.append((score, key))
    scored.sort(reverse=True)
    return scored


def find_tasks(text: str) -> list:
    """질의 텍스트에서 업무키 후보 — 매칭 점수 내림차순."""
    return [k for _, k in find_tasks_scored(text)]


def resolve_tie(scored: list, text: str):
    """동점 1위들 사이의 결정적 tie-break — 변별 토큰이 **한 후보의 leaf에만** 있으면 그것.

    실측 계기(2026-08-14): "매각 건으로 126만원…전결권자는?"에서 정답('…매각')을 포함해
    3개가 8점 동점 → rag_core가 '모호'로 라우팅을 접고 일반 회수에 맡겨 오답(원장)이 나갔다.
    동점의 원인은 '집행'처럼 **여러 leaf에 공통으로 들어 있는 흔한 말**이다. 반대로 '매각'은
    동점 후보 중 한 곳의 leaf에만 있으므로 업무를 특정하는 신호다.

    ⛔ 안전 유지: 변별 토큰이 둘 이상의 후보에서 잡히면(예: '구입 매각 500만원') None을
    돌려 기존대로 모호 처리한다 — 찍어서 맞히면 안 되는 자리다(형제 배제 주석과 같은 정신).
    """
    if not scored:
        return None
    top = scored[0][0]
    tied = [k for s, k in scored if s == top]
    if len(tied) == 1:
        return tied[0]
    tnorm = _norm(text)
    leaves = {}
    for k in tied:
        path = _rules()[k]["업무경로"]
        parts = path.rsplit(">", 1)
        leaves[k] = {t for t in _subtokens(parts[1] if len(parts) == 2 else path) if len(t) >= 2}
    winners = []
    for k, toks in leaves.items():
        others = set().union(*(v for j, v in leaves.items() if j != k)) if len(leaves) > 1 else set()
        if any(t in tnorm for t in (toks - others)):   # 이 후보에만 있는 토큰이 질문에 있다
            winners.append(k)
    return winners[0] if len(winners) == 1 else None


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
