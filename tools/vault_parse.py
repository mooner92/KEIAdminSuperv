#!/usr/bin/env python3
"""vault_parse.py — 규정원문 조문 파싱 공통 모듈 (Track A 추출기 01i/01j/01k 공용).

⚠ 02_chunk_and_embed.py와 **동일한** 제N조 경계·라벨 규칙을 재사용한다.
추출기가 만드는 조 라벨(예 '제16조', '제19조의2')이 청크 메타의 '조' 및 rag_core._jo_key
정규화 결과와 정확히 일치해야 런타임 오버레이(효력 배지·삭제 강등·준용 첨부) 조인이 성립한다.
원문층은 읽기 전용으로만 접근한다(절대 규칙2: 의역·수정 금지)."""
import re
from pathlib import Path

ARTICLE = re.compile(r"(?=^\s*제\s*\d+\s*조)", re.MULTILINE)   # 제N조 경계(02와 동일)
WARN_PREFIX = "> [!warning] 자동 변환"
_ART_HEAD = re.compile(r"제\s*(\d+)\s*조(?:\s*의\s*(\d+))?")
_ART_TITLE = re.compile(r"제\s*\d+\s*조(?:\s*의\s*\d+)?\s*\(([^)]*)\)")


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


def strip_wikilinks(text: str) -> str:
    """[[대상|표시]]→표시, [[대상]]→대상 (01b가 넣은 그래프용 마크업 제거, 02와 동일).
    추출 텍스트를 임베딩 텍스트와 동일한 자연어로 맞춰 정의·참조 오탐을 없앤다."""
    return re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)


def strip_injected(body: str) -> str:
    """01 단계가 넣은 머리 H1(# 제목)과 변환 경고 콜아웃 제거(02.strip_injected와 동일)."""
    out = []
    for ln in body.split("\n"):
        s = ln.strip()
        if not out and s.startswith("# "):
            continue
        if s.startswith(WARN_PREFIX):
            continue
        out.append(ln)
    return "\n".join(out).strip()


def article_label(chunk: str) -> str:
    """청크 머리 → '제N조' | '제N조의M' | '' (가지번호 보존, 02._article_label과 동일)."""
    m = _ART_HEAD.match(chunk.lstrip())
    if not m:
        return ""
    return f"제{m.group(1)}조의{m.group(2)}" if m.group(2) else f"제{m.group(1)}조"


def article_title(chunk: str) -> str:
    """'제N조(제목) …' → '제목' (없으면 '')."""
    m = _ART_TITLE.match(chunk.lstrip())
    return m.group(1).strip() if m else ""


def reg_name(meta: dict, md: Path) -> str:
    """규정명 결정 규칙 — 02와 동일(메타 규정명 우선, 없으면 파일 stem)."""
    return meta.get("규정명") or md.stem


def iter_regulations(vault):
    """각 규정 .md → dict(path, 규정명, 규정번호, 분류, 개정일, 검수상태, articles).
    articles = [(label, title, body), ...] (머리말/기타 청크는 제외).
    라벨·본문 분할은 02_chunk_and_embed.iter_chunks(regulation 경로)와 정합."""
    for md in sorted(Path(vault).rglob("*.md")):
        if "_templates" in md.parts:
            continue
        meta, body = split_frontmatter(md.read_text(encoding="utf-8"))
        if meta.get("type") != "regulation":
            continue
        body = strip_wikilinks(strip_injected(body))
        # 라벨 중복 제거 — 첫 등장 우선. 본칙이 문서 앞에 오므로 본칙 제N조가 채택되고,
        # 뒤따르는 부칙의 '제1조(시행일)…' 더미조는 라벨 충돌로 자동 배제된다(개정횟수 오염 방지).
        # 부칙 뒤에 오는 '제32조 삭제'류(변환 배치 특성)는 유일 등장이라 그대로 보존.
        arts, seen = [], set()
        for p in (x.strip() for x in ARTICLE.split(body) if x.strip()):
            lab = article_label(p)
            if lab and lab not in seen:
                seen.add(lab)
                arts.append((lab, article_title(p), p))
        yield {
            "path": str(md.relative_to(vault)),
            "규정명": reg_name(meta, md),
            "규정번호": meta.get("규정번호", ""),
            "분류": meta.get("분류", ""),
            "개정일": meta.get("개정일", ""),
            "검수상태": meta.get("검수상태", ""),
            "articles": arts,
        }


def reg_names(vault) -> list:
    """볼트 전체 규정명 목록(길이 내림차순 — 긴 이름 우선 매칭). find_reg_refs식 크로스규정 해소용."""
    names = set()
    for r in iter_regulations(vault):
        if r["규정명"]:
            names.add(r["규정명"])
    return sorted(names, key=len, reverse=True)
