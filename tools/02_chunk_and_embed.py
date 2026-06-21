#!/usr/bin/env python3
"""
02_chunk_and_embed.py — 제N조 단위 청킹 + 한국어 임베딩 + Chroma 적재

- 규정원문은 '제1조', '제2조(목적)' 경계로 나눠 조문 1개 = 청크 1개
  → 검색 결과가 "법적으로 완결된 단위"로 떨어지고, 출처(제N조) 표기가 깔끔해짐
  → 첫 제N조 앞의 머리말(규정명·제정/개정 이력·표)은 조="" 청크로 따로 적재
- 가이드/용어는 노트 단위로 적재
- 임베딩: 한국어 검색 특화 KURE-v1(권장) 또는 다국어 BGE-M3 (양자화하지 않음)
- 기본은 '클린 리빌드'(--reset): 컬렉션을 비우고 다시 만든다. id가 위치 기반이라
  조문 가감 시 stale 벡터가 남는 문제를, 볼트(진실원천) 전체 재생성으로 원천 차단.

실행:  python 02_chunk_and_embed.py --vault KEI-행정가이드 --db tools/chroma
"""
import argparse
import os
import re
from pathlib import Path

# CUDA 메모리 단편화 완화(긴 조문이 섞인 배치에서 OOM 방지에 도움)
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

EMBED_MODEL = "nlpai-lab/KURE-v1"   # 대안: "BAAI/bge-m3"
COLLECTION = "kei_regs"
# 별표/별지 1급 청크 분리(P1.3). 기본 on. CHUNK_BYEOLPYO=0이면 기존(제N조만) — A/B 비교용.
BYEOLPYO_SPLIT = os.environ.get("CHUNK_BYEOLPYO", "1") not in ("0", "false", "")

ARTICLE = re.compile(r"(?=^\s*제\s*\d+\s*조)", re.MULTILINE)  # 제N조 경계
# 제N조 | 별표 | 별지 경계로 분할(P1.3: 별표/별지를 1급 청크로). 본문 인용("별표 1의…")이 아니라
# 줄머리 대괄호 헤더([별표 N], [별지 제N호…])만 경계로 본다.
BOUNDARY = re.compile(r"(?=^\s*제\s*\d+\s*조)|(?=^\s*\[\s*별표)|(?=^\s*\[\s*별지)", re.MULTILINE)
WARN_PREFIX = "> [!warning] 자동 변환"

# 긴 조문 하위분할(P3): max_seq_len 초과 조문은 뒷부분(항·호의 금액·조건)이 임베딩에서 잘린다.
# 항(①②…)→호(1./가.)→문단 순으로 쪼개되 조 라벨('제N조')·메타는 유지(출처·앵커·평가 불변).
HANG = re.compile(r"(?=[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕])")
HO = re.compile(r"(?=^\s*(?:\d{1,2}\.|[가나다라마바사아자차카타파하]\.))", re.MULTILINE)
ART_HEADER = re.compile(r"^\s*(제\s*\d+\s*조(?:\s*\([^)]*\))?)")
SUBSPLIT = os.environ.get("CHUNK_SUBSPLIT", "1") not in ("0", "false", "")


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


def strip_injected(body: str) -> str:
    """01 단계가 넣은 머리 H1(# 제목)과 경고 콜아웃을 제거해 임베딩 노이즈를 줄인다."""
    lines = body.split("\n")
    out = []
    for ln in lines:
        s = ln.strip()
        if not out and s.startswith("# "):      # 맨 앞 H1 제목
            continue
        if s.startswith(WARN_PREFIX):            # 변환 경고 콜아웃
            continue
        out.append(ln)
    return "\n".join(out).strip()


def strip_wikilinks(text: str) -> str:
    """[[대상|표시]] → 표시, [[대상]] → 대상. 01b가 넣은 위키링크 마크업을 임베딩 전에 벗겨
    검색 노이즈를 없앤다(그래프용 링크는 볼트에 유지, 임베딩 텍스트만 정리)."""
    return re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)


def article_no(chunk: str) -> str:
    m = re.match(r"\s*제\s*(\d+)\s*조", chunk)
    return f"제{m.group(1)}조" if m else ""


def chunk_label(chunk: str):
    """청크 머리로 (kind, 라벨) 판정. kind ∈ article|byeolpyo|byeolji|head."""
    s = chunk.lstrip()
    m = re.match(r"제\s*(\d+)\s*조", s)
    if m:
        return "article", f"제{m.group(1)}조"
    m = re.match(r"\[\s*별표\s*(\d+)", s)
    if m:
        return "byeolpyo", f"별표 {m.group(1)}"
    if re.match(r"\[\s*별표", s):
        return "byeolpyo", "별표"
    m = re.match(r"\[\s*별지\s*제?\s*(\d+)\s*호", s)
    if m:
        return "byeolji", f"별지 제{m.group(1)}호"
    if re.match(r"\[\s*별지", s):
        return "byeolji", "별지"
    return "head", ""


def find_refs(label: str, kind: str, articles):
    """별표/별지 N을 '인용하는' 조문 목록(refs) 산출 — 본문에서 '별표 N'/'별지 제N호' 언급 탐색."""
    m = re.search(r"(\d+)", label)
    if not m:
        return ""
    n = m.group(1)
    key = "별표" if kind == "byeolpyo" else "별지"
    pat = re.compile(rf"{key}\s*제?\s*{n}(?!\d)")
    return ",".join(a_label for a_label, a_text in articles if pat.search(a_text))


def _ntok(tok, s: str) -> int:
    return len(tok.encode(s, add_special_tokens=True))


def _hard_wrap(text: str, tok, max_tokens: int):
    """최후 수단: 문장/길이 단위 강제 분할(항·호가 없거나 단일 항이 한도 초과일 때)."""
    units = re.split(r"(?<=[.。!?\n])", text)
    out, buf = [], ""
    for u in units:
        if buf and _ntok(tok, buf + u) > max_tokens:
            out.append(buf); buf = u
        else:
            buf += u
    if buf:
        out.append(buf)
    return out or [text]


def _split_long_text(text: str, tok, max_len: int):
    """max_len 토큰 초과 텍스트를 항(①②…)→호(1./가.)→문단→줄/문장 순으로 분할.
    조문이면 조 헤더(제N조(…))를 각 조각에 prefix해 자족성 유지. 거대 표는 줄 단위로 폴백."""
    m = ART_HEADER.match(text)
    header = m.group(1).strip() if m else ""
    floor = max(256, max_len - 48)  # 헤더·특수토큰 여유

    def first_split(t):
        for splitter in (HANG, HO):
            segs = [s for s in splitter.split(t) if s.strip()]
            if len(segs) > 1:
                return segs
        segs = [s for s in re.split(r"\n{2,}", t) if s.strip()]
        if len(segs) > 1:
            return segs
        return _hard_wrap(t, tok, floor)  # 표/단일 블록: 줄·문장 단위 강제 분할

    def probe(s):
        return (header + "\n" + s) if header else s

    # 1차 분할 후, 한도 초과 단일 세그먼트는 줄/문장 단위로 재분할
    fine = []
    for seg in first_split(text):
        fine.append(seg) if _ntok(tok, probe(seg)) <= max_len else fine.extend(_hard_wrap(seg, tok, floor))
    # 헤더 prefix 고려해 max_len 이하로 그리디 패킹
    pieces, buf = [], ""
    for seg in fine:
        cand = (buf + seg) if buf else seg
        if buf and _ntok(tok, probe(cand)) > max_len:
            pieces.append(buf); buf = seg
        else:
            buf = cand
    if buf:
        pieces.append(buf)
    out = []
    for p in pieces:
        p = p.strip()
        if header and not p.startswith(header):
            p = f"{header}\n{p}"
        out.append(p)
    return out or [text]


def subsplit_long_chunks(chunks, tok, max_len: int):
    """max_len 초과 청크를 하위분할. 조 라벨·메타 유지(출처·앵커·평가 불변), 하위 인덱스는 '부분'(1/3)으로만 기록.
    ⛔ 별표/별지(표)는 분할하지 않는다 — 표 구조 보존 + 깨진 표는 VLM 복원 트랙(P1.3)에서 처리."""
    out = []
    for c in chunks:
        if c.get("별표") == "Y" or _ntok(tok, c["text"]) <= max_len:
            out.append(c); continue
        pieces = _split_long_text(c["text"], tok, max_len)
        if len(pieces) <= 1:
            out.append(c); continue
        for j, ptext in enumerate(pieces):
            d = dict(c)
            d["text"] = ptext
            d["부분"] = f"{j + 1}/{len(pieces)}"
            out.append(d)
    return out


def chunk_guide(body: str, max_chars: int = 1800, pack: int = 1400):
    """가이드/시스템 노트를 헤딩(####/###/##) 단위로 청킹. (text, label) 리스트 반환.
    - `#### 기능` 단위(앞 `### 서브그룹`을 맥락으로 prefix) → ERP 기능별 정밀 검색
    - `##`(예: pptx 슬라이드)도 경계. 헤딩이 없으면 문단 패킹(긴 가이드 잘림 방지)
    - 과대 청크는 문단 단위로 재분할. label = 그 청크의 헤딩 텍스트(출처 부제)."""
    lines = body.split("\n")
    if not any(re.match(r"^#{2,4}\s", ln) for ln in lines):
        paras = [p.strip() for p in re.split(r"\n{2,}", body) if p.strip()]
        out, buf, cur = [], [], 0
        for p in paras:
            if cur + len(p) > pack and buf:
                out.append(("\n\n".join(buf), "")); buf, cur = [], 0
            buf.append(p); cur += len(p)
        if buf:
            out.append(("\n\n".join(buf), ""))
        return out or [(body.strip(), "")]

    out, buf, label, cur_sub = [], [], "", ""

    def flush():
        t = "\n".join(buf).strip()
        if t:
            out.append((t, label))

    for ln in lines:
        s = ln.strip()
        if re.match(r"^####\s", s):
            flush(); buf = []; label = s.lstrip("#").strip()
            if cur_sub:
                buf.append(f"[{cur_sub}]")
            buf.append(ln)
        elif re.match(r"^###\s", s):
            flush(); buf = []; label = ""; cur_sub = s.lstrip("#").strip().lstrip("▎").strip()
        elif re.match(r"^##\s", s):
            flush(); buf = []; label = s.lstrip("#").strip()
        else:
            buf.append(ln)
    flush()

    final = []
    for text, lab in out:
        if len(text) <= max_chars:
            final.append((text, lab)); continue
        b, c = [], 0
        for p in [x.strip() for x in re.split(r"\n{2,}", text) if x.strip()]:
            if c + len(p) > pack and b:
                final.append(("\n\n".join(b), lab)); b, c = [], 0
            b.append(p); c += len(p)
        if b:
            final.append(("\n\n".join(b), lab))
    return final or [(body.strip(), "")]


def iter_chunks(vault: Path):
    for md in sorted(vault.rglob("*.md")):
        if "_templates" in md.parts:
            continue
        meta, body = split_frontmatter(md.read_text(encoding="utf-8"))
        typ = meta.get("type", "")
        rel = str(md.relative_to(vault))
        body = strip_wikilinks(body)             # 그래프용 [[ ]] 는 검색 텍스트에서 제거
        if typ == "regulation":
            body = strip_injected(body)
            splitter = BOUNDARY if BYEOLPYO_SPLIT else ARTICLE  # A/B: 별표 분리 on/off
            parts = [p.strip() for p in splitter.split(body) if p.strip()]
            labeled = [(chunk_label(p), p) for p in parts]
            # ref 산출용 조문 텍스트(라벨, 본문)
            articles = [(lab, p) for (kind, lab), p in labeled if kind == "article"]
            for (kind, label), p in labeled:
                refs = find_refs(label, kind, articles) if kind in ("byeolpyo", "byeolji") else ""
                yield {
                    "text": p,
                    "규정명": meta.get("규정명") or md.stem,
                    "규정번호": meta.get("규정번호", ""),
                    "조": label,                      # 제N조 | 별표 N | 별지 제N호 | (머리말 "")
                    "분류": meta.get("분류", ""),
                    "개정일": meta.get("개정일", ""),
                    "검수상태": meta.get("검수상태", ""),
                    "type": "regulation",
                    "별표": "Y" if kind in ("byeolpyo", "byeolji") else "",  # 별표/별지 1급 청크 표식
                    "refs": refs,                     # 이 별표/별지를 인용하는 조문들(그래프/출처 연결)
                    "path": rel,
                }
        elif typ in ("guide", "term", "system"):
            body = strip_injected(body)              # 머리 H1·경고 콜아웃 제거(임베딩 노이즈↓)
            name = meta.get("제목") or meta.get("용어") or md.stem
            for text, label in chunk_guide(body):
                yield {
                    "text": text,
                    "규정명": name,
                    "규정번호": "",
                    "조": label,                     # #### 기능명/슬라이드/소제목 → 출처 부제
                    "분류": meta.get("분류", ""),
                    "개정일": meta.get("개정일", ""),
                    "검수상태": meta.get("검수상태", ""),
                    "type": typ,
                    "path": rel,
                }


META_KEYS = ("규정명", "규정번호", "조", "분류", "개정일", "검수상태", "type", "별표", "refs", "부분", "path")


def main():
    ap = argparse.ArgumentParser(description="제N조 청킹 + 임베딩 + Chroma 적재")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--db", default="tools/chroma")
    ap.add_argument("--model", default=EMBED_MODEL)
    ap.add_argument("--collection", default=COLLECTION)
    ap.add_argument("--batch-size", type=int, default=8,
                    help="임베딩 배치 크기. KURE-v1(8192 컨텍스트)은 긴 조문이 섞이면 OOM 나기 쉬워 작게")
    ap.add_argument("--max-seq-len", type=int, default=2048,
                    help="모델 입력 토큰 상한(메모리·속도 ↔ 긴 조문 잘림 트레이드오프). 0=모델 기본(8192)")
    ap.add_argument("--limit", type=int, default=0, help="처음 N청크만(테스트)")
    ap.add_argument("--no-reset", action="store_true",
                    help="컬렉션을 비우지 않고 upsert만(기본은 클린 리빌드)")
    args = ap.parse_args()

    import chromadb
    from sentence_transformers import SentenceTransformer

    chunks = list(iter_chunks(Path(args.vault)))
    if args.limit:
        chunks = chunks[: args.limit]
    by_type: dict[str, int] = {}
    docs = set()
    for c in chunks:
        by_type[c["type"]] = by_type.get(c["type"], 0) + 1
        docs.add(c["path"])
    with_article = sum(1 for c in chunks if c["조"])
    print(f"청크 {len(chunks)}개  (문서 {len(docs)}개 · 조문청크 {with_article} · 머리말/기타 {len(chunks)-with_article})")
    print("타입별:", ", ".join(f"{k} {v}" for k, v in sorted(by_type.items())))

    print(f"\n임베딩 모델 로드: {args.model}")
    model = SentenceTransformer(args.model)
    if args.max_seq_len:
        model.max_seq_length = args.max_seq_len
    dev = getattr(model, "device", "?")
    max_len = getattr(model, "max_seq_length", None)
    print(f"  device={dev}  max_seq_length={max_len}")

    # 긴 청크 하위분할(P3): 입력 한도 초과 청크를 항/호/줄로 쪼개 뒷부분(금액·조건) 잘림 방지(별표 제외)
    if SUBSPLIT and max_len:
        n0 = len(chunks)
        chunks = subsplit_long_chunks(chunks, model.tokenizer, max_len)
        if len(chunks) != n0:
            print(f"  긴 청크 하위분할(P3): {n0} → {len(chunks)} 청크 (+{len(chunks) - n0}; CHUNK_SUBSPLIT=0이면 끔)")

    # 과대 청크(모델 입력 한도 초과 → 잘림) 점검
    if max_len:
        tok = model.tokenizer
        over = [(c, len(tok.encode(c["text"], add_special_tokens=True))) for c in chunks]
        big = [(n, c["규정명"], c["조"]) for c, n in over if n > max_len]
        if big:
            big.sort(reverse=True)
            print(f"  ⚠ 입력 한도({max_len} 토큰) 초과 청크 {len(big)}개 — 임베딩 시 잘림. 상위:")
            for n, name, jo in big[:8]:
                print(f"     {n:>5} tok  {name} {jo}")

    client = chromadb.PersistentClient(path=args.db)
    if not args.no_reset:
        try:
            client.delete_collection(args.collection)
            print(f"\n기존 컬렉션 '{args.collection}' 비움(클린 리빌드)")
        except Exception:
            pass
    col = client.get_or_create_collection(args.collection, metadata={"hnsw:space": "cosine"})

    print(f"\n청크 {len(chunks)}개 임베딩 중...")
    embs = model.encode(
        [c["text"] for c in chunks],
        normalize_embeddings=True,
        batch_size=args.batch_size,
        show_progress_bar=True,
    )
    # id: 경로#순번 (클린 리빌드 전제로 안정·고유)
    ids = [f"{c['path']}#{i}" for i, c in enumerate(chunks)]
    col.upsert(
        ids=ids,
        embeddings=[e.tolist() for e in embs],
        documents=[c["text"] for c in chunks],
        metadatas=[{k: (c.get(k) or "") for k in META_KEYS} for c in chunks],
    )
    print(f"\n적재 완료 → {args.db} (collection={args.collection}, {col.count()} items)")


if __name__ == "__main__":
    main()
