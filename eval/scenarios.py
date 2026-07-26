#!/usr/bin/env python3
"""scenarios.py — 복합 시나리오 문항(specs/07 A).

**문제**(사용자 지적): 매일 비슷한 질문만 나온다. 원인은 프롬프트가 아니라 **구조**다 —
`daily_gen.gen_one()`이 청크 **1개**를 주고 "그 원문만으로 답할 수 있는 질문"을 요구한다.
채점 근거를 단일 청크로 고정하려는 설계였고, 그 대가로 복합 질문이 원천 차단됐다.

**설계**: 골격은 이미 있다 — `90_관리/_journeys/*.json`(여정 13종)은 한 업무의 노드·근거가
구조화돼 있다. 사용자 예시("세종→런던 세미나 — 항공사? 항공비? 숙소비? 귀국시간? 정산?")가
곧 해외출장 여정이다. 여정의 근거 조문 2~4개를 함께 주고 **하나의 상황 질문 + 근거별 골든**을 만든다.

⛔ 창작 차단(단일 문항과 동일 철학):
  ① 골든은 각 근거 원문에 **글자 그대로 실존**해야 채택(2그램 80%)
  ② 질문 속 숫자는 근거 원문 합집합에 실존해야 함
  ③ 골든 2개 미만이면 폐기(복합이 아님)
  ④ 자문자답(골든 값이 질문에 노출) 폐기

채점은 **골든별 개별 대조(결정적)** — 전부 충족=정답 · 일부=부분 · 0건=검토필요(보수적).
LLM 판정을 쓰지 않는 이유: 근거가 여러 개면 판정자가 "어느 근거를 봤는지" 흔들려
채점기 오판(T7·T9 계열)이 다시 들어온다. 골든이 원문 문장이므로 대조로 충분하다.
"""
from __future__ import annotations

import json
import pathlib
import random
import re
import sys

from daily_common import ROOT, chroma_col, llm_json, norm_q

sys.path.insert(0, str(ROOT / "tools"))
from refusal_detect import is_refusal  # noqa: E402  단일 정본(specs/01 P0)

JOURNEY_DIR = ROOT / "KEI-행정가이드" / "90_관리" / "_journeys"
IDX = ROOT / "tools" / "index"

GEN_SYS = (
    "너는 사내 규정 챗봇의 품질을 검사할 '시험 문항' 출제자다. 한 업무 상황과 그 업무의 "
    "규정 근거 여러 개가 주어진다.\n"
    "그 근거들을 **모두 봐야** 답할 수 있는 실무 질문 1개를 만들어 다음 JSON만 출력하라:\n"
    '{"질문": "<상황이 담긴 자연스러운 질문 1~2문장>", '
    '"골든": ["<근거1에서 그대로 복사한 한 문장>", "<근거2에서 그대로 복사한 한 문장>", ...]}\n'
    "규칙: ① 근거에 없는 내용을 묻지 마라 ② 질문에 답(수치·결론)을 넣지 마라 "
    "③ 골든은 **각 근거마다 하나씩**, 원문에서 글자 그대로 복사(요약·의역 금지) "
    "④ 질문은 '~는 어떻게 되나요?'처럼 여러 항목을 한 번에 묻는 형태가 좋다 "
    "⑤ 근거 중 하나라도 질문과 무관하면 그 근거의 골든은 빼라(남은 골든이 2개 미만이면 "
    '{"질문": ""} 출력).'
)

TURN_SYS = (
    "너는 시험 문항 출제자다. 방금 만든 상황 질문에 이어질 **후속 질문 1개**를 만들어라. "
    '다음 JSON만 출력하라: {"후속": "<앞 질문의 주제를 이어받는 짧은 질문>"}\n'
    "규칙: ① 앞 질문과 같은 상황·업무여야 한다 ② 대명사('그럼', '그건')로 자연스럽게 이어라 "
    "③ 주어진 근거로 답할 수 있어야 한다 ④ 한 문장, 40자 이내."
)


def journeys() -> list:
    out = []
    for f in sorted(JOURNEY_DIR.glob("*.json")):
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:  # noqa: BLE001
            continue
    return out


def _refs(j: dict) -> list:
    """여정 노드의 근거 — 중복 제거, 순서 보존(업무 흐름 순).

    조가 비어 있는 근거(가이드·규칙 통째 참조)도 버리지 않는다. 실측: 법인카드사용정산·육아시간사용
    ·도서구입은 근거가 **전부 조 없는 가이드**라, 조문만 받으면 흔한 업무가 통째로 출제에서 빠졌다
    (출제 가능 여정 9/13). 이 경우 노드 설명(action)과 가장 맞는 청크를 결정적으로 고른다.
    """
    seen, out = set(), []
    for n in j.get("nodes", []):
        for r in n.get("근거", []):
            reg, jo = (r.get("규정명") or "").strip(), (r.get("조") or "").strip()
            if not reg or reg.startswith("ERP 시스템"):
                continue  # ERP 화면명은 조문 대조 대상이 아님
            if jo and not (jo.startswith("제") or "별표" in jo):
                jo = ""    # 화면명·기능명 → 문서 단위 매칭으로 강등
            if (reg, jo) in seen:
                continue
            seen.add((reg, jo))
            out.append({"규정명": reg, "조": jo, "노드": n.get("name", ""),
                        "stage": n.get("stage", ""), "action": (n.get("action") or "")[:400]})
    return out


def _sim(a: str, b: str) -> float:
    """2그램 겹침 — 노드 설명과 청크의 결정적 매칭(임베딩 불필요)."""
    x, y = norm_q(a), norm_q(b)
    if len(x) < 4 or len(y) < 4:
        return 0.0
    xg = {x[i:i + 2] for i in range(len(x) - 1)}
    yg = {y[i:i + 2] for i in range(len(y) - 1)}
    return len(xg & yg) / max(1, len(xg))


def _fetch(col, reg: str, jo: str, action: str = ""):
    """근거 → 청크 1개.
    조가 있으면 (규정명, 조) 정확 매칭. 조가 없으면 그 문서의 청크 중 **노드 설명과 가장
    비슷한 것**을 고른다(결정적 2그램 — LLM·임베딩 없음). 골든 verbatim 게이트가 뒤를 받친다."""
    try:
        where = {"$and": [{"규정명": reg}, {"조": jo}]} if jo else {"규정명": reg}
        got = col.get(where=where, include=["documents", "metadatas"], limit=1 if jo else 60)
    except Exception:  # noqa: BLE001
        return None
    if not got.get("ids"):
        return None
    if jo:
        return {"cid": got["ids"][0], "doc": got["documents"][0], "meta": got["metadatas"][0]}
    cands = [(i, d) for i, d in enumerate(got["documents"]) if len(d) >= 200]
    if not cands:
        return None
    best = max(cands, key=lambda t: _sim(action, t[1]))
    if action and _sim(action, best[1]) < 0.15:
        return None            # 노드와 무관한 청크로 문항을 만들지 않는다
    i = best[0]
    return {"cid": got["ids"][i], "doc": got["documents"][i], "meta": got["metadatas"][i],
            "조": got["metadatas"][i].get("조", "")}


def _korean_ok(text: str) -> bool:
    """한국어 문항인가 — qwen이 후속 질문에서 중국어를 섞는 실측 결함('임원 기준도有什么不同吗?')."""
    if re.search(r"[\u4e00-\u9fff]", text):      # 한자 혼입 = 언어 이탈(우리 코퍼스 질문에 불필요)
        return False
    letters = re.findall(r"[가-힣a-zA-Z]", text)
    han = re.findall(r"[가-힣]", text)
    return bool(letters) and len(han) / len(letters) >= 0.6


def _verbatim(golden: str, doc: str) -> bool:
    """골든이 원문에 실존하는가 — 공백차만 허용(gen_one과 동일 기준)."""
    ng = norm_q(golden)
    if len(ng) < 10:
        return False
    src = norm_q(doc)
    gg = {ng[i:i + 2] for i in range(len(ng) - 1)}
    return sum(1 for g in gg if g in src) / max(1, len(gg)) >= 0.8


def gen_scenario(j: dict, rng: random.Random, col, with_turn: bool = False) -> dict | None:
    """여정 1개 → 복합 문항 1개(또는 None). 근거 2~4개를 함께 준다."""
    refs = _refs(j)
    if len(refs) < 2:
        return None
    rng.shuffle(refs)
    ev = []
    for r in refs:
        if len(ev) >= 4:
            break
        got = _fetch(col, r["규정명"], r["조"], r.get("action", ""))
        if got and len(got["doc"]) >= 120:
            ev.append({**r, **got})     # 조 없는 근거는 _fetch가 실제 청크의 조 라벨을 채운다
    if len(ev) < 2:
        return None

    blocks = "\n\n".join(
        f"[근거{i+1}] {e['규정명']} {e['조']} ({e['노드']})\n{e['doc'][:900]}" for i, e in enumerate(ev))
    r = llm_json([
        {"role": "system", "content": GEN_SYS},
        {"role": "user", "content": f"업무 상황: {j['title']} — {j.get('요약','')}\n\n{blocks}"},
    ], temperature=0.7, max_tokens=520)

    q = re.sub(r"\s+", " ", str(r.get("질문", ""))).strip()
    goldens = [re.sub(r"\s+", " ", str(g)).strip() for g in (r.get("골든") or []) if str(g).strip()]
    if not q or len(q) < 15 or len(q) > 220 or len(goldens) < 2 or not _korean_ok(q):
        return None

    # ── 게이트 ① 골든 verbatim 실존(근거 어느 하나에라도) ──
    matched, used = [], set()
    for g in goldens:
        for i, e in enumerate(ev):
            if i in used or not _verbatim(g, e["doc"]):
                continue
            matched.append({"골든": g, "규정명": e["규정명"], "조": e["조"], "청크id": e["cid"]})
            used.add(i)
            break
    if len(matched) < 2:
        return None

    # ── 게이트 ② 질문 속 숫자는 근거 합집합에 실존(환각 상황 차단) ──
    allsrc = "".join(e["doc"] for e in ev).replace(" ", "")
    for tok in re.findall(r"\d+", q):
        if tok not in allsrc:
            return None

    # ── 게이트 ③ 자문자답 — **질문에 값 토큰이 있으면 폐기** ──
    # 실측 결함: 골든만 대조하면 근거의 *다른* 문장에 있는 정답이 질문에 새어 들어온다
    # ("복명서는 귀국 후 30일 이내(임원은 14일)에 …하며, 마일 당 20원을 초과하면…?").
    # 게이트②가 이미 "질문의 숫자는 근거에 실존"을 요구하므로, 질문에 남는 값 토큰은
    # 사실상 전부 근거에서 온 답이다 ⟹ 값 토큰 자체를 금지한다(조문 번호 '제33조'는 허용).
    if re.search(r"\d[\d,]*\s*(?:원|만원|억원|일|개월|년|주|%|퍼센트|박|시간|회|명|급|점)(?![가-힣])", q):
        return None

    item = {
        "질문": q, "형식": "복합", "유형": "복합형", "정량여부": False,
        "시나리오": {"여정": j["id"], "제목": j["title"],
                  "단계": sorted({e["stage"] for e in ev if e.get("stage")})},
        # 호환: 기존 소비자(채점 원인분류·publish slug·검수신호)는 dict 출처를 기대한다.
        #       대표 1건을 그대로 두고 전체는 출처들[]에 담는다(스키마 파괴 없이 복수 근거 보존).
        "출처": {"규정명": matched[0]["규정명"], "조": matched[0]["조"], "청크id": matched[0]["청크id"]},
        "출처들": [{k: m[k] for k in ("규정명", "조", "청크id")} for m in matched],
        "분류": "복합", "주제": [j["id"]],
        "골든": matched[0]["골든"],          # 단일 소비자용 대표 골든
        "골든들": [m["골든"] for m in matched],
    }

    if with_turn:
        t = llm_json([
            {"role": "system", "content": TURN_SYS},
            {"role": "user", "content": f"앞 질문: {q}\n\n{blocks[:1500]}"},
        ], temperature=0.7, max_tokens=120)
        follow = re.sub(r"\s+", " ", str(t.get("후속", ""))).strip()
        if 8 <= len(follow) <= 60 and not re.search(r"\d", follow) and _korean_ok(follow):
            item["턴"] = [q, follow]      # 2턴 — 맥락 유지 회귀(condense_query)를 평가에 편입
    return item


# ────────────────────────────── 채점(결정적) ──────────────────────────────
STOP = {"경우", "다음", "각호", "해당", "관한", "대한", "이하", "같다", "위하여", "하여야", "한다"}


# 조사·어미 — 원문의 '금지한다'와 답변의 '금지됩니다'가 같은 말임을 알아보려면 어간으로 잘라야 한다.
#   (실측: 어형 그대로 비교하면 정상 의역 답변이 '반영 0건'으로 떨어진다)
_TAIL = re.compile(r"(하여야|하려는|합니다|됩니다|하면서|하거나|한다|된다|하며|하고|하는|되는|하여|되어|"
                   r"이다|으로서|으로|에서|에게|에는|까지|부터|보다|이나|한|을|를|은|는|이|가|의|에)$")


def _stem(w: str) -> str:
    prev = None
    while prev != w and len(w) > 2:
        prev, w = w, _TAIL.sub("", w)
    return w


def _cover(golden: str, 답변: str) -> float:
    """골든 문장이 답변에 반영된 정도 — 2그램·어간 2축(의역에 강함)."""
    g, a = norm_q(golden), norm_q(답변)
    gg = {g[i:i + 2] for i in range(len(g) - 1)}
    bg = sum(1 for x in gg if x in a) / max(1, len(gg))
    kws = [_stem(w) for w in re.findall(r"[가-힣]{2,}", golden) if w not in STOP]
    kws = [w for w in dict.fromkeys(kws) if len(w) >= 2][:10]
    kw = sum(1 for w in kws if w in a) / max(1, len(kws))
    return max(bg, kw)


def grade_scenario(item: dict, 답변: str) -> tuple:
    """(판정, 증거, 원인) — 골든별 개별 대조. ⛔오답 선언은 보수적."""
    gs = item.get("골든들") or [item.get("골든", "")]
    hits = [(g, _cover(g, 답변)) for g in gs if g]
    ok = [g for g, c in hits if c >= 0.45]
    miss = [(g, c) for g, c in hits if c < 0.45]
    if len(ok) == len(hits) and hits:
        return "정답", "", None
    if is_refusal(답변) and not ok:
        regs = ", ".join(f"{s['규정명']} {s['조']}" for s in (item.get("출처들") or [])[:3])
        return "오답", f"근거({regs})가 실재하는데 확인 불가로 답변함", "검색실패"
    if ok:
        빠짐 = " / ".join(f"「{g[:40]}…」({c:.0%})" for g, c in miss[:2])
        return "부분", f"근거 {len(ok)}/{len(hits)}건만 반영 — 빠진 항목: {빠짐}", None
    return "검토필요", f"근거 {len(hits)}건 중 반영 0건(최고 일치 {max(c for _, c in hits):.0%})", None
