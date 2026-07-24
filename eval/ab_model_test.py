#!/usr/bin/env python3
"""ab_model_test.py — 생성 LLM A/B 비교(2026-07-24, Qwythos-9B vs Qwen3.5-9B).

설계(공정성):
  · 검색·프롬프트·가드 전부 동일 — rag_core.retrieve(질문) → rag_core.answer(질문, 근거)
    서비스 경로 그대로, 프로세스 env `LLM_MODEL`만 바꿔 생성 모델을 스왑.
  · 문항 세트 동일 — 은행 골든 보유 100문(seed 고정) + 거부형 12문 전부.
  · 채점자 LLM은 별도 실행(--grade)에서 **양쪽 다 현행 Qwen3.5로 고정**(daily_grade JUDGE 재사용).
  · 지연시간 문항별 기록(추론 모델 비용 비교).

실행:
  ① 답변: LLM_MODEL=<모델> python ab_model_test.py --tag qwen35   (모델별 1회씩)
  ② 채점: python ab_model_test.py --grade --tags qwen35,qwythos   (채점 LLM=env 기본 Qwen3.5)
산출: eval/ab/<tag>.answers.jsonl · ab/report.md
"""
import argparse
import importlib.util
import json
import os
import pathlib
import random
import re
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
AB_DIR = HERE / "ab"
AB_DIR.mkdir(exist_ok=True)

sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "tools"))
from daily_common import LLM_MODEL, llm_json, load_bank, norm_q  # noqa: E402
from refusal_detect import is_refusal  # noqa: E402 — 단일 정본(specs/01 P0), 결론부 스코프(T9)

JUDGE_SYS = (
    "너는 채점자다. [질문, 챗봇 답변, 정답 근거 문장]이 주어진다. 답변이 근거와 부합하는지 다음 "
    'JSON만 출력하라:\n{"판정": "<정답|부분|오답>", "이유": "<한 줄>"}\n'
    "기준: 질문이 묻는 핵심(값·결론)을 근거대로 답했으면 정답. 핵심 값·결론이 다르면 오답. "
    "일부만 맞으면 부분. 공백·단위 표기 차이만 있으면 정답으로 본다."
)


def pick_questions(n: int = 100, seed: int = 42):
    bank = load_bank()
    golden = [b for b in bank if b.get("골든") and b.get("유형") != "거부형"
              and b.get("상태") not in ("retire", "stale")]
    refuse = [b for b in bank if b.get("유형") == "거부형"]
    random.seed(seed)
    sample = random.sample(golden, min(n, len(golden)))
    return sample, refuse


def golden_hit(answer: str, golden: str) -> bool:
    g = norm_q(golden)
    if len(g) < 8:
        return True
    gg = {g[i:i + 2] for i in range(len(g) - 1)}
    a = norm_q(answer)
    return sum(1 for x in gg if x in a) / max(1, len(gg)) >= 0.55


def run_answers(tag: str) -> int:
    """현재 env LLM_MODEL로 전 문항 답변 생성(rag_core 직접 — 서비스 동일 경로)."""
    spec = importlib.util.spec_from_file_location("rag_core", ROOT / "tools" / "rag_core.py")
    rc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rc)
    print(f"[{tag}] LLM_MODEL={rc.LLM_MODEL} · QWEN35플래그={rc.QWEN35} · NO_THINK={rc.NO_THINK}")

    sample, refuse = pick_questions()
    out_f = AB_DIR / f"{tag}.answers.jsonl"
    done = set()
    if out_f.exists():  # 이어하기(중단 대비)
        done = {json.loads(l)["id"] for l in out_f.open() if l.strip()}
        print(f"[{tag}] 기존 {len(done)}건 스킵(이어하기)")
    qs = [("golden", b) for b in sample] + [("refuse", b) for b in refuse]
    with out_f.open("a", encoding="utf-8") as fh:
        for i, (kind, b) in enumerate(qs):
            if b["id"] in done:
                continue
            t0 = time.time()
            try:
                context, srcs = rc.retrieve(b["질문"])
                ans = rc.answer(b["질문"], context)
            except Exception as e:  # noqa: BLE001
                ans = f"[ERR] {e}"
                srcs = []
            rec = {"id": b["id"], "kind": kind, "질문": b["질문"], "골든": b.get("골든", ""),
                   "답변": ans, "지연s": round(time.time() - t0, 1),
                   "srcs": [s.get("규정명", "") for s in srcs][:5]}
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
            fh.flush()
            if (i + 1) % 10 == 0:
                print(f"[{tag}] {i + 1}/{len(qs)} (마지막 {rec['지연s']}s)")
    print(f"[{tag}] 완료 → {out_f}")
    return 0


def grade(tags: list) -> int:
    """채점 — 채점자 LLM은 이 프로세스의 LLM_MODEL(기본 Qwen3.5, 양쪽 동일)."""
    print(f"채점자 LLM = {LLM_MODEL} (양쪽 동일)")
    rows = {}
    for tag in tags:
        recs = [json.loads(l) for l in (AB_DIR / f"{tag}.answers.jsonl").open() if l.strip()]
        g = [r for r in recs if r["kind"] == "golden"]
        rf = [r for r in recs if r["kind"] == "refuse"]
        res = {"tag": tag, "n_g": len(g), "n_r": len(rf), "정답": 0, "부분": 0, "오답": 0,
               "골든보존": 0, "과잉거부": 0, "거부성공": 0, "지연중앙값": 0.0, "오답목록": []}
        lat = sorted(r["지연s"] for r in recs)
        res["지연중앙값"] = lat[len(lat) // 2] if lat else 0
        for i, r in enumerate(g):
            refused = is_refusal(r["답변"])
            if refused:
                res["과잉거부"] += 1
                res["오답"] += 1
                res["오답목록"].append((r["질문"][:40], "과잉거부"))
                continue
            if golden_hit(r["답변"], r["골든"]):
                res["골든보존"] += 1
            j = llm_json([
                {"role": "system", "content": JUDGE_SYS},
                {"role": "user", "content": f"[질문]\n{r['질문']}\n\n[챗봇 답변]\n{r['답변'][:1500]}\n\n[정답 근거 문장]\n{r['골든']}"},
            ], max_tokens=200)
            v = j.get("판정", "오답")
            res[v if v in ("정답", "부분", "오답") else "오답"] += 1
            if v == "오답":
                res["오답목록"].append((r["질문"][:40], j.get("이유", "")[:50]))
            if (i + 1) % 20 == 0:
                print(f"[{tag}] 채점 {i + 1}/{len(g)}")
        for r in rf:
            if is_refusal(r["답변"]):
                res["거부성공"] += 1
        rows[tag] = res

    # 리포트
    lines = ["# 생성 LLM A/B 리포트(같은 검색·프롬프트, 모델만 스왑)", ""]
    lines.append("| 지표 | " + " | ".join(tags) + " |")
    lines.append("|---|" + "---|" * len(tags))
    def row(label, fn):
        lines.append(f"| {label} | " + " | ".join(str(fn(rows[t])) for t in tags) + " |")
    row("골든 100문 정답", lambda r: f"{r['정답']} ({r['정답'] / max(1, r['n_g']):.0%})")
    row("부분", lambda r: r["부분"])
    row("오답", lambda r: r["오답"])
    row("골든 토큰 보존", lambda r: f"{r['골든보존']} ({r['골든보존'] / max(1, r['n_g']):.0%})")
    row("⛔과잉거부(정상질문 거부)", lambda r: r["과잉거부"])
    row("거부형 12문 거부 성공", lambda r: f"{r['거부성공']}/{r['n_r']}")
    row("지연 중앙값(s)", lambda r: r["지연중앙값"])
    lines.append("")
    for t in tags:
        lines.append(f"## {t} 오답 목록")
        for q, why in rows[t]["오답목록"]:
            lines.append(f"- {q} — {why}")
        lines.append("")
    (AB_DIR / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:14]))
    print(f"\n→ {AB_DIR / 'report.md'}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", help="답변 생성 모드: 이 태그로 저장(모델은 env LLM_MODEL)")
    ap.add_argument("--grade", action="store_true")
    ap.add_argument("--tags", default="qwen35,qwythos")
    a = ap.parse_args()
    if a.grade:
        raise SystemExit(grade([t.strip() for t in a.tags.split(",")]))
    if not a.tag:
        ap.error("--tag 또는 --grade 필요")
    raise SystemExit(run_answers(a.tag))
