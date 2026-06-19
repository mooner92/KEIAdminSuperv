#!/usr/bin/env python3
"""
01e_erp_crosslink.py — ERP 모듈 노트 ↔ 관련 규정 교차링크(그래프 엣지 생성)

ERP 기능 설명은 규정명을 직접 인용하지 않아 autolink로는 연결이 안 됨(고립 노드).
이 단계는 모듈별 도메인 키워드로 레지스트리(20_규정원문)에서 관련 규정을 찾아
각 ERP 모듈 노트에 `## 관련 규정` 섹션(`[[stem|규정명]]` 해석된 링크)을 주입한다.
→ 그래프에서 ERP 노드가 규정 클러스터에 연결됨.

- 멱등: `<!-- erp-crosslink -->` 마커 블록을 매번 교체.
- ⛔ 본문(기능 설명)은 건드리지 않음. '관련 규정' 보조 섹션만 추가. 검수상태 불변(미검수).

순서: 01d(생성) → 01e(교차링크) → 01b(나머지 autolink, 멱등) → 02(임베딩)
실행:  python 01e_erp_crosslink.py --vault KEI-행정가이드
"""
import argparse
import re
from pathlib import Path

MARKER = "<!-- erp-crosslink -->"

# 모듈 도메인 → 규정명에 포함될 키워드(레지스트리와 매칭)
MODULE_KEYWORDS = {
    "인사관리": ["인사", "채용", "임용", "직원평가", "교육훈련", "교육", "승진", "전직", "겸직", "인사위", "임시직", "비정규직", "정원"],
    "복무관리": ["복무", "여비", "유연근무", "출장", "휴가", "휴직", "당직", "근로시간", "유연"],
    "총무관리": ["총무", "차량", "복리후생", "가족수당", "콘도", "명함", "서무", "후생"],
    "급여관리": ["보수", "급여", "임금", "수당", "연봉", "퇴직금"],
    "예산관리": ["예산", "재무", "자금"],
    "회계관리": ["회계", "법인카드", "계약", "결산", "증빙", "지출", "세입"],
    "구매관리": ["구매", "계약", "물품", "용역", "조달"],
    "자산관리": ["자산", "물품", "비품", "재물", "재산"],
    "평가관리": ["평가", "성과", "직원평가", "감수"],
    "경영지원": ["규정관리", "위임전결", "이사회", "직제", "정관", "인권경영", "제규정"],
    "경영자정보": ["이사회", "위임전결", "직제", "정관"],
}
MAX_LINKS = 8  # 모듈당 과다 링크 방지


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
    ap = argparse.ArgumentParser(description="ERP 모듈 ↔ 관련 규정 교차링크")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    vault = Path(args.vault)
    reg = build_registry(vault)
    sys_dir = vault / "40_시스템"
    total = 0
    rows = []

    for md in sorted(sys_dir.glob("*.md")):
        meta, fm, body = split_fm(md.read_text(encoding="utf-8"))
        title = (meta.get("제목") or md.stem)
        m = re.search(r"·\s*(\S+)", title)  # "ERP 시스템 · 인사관리" → 인사관리
        module = m.group(1) if m else ""
        kws = MODULE_KEYWORDS.get(module)
        if not kws:
            continue
        # 관련 규정 매칭(이름에 키워드 포함). 긴 이름 우선, 중복 제거, 상한.
        matched = []
        for name, stem in reg.items():
            if any(k in name for k in kws):
                matched.append((name, stem))
        matched.sort(key=lambda x: -len(x[0]))
        seen, picked = set(), []
        for name, stem in matched:
            if stem in seen:
                continue
            seen.add(stem)
            picked.append((name, stem))
            if len(picked) >= MAX_LINKS:
                break

        # 기존 마커 블록 제거(멱등)
        body = re.sub(rf"\n*{re.escape(MARKER)}.*?{re.escape(MARKER)}\n*", "\n", body, flags=re.S)
        if picked:
            links = "\n".join(f"- [[{stem}|{name}]]" for name, stem in picked)
            section = f"\n\n{MARKER}\n## 관련 규정\n\n{links}\n{MARKER}\n"
            # 경고 콜아웃 다음에 삽입(없으면 본문 끝)
            wm = re.search(r"(> \[!warning\][^\n]*\n)", body)
            if wm:
                body = body[: wm.end()] + section + body[wm.end():]
            else:
                body = body.rstrip() + section
        rows.append((module, len(picked), ", ".join(n for n, _ in picked[:4])))
        total += len(picked)
        if not args.dry_run and picked:
            md.write_text(fm + body, encoding="utf-8")

    print(f"{'(dry-run) ' if args.dry_run else ''}레지스트리 {len(reg)}건 · ERP 모듈 교차링크")
    for module, n, sample in rows:
        print(f"  {module:<10} {n:>2}건  {sample}")
    print(f"총 교차링크 {total}개")


if __name__ == "__main__":
    main()
