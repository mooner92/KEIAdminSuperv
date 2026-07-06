#!/usr/bin/env python3
"""
01e_system_crosslink.py — 시스템 노트 ↔ 관련 규정 교차링크 (ERP 01e 일반화, 그래프 엣지)

01e_erp_crosslink.py를 다중 시스템으로 일반화. 시스템 기능 설명은 규정명을 직접 인용하지 않아
autolink로는 고립되므로, 시스템별 도메인 키워드로 20_규정원문에서 관련 규정을 찾아
각 시스템 노트에 `## 관련 규정` 섹션을 주입한다(멱등, `<!-- system-crosslink -->` 마커).

- `--system <key>`로 해당 시스템 노트만 처리 → ERP 등 다른 시스템 노트 불변.
- 시스템별 키워드: 모듈별 정밀 맵(데이터 확인 후 채움) → 없으면 `_default`(시스템 공통) 폴백.
- ⛔ 본문(기능 설명) 불변, '관련 규정' 보조 섹션만. 검수상태 불변(미검수).

순서: 01d_system(생성) → 01e_system(교차링크) → 01b(나머지 autolink) → 02(임베딩)
실행:  python 01e_system_crosslink.py --vault KEI-행정가이드 --system eas
"""
import argparse
import re
from pathlib import Path

MARKER = "<!-- system-crosslink -->"
OLD_MARKERS = ("<!-- system-crosslink -->", "<!-- erp-crosslink -->")  # 마이그레이션 안전(둘 다 제거 후 재주입)
MAX_LINKS = 8

# 시스템 분류 → 키워드 맵. `_default`=시스템 공통, 그 외 키=모듈명(정밀). 데이터 확인 후 모듈 키를 채워 정밀도↑.
SYSTEM_KEYWORDS = {
    "ERP시스템": {  # 참고: ERP는 01e_erp_crosslink.py가 이미 처리(여기선 --system erp로만 재실행 가능)
        "_default": ["규정", "지침", "기준"],
        "인사관리": ["인사", "채용", "임용", "직원평가", "교육훈련", "교육", "승진", "전직", "겸직", "인사위", "임시직", "비정규직", "정원"],
        "복무관리": ["복무", "여비", "유연근무", "출장", "휴가", "휴직", "당직", "근로시간"],
        "총무관리": ["총무", "차량", "복리후생", "가족수당", "콘도", "명함", "서무", "후생"],
        "급여관리": ["보수", "급여", "임금", "수당", "연봉", "퇴직금"],
        "예산관리": ["예산", "재무", "자금"],
        "회계관리": ["회계", "법인카드", "계약", "결산", "증빙", "지출", "세입"],
        "구매관리": ["구매", "계약", "물품", "용역", "조달"],
        "자산관리": ["자산", "물품", "비품", "재물", "재산"],
        "평가관리": ["평가", "성과", "직원평가", "감수"],
        "경영지원": ["규정관리", "위임전결", "이사회", "직제", "정관", "인권경영", "제규정"],
        "경영자정보": ["이사회", "위임전결", "직제", "정관"],
    },
    "전자결재시스템": {  # 전자결재/기안 — 문서·전결·규정관리 계열
        "_default": ["문서관리", "위임전결", "전결", "제규정관리", "규정관리", "보안", "기록물", "공문"],
    },
    "대외업무시스템": {  # 대외활동·홍보·정보공개 계열
        "_default": ["대외활동", "원외겸직", "홍보", "출판", "정보공개", "언론", "초청", "행사", "의전"],
    },
    "웹디스크시스템": {  # 문서 저장·공유·보안 계열
        "_default": ["문서관리", "보안", "기록물", "정보보안", "전산", "자료"],
    },
}

# --system 값 → 분류(01d_system_to_md.SYSTEMS와 동기화)
SYSTEM_CAT = {"erp": "ERP시스템", "eas": "전자결재시스템", "external": "대외업무시스템", "webdisk": "웹디스크시스템"}


def split_fm(text):
    if text.startswith("---"):
        _, fm, body = text.split("---", 2)
        meta = {}
        for ln in fm.strip().splitlines():
            if ":" in ln:
                k, v = ln.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
        return meta, "---" + fm + "---", body
    return {}, "", text


def build_registry(vault):
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


def main():
    ap = argparse.ArgumentParser(description="시스템 노트 ↔ 관련 규정 교차링크(01e 일반화)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--system", required=True, help="erp | eas | external | webdisk")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cat = SYSTEM_CAT.get(args.system)
    kwmap = SYSTEM_KEYWORDS.get(cat)
    if not kwmap:
        ap.error(f"'{args.system}'(분류 {cat})의 키워드 맵이 없습니다. SYSTEM_KEYWORDS에 등록하세요.")

    vault = Path(args.vault)
    reg = build_registry(vault)
    sys_dir = vault / "40_시스템"
    total, rows = 0, []

    for md in sorted(sys_dir.glob("*.md")):
        meta, fm, body = split_fm(md.read_text(encoding="utf-8"))
        if (meta.get("분류") or "") != cat:  # 이 시스템 노트만 처리(다른 시스템 불변)
            continue
        title = meta.get("제목") or md.stem
        m = re.search(r"·\s*(\S+)", title)  # "· 모듈" → 모듈명
        module = m.group(1) if m else ""
        kws = kwmap.get(module, kwmap.get("_default", []))

        matched = [(name, stem) for name, stem in reg.items() if any(k in name for k in kws)]
        matched.sort(key=lambda x: -len(x[0]))
        seen, picked = set(), []
        for name, stem in matched:
            if stem in seen:
                continue
            seen.add(stem)
            picked.append((name, stem))
            if len(picked) >= MAX_LINKS:
                break

        # 기존 마커 블록 제거(멱등 · erp/system 둘 다)
        for mk in OLD_MARKERS:
            body = re.sub(rf"\n*{re.escape(mk)}.*?{re.escape(mk)}\n*", "\n", body, flags=re.S)
        if picked:
            links = "\n".join(f"- [[{stem}|{name}]]" for name, stem in picked)
            section = f"\n\n{MARKER}\n## 관련 규정\n\n{links}\n{MARKER}\n"
            wm = re.search(r"(> \[!warning\][^\n]*\n)", body)
            body = (body[: wm.end()] + section + body[wm.end():]) if wm else (body.rstrip() + section)
        rows.append((module or "(개요)", len(picked), ", ".join(n for n, _ in picked[:4])))
        total += len(picked)
        if not args.dry_run and picked:
            md.write_text(fm + body, encoding="utf-8")

    print(f"{'(dry-run) ' if args.dry_run else ''}[{args.system}] 레지스트리 {len(reg)}건 · {cat} 노트 교차링크")
    for module, n, sample in rows:
        print(f"  {module:<12} {n:>2}건  {sample}")
    print(f"총 교차링크 {total}개")
    if not rows:
        print(f"  ⚠ {cat} 노트가 없습니다 — 먼저 01d_system_to_md.py --system {args.system} 실행")


if __name__ == "__main__":
    main()
