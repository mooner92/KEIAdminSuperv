#!/usr/bin/env python3
"""
01e_system_crosslink.py — 시스템 노트 ↔ 관련 규정 교차링크 (ERP 01e 일반화, 그래프 엣지)

01e_erp_crosslink.py를 다중 시스템으로 일반화. 시스템 기능 설명은 규정명을 직접 인용하지 않아
autolink로는 고립되므로, **노트의 분류(frontmatter)** 별 도메인 키워드로 20_규정원문에서
관련 규정을 찾아 `## 관련 규정` 섹션을 주입한다(멱등, `<!-- system-crosslink -->` 마커).

- `--system all` = 40_시스템 전체(분류→키워드맵 등록된 노트만) / `--system <분류>` = 해당 분류만.
- 키워드: 분류 안에서 모듈명(제목 '· 뒤') 키 우선 → `_default` 폴백. 미등록 분류는 건너뜀.
- ⛔ 본문(기능 설명) 불변, '관련 규정' 보조 섹션만. 검수상태 불변(미검수).

순서: 01d_system(생성) → 01e_system(교차링크) → 01b(나머지 autolink) → 02(임베딩)
실행:  python 01e_system_crosslink.py --vault KEI-행정가이드 --system all
"""
import argparse
import re
from pathlib import Path

MARKER = "<!-- system-crosslink -->"
OLD_MARKERS = ("<!-- system-crosslink -->", "<!-- erp-crosslink -->")  # 마이그레이션 안전(둘 다 제거 후 재주입)
MAX_LINKS = 8

# 분류(frontmatter) → 키워드 맵. `_default`=시스템 공통, 그 외 키=모듈명(제목 '· 뒤', 정밀).
# 키워드는 규정명(20_규정원문)에 포함될 문자열.
SYSTEM_KEYWORDS = {
    "대외업무(NAMS)": {
        "_default": ["문서관리", "위임전결", "기록물", "보안관리"],
        "국정감사": ["내부감사", "감사"],
        "시정·처리사항": ["내부감사"],
        "정보공개": ["문서관리", "보안관리"],
        "마이페이지": ["위임전결"],
    },
    "행정관리(ERP)": {  # 기존 ERP(01e_erp_crosslink와 동일 맵 — 이 스크립트로 일원화)
        "_default": ["규정관리", "위임전결", "직제"],
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
        # ERP 상세가이드(심화, G-ProOne 지침서) 모듈 — 화면 신청법 중심이라 실무 규정 위주
        "회계(ACT)": ["회계", "법인카드", "지출", "증빙", "세입", "결산"],
        "자산(ASS)": ["자산", "물품", "비품", "재물"],
        "예산(BDG)": ["예산", "자금"],
        "일반·총무(GEN)": ["여비", "출장", "휴가", "복무", "유연근무", "차량", "복리후생", "명함", "총무"],
        "인사(HRM)": ["인사", "가족수당", "교육훈련", "원외겸직", "연장근로", "근로시간", "규정관리"],
        "공통 패턴": ["여비", "복무", "문서관리"],
    },
    "연구관리(PMS)": {
        "_default": ["연구사업관리", "연구윤리"],
        "과제선정": ["연구사업", "수탁", "위탁"],
        "과제계약": ["위탁", "수탁", "계약"],
        "과제관리": ["연구사업", "자문", "전문가"],
        "성과물관리": ["출판", "발간", "감수", "홍보", "학술지"],
        "연구윤리·특허": ["연구윤리", "지식재산", "특허", "직무발명"],
        "연구실적": ["직원평가", "평가", "성과"],
        "전문가 Pool": ["전문가", "자문"],
        "행사·대외협력": ["행사", "의전", "대외활동", "초청"],
        "원내외활동": ["대외활동", "원외겸직", "연구연수", "학술", "여비"],
    },
    "그룹웨어": {
        "_default": ["문서관리", "위임전결", "기록물"],
        "전자결재": ["문서관리", "위임전결", "제규정", "보안관리"],
        "문서수발": ["문서관리", "기록물"],
        "기록물": ["기록물"],
        "PIMS(자원예약)": ["물품", "자산", "정보보안"],
        "게시판": [],  # 대응 규정 없음 — 링크 생략
    },
    "전자결재(기안)": {  # ERP [결재상신] 시 마주치는 G-ProOne 기안 레이어 — 전결·문서·기록물·감사 계열
        "_default": ["위임전결", "전결", "문서관리", "기록물", "내부감사", "보안관리"],
        "결재상신 공통": ["위임전결", "전결", "문서관리", "기록물", "내부감사"],
        "업무별 적용": ["여비", "복무", "회계", "예산", "구매", "원외겸직"],
    },
    "웹메일": {"_default": ["정보보안", "보안관리", "전산"]},
    "웹디스크": {"_default": ["문서관리", "보안관리", "전산", "기록물"]},
    "전자도서관": {"_default": ["도서", "출판", "학술지", "자료"]},
    "통합포털(EIP)": {"_default": ["전산", "정보보안"]},
    "사내시스템(전사)": {"_default": []},  # 허브 — 시스템 링크만으로 충분(규정 링크 생략)
}


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
    ap = argparse.ArgumentParser(description="시스템 노트 ↔ 관련 규정 교차링크(01e 일반화, 분류 기반)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--system", required=True, help="'all' 또는 분류명(예: '연구관리(PMS)')")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    vault = Path(args.vault)
    reg = build_registry(vault)
    sys_dir = vault / "40_시스템"
    total, rows, skipped = 0, [], []

    for md in sorted(sys_dir.glob("*.md")):
        meta, fm, body = split_fm(md.read_text(encoding="utf-8"))
        cat = (meta.get("분류") or "").strip()
        if args.system != "all" and cat != args.system:
            continue
        kwmap = SYSTEM_KEYWORDS.get(cat)
        if kwmap is None:
            skipped.append(f"{md.stem}(분류 '{cat}' 미등록)")
            continue
        title = meta.get("제목") or md.stem
        m = re.search(r"·\s*(.+)$", title)  # "<시스템> · <모듈>" → 모듈명
        module = m.group(1).strip() if m else ""
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
        new_body = body
        for mk in OLD_MARKERS:
            new_body = re.sub(rf"\n*{re.escape(mk)}.*?{re.escape(mk)}\n*", "\n", new_body, flags=re.S)
        if picked:
            links = "\n".join(f"- [[{stem}|{name}]]" for name, stem in picked)
            section = f"\n\n{MARKER}\n## 관련 규정\n\n{links}\n{MARKER}\n"
            wm = re.search(r"(> \[!warning\][^\n]*\n)", new_body)
            new_body = (new_body[: wm.end()] + section + new_body[wm.end():]) if wm else (new_body.rstrip() + section)
        rows.append((cat, module or "(단일/개요)", len(picked), ", ".join(n for n, _ in picked[:3])))
        total += len(picked)
        if not args.dry_run and new_body != body:
            md.write_text(fm + new_body, encoding="utf-8")

    print(f"{'(dry-run) ' if args.dry_run else ''}[{args.system}] 규정 레지스트리 {len(reg)}건 · 시스템 노트 교차링크")
    cur = None
    for cat, module, n, sample in rows:
        if cat != cur:
            print(f" ▎{cat}")
            cur = cat
        print(f"    {module:<16} {n:>2}건  {sample}")
    print(f"총 교차링크 {total}개")
    if skipped:
        print("건너뜀(분류 미등록):", ", ".join(skipped))


if __name__ == "__main__":
    main()
