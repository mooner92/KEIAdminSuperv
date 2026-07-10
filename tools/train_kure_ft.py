#!/usr/bin/env python3
"""train_kure_ft.py — KURE-v1 도메인 대조학습 실험 (지렛대 ②, docs/23 §2).

학습쌍(01r 합성 + 실로그 👍)으로 KURE-v1을 파인튜닝한다. MultipleNegativesRankingLoss
(+명시적 hard negative: 현 인덱스 top-k 중 비정답). 골든셋은 학습에 넣지 않는다(held-out).

⛔ 온프레미스 전용(데이터 반출 없음). 산출물 models/kure-kei-ft/ (gitignore).
⚠ GPU1에서 학습(서빙 리랭커 ~3GB와 공유) — OOM 시 batch를 낮출 것. 서빙 우선.

실행: CUDA_VISIBLE_DEVICES=1 .venv/bin/python tools/train_kure_ft.py \
        [--pairs tools/index/ft_pairs.jsonl] [--epochs 1] [--batch 8]
"""
import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

BASE = "nlpai-lab/KURE-v1"
OUT_DIR = Path(__file__).resolve().parent.parent / "models" / "kure-kei-ft"


def load_pairs(path: Path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except Exception:
            pass
    return rows


def mine_hard_negatives(pairs, k: int = 6):
    """현 인덱스(베이스 임베딩)로 top-k 회수 → 정답이 아닌 최상위 청크를 hard negative로."""
    import rag_core
    embed, col, _ = rag_core.backend()
    out = []
    B = 64
    for i in range(0, len(pairs), B):
        batch = pairs[i:i + B]
        vecs = embed.encode([p["query"] for p in batch], normalize_embeddings=True)
        res = col.query(query_embeddings=[v.tolist() for v in vecs], n_results=k,
                        include=["documents", "metadatas"])
        metas = res.get("metadatas") or [[{}] * len(x) for x in res["ids"]]
        for p, ids, docs, ms in zip(batch, res["ids"], res["documents"], metas):
            # 거짓 음성 방어: 같은 규정(문서)의 청크는 인접 조문이 실제 정답일 수 있어 negative 금지
            negs = [d for cid, d, m in zip(ids, docs, ms)
                    if cid != p["pos_id"] and (m.get("규정명") or "") != (p.get("규정명") or "")][:2]
            pos = col.get(ids=[p["pos_id"]], include=["documents"])["documents"]
            if not pos or not pos[0]:
                continue
            p["pos_text"] = pos[0]
            p["neg_texts"] = negs
            out.append(p)
        if (i // B) % 4 == 0:
            print(f"  hard negative 채굴 {min(i + B, len(pairs))}/{len(pairs)}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", default=str(Path(__file__).parent / "index" / "ft_pairs.jsonl"))
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=5e-6)
    ap.add_argument("--out", default=str(OUT_DIR))
    args = ap.parse_args()

    pairs = load_pairs(Path(args.pairs))
    print(f"학습쌍 {len(pairs)}개 로드")
    random.Random(7).shuffle(pairs)

    print("hard negative 채굴(베이스 인덱스)…")
    pairs = mine_hard_negatives(pairs)
    print(f"채굴 완료: {len(pairs)}개 (query, pos, neg×≤2)")

    import torch
    from datasets import Dataset
    from sentence_transformers import (SentenceTransformer, SentenceTransformerTrainer,
                                       SentenceTransformerTrainingArguments)
    from sentence_transformers.losses import CachedMultipleNegativesRankingLoss

    model = SentenceTransformer(BASE, device="cuda")
    model.max_seq_length = 512  # 학습 활성화 메모리 절감(bge-m3 기본 8192 → OOM 실측). 색인·서빙은 원 길이.
    # (anchor, positive, negative) 3열 — MNRL은 in-batch negative + 명시 negative 모두 사용
    rows = {"anchor": [], "positive": [], "negative": []}
    for p in pairs:
        neg = p["neg_texts"][0] if p["neg_texts"] else ""
        if not neg:
            continue
        rows["anchor"].append(p["query"])
        rows["positive"].append(p["pos_text"][:1800])
        rows["negative"].append(neg[:1800])
    ds = Dataset.from_dict(rows)
    print(f"학습 데이터셋 {len(ds)}행 (트리플릿)")

    targs = SentenceTransformerTrainingArguments(
        output_dir=str(Path(args.out) / "_ckpt"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        learning_rate=args.lr,
        warmup_ratio=0.1,
        fp16=True,           # Turing: bf16 불가 — fp16
        gradient_checkpointing=True,  # 24GB 공유 GPU에서 활성화 메모리 절감(OOM 실측 대응)
        logging_steps=20,
        save_strategy="no",
        report_to=[],
        seed=7,
    )
    trainer = SentenceTransformerTrainer(
        model=model, args=targs, train_dataset=ds,
        loss=CachedMultipleNegativesRankingLoss(model, mini_batch_size=8),
    )
    trainer.train()
    Path(args.out).mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.out)
    print(f"저장 → {args.out}")
    print(f"VRAM peak: {torch.cuda.max_memory_allocated() / 1e9:.1f} GB")


if __name__ == "__main__":
    main()
