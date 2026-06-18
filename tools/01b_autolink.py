#!/usr/bin/env python3
"""
01b_autolink.py — 규정 간 평문 상호참조를 Obsidian 위키링크로 (인공뇌 그래프 엣지 생성)

볼트의 규정 원문은 서로를 평문으로 인용한다(예: "인사규정 제31조", "「회계규정」").
이 단계는 그 인용을 `[[<파일stem>#제N조|원문 그대로]]` 로 감싸 **그래프 엣지**를 만든다.

원칙:
- ⛔ 의역 금지: 표시 텍스트(alias)에 **원문을 글자 그대로** 넣어 화면 표기는 불변. 링크 마크업만 추가.
- 자기 자신(같은 규정)으로는 링크하지 않는다.
- 인용이 분명한 경우만 링크: ① `「규정명」`(꺾쇠 인용) ② `규정명 제N조`(이름+조). 맨 이름만 있는 언급은 건너뜀(노이즈 방지).
- 멱등(idempotent): 이미 `[[ ]]` 안은 다시 건드리지 않으므로 반복 실행해도 안전.
- 01(변환) → 01b(링크) → 02(임베딩) 순서. 02는 임베딩 전에 위키링크 마크업을 벗겨 검색 노이즈를 없앤다.

실행:  python 01b_autolink.py --vault KEI-행정가이드            (적용)
       python 01b_autolink.py --vault KEI-행정가이드 --dry-run  (미리보기)
"""
import argparse
import re
from pathlib import Path


def split_fm(text: str):
    if text.startswith("---"):
        _, fm, body = text.split("---", 2)
        meta = {}
        for ln in fm.strip().splitlines():
            if ":" in ln:
                k, v = ln.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
        return meta, "---" + fm + "---", body
    return {}, "", text


def build_registry(vault: Path):
    """규정명 → 파일 stem (확장자 제외). 원문(regulation)만 대상."""
    reg = {}
    for md in (vault / "20_규정원문").rglob("*.md"):
        if md.name == "README.md":
            continue
        meta, _, _ = split_fm(md.read_text(encoding="utf-8"))
        if meta.get("type") == "regulation":
            name = (meta.get("규정명") or "").strip()
            if name and name != "목차":
                reg.setdefault(name, md.stem)
    return reg


def make_pattern(names):
    # 긴 이름 우선(내부감사규정 > 감사규정). re 교대는 leftmost-first 라 정렬이 중요.
    alt = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
    # 「?이름」? (제N조(의M)(제M항))?
    return re.compile(
        r"「?(" + alt + r")」?(\s*제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제\s*\d+\s*항)?)?"
    )


def link_text(segment: str, pat, reg, self_name, counter):
    def repl(m):
        name = m.group(1)
        if name == self_name:           # 자기 규정으로는 링크 안 함
            return m.group(0)
        stem = reg.get(name)
        if not stem:
            return m.group(0)
        article = m.group(2)
        disp = m.group(0)
        if article:
            anum = re.search(r"제\s*(\d+)\s*조", article)
            anchor = f"#제{anum.group(1)}조" if anum else ""
            counter[0] += 1
            return f"[[{stem}{anchor}|{disp}]]"
        if disp.startswith("「"):        # 꺾쇠 인용만 링크(맨 이름은 skip)
            counter[0] += 1
            return f"[[{stem}|{disp}]]"
        return disp
    return pat.sub(repl, segment)


def main():
    ap = argparse.ArgumentParser(description="규정 상호참조 → 위키링크 (그래프 엣지)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    vault = Path(args.vault)
    reg = build_registry(vault)
    pat = make_pattern(reg.keys())
    print(f"규정 레지스트리 {len(reg)}건 로드")

    total_links = 0
    changed = 0
    per_file = []
    for md in sorted(vault.rglob("*.md")):
        if "_templates" in md.parts or md.name == "README.md":
            continue
        meta, fm, body = split_fm(md.read_text(encoding="utf-8"))
        if meta.get("type") not in ("regulation", "guide", "term"):
            continue
        self_name = (meta.get("규정명") or meta.get("제목") or meta.get("용어") or "")
        # 기존 [[...]] 보호: 링크 밖 구간만 변환
        parts = re.split(r"(\[\[[^\]]*\]\])", body)
        counter = [0]
        for i in range(0, len(parts), 2):
            parts[i] = link_text(parts[i], pat, reg, self_name, counter)
        if counter[0]:
            new_body = "".join(parts)
            per_file.append((md.stem, counter[0]))
            total_links += counter[0]
            changed += 1
            if not args.dry_run:
                md.write_text(fm + new_body, encoding="utf-8")

    per_file.sort(key=lambda x: -x[1])
    print(f"\n링크 {total_links}개 / 변경 파일 {changed}개")
    print("상위(파일별 링크 수):")
    for stem, n in per_file[:15]:
        print(f"  {n:>4}  {stem}")
    if args.dry_run:
        print("\n(dry-run: 파일 미수정)")


if __name__ == "__main__":
    main()
