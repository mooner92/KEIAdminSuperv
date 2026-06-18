#!/usr/bin/env python3
"""
03_rag_query.py — 검색 → 근거 조문 주입 → 로컬 vLLM → 출처 표기

- 임베딩 검색으로 관련 조문 top-k 회수
- '근거 안에서만 답하고, 없으면 모른다고 말하고, 끝에 [규정명 제N조] 출처를 달라'는
  프롬프트로 환각 억제 + 감사 추적성 확보
- LLM은 로컬 vLLM(OpenAI 호환). 행정 QA에는 VL이 아니라 일반 instruct 모델 권장
  (예: Qwen2.5-7B/14B-Instruct, Gemma-3, 또는 한국어 특화 EXAONE/Kanana)
"""
import argparse
from openai import OpenAI

EMBED_MODEL = "nlpai-lab/KURE-v1"     # 02와 동일해야 함
VLLM_BASE   = "http://localhost:8000/v1"
LLM_MODEL   = "Qwen/Qwen2.5-14B-Instruct"

SYSTEM = (
    "너는 KEI 행정 도우미다. 아래 [근거]에 담긴 규정 조문만 사용해 답한다.\n"
    "규칙:\n"
    "1) [근거]에 없는 내용(특히 금액·한도·기한)은 절대 지어내지 말고 '규정에서 확인되지 않습니다'라고 말한다.\n"
    "2) 답변은 신입도 이해하게 쉽게, 단계로.\n"
    "3) 답변 맨 끝에 사용한 출처를 [규정명 제N조] 형식으로 모두 표기한다.\n"
    "4) 마지막에 '최종 판단은 원문과 담당 부서 확인 바랍니다.'를 덧붙인다."
)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="./chroma")
    ap.add_argument("--q", required=True)
    ap.add_argument("--k", type=int, default=5)
    args = ap.parse_args()

    import chromadb
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(EMBED_MODEL)
    qv = model.encode([args.q], normalize_embeddings=True)[0].tolist()
    col = chromadb.PersistentClient(path=args.db).get_collection("kei_regs")
    res = col.query(query_embeddings=[qv], n_results=args.k)

    ctx = []
    for doc, meta in zip(res["documents"][0], res["metadatas"][0]):
        tag = f"{meta.get('규정명','')} {meta.get('조','')}".strip()
        ctx.append(f"[{tag}]\n{doc}")
    context = "\n\n---\n\n".join(ctx)

    client = OpenAI(base_url=VLLM_BASE, api_key="EMPTY")
    out = client.chat.completions.create(
        model=LLM_MODEL, temperature=0.1,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"[질문]\n{args.q}\n\n[근거]\n{context}"},
        ],
    )
    print("\n" + out.choices[0].message.content + "\n")
    print("─ 회수된 조문:", [m.get("조") or m.get("규정명") for m in res["metadatas"][0]])

if __name__ == "__main__":
    main()
