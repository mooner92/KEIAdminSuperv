#!/usr/bin/env python3
"""
01d_erp_to_md.py — ERP 기능 분석 문서(KEI_ERP_entire_features.md) → 모듈별 가이드 노트

원본은 `## N. 모듈` > `### ▎서브그룹` > `#### 기능(화면ID·검색조건·컬럼…)` 3단 구조의 단일 문서.
- 모듈 1개 = 노트 1개(`10_업무가이드/ERP/ERP-<모듈>.md`, type:guide, 분류:ERP시스템) → 그래프 노드 + 02의 #### 단위 청킹으로 기능별 검색
- 맨 앞 제목/범례/목차 = 'ERP 시스템 개요' 노트(인덱스)
- ⛔ 원문 의역 금지: 본문(화면ID·기능 설명)을 그대로 보존. 검수상태 미검수.

실행:  python 01d_erp_to_md.py --src KEI_ERP_entire_features.md --vault KEI-행정가이드
"""
import argparse
import re
from pathlib import Path

CAT = "ERP시스템"
WARN = "> [!warning] 자동 분석 자료(Claude Chrome extension로 ERP 메뉴 수집) — 화면ID·기능 표기. 실제 화면과 다를 수 있어 검수 후 `검수상태: 검수완료`로."


def note(title, body, original, extra_meta=""):
    fm = [
        "---",
        "type: guide",
        f'제목: "{title}"',
        f'분류: "{CAT}"',
        '대상: "전직원"',
        "관련규정: []",
        "관련서식: []",
        "개정일:",
        "최종검토일:",
        "검토자:",
        f'원본파일: "{original}"',
        '태그: ["ERP", "시스템"]',
        "검수상태: 미검수",
        "---",
        "",
        f"# {title}",
        "",
        WARN,
        "",
        body.strip(),
        "",
    ]
    return "\n".join(fm)


def main():
    ap = argparse.ArgumentParser(description="ERP 기능 문서 → 모듈별 가이드 노트")
    ap.add_argument("--src", required=True)
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src = Path(args.src)
    out_root = Path(args.vault) / "10_업무가이드" / "ERP"
    text = src.read_text(encoding="utf-8")
    original = src.name

    # 레벨2(## ) 경계로 분할. 첫 조각(제목 앞부분) + 범례/목차 = 개요, 'N. 모듈' = 모듈 노트
    parts = re.split(r"(?m)^(##\s+.+)$", text)
    # parts = [intro, '## 범례', body, '## 목차', body, '## 1. 인사관리', body, ...]
    intro = parts[0].strip()
    overview_blocks = [intro]
    modules = []  # (module_name, body)
    i = 1
    while i < len(parts):
        heading = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        name = heading.lstrip("#").strip()
        m = re.match(r"^\d+\.\s*(.+)$", name)
        if m:  # 'N. 모듈명' → 모듈 노트
            modules.append((m.group(1).strip(), body.strip()))
        else:  # 범례 / 목차 / 기타 → 개요로
            overview_blocks.append(f"## {name}\n\n{body.strip()}")
        i += 2

    existing = {md.stem for md in Path(args.vault).rglob("*.md")}
    written = []

    def emit(title, body):
        slug = title
        n = 1
        while slug in existing:
            n += 1
            slug = f"{title}_{n}"
        existing.add(slug)
        dest = out_root / f"{slug}.md"
        written.append((title, dest, len(re.findall(r'(?m)^####\s', body))))
        if not args.dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(note(title, body, original), encoding="utf-8")

    # 개요 노트
    emit("ERP 시스템 개요", "\n\n".join(b for b in overview_blocks if b.strip())
         .replace("# 한국환경연구원(KEI) 행정관리시스템(ERP) 전체 기능 정리", "").strip())
    # 모듈 노트
    for name, body in modules:
        emit(f"ERP 시스템 · {name}", body)

    print(f"{'(dry-run) ' if args.dry_run else ''}생성 {len(written)}개 노트 → {out_root}")
    print(f"{'제목':<28}{'기능(####) 수':>12}  파일")
    for title, dest, nfeat in written:
        print(f"{title:<28}{nfeat:>12}  {dest.name}")
    print(f"총 기능(####): {sum(n for _,_,n in written)}개")


if __name__ == "__main__":
    main()
