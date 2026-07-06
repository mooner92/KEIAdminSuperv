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

── 번들 모드(--bundle) ──────────────────────────────────────────────────────
여러 시스템이 한 파일에 담긴 전사 정리 문서(예: KEI 전사 시스템 전체 기능 정리)용.
  구조: `## N. <시스템명>` = 시스템 경계 / `### N.M <모듈>` = 모듈(있으면 모듈별 노트, 없으면 시스템=노트 1개)
  - 문서 머리말 → '사내 시스템 개요' 허브 노트([[시스템]] 링크 → 그래프 클러스터 허브)
  - 다모듈 시스템(PMS·그룹웨어)은 '<시스템> 개요' + '<시스템> · <모듈>' 노트, 개요에 [[모듈]] 링크
  - PMS식 `**기능명**`(+화면ID) 항목은 `#### 기능명`으로 승격 → ERP와 동일한 기능 단위 청킹
  - ⛔ 본문 텍스트 불변(헤딩 레벨·링크 등 구조만 조정). 검수상태 미검수.
실행:  python 01d_system_to_md.py --bundle --src <전사문서.md> --vault KEI-행정가이드 [--dry-run]
"""
import argparse
import re
from pathlib import Path

# ── 시스템 레지스트리 — 여기에 한 줄 등록하면 새 시스템이 파이프라인에 편입된다 ─────────────
# key: CLI --system 값 / name: 표시명 / prefix: 노트 제목 접두("· 모듈"이 붙음) / cat: 분류(둘러보기 필터)
# tags: 프론트매터 태그 / overview: 개요 노트 제목 / strip_h1: 원자료 맨 앞 H1 중 제거할 제목(선택)
WARN_DEFAULT = "> [!warning] 자동/수집 자료 — 메뉴·기능 표기. 실제 화면과 다를 수 있어 검수 후 `검수상태: 검수완료`로."

SYSTEMS = {
    "erp": {
        "name": "ERP", "prefix": "ERP 시스템", "cat": "행정관리(ERP)",
        "tags": ["ERP", "시스템"], "overview": "ERP 시스템 개요",
        "strip_h1": "# 한국환경연구원(KEI) 행정관리시스템(ERP) 전체 기능 정리",
        "warn": "> [!warning] 자동 분석 자료(메뉴 수집) — 화면ID·기능 표기. 실제 화면과 다를 수 있어 검수 후 `검수상태: 검수완료`로.",
    },
    # ⚠ 아래 단일 파일용 항목(eas/external/webdisk)은 전사 번들(--bundle)이 커버함을 확인
    #   (전자결재=그룹웨어 모듈, 대외활동=PMS 모듈, 웹디스크=번들 시스템). 개별 심화 문서가 오면 사용.
    "eas": {
        "name": "전자결재", "prefix": "전자결재 시스템", "cat": "그룹웨어",
        "tags": ["전자결재", "결재", "기안", "시스템"], "overview": "전자결재 시스템 개요",
        "strip_h1": "", "warn": WARN_DEFAULT,
    },
    "external": {
        "name": "대외업무", "prefix": "대외업무 시스템", "cat": "대외업무시스템",
        "tags": ["대외업무", "시스템"], "overview": "대외업무 시스템 개요",
        "strip_h1": "", "warn": WARN_DEFAULT,
    },
    "webdisk": {
        "name": "웹디스크", "prefix": "웹디스크", "cat": "웹디스크",
        "tags": ["웹디스크", "문서", "시스템"], "overview": "웹디스크 개요",
        "strip_h1": "", "warn": WARN_DEFAULT,
    },
}

# ── 번들 모드: `## N. 시스템` 헤딩의 키워드 → 시스템 설정. 미등록 시스템은 이름 그대로 단일 노트. ──
BUNDLE_SYSTEMS = [
    # (감지 키워드, name(노트 제목·접두), cat(분류=둘러보기 필터), tags)
    ("통합정보시스템", "통합정보시스템(EIP)", "통합포털(EIP)", ["EIP", "포털", "시스템"]),
    ("연구관리시스템", "연구관리시스템(PMS)", "연구관리(PMS)", ["PMS", "연구관리", "시스템"]),
    ("웹메일", "웹메일", "웹메일", ["웹메일", "메일", "시스템"]),
    ("그룹웨어", "그룹웨어", "그룹웨어", ["그룹웨어", "전자결재", "시스템"]),
    ("InternetDisk", "웹디스크(InternetDisk)", "웹디스크", ["웹디스크", "문서", "시스템"]),
    ("전자도서관", "전자도서관", "전자도서관", ["도서관", "학술", "시스템"]),
]
BUNDLE_HUB = "사내 시스템 개요"           # 문서 머리말 → 전사 허브 노트(그래프 허브)
MODULE_ALIAS = {"PIMS": "PIMS(자원예약)"}  # 모듈명 정리(괄호 잘림 보정)


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


def promote_features(body):
    """PMS식 구조를 ERP식으로 승격(내용 불변, 헤딩 레벨만):
    - `#### ▎서브그룹` → `### ▎서브그룹` (02 chunk_guide가 [서브그룹] 맥락 prefix로 처리)
    - 독립줄 `**기능명**` 바로 아래에 `- 화면ID`가 오면 → `#### 기능명` (기능 단위 청킹)"""
    lines = body.split("\n")
    out = []
    for idx, ln in enumerate(lines):
        s = ln.strip()
        if re.match(r"^####\s*▎", s):
            out.append(re.sub(r"^(\s*)####", r"\1###", ln))
            continue
        m = re.match(r"^\*\*(.+)\*\*$", s)
        if m:
            nxt = ""
            for j in range(idx + 1, min(idx + 3, len(lines))):
                if lines[j].strip():
                    nxt = lines[j].strip()
                    break
            if nxt.startswith("- 화면ID"):
                out.append(f"#### {m.group(1).strip()}")
                continue
        out.append(ln)
    return "\n".join(out)


def _bundle_conf(heading_name):
    for kw, name, cat, tags in BUNDLE_SYSTEMS:
        if kw.lower() in heading_name.lower():
            return {"name": name, "cat": cat, "tags": tags, "warn": WARN_DEFAULT}
    clean = heading_name.split(" (")[0].strip()  # 미등록: 이름 그대로 단일 노트
    return {"name": clean, "cat": clean, "tags": [clean, "시스템"], "warn": WARN_DEFAULT}


def convert_bundle(text):
    """전사 번들 → [(제목, 본문, conf)] 리스트. 허브 1 + 시스템별(단일 노트 | 개요+모듈 노트)."""
    parts = re.split(r"(?m)^(##\s+\d+\.\s*.+)$", text)
    intro = parts[0].strip()
    systems = []  # (heading_name, body)
    i = 1
    while i < len(parts):
        name = re.sub(r"^##\s+\d+\.\s*", "", parts[i].strip())
        body = (parts[i + 1] if i + 1 < len(parts) else "").strip()
        systems.append((name, body))
        i += 2

    notes = []          # (title, body, conf)
    hub_links = []
    for heading_name, body in systems:
        conf = _bundle_conf(heading_name)
        name = conf["name"]
        body = promote_features(body)
        # 번호 모듈(### N.M 모듈) 분할 — 있으면 개요+모듈 노트, 없으면 시스템=노트 1개
        mparts = re.split(r"(?m)^(###\s+\d+\.\d+\s*.+)$", body)
        pre = mparts[0].strip()
        modules = []
        j = 1
        while j < len(mparts):
            mname = re.sub(r"^###\s+\d+\.\d+\s*", "", mparts[j].strip())
            mname = mname.split(" (")[0].strip()
            mname = MODULE_ALIAS.get(mname, mname).replace("/", "·")  # '/'는 파일경로 구분자 — 제목에서 치환
            mbody = (mparts[j + 1] if j + 1 < len(mparts) else "").strip()
            modules.append((mname, mbody))
            j += 2
        if modules:
            mod_titles = [f"{name} · {mn}" for mn, _ in modules]
            toc = "\n".join(f"- [[{t}]]" for t in mod_titles)
            over_body = (pre + f"\n\n## 모듈 노트\n\n{toc}").strip()
            over_title = f"{name} 개요"
            notes.append((over_title, over_body, conf))
            hub_links.append(over_title)
            for (mn, mb), t in zip(modules, mod_titles):
                notes.append((t, mb, conf))
        else:
            notes.append((name, body, conf))
            hub_links.append(name)
    # 전사 허브 노트(머리말 + 시스템 링크) — 그래프 허브·둘러보기 진입점
    hub_conf = {"name": "사내 시스템", "cat": "사내시스템(전사)", "tags": ["시스템", "포털"], "warn": WARN_DEFAULT}
    hub_body = (intro + "\n\n## 시스템\n\n" + "\n".join(f"- [[{t}]]" for t in hub_links)).strip()
    hub_body += "\n\n> 행정관리시스템(ERP)은 [[ERP 시스템 개요]] 참조."
    notes.insert(0, (BUNDLE_HUB, hub_body, hub_conf))
    return notes


def main():
    ap = argparse.ArgumentParser(description="사내 시스템 기능 문서 → 모듈별 시스템 노트(ERP 방식 일반화)")
    ap.add_argument("--system", help="SYSTEMS 레지스트리 키(예: eas, external, webdisk, erp)")
    ap.add_argument("--bundle", action="store_true", help="전사 번들 문서(## N.=시스템) 모드")
    ap.add_argument("--src")
    ap.add_argument("--vault")
    ap.add_argument("--list", action="store_true", help="등록된 시스템 목록")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.list:
        print("등록된 시스템(--system 값):")
        for k, v in SYSTEMS.items():
            print(f"  {k:<10} → {v['prefix']:<16} (분류 {v['cat']})")
        print("번들(--bundle) 시스템:")
        for kw, name, cat, _ in BUNDLE_SYSTEMS:
            print(f"  {kw:<14} → {name:<22} (분류 {cat})")
        return
    if not (args.src and args.vault) or (not args.bundle and not args.system):
        ap.error("--src, --vault 필수 + (--system <key> 또는 --bundle)")

    src = Path(args.src)
    out_root = Path(args.vault) / "40_시스템"
    text = src.read_text(encoding="utf-8")
    original = src.name

    if args.bundle:
        triples = convert_bundle(text)          # (title, body, conf)
        label = "번들"
    else:
        if args.system not in SYSTEMS:
            ap.error(f"미등록 시스템 '{args.system}'. --list로 확인하거나 SYSTEMS에 등록하세요.")
        sysconf = SYSTEMS[args.system]
        triples = [(t, b, sysconf) for t, b in convert(text, sysconf)]
        label = sysconf["name"]

    existing = {md.stem for md in Path(args.vault).rglob("*.md")}
    written = []
    for title, body, conf in triples:
        slug, n = title, 1
        while slug in existing:
            n += 1
            slug = f"{title}_{n}"
        existing.add(slug)
        dest = out_root / f"{slug}.md"
        nfeat = len(re.findall(r"(?m)^####\s", body))
        written.append((title, conf["cat"], dest, nfeat))
        if not args.dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(note(title, body, original, conf), encoding="utf-8")

    print(f"{'(dry-run) ' if args.dry_run else ''}[{label}] 생성 {len(written)}개 노트 → {out_root}")
    print(f"{'제목':<34}{'분류':<16}{'기능(####)':>8}")
    for title, cat, dest, nfeat in written:
        print(f"{title:<34}{cat:<16}{nfeat:>8}")
    print(f"총 기능(####): {sum(n for _, _, _, n in written)}개")
    if not args.dry_run:
        nxt = "--system all" if args.bundle else f"--system {args.system}"
        print(f"\n다음: python 01e_system_crosslink.py --vault {args.vault} {nxt}  → 규정 교차링크")


if __name__ == "__main__":
    main()
