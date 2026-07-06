#!/usr/bin/env python3
"""
01d_system_to_md.py — 사내 시스템 기능 분석 문서 → 모듈별 시스템 노트 (ERP 방식 일반화)

01d_erp_to_md.py를 **다중 시스템**으로 일반화한 버전. 전자결재·기안·대외업무·웹디스크 등
"저번 ERP처럼" 수집한 기능 문서를 같은 파이프라인으로 코퍼스에 적재한다.

입력 형식(ERP와 동일): 단일 MD.  `## N. 모듈` > `### ▎서브그룹` > `#### 기능(화면/메뉴·설명)` 3단.
  - 맨 앞 제목/범례/목차 → '<시스템> 시스템 개요' 노트(인덱스)
  - `## N. 모듈명` → '<시스템> 시스템 · 모듈명' 노트 (type:system, 02가 #### 단위 청킹)
  - ⛔ 원문 의역 금지: 본문(메뉴·기능 설명) 그대로 보존. 검수상태 미검수.

시스템 추가법: 아래 SYSTEMS 레지스트리에 한 줄 등록 → 원자료를 주고 아래 실행.
실행:  python 01d_system_to_md.py --system eas --src <파일.md> --vault KEI-행정가이드
       python 01d_system_to_md.py --list           # 등록된 시스템 보기
       python 01d_system_to_md.py --system erp --src KEI_ERP_entire_features.md --vault ... --dry-run  # ERP 재현 검증
"""
import argparse
import re
from pathlib import Path

# ── 시스템 레지스트리 — 여기에 한 줄 등록하면 새 시스템이 파이프라인에 편입된다 ─────────────
# key: CLI --system 값 / name: 표시명 / prefix: 노트 제목 접두("· 모듈"이 붙음) / cat: 분류(둘러보기 필터)
# tags: 프론트매터 태그 / overview: 개요 노트 제목 / strip_h1: 원자료 맨 앞 H1 중 제거할 제목(선택)
SYSTEMS = {
    "erp": {
        "name": "ERP", "prefix": "ERP 시스템", "cat": "ERP시스템",
        "tags": ["ERP", "시스템"], "overview": "ERP 시스템 개요",
        "strip_h1": "# 한국환경연구원(KEI) 행정관리시스템(ERP) 전체 기능 정리",
        "warn": "> [!warning] 자동 분석 자료(메뉴 수집) — 화면ID·기능 표기. 실제 화면과 다를 수 있어 검수 후 `검수상태: 검수완료`로.",
    },
    "eas": {  # 전자결재(기안·결재함·문서함·양식)
        "name": "전자결재", "prefix": "전자결재 시스템", "cat": "전자결재시스템",
        "tags": ["전자결재", "결재", "기안", "시스템"], "overview": "전자결재 시스템 개요",
        "strip_h1": "",
        "warn": "> [!warning] 자동/수집 자료 — 메뉴·기능 표기. 실제 화면과 다를 수 있어 검수 후 `검수상태: 검수완료`로.",
    },
    "external": {  # 대외업무(대외활동·홍보·정보공개 등)
        "name": "대외업무", "prefix": "대외업무 시스템", "cat": "대외업무시스템",
        "tags": ["대외업무", "시스템"], "overview": "대외업무 시스템 개요",
        "strip_h1": "",
        "warn": "> [!warning] 자동/수집 자료 — 메뉴·기능 표기. 실제 화면과 다를 수 있어 검수 후 `검수상태: 검수완료`로.",
    },
    "webdisk": {  # 웹디스크(문서 저장·공유)
        "name": "웹디스크", "prefix": "웹디스크", "cat": "웹디스크시스템",
        "tags": ["웹디스크", "문서", "시스템"], "overview": "웹디스크 개요",
        "strip_h1": "",
        "warn": "> [!warning] 자동/수집 자료 — 메뉴·기능 표기. 실제 화면과 다를 수 있어 검수 후 `검수상태: 검수완료`로.",
    },
}


def note(title, body, original, sysconf):
    fm = [
        "---",
        "type: system",
        f'제목: "{title}"',
        f'분류: "{sysconf["cat"]}"',
        '대상: "전직원"',
        "관련규정: []",
        "관련서식: []",
        "개정일:",
        "최종검토일:",
        "검토자:",
        f'원본파일: "{original}"',
        "태그: [" + ", ".join(f'"{t}"' for t in sysconf["tags"]) + "]",
        "검수상태: 미검수",
        "---",
        "",
        f"# {title}",
        "",
        sysconf["warn"],
        "",
        body.strip(),
        "",
    ]
    return "\n".join(fm)


def convert(text, sysconf):
    """원자료 → [(제목, 본문)] 리스트(개요 1 + 모듈 N). ERP 01d와 동일한 ## N.모듈 분할 로직."""
    parts = re.split(r"(?m)^(##\s+.+)$", text)
    intro = parts[0].strip()
    if sysconf.get("strip_h1"):
        intro = intro.replace(sysconf["strip_h1"], "").strip()
    overview_blocks = [intro]
    modules = []
    i = 1
    while i < len(parts):
        heading = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        name = heading.lstrip("#").strip()
        m = re.match(r"^\d+\.\s*(.+)$", name)
        if m:  # 'N. 모듈명' → 모듈 노트
            modules.append((m.group(1).strip(), body.strip()))
        else:  # 범례/목차/기타 → 개요로
            overview_blocks.append(f"## {name}\n\n{body.strip()}")
        i += 2
    out = [(sysconf["overview"], "\n\n".join(b for b in overview_blocks if b.strip()))]
    for name, body in modules:
        out.append((f'{sysconf["prefix"]} · {name}', body))
    return out


def main():
    ap = argparse.ArgumentParser(description="사내 시스템 기능 문서 → 모듈별 시스템 노트(ERP 방식 일반화)")
    ap.add_argument("--system", help="SYSTEMS 레지스트리 키(예: eas, external, webdisk, erp)")
    ap.add_argument("--src")
    ap.add_argument("--vault")
    ap.add_argument("--list", action="store_true", help="등록된 시스템 목록")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.list:
        print("등록된 시스템(--system 값):")
        for k, v in SYSTEMS.items():
            print(f"  {k:<10} → {v['prefix']:<16} (분류 {v['cat']})")
        return
    if not (args.system and args.src and args.vault):
        ap.error("--system, --src, --vault 필수 (또는 --list)")
    if args.system not in SYSTEMS:
        ap.error(f"미등록 시스템 '{args.system}'. --list로 확인하거나 SYSTEMS에 등록하세요.")

    sysconf = SYSTEMS[args.system]
    src = Path(args.src)
    out_root = Path(args.vault) / "40_시스템"
    text = src.read_text(encoding="utf-8")
    original = src.name
    notes = convert(text, sysconf)

    existing = {md.stem for md in Path(args.vault).rglob("*.md")}
    written = []
    for title, body in notes:
        slug, n = title, 1
        while slug in existing:
            n += 1
            slug = f"{title}_{n}"
        existing.add(slug)
        dest = out_root / f"{slug}.md"
        nfeat = len(re.findall(r"(?m)^####\s", body))
        written.append((title, dest, nfeat))
        if not args.dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(note(title, body, original, sysconf), encoding="utf-8")

    print(f"{'(dry-run) ' if args.dry_run else ''}[{sysconf['name']}] 생성 {len(written)}개 노트 → {out_root}")
    print(f"{'제목':<30}{'기능(####)':>10}  파일")
    for title, dest, nfeat in written:
        print(f"{title:<30}{nfeat:>10}  {dest.name}")
    print(f"총 기능(####): {sum(n for _, _, n in written)}개")
    if not args.dry_run:
        print(f"\n다음: python 01e_system_crosslink.py --vault {args.vault} --system {args.system}  → 규정 교차링크")


if __name__ == "__main__":
    main()
