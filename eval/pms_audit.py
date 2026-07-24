#!/usr/bin/env python3
"""pms_audit.py — PMS 상세가이드 답변 정확도 감사(로컬 Qwen 실답변 채점).

run_eval.py가 '검색이 정답 출처를 회수하는가'(Hit@k)를 재는 반면, 이 스크립트는
**로컬 모델이 실제로 내놓는 답이 맞는가**를 잰다(docs/15 §2.1 방법론의 PMS판).

정답 근거: `pms_raw/`(도움말 PDF·화면 캡처 판독본)는 사람이 만든 신뢰 자료다 →
질문·정답을 여기서 직접 뽑았다(eval/pms_golden.jsonl). 즉 이 감사는 '초안 대비'가
아니라 **원문 대비 정답률**이다.

채점(문항당):
  ⓐ 회수  : 기대 출처가 top-k에 있는가(strict=노트+섹션 / relaxed=노트만)
  ⓑ 값정확: must(전부 포함) + any(하나 이상 포함) 키워드가 답변에 등장하는가
  ⓒ 인용  : 답변에 출처 표기가 있는가
  ⓓ 거부  : refusal 문항은 '확인되지 않습니다' 계열로 거부해야 정답(절대 규칙 1·4)
  → PASS(값정확 ok) / PARTIAL(회수는 됐으나 값 누락) / MISS / REFUSED

⚠ 채점기는 표기 변형에 강건해야 한다(docs/15 교훈: 공백 차이로 결과가 뒤집힌 사례).
   비교 전 공백·대괄호·중점·마침표를 제거하고 소문자화한다.

실행: cd tools && CHROMA_DIR=chroma RAG_COLLECTION=kei_regs \
      .venv/bin/python ../eval/pms_audit.py [--k 5] [--out ../eval/reports/pms-audit.json]
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tools"))

# 거부 판정은 단일 정본 refusal_detect(specs/01 P0, T9) — 결론부 스코프+부정형 한정.
# (과거 이 파일의 자체 정규식은 '규정에서 확인'이 긍정문 "규정에서 확인된"까지 매칭하는 결함 공유)
from refusal_detect import is_refusal  # noqa: E402
CITE_RE = re.compile(r"\[[^\]\n]+\]|출처|근거")


def norm(s: str) -> str:
    """표기 변형에 강건한 비교용 정규화 — 공백·대괄호·중점·마침표 제거 + 소문자."""
    return re.sub(r"[\s\[\]()·ㆍ.,/>]+", "", str(s)).lower()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--golden", default=str(HERE / "pms_golden.jsonl"))
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--out", default="")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    import rag_core  # noqa: PLC0415

    rows = [json.loads(l) for l in Path(args.golden).read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        rows = rows[: args.limit]

    results, t0 = [], time.time()
    for r in rows:
        ctx, srcs = rag_core.retrieve(r["question"], k=args.k)
        ans = rag_core.answer(r["question"], ctx)
        na = norm(ans)

        # ⓐ 회수
        got = [(str(s.get("규정명", "")), str(s.get("조", ""))) for s in srcs]
        exp = [(e.get("규정명", ""), e.get("조", "")) for e in r.get("expected_sources", [])]
        hit_strict = any(norm(en) == norm(gn) and norm(ej) == norm(gj)
                         for en, ej in exp for gn, gj in got)
        hit_relaxed = any(norm(en) == norm(gn) for en, _ in exp for gn, _ in got)

        # ⓓ 거부 문항
        if r.get("refusal"):
            refused = is_refusal(ans)
            verdict = "PASS" if refused else "MISS"
            results.append({"id": r["id"], "verdict": verdict, "refused": refused,
                            "question": r["question"], "answer": ans[:400]})
            print(f"  {'✅' if refused else '❌'} {r['id']} [거부기대] {verdict}")
            continue

        # ⓑ 값 정확도
        miss_must = [m for m in r.get("must", []) if norm(m) not in na]
        anys = r.get("any", [])
        any_ok = (not anys) or any(norm(a) in na for a in anys)
        value_ok = not miss_must and any_ok

        cited = bool(CITE_RE.search(ans))
        verdict = "PASS" if value_ok else ("PARTIAL" if (hit_relaxed or hit_strict) else "MISS")
        results.append({
            "id": r["id"], "화면": r.get("화면"), "verdict": verdict,
            "hit_strict": hit_strict, "hit_relaxed": hit_relaxed,
            "value_ok": value_ok, "miss_must": miss_must, "any_ok": any_ok, "cited": cited,
            "question": r["question"], "grounding": r.get("grounding"),
            "answer": ans[:400], "got": got[:3],
        })
        mark = {"PASS": "✅", "PARTIAL": "🟡", "MISS": "❌"}[verdict]
        detail = "" if value_ok else f" (must누락={miss_must} any={any_ok})"
        print(f"  {mark} {r['id']} {r.get('화면','')} — {verdict}{detail}")

    n = len(results)
    npass = sum(1 for x in results if x["verdict"] == "PASS")
    npart = sum(1 for x in results if x["verdict"] == "PARTIAL")
    hs = sum(1 for x in results if x.get("hit_strict"))
    hr = sum(1 for x in results if x.get("hit_relaxed"))
    scored = [x for x in results if "hit_relaxed" in x]
    summary = {
        "n": n, "pass": npass, "partial": npart, "miss": n - npass - npart,
        "정답률": round(npass / n, 4) if n else 0.0,
        "Hit@%d_strict" % args.k: round(hs / len(scored), 4) if scored else 0.0,
        "Hit@%d_relaxed" % args.k: round(hr / len(scored), 4) if scored else 0.0,
        "인용포함": round(sum(1 for x in scored if x.get("cited")) / len(scored), 4) if scored else 0.0,
        "elapsed_s": round(time.time() - t0),
        "model": os.environ.get("LLM_MODEL", "(rag_core 기본)"),
    }
    print(f"\n📊 정답률 {npass}/{n} = {summary['정답률']:.1%} "
          f"(PASS {npass} · PARTIAL {npart} · MISS {summary['miss']})")
    print(f"   회수 strict {summary['Hit@%d_strict' % args.k]:.1%} · "
          f"relaxed {summary['Hit@%d_relaxed' % args.k]:.1%} · 인용 {summary['인용포함']:.1%} "
          f"· {summary['elapsed_s']}초")

    if args.out:
        p = Path(args.out)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"summary": summary, "results": results},
                                ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"   → {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
