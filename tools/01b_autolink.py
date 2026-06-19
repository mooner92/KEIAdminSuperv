#!/usr/bin/env python3
"""
01b_autolink.py — 규정 간 평문 상호참조를 Obsidian 위키링크로 (인공뇌 그래프 엣지 생성)

볼트의 규정 원문은 서로를 평문으로 인용한다(예: "인사규정 제31조", "「회계규정」").
이 단계는 그 인용을 `[[<파일stem>#제N조|원문 그대로]]` 로 감싸 **그래프 엣지**를 만든다.

원칙:
- ⛔ 의역 금지: 표시 텍스트(alias)에 **원문을 글자 그대로** 넣어 화면 표기는 불변. 링크 마크업만 추가.
- 자기 자신(같은 규정)으로는 링크하지 않는다.
- 인용이 분명한 경우만 링크: ① `「규정명」`(꺾쇠 인용) ② `규정명 제N조`(이름+조). 맨 이름만 있는 언급은 건너뜀(노이즈 방지).
- **이름 변이 흡수**: 꺾쇠 인용은 공백·가운뎃점(`·` `.`)·`및`·괄호 차이를 정규화해 같은 규정으로 연결한다.
  (예: 「승진·전직에관한규칙」→ 승진.전직에관한규칙, 「법인카드관리 및 사용규칙」→ 법인카드관리및사용규칙)
- 멱등(idempotent): 이미 `[[ ]]` 안은 다시 건드리지 않으므로 반복 실행해도 안전.
- 01(변환) → 01b(링크) → 02(임베딩) 순서. 02는 임베딩 전에 위키링크 마크업을 벗겨 검색 노이즈를 없앤다.

실행:  python 01b_autolink.py --vault KEI-행정가이드            (적용)
       python 01b_autolink.py --vault KEI-행정가이드 --dry-run  (미리보기)
"""
import argparse
import re
from pathlib import Path

# 조 표기: 제N조 / 제N조의M / 제N조제M항
ART = r"(?:\s*제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제\s*\d+\s*항)?)"
TRAIL_ART = re.compile(r"(제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제\s*\d+\s*항)?)\s*$")
ANUM = re.compile(r"제\s*(\d+)\s*조")


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


def norm(s: str) -> str:
    """이름 변이 흡수: 공백·가운뎃점(·.ㆍ･・)·'및'·괄호·따옴표 제거."""
    return re.sub(r"[\s·.,;:「」()\[\]‘’“”ㆍ･・及및]", "", s)


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


def build_pattern(names):
    # 긴 이름 우선(내부감사규정 > 감사규정). re 교대는 leftmost-first 라 정렬이 중요.
    alt = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
    # (1)(2): 「임의 인용」 + 선택 조  → 정규화로 변이 흡수
    # (3)(4): 정확 이름 + 조(필수)  → 꺾쇠 없는 평문 인용
    return re.compile(
        r"「\s*([^」\n]{2,40}?)\s*」(" + ART + r")?"
        + r"|(" + alt + r")(" + ART + r")"
    )


def link_text(segment, pat, reg, normmap, self_name, counter):
    def lookup(nm):
        return nm if nm in reg else normmap.get(norm(nm))

    def repl(m):
        if m.group(1) is not None:                 # 「...」 인용 (변이 허용)
            inside = m.group(1).strip()
            tm = TRAIL_ART.search(inside)           # 조가 꺾쇠 안에 있으면 분리
            if tm:
                name_part, art = inside[:tm.start()].strip(), tm.group(1)
            else:
                name_part, art = inside, (m.group(2) or "")
            actual = lookup(name_part)
        else:                                      # 정확 이름 + 조
            name_part, art = m.group(3), m.group(4)
            actual = name_part if name_part in reg else None
        if not actual or actual == self_name:      # 미상/자기참조 → 그대로
            return m.group(0)
        am = ANUM.search(art or "")
        anchor = f"#제{am.group(1)}조" if am else ""
        counter[0] += 1
        return f"[[{reg[actual]}{anchor}|{m.group(0)}]]"

    return pat.sub(repl, segment)


def main():
    ap = argparse.ArgumentParser(description="규정 상호참조 → 위키링크 (그래프 엣지)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    vault = Path(args.vault)
    reg = build_registry(vault)
    normmap = {}
    for nm in reg:
        normmap.setdefault(norm(nm), nm)
    pat = build_pattern(reg.keys())
    print(f"규정 레지스트리 {len(reg)}건 로드 (정규화 키 {len(normmap)}개)")

    total_links = 0
    changed = 0
    per_file = []
    for md in sorted(vault.rglob("*.md")):
        if "_templates" in md.parts or md.name == "README.md":
            continue
        meta, fm, body = split_fm(md.read_text(encoding="utf-8"))
        if meta.get("type") not in ("regulation", "guide", "term", "system"):
            continue
        self_name = (meta.get("규정명") or meta.get("제목") or meta.get("용어") or "")
        # 기존 [[...]] 보호: 링크 밖 구간만 변환
        parts = re.split(r"(\[\[[^\]]*\]\])", body)
        counter = [0]
        for i in range(0, len(parts), 2):
            parts[i] = link_text(parts[i], pat, reg, normmap, self_name, counter)
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
