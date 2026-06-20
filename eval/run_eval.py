#!/usr/bin/env python3
"""run_eval.py — RAG 검색 품질 평가 하베스트 (P1.1).

eval/golden.jsonl(사람 검수 전 verified:false 초안)을 읽어, 각 질문을 실제 RAG 검색기
(rag_core.retrieve)에 통과시켜 기대 출처(expected_sources)가 top-k 안에 회수되는지 측정한다.

지표(검색 품질):
  - Hit@k   : 질문 중 기대 출처가 top-k 안에 하나라도 잡힌 비율
  - Recall@k: 질문별 (회수된 기대 출처 수 / 전체 기대 출처 수) 평균
  - MRR     : 첫 적중 출처의 역순위(1/rank) 평균
strict = 규정명+조 일치, relaxed = 규정명만 일치(조 무시) — 둘 다 보고.
카테고리별 분해 + 질문별 상세 포함. 리포트는 eval/reports/<timestamp>.json.

선택(--judge): LLM-as-judge 충실도 — 생성 답변이 [근거] 밖 사실을 지어내지 않았는지
Ollama로 판정(0/1)하고 인용·면책 문구 유무를 함께 본다. (생성까지 도므로 느림)

⛔ 가드레일: 이 스크립트는 측정만 한다. golden의 정답/기대출처는 사람이 검수(verified)하기
전까지 신뢰 점수가 아니라 '초안 대비 검색기 동작' 지표로 읽는다. 개선 주장은 before/after 필수.

실행:  bash eval/run.sh            (검색 지표만, 빠름)
       bash eval/run.sh --judge   (충실도까지, Ollama 필요)
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "tools"))  # rag_core 임포트


def jo_token(s: str) -> str:
    """'제4조의2' → '제4조'(의N 제거)로 정규화. 제N조가 없으면(시스템/용어 헤딩) 원문 strip."""
    s = (s or "").strip()
    m = re.match(r"(제\d+조)", s)
    return m.group(1) if m else s


def src_match(exp: dict, ret: dict) -> bool:
    """기대 출처 exp가 회수 출처 ret와 일치하는가(strict: 규정명 + 조)."""
    if (exp.get("규정명") or "").strip() != (ret.get("규정명") or "").strip():
        return False
    e = (exp.get("조") or "").strip()
    if not e:  # 조 미지정(용어/가이드 단일 노트) → 규정명만으로 일치
        return True
    rj = (ret.get("조") or "").strip()
    return jo_token(rj) == jo_token(e) or e in rj or rj in e


def name_match(exp: dict, ret: dict) -> bool:
    """relaxed: 규정명만 일치(조 무시)."""
    return (exp.get("규정명") or "").strip() == (ret.get("규정명") or "").strip()


def first_hit_rank(expected, retrieved, matcher) -> int:
    """top-k에서 기대 출처와 처음 일치하는 회수 순위(1-based), 없으면 0."""
    for i, ret in enumerate(retrieved, 1):
        if any(matcher(e, ret) for e in expected):
            return i
    return 0


def recall_at(expected, retrieved, matcher) -> float:
    """회수된 '서로 다른 기대 출처' 비율."""
    if not expected:
        return 0.0
    hit = sum(1 for e in expected if any(matcher(e, ret) for ret in retrieved))
    return hit / len(expected)


def evaluate(golden, ks, topn, judge=False, hybrid=False):
    import rag_core  # 임베딩/벡터DB 로드(첫 호출 시 수 초)

    # 적중 케이스(기대출처 있음) vs 부정 케이스(코퍼스 밖 → 거부 기대)
    retr_rows = [r for r in golden if not r.get("expect_refusal")]
    refusal_rows = [r for r in golden if r.get("expect_refusal")]

    ks = sorted(ks)
    per_q = []
    # 누적: metrics[k]['strict'|'relaxed']['hit'|'recall'|'rr'] = [값들]
    agg = {k: {m: defaultdict(list) for m in ("strict", "relaxed")} for k in ks}
    cat_hit = {k: defaultdict(lambda: [0, 0]) for k in ks}  # 카테고리별 [hit, total] (strict, top-max k)
    judged = []

    for row in retr_rows:
        q = row["question"]
        expected = row.get("expected_sources", [])
        _, srcs = rag_core.retrieve(q, k=topn, hybrid=hybrid)  # top-N 회수 후 k별로 슬라이스
        rec = {"id": row["id"], "category": row.get("category", ""),
               "question": q, "expected": expected,
               "retrieved": [{"규정명": s["규정명"], "조": s["조"], "distance": s["distance"]} for s in srcs]}
        for k in ks:
            topk = srcs[:k]
            for label, matcher in (("strict", src_match), ("relaxed", name_match)):
                r_first = first_hit_rank(expected, topk, matcher)
                agg[k][label]["hit"].append(1.0 if r_first else 0.0)
                agg[k][label]["recall"].append(recall_at(expected, topk, matcher))
                agg[k][label]["rr"].append(1.0 / r_first if r_first else 0.0)
            # 카테고리 분해는 strict 기준
            c = cat_hit[k][row.get("category", "")]
            c[1] += 1
            if first_hit_rank(expected, topk, src_match):
                c[0] += 1
        rec["strict_hit_rank@{}".format(topn)] = first_hit_rank(expected, srcs, src_match)
        per_q.append(rec)

        if judge:
            judged.append(_judge_one(rag_core, row, srcs, hybrid))

    summary = {}
    for k in ks:
        summary[f"@{k}"] = {
            label: {
                "Hit": round(_mean(agg[k][label]["hit"]), 4),
                "Recall": round(_mean(agg[k][label]["recall"]), 4),
                "MRR": round(_mean(agg[k][label]["rr"]), 4),
            } for label in ("strict", "relaxed")
        }
    by_cat = {}
    kmax = ks[-1]
    for cat, (h, t) in sorted(cat_hit[kmax].items()):
        by_cat[cat] = {"hit": h, "total": t, f"Hit@{kmax}_strict": round(h / t, 4) if t else 0.0}

    # 부정 케이스: 코퍼스 밖 질문에 올바로 거부하는가(생성 필요 → --judge 시에만 측정)
    refusal = None
    if refusal_rows and judge:
        cases = [_refusal_one(rag_core, r, hybrid) for r in refusal_rows]
        refused = sum(1 for c in cases if c["refused"])
        fabricated = sum(1 for c in cases if c["fabricated_citation"])
        refusal = {"n": len(cases), "refusal_rate": round(refused / len(cases), 4),
                   "fabricated_citation": fabricated, "cases": cases}

    return {"summary": summary, "by_category": by_cat, "per_question": per_q,
            "n_retrieval": len(retr_rows), "n_refusal": len(refusal_rows),
            "faithfulness": _judge_summary(judged) if judge else None,
            "judged": judged if judge else None,
            "refusal": refusal}


def _mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


# ── 선택: LLM-as-judge 충실도 ─────────────────────────────────────────────
JUDGE_SYS = (
    "너는 RAG 답변 검수자다. [근거]만으로 [답변]이 뒷받침되는지 평가한다.\n"
    "[근거]에 없는 사실(금액·한도·기한 등)을 [답변]이 단정하면 grounded=false.\n"
    'JSON만 출력: {"grounded": true|false, "reason": "한 줄"}'
)


CITE_PAT = re.compile(r"\[[^\]]*제\d+조[^\]]*\]")
REFUSAL_PAT = re.compile(r"확인되지\s*않|확인할\s*수\s*없|규정에서\s*확인")


def _refusal_one(rag_core, row, hybrid=False):
    """부정 케이스: 코퍼스 밖 질문에 '확인되지 않습니다'로 거부하는가. 거부 없이 조문을 인용하면 위험(fabricated)."""
    context, _ = rag_core.retrieve(row["question"], hybrid=hybrid)
    ans = rag_core.answer(row["question"], context)
    refused = bool(REFUSAL_PAT.search(ans))
    has_cite = bool(CITE_PAT.search(ans))
    return {"id": row["id"], "question": row["question"], "refused": refused,
            "fabricated_citation": (has_cite and not refused), "answer_head": ans[:200]}


def _judge_one(rag_core, row, srcs, hybrid=False):
    context, _ = rag_core.retrieve(row["question"], hybrid=hybrid)  # 생성에 쓰는 것과 동일한 전체 근거로 판정
    ans = rag_core.answer(row["question"], context)
    has_cite = bool(CITE_PAT.search(ans)) or "ERP" in ans
    has_disc = "최종 판단은" in ans
    verdict = {"grounded": None, "reason": "judge 호출 실패"}
    try:
        _, _, llm = rag_core.backend()
        out = llm.chat.completions.create(
            model=rag_core.LLM_MODEL, temperature=0,
            messages=[{"role": "system", "content": JUDGE_SYS},
                      {"role": "user", "content": f"[근거]\n{context}\n\n[답변]\n{ans}"}],
            extra_body={"keep_alive": rag_core._keep_alive()},
        )
        txt = out.choices[0].message.content or ""
        m = re.search(r"\{.*\}", txt, re.S)
        if m:
            verdict = json.loads(m.group(0))
    except Exception as e:  # noqa: BLE001
        verdict["reason"] = f"judge 오류: {e}"
    return {"id": row["id"], "grounded": verdict.get("grounded"),
            "reason": verdict.get("reason", ""), "has_citation": has_cite,
            "has_disclaimer": has_disc, "answer_head": ans[:160]}


def _judge_summary(judged):
    if not judged:
        return None
    n = len(judged)
    g = sum(1 for j in judged if j.get("grounded") is True)
    cite = sum(1 for j in judged if j.get("has_citation"))
    disc = sum(1 for j in judged if j.get("has_disclaimer"))
    return {"n": n, "grounded_rate": round(g / n, 4),
            "citation_rate": round(cite / n, 4), "disclaimer_rate": round(disc / n, 4)}


def main():
    ap = argparse.ArgumentParser(description="RAG 검색 품질 평가 (P1.1)")
    ap.add_argument("--golden", default=str(HERE / "golden.jsonl"))
    ap.add_argument("--ks", default="1,3,5,10", help="평가 cutoff 목록")
    ap.add_argument("--topn", type=int, default=10, help="회수 top-N(>= max k)")
    ap.add_argument("--judge", action="store_true", help="LLM-as-judge 충실도까지(느림, Ollama 필요)")
    ap.add_argument("--hybrid", action="store_true", help="하이브리드 검색(밀집+BM25 RRF) 사용")
    ap.add_argument("--tag", default="", help="리포트 파일명 태그(before/after 비교용)")
    args = ap.parse_args()

    golden = [json.loads(l) for l in Path(args.golden).read_text(encoding="utf-8").splitlines() if l.strip()]
    ks = [int(x) for x in args.ks.split(",")]
    topn = max(args.topn, max(ks))
    n_unverified = sum(1 for r in golden if not r.get("verified", False))

    n_ref = sum(1 for r in golden if r.get("expect_refusal"))
    print(f"평가셋: {len(golden)}문항 (적중 {len(golden) - n_ref} · 부정/거부 {n_ref} · 미검수 {n_unverified})"
          f" · cutoff {ks} · top-N {topn}"
          + (" · 하이브리드(BM25+RRF)" if args.hybrid else " · 밀집(dense)")
          + (" · +LLM judge" if args.judge else ""))
    result = evaluate(golden, ks, topn, judge=args.judge, hybrid=args.hybrid)

    # 콘솔 요약
    print("\n=== 검색 지표 (strict = 규정명+조) ===")
    print(f"{'cutoff':>7} | {'Hit':>6} {'Recall':>7} {'MRR':>6}  ||  {'Hit(relaxed)':>12} {'MRR':>6}")
    for k in ks:
        s = result["summary"][f"@{k}"]
        print(f"@{k:<6} | {s['strict']['Hit']:>6.3f} {s['strict']['Recall']:>7.3f} {s['strict']['MRR']:>6.3f}"
              f"  ||  {s['relaxed']['Hit']:>12.3f} {s['relaxed']['MRR']:>6.3f}")
    kmax = ks[-1]
    print(f"\n=== 카테고리별 Hit@{kmax} (strict) ===")
    for cat, d in result["by_category"].items():
        print(f"  {cat:<22} {d['hit']:>2}/{d['total']:<2}  {d[f'Hit@{kmax}_strict']:.3f}")
    if result.get("faithfulness"):
        f = result["faithfulness"]
        print(f"\n=== 충실도(LLM judge, n={f['n']}) ===")
        print(f"  근거충실 {f['grounded_rate']:.3f} · 출처표기 {f['citation_rate']:.3f} · 면책문구 {f['disclaimer_rate']:.3f}")
    if result.get("refusal"):
        rf = result["refusal"]
        print(f"\n=== 거부율(부정 케이스, n={rf['n']}) ===")
        print(f"  올바른 거부 {rf['refusal_rate']:.3f} · 근거없는 조문인용(위험) {rf['fabricated_citation']}건")
    elif result.get("n_refusal") and not args.judge:
        print(f"\n=== 거부율: 부정 {result['n_refusal']}건은 생성 필요 → --judge 로 측정 ===")

    # 적중 실패 질문(디버깅용)
    misses = [q["id"] for q in result["per_question"] if not q[f"strict_hit_rank@{topn}"]]
    if misses:
        print(f"\n=== top-{topn} strict 미적중 {len(misses)}건: {', '.join(misses)}")

    # 리포트 저장
    reports = HERE / "reports"
    reports.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    fn = reports / (f"{ts}{('-' + args.tag) if args.tag else ''}.json")
    meta = {"timestamp": ts, "golden": os.path.basename(args.golden), "n": len(golden),
            "n_unverified": n_unverified, "ks": ks, "topn": topn, "judge": args.judge,
            "hybrid": args.hybrid, "tag": args.tag,
            "backend": {"embed": os.environ.get("EMBED_MODEL", "nlpai-lab/KURE-v1"),
                        "chroma": os.environ.get("CHROMA_DIR", "tools/chroma"),
                        "collection": os.environ.get("RAG_COLLECTION", "kei_regs"),
                        "llm": os.environ.get("LLM_MODEL", "")}}
    fn.write_text(json.dumps({"meta": meta, **result}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n리포트 저장 → {fn}")


if __name__ == "__main__":
    main()
