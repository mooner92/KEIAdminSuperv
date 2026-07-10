#!/usr/bin/env python3
"""01r_synth_queries.py — 임베딩 FT용 합성 쿼리 생성 (지렛대 ②, docs/23 §2).

청크(규정·가이드·시스템)마다 로컬 LLM(Qwen3.5-9B, 온프레미스)으로 "행정 초보가 던질 법한
실제 질문" 1개를 생성해 (질문, 정답 청크) 학습쌍을 만든다. InPars/GPL 방식.

⛔ 골든셋(eval/golden.jsonl)은 학습에 쓰지 않는다 — 순수 held-out 평가(유출 방지, docs/23 §2).
⛔ 데이터 반출 없음: 생성·저장 전 과정 온프레미스.

실행: CHROMA_DIR=... VLLM_BASE=http://127.0.0.1:11436/v1 LLM_MODEL=... \
      .venv/bin/python tools/01r_synth_queries.py [--target 650] [--limit 5]
산출: tools/index/ft_pairs.jsonl  {qid, query, pos_id, 규정명, 조, type}
"""
import argparse
import json
import os
import random
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

OUT = Path(__file__).resolve().parent / "index" / "ft_pairs.jsonl"

GEN_SYS = (
    "너는 검색 학습데이터 생성기다. 주어진 사내 규정/가이드/시스템 문서 조각을 보고, "
    "KEI(한국환경연구원)의 행정 초보 직원이 '이 조각으로 답을 찾게 될 법한' 현실적인 질문을 딱 1개 만든다.\n"
    "- 구어체로, 문서의 문장을 그대로 베끼지 말 것(단어 일부 겹침은 자연스러움).\n"
    "- 문서에 금액·기한·절차가 있으면 그것을 묻는 질문이 좋다. 규정명은 질문에 넣지 말 것.\n"
    "- 출력은 질문 한 줄만. 따옴표·번호·설명 금지."
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=650, help="생성할 학습쌍 수")
    ap.add_argument("--limit", type=int, default=0, help="스모크 테스트용 상한(0=target)")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    import rag_core
    from openai import OpenAI
    _, col, _ = rag_core.backend()
    got = col.get(include=["documents", "metadatas"])
    llm = OpenAI(base_url=rag_core.VLLM_BASE, api_key="EMPTY")

    # 후보: 실질 본문이 있는 청크(부칙·빈 서식 제외), 유형 혼합
    cands = []
    for i, d, m in zip(got["ids"], got["documents"], got["metadatas"]):
        typ = (m.get("type") or "")
        if typ not in ("regulation", "guide", "system"):
            continue
        body = (d or "").strip()
        if len(body) < 120 or len(body) > 3000:
            continue
        jo = (m.get("조") or "")
        if re.search(r"부칙|별지", jo):
            continue
        cands.append((i, body, m))
    random.Random(args.seed).shuffle(cands)
    n = min(args.limit or args.target, args.target, len(cands))
    cands = cands[:n]
    print(f"후보 {len(cands)}개 청크 → 합성 쿼리 생성 시작 (LLM={rag_core.LLM_MODEL})")

    done_ids = set()
    if OUT.exists():
        for line in OUT.read_text(encoding="utf-8").splitlines():
            try:
                done_ids.add(json.loads(line)["pos_id"])
            except Exception:
                pass
        print(f"이어하기: 기존 {len(done_ids)}쌍 스킵")

    t0 = time.time()
    n_new = 0
    with OUT.open("a", encoding="utf-8") as f:
        for k, (cid, body, m) in enumerate(cands):
            if cid in done_ids:
                continue
            try:
                out = llm.chat.completions.create(
                    model=rag_core.LLM_MODEL, temperature=0.7, max_tokens=60,
                    messages=[{"role": "system", "content": GEN_SYS},
                              {"role": "user", "content": f"[문서 조각]\n{body[:1500]}\n\n[질문]"}],
                    extra_body=rag_core._gen_extra(),
                )
                q = (out.choices[0].message.content or "").strip().strip('"').splitlines()[0].strip()
            except Exception as e:  # noqa: BLE001 — 실패 청크는 건너뜀
                print(f"  ⚠ {cid}: {type(e).__name__}")
                continue
            if len(q) < 8 or len(q) > 150:
                continue
            f.write(json.dumps({
                "qid": f"synth-{cid}", "query": q, "pos_id": cid,
                "규정명": m.get("규정명", ""), "조": m.get("조", ""), "type": m.get("type", ""),
            }, ensure_ascii=False) + "\n")
            f.flush()
            n_new += 1
            if n_new % 25 == 0:
                rate = n_new / (time.time() - t0 + 1e-9)
                print(f"  {n_new}/{len(cands)} ({rate:.1f}/s 아님 — {rate*60:.0f}/min), 예시: {q[:60]}")
    print(f"완료: 신규 {n_new}쌍 (총 {len(done_ids) + n_new}) → {OUT}")


if __name__ == "__main__":
    main()
