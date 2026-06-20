#!/usr/bin/env bash
# eval/run.sh — RAG 검색 품질 평가 실행 래퍼 (P1.1 /verify 진입점)
#
#   bash eval/run.sh                 # 검색 지표만(Hit/Recall/MRR) — 빠름, LLM 불필요
#   bash eval/run.sh --judge         # 충실도(LLM-as-judge)까지 — Ollama 필요
#   bash eval/run.sh --tag before    # 리포트 파일명에 태그(before/after 비교용)
#
# 현행(개발) 백엔드와 동일한 임베딩/벡터DB를 보도록 env를 고정한다.
# (재임베딩/리랭커 실험 시 CHROMA_DIR·EMBED_MODEL만 바꿔 같은 평가셋으로 before/after 측정)
set -euo pipefail
cd "$(dirname "$0")/.."

export CHROMA_DIR="${CHROMA_DIR:-tools/chroma}"
export RAG_COLLECTION="${RAG_COLLECTION:-kei_regs}"
export EMBED_MODEL="${EMBED_MODEL:-nlpai-lab/KURE-v1}"
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"
# 평가는 오프라인 배치 → 임베딩을 CPU로 돌려 라이브 서빙(GPU)과 경쟁하지 않는다.
# (랭킹은 장치 무관 — 같은 KURE-v1 가중치. GPU로 강제하려면 CUDA_VISIBLE_DEVICES 지정)
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES-}"
# --judge 시에만 사용(생성). 검색 지표만이면 호출 안 함.
export VLLM_BASE="${VLLM_BASE:-http://127.0.0.1:11434/v1}"
export LLM_MODEL="${LLM_MODEL:-hf.co/bartowski/Qwen2.5-14B-Instruct-GGUF:Q4_K_M}"

PY=tools/.venv/bin/python
[ -x "$PY" ] || PY=python3
exec "$PY" eval/run_eval.py "$@"
