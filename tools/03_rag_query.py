#!/usr/bin/env python3
"""
03_rag_query.py — 검색 → 근거 조문 주입 → 로컬 vLLM → 출처 표기

- 임베딩 검색으로 관련 조문 top-k 회수
- '근거 안에서만 답하고, 없으면 모른다고 말하고, 끝에 [규정명 제N조] 출처를 달라'는
  프롬프트로 환각 억제 + 감사 추적성 확보
- LLM은 로컬 vLLM(OpenAI 호환). 행정 QA에는 VL이 아니라 일반 instruct 모델 권장
  (예: Qwen2.5-7B/14B-Instruct, 또는 한국어 특화 EXAONE/Kanana)

검색만 테스트(LLM 불필요):
  python 03_rag_query.py --db tools/chroma --q "출장 여비 정산" --retrieve-only
전체 RAG(vLLM 필요):
  python 03_rag_query.py --db tools/chroma --q "법인카드로 주말에 비품 사도 되나요?"
"""
import argparse
import os

EMBED_MODEL = "nlpai-lab/KURE-v1"     # 02와 동일해야 함
VLLM_BASE = os.environ.get("VLLM_BASE", "http://localhost:8000/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-14B-Instruct")
COLLECTION = "kei_regs"

SYSTEM = (
    "너는 KEI 행정 도우미다. 아래 [근거]에 담긴 규정 조문만 사용해 답한다.\n"
    "규칙:\n"
    "1) [근거]에 없는 내용(특히 금액·한도·기한)은 절대 지어내지 말고 '규정에서 확인되지 않습니다'라고 말한다.\n"
    "2) 답변은 신입도 이해하게 쉽게, 단계로.\n"
    "3) 답변 맨 끝에 사용한 출처를 [규정명 제N조] 형식으로 모두 표기한다.\n"
    "4) 마지막에 '최종 판단은 원문과 담당 부서 확인 바랍니다.'를 덧붙인다."
)


def retrieve(model, col, query: str, k: int):
    qv = model.encode([query], normalize_embeddings=True)[0].tolist()
    res = col.query(query_embeddings=[qv], n_results=k,
                    include=["documents", "metadatas", "distances"])
    hits = []
    for doc, meta, dist in zip(res["documents"][0], res["metadatas"][0], res["distances"][0]):
        hits.append({"doc": doc, "meta": meta, "dist": dist})
    return hits


def build_context(hits):
    blocks, srcs = [], []
    for h in hits:
        m = h["meta"]
        tag = f"{m.get('규정명', '')} {m.get('조', '')}".strip()
        blocks.append(f"[{tag}]\n{h['doc']}")
        srcs.append(tag)
    return "\n\n---\n\n".join(blocks), srcs


def main():
    ap = argparse.ArgumentParser(description="검색 → 근거 주입 → LLM → 출처 표기")
    ap.add_argument("--db", default="tools/chroma")
    ap.add_argument("--q", required=True)
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--collection", default=COLLECTION)
    ap.add_argument("--model", default=EMBED_MODEL)
    ap.add_argument("--retrieve-only", action="store_true",
                    help="LLM 없이 회수된 근거 조문만 출력(검색 품질 점검용)")
    args = ap.parse_args()

    import chromadb
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(args.model)
    col = chromadb.PersistentClient(path=args.db).get_collection(args.collection)
    hits = retrieve(model, col, args.q, args.k)

    print(f"\n질문: {args.q}")
    print(f"─ 회수된 근거 {len(hits)}개 (거리=작을수록 유사):")
    for i, h in enumerate(hits, 1):
        m = h["meta"]
        tag = f"{m.get('규정명', '')} {m.get('조', '')}".strip()
        snippet = h["doc"][:90].replace("\n", " ")
        print(f"  {i}. [{h['dist']:.3f}] {tag}  ·  {m.get('분류', '')}")
        print(f"       {snippet}")

    if args.retrieve_only:
        return

    context, srcs = build_context(hits)
    from openai import OpenAI
    client = OpenAI(base_url=VLLM_BASE, api_key="EMPTY")
    try:
        out = client.chat.completions.create(
            model=LLM_MODEL, temperature=0.1,
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"[질문]\n{args.q}\n\n[근거]\n{context}"},
            ],
        )
    except Exception as e:
        print(f"\n[!] LLM 호출 실패({VLLM_BASE}, {LLM_MODEL}): {type(e).__name__}: {e}")
        print("    vLLM 엔드포인트가 떠 있는지 확인하세요. 검색만 보려면 --retrieve-only.")
        return
    print("\n" + (out.choices[0].message.content or "") + "\n")


if __name__ == "__main__":
    main()
