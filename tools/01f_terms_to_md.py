#!/usr/bin/env python3
"""
01f_terms_to_md.py — 행정 용어집(KEI_admin_terms.md) → 용어 1개 = 노트 1개 (30_용어집/)

원본은 `## 카테고리` 아래 `**용어명**` + 정의 + `*관련: ...*` 형식. (총 84개)
- 용어 1개 = 노트 1개(`30_용어집/<카테고리>/<용어>.md`, type:term) → 용어집 섹션(주황) 노드 + 02 노트 단위 청킹
- 프론트매터: type, 용어, 영문, 분류(카테고리), 관련규정[], 태그, 검수상태:미검수
- ⛔ 의역 금지: 정의 원문 보존. 자동 초안이므로 검수상태 미검수.

순서: 01f(생성) → 01b(autolink: 용어 정의가 규정명 인용 시 링크) → 02(임베딩)
실행:  python 01f_terms_to_md.py --src KEI_admin_terms.md --vault KEI-행정가이드
"""
import argparse
import re
import unicodedata
from pathlib import Path

FS_FORBIDDEN = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
# 용어 헤더 라인: 한 줄 전체가 **용어** (+ 선택적 `[tag]`)
TERM_HEAD = re.compile(r"^\*\*(.+?)\*\*\s*(?:`\[[^`]*\]`)?\s*$")


def nfc(s):
    return unicodedata.normalize("NFC", s)


def safe(s):
    return FS_FORBIDDEN.sub("_", s).strip()[:80]


def note(term, cat, body, original):
    fm = [
        "---",
        "type: term",
        f'용어: "{term}"',
        '영문: ""',
        f'분류: "{cat}"',
        "관련규정: []",
        f'원본파일: "{original}"',
        "태그: []",
        "검수상태: 미검수",
        "---",
        "",
        f"# {term}",
        "",
        "> [!warning] 자동 작성 초안(ERP 화면 기반) — 규정상 정의와 다를 수 있어 공식 규정집과 함께 검수.",
        "",
        body.strip(),
        "",
    ]
    return "\n".join(fm)


def main():
    ap = argparse.ArgumentParser(description="행정 용어집 → 용어별 노트(30_용어집/)")
    ap.add_argument("--src", required=True)
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    vault = Path(args.vault)
    out_root = vault / "30_용어집"
    text = Path(args.src).read_text(encoding="utf-8")
    original = Path(args.src).name

    # ## 카테고리 경계로 분할(부록 제외)
    parts = re.split(r"(?m)^##\s+(.+)$", text)
    existing = {md.stem for md in vault.rglob("*.md")}
    rows = []
    by_cat = {}

    i = 1
    while i < len(parts):
        cat = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        i += 2
        if cat.startswith("부록"):
            continue
        # 카테고리 본문에서 **용어** 블록 추출
        lines = body.split("\n")
        cur_term, buf = None, []

        def flush():
            nonlocal cur_term, buf
            if cur_term:
                definition = "\n".join(buf).strip()
                emit(cur_term, cat, definition)
            cur_term, buf = None, []

        def emit(term, category, definition):
            slug = safe(term)
            n = 1
            while slug in existing:
                n += 1
                slug = f"{safe(term)}_{n}"
            existing.add(slug)
            dest = out_root / safe(category) / f"{slug}.md"
            by_cat[category] = by_cat.get(category, 0) + 1
            rows.append((category, term))
            if not args.dry_run:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(note(term, category, definition, original), encoding="utf-8")

        for ln in lines:
            m = TERM_HEAD.match(ln.strip())
            if m:
                flush()
                cur_term = nfc(m.group(1).strip())
            elif cur_term is not None:
                buf.append(ln)
        flush()

    print(f"{'(dry-run) ' if args.dry_run else ''}용어 {len(rows)}개 생성 → {out_root}")
    for cat, n in sorted(by_cat.items()):
        print(f"  {cat:<16} {n:>3}")
    print("샘플:", ", ".join(t for _, t in rows[:8]))


if __name__ == "__main__":
    main()
