#!/usr/bin/env python3
"""
02_chunk_and_embed.py — 제N조 단위 청킹 + 한국어 임베딩 + Chroma 적재

- 규정원문은 '제1조', '제2조(목적)' 경계로 나눠 조문 1개 = 청크 1개
  → 검색 결과가 "법적으로 완결된 단위"로 떨어지고, 출처(제N조) 표기가 깔끔해짐
- 가이드/용어는 노트 단위로 적재
- 임베딩: 한국어 검색 특화 KURE-v1(권장) 또는 다국어 BGE-M3
"""
import argparse, re
from pathlib import Path

EMBED_MODEL = "nlpai-lab/KURE-v1"   # 대안: "BAAI/bge-m3"

ARTICLE = re.compile(r"(?=^\s*제\s*\d+\s*조)", re.MULTILINE)  # 제N조 경계

def split_frontmatter(text: str):
    if text.startswith("---"):
        _, fm, body = text.split("---", 2)
        meta = {}
        for line in fm.strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
        return meta, body.strip()
    return {}, text

def article_no(chunk: str) -> str:
    m = re.match(r"\s*제\s*(\d+)\s*조", chunk)
    return f"제{m.group(1)}조" if m else ""

def iter_chunks(vault: Path):
    for md in vault.rglob("*.md"):
        if "_templates" in md.parts:
            continue
        meta, body = split_frontmatter(md.read_text(encoding="utf-8"))
        typ = meta.get("type", "")
        if typ == "regulation":
            parts = [p.strip() for p in ARTICLE.split(body) if p.strip()]
            for p in parts:
                yield {
                    "text": p,
                    "규정명": meta.get("규정명", md.stem),
                    "규정번호": meta.get("규정번호", ""),
                    "조": article_no(p),
                    "type": "regulation",
                    "path": str(md),
                }
        elif typ in ("guide", "term"):
            yield {"text": body, "규정명": meta.get("제목") or meta.get("용어", md.stem),
                   "규정번호": "", "조": "", "type": typ, "path": str(md)}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", required=True)
    ap.add_argument("--db", default="./chroma")
    args = ap.parse_args()

    import chromadb
    from sentence_transformers import SentenceTransformer

    print(f"임베딩 모델 로드: {EMBED_MODEL}")
    model = SentenceTransformer(EMBED_MODEL)  # GPU 자동 사용
    client = chromadb.PersistentClient(path=args.db)
    col = client.get_or_create_collection("kei_regs", metadata={"hnsw:space": "cosine"})

    chunks = list(iter_chunks(Path(args.vault)))
    print(f"청크 {len(chunks)}개 임베딩 중...")
    embs = model.encode([c["text"] for c in chunks], normalize_embeddings=True,
                        batch_size=32, show_progress_bar=True)
    col.upsert(
        ids=[f"{i}" for i in range(len(chunks))],
        embeddings=[e.tolist() for e in embs],
        documents=[c["text"] for c in chunks],
        metadatas=[{k: c[k] for k in ("규정명","규정번호","조","type","path")} for c in chunks],
    )
    print(f"적재 완료 → {args.db} (collection=kei_regs, {col.count()} items)")

if __name__ == "__main__":
    main()
