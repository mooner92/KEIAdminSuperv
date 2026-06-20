#!/usr/bin/env python3
"""reembed_note.py — 단일 노트만 재청킹·재임베딩해 Chroma 갱신 (P1.2).

검수 도구가 사람의 '검수완료' 확정 직후 호출한다(그 노트만 갱신 → 전체 리빌드 회피).
02_chunk_and_embed.py의 청킹을 그대로 재사용해 전체 빌드와 100% 동일하게 자른다.

id 정책: 02는 `경로#전역순번`을 쓴다. 단건 갱신은 충돌을 피하려고
  ① `where={"path": rel}` 로 그 노트의 기존 청크를 **먼저 전부 삭제**한 뒤
  ② `경로#노트로컬순번` 으로 새로 add 한다. (다음 전체 리빌드 시 전역순번으로 정규화됨)

⛔ 가드레일:
  - 재임베딩 전 **Chroma 백업 필수**(기본 자동: `<db>.bak.<날짜>`). 롤백 경로를 출력한다.
  - 라이브 `kei-rag-api`가 같은 db를 열고 있으면, 갱신 반영을 위해 갱신 후 `pm2 restart kei-rag-api`.
    (안전 테스트는 `--db tools/chroma.test` 처럼 사본에 대고 한다.)
  - 이 도구는 임베딩만 갱신한다. '검수완료' 프론트매터 표시는 사람/검수도구가 한다.

실행:
  python tools/reembed_note.py --vault KEI-행정가이드 --path 20_규정원문/4000_보수·여비/여비규정.md
  python tools/reembed_note.py --vault KEI-행정가이드 --stem 여비규정 --db tools/chroma.test --skip-backup
"""
import argparse
import importlib.util
import os
import shutil
from datetime import datetime
from pathlib import Path

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
HERE = Path(__file__).resolve().parent


def load_chunker():
    """02_chunk_and_embed.py(숫자 시작 모듈)를 importlib로 로드해 청킹 로직 재사용."""
    spec = importlib.util.spec_from_file_location("chunk02", HERE / "02_chunk_and_embed.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    ap = argparse.ArgumentParser(description="단일 노트 재임베딩(Chroma 단건 갱신)")
    ap.add_argument("--vault", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--path", help="볼트 기준 상대경로(예: 20_규정원문/.../여비규정.md)")
    g.add_argument("--stem", help="파일명(확장자 제외)로 지정")
    ap.add_argument("--db", default="tools/chroma")
    ap.add_argument("--collection", default="kei_regs")
    ap.add_argument("--model", default="nlpai-lab/KURE-v1")
    ap.add_argument("--device", default="cpu", help="cpu(기본, 라이브 GPU 비경쟁) 또는 cuda")
    ap.add_argument("--max-seq-len", type=int, default=2048)
    ap.add_argument("--skip-backup", action="store_true", help="⚠ 백업 생략(사본 테스트 때만)")
    ap.add_argument("--dry-run", action="store_true", help="청크만 보고 쓰지 않음")
    args = ap.parse_args()

    if args.device == "cpu":
        os.environ["CUDA_VISIBLE_DEVICES"] = ""

    mod = load_chunker()
    vault = Path(args.vault)

    # 대상 노트의 청크만 추출(전체 iter_chunks를 path/stem으로 필터 → 빌드와 동일 청킹 보장)
    chunks = list(mod.iter_chunks(vault))
    if args.path:
        rel = args.path
        sel = [c for c in chunks if c["path"] == rel]
    else:
        sel = [c for c in chunks if Path(c["path"]).stem == args.stem]
        rel = sel[0]["path"] if sel else None
    if not sel:
        raise SystemExit(f"대상 노트의 청크를 찾지 못함(path/stem 확인): {args.path or args.stem}")
    paths = sorted({c["path"] for c in sel})
    if len(paths) > 1:
        raise SystemExit(f"여러 노트가 매칭됨(--path로 한정): {paths}")
    rel = paths[0]
    print(f"대상: {rel}  · 청크 {len(sel)}개 "
          f"({sum(1 for c in sel if c['조'])} 조문/라벨 · 검수상태 {sel[0].get('검수상태') or '미검수'})")
    for c in sel:
        print(f"   - [{c['규정명']} {c['조']}]  {c['text'][:60].strip()}…")

    if args.dry_run:
        print("\n(dry-run) 쓰지 않음.")
        return

    # ⛔ 백업(가드레일)
    if not args.skip_backup:
        bak = f"{args.db}.bak.{datetime.now().strftime('%F')}"
        if not Path(bak).exists():
            shutil.copytree(args.db, bak)
            print(f"\n[백업] {args.db} → {bak} (롤백: rm -rf {args.db} && mv {bak} {args.db})")
        else:
            print(f"\n[백업] 오늘자 백업 존재: {bak} (롤백 경로)")

    import chromadb
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(args.model, device=args.device)
    if args.max_seq_len:
        model.max_seq_length = args.max_seq_len
    embs = model.encode([c["text"] for c in sel], normalize_embeddings=True, batch_size=8)

    col = chromadb.PersistentClient(path=args.db).get_or_create_collection(
        args.collection, metadata={"hnsw:space": "cosine"})
    before = col.count()
    # ① 기존 청크 전부 삭제(전역순번 id든 뭐든 path 메타로 한 번에)
    col.delete(where={"path": rel})
    # ② 노트로컬 id로 재적재
    ids = [f"{rel}#{i}" for i in range(len(sel))]
    col.upsert(
        ids=ids,
        embeddings=[e.tolist() for e in embs],
        documents=[c["text"] for c in sel],
        metadatas=[{k: (c.get(k) or "") for k in mod.META_KEYS} for c in sel],
    )
    after = col.count()
    print(f"\n갱신 완료: '{rel}' {len(sel)}청크 재적재. 컬렉션 {before} → {after} items.")
    print("⚠ 라이브 API 반영하려면: pm2 restart kei-rag-api")


if __name__ == "__main__":
    main()
