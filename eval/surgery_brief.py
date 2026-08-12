#!/usr/bin/env python3
"""surgery_brief.py — 수술 브리핑: 수술대기(검색실패·생성환각·근거부적합)를 Claude Code
세션이 붙여넣기 한 줄로 수술할 수 있는 **자족 문서**로 물질화(운영자 요청 2026-08-12).

흐름: daily_run.sh가 분석서 뒤에 호출 → `eval/daily/{date}.surgery.md` 생성 →
Slack 다이제스트에 건수 + 붙여넣기 한 줄만 실린다.
⛔ 질문·답변·조문 등 규정 내용은 Slack으로 내보내지 않는다 — docs/66 유출 백스톱과
같은 정책(Slack은 외부 SaaS, 절대규칙 5). 상세는 이 로컬 파일이고, 세션이 직접 읽는다.

운영자 사용법: Slack의 「수술 브리핑 YYYY-MM-DD 처리해」 한 줄을 Claude Code에 붙여넣기.
세션 계약(파일 머리에도 박혀 있음): 원인 수술 → 회귀 → 사용자 노출 변화는 패치노트
**분류 '개선'** → 다음날 재시험 코호트가 효과를 검증.

LLM 0회 — daily_report와 같은 원칙(같은 입력 = 같은 출력).
"""
import argparse
import datetime
import json
from pathlib import Path

from daily_common import retrieved_expected

HERE = Path(__file__).resolve().parent
DAILY = HERE / "daily"
SURGERY = ("검색실패", "생성환각", "근거부적합")   # daily_report.SURGERY와 동일(회귀가 대사)

_CAP_ANSWER = 700   # 답변 인용 상한(원인 판단에 충분·문서 비대 방지)
_CAP_GOLDEN = 400


def _gates(q: dict) -> str:
    g = q.get("x_gates") or {}
    routes = ", ".join(k for k, v in (g.get("routes") or {}).items() if v) or "없음"
    parts = [f"라우트 {routes}"]
    if g.get("절단"):
        parts.append("⚠근거 절단됨")
    if g.get("cite_unmatched"):
        parts.append(f"⚠근거 밖 인용 {g['cite_unmatched']}건: {g.get('cite_unmatched_list')}")
    return " · ".join(parts)


def _srcs(q: dict) -> list[str]:
    out = []
    for s in (q.get("x_sources") or [])[:5]:
        flags = [k for k in ("rerank", "defterm_route", "scope_anchor", "표깨짐", "절단")
                 if s.get(k)]
        out.append(f"{s.get('규정명', '?')} {s.get('조', '')}"
                   + (f"  [{' '.join(flags)}]" if flags else ""))
    return out


def _item_md(i: int, q: dict) -> str:
    src = q.get("출처") or {}
    expected = f"{src.get('규정명', '?')} {src.get('조', '')}".strip()
    hit = "✅ 회수됨" if retrieved_expected(q) else "❌ 회수 안 됨"
    turns = q.get("턴")
    question = "\n".join(f"  {t}" for t in turns) if turns else f"  {q.get('질문', '')}"
    answer = (q.get("답변") or "(빈 답변)")[:_CAP_ANSWER].replace("\n", "\n  > ")
    L = [
        f"## {i}. [{q.get('실패유형', '?')}] {q.get('id', '?')}",
        f"- 유형 {q.get('유형', '?')} · 어휘층 {q.get('어휘층') or '-'} · "
        f"코호트 {q.get('코호트', '?')} · 판정 {q.get('판정', '?')}",
        "- 질문:", question,
        f"- 골든(기대 정답): {(q.get('골든') or '(없음 — 거부형)')[:_CAP_GOLDEN]}",
        f"- 기대 근거: {expected} — {hit}",
        "- 실제 답변:",
        f"  > {answer}",
        "- 회수 근거 top5: " + ("; ".join(_srcs(q)) or "(없음)"),
        f"- 게이트: {_gates(q)}",
        f"- 채점 증거: {q.get('증거') or '-'}",
        "- 재현: `cd tools && .venv/bin/python 03_rag_query.py --db chroma "
        f"--q \"{(q.get('질문') or '').replace(chr(34), chr(39))}\"`",
        "",
    ]
    return "\n".join(L)


def build(date: str) -> Path | None:
    """graded.json → surgery.md. 수술대기 0건이면 파일을 만들지 않는다(None)."""
    f = DAILY / f"{date}.graded.json"
    if not f.exists():
        print(f"[surgery_brief] {f.name} 없음 — 생략")
        return None
    d = json.loads(f.read_text(encoding="utf-8"))
    items = [q for q in (d.get("문항") or []) if (q.get("실패유형") or "") in SURGERY]
    if not items:
        print("[surgery_brief] 수술대기 0건 — 브리핑 없음")
        return None
    by_type: dict[str, int] = {}
    for q in items:
        by_type[q["실패유형"]] = by_type.get(q["실패유형"], 0) + 1
    head = [
        f"# 수술 브리핑 {date} — 수술대기 {len(items)}건"
        f" ({' · '.join(f'{k} {v}' for k, v in sorted(by_type.items()))})",
        "",
        "> 기계가 만든 수술 대상 목록(아침 분석서의 수술대기 분류 그대로 · LLM 0회).",
        "> **세션 계약**: ① 항목별 원인 파악(검색/생성/게이트/원문) → 수정 + 회귀",
        "> ② 원문 결함은 코드로 고치지 말고 검수 큐로(⛔규정 내용 추측 금지 — 절대규칙 1)",
        "> ③ 사용자 노출 변화는 패치노트 **분류: 개선** ④ 효과는 다음날 재시험 코호트가 검증.",
        "",
    ]
    out = DAILY / f"{date}.surgery.md"
    out.write_text("\n".join(head) + "\n".join(_item_md(i, q) for i, q in enumerate(items, 1)),
                   encoding="utf-8")
    print(f"[surgery_brief] {out.name} 생성 — {len(items)}건")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    a = ap.parse_args()
    build(a.date)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
