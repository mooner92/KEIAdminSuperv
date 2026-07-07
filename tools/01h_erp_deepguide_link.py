#!/usr/bin/env python3
"""
01h_erp_deepguide_link.py — 기존 ERP 메뉴 노트 ↔ ERP 상세가이드(심화) 교차 보강

기존 'ERP 시스템 · <모듈>'(메뉴 지도, 화면ID+한줄 기능)과 신규 'ERP 상세가이드 · <모듈>'
(화면별 신청 방법 상세)를 **공유 화면ID**로 양방향 연결한다:
  ① 메뉴 노트에 `## 상세 신청 가이드` 섹션 — 어떤 화면의 상세 가이드가 있는지 + [[링크]]
  ② 상세가이드 노트에 `## 관련 메뉴 노트` 섹션 — 이 화면들이 속한 메뉴 지도 [[링크]]
  ③ 커버리지 리포트(출력) — 상세가이드가 신규로 커버한 화면 / 아직 미보강인 메뉴 화면

- 멱등: `<!-- deepguide-link -->` 마커 블록 교체. ⛔ 본문 불변, 보조 섹션만. 검수상태 불변.
순서: 01d --deep-guide(적재) → 01h(본 스크립트) → 02(재임베딩)
실행:  python 01h_erp_deepguide_link.py --vault KEI-행정가이드 [--dry-run]
"""
import argparse
import re
from pathlib import Path

MARKER = "<!-- deepguide-link -->"
ID_RE = re.compile(r"`([a-z]{3}_\w{3,}[MPL]?)`")   # `gen_0020M` 등 백틱 화면ID
MENU_PREFIX = "ERP 시스템 · "
DEEP_PREFIX = "ERP 상세가이드 · "
DEEP_OVERVIEW = "ERP 상세가이드 개요"


def split_fm(text):
    if text.startswith("---"):
        _, fm, body = text.split("---", 2)
        return "---" + fm + "---", body
    return "", text


def inject(body: str, section: str) -> str:
    """마커 블록 교체(멱등). 경고 콜아웃 뒤(없으면 끝)에 삽입."""
    body = re.sub(rf"\n*{re.escape(MARKER)}.*?{re.escape(MARKER)}\n*", "\n", body, flags=re.S)
    block = f"\n\n{MARKER}\n{section}\n{MARKER}\n"
    wm = re.search(r"(> \[!warning\][^\n]*\n)", body)
    return (body[: wm.end()] + block + body[wm.end():]) if wm else (body.rstrip() + block)


def main():
    ap = argparse.ArgumentParser(description="ERP 메뉴 노트 ↔ 상세가이드 화면ID 교차 보강")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sys_dir = Path(args.vault) / "40_시스템"
    menu_notes, deep_notes, screen_names = {}, {}, {}

    for md in sorted(sys_dir.glob("*.md")):
        stem = md.stem
        text = md.read_text(encoding="utf-8")
        ids = set(ID_RE.findall(text))
        if stem.startswith(MENU_PREFIX):
            menu_notes[stem] = (md, ids)
        elif stem.startswith(DEEP_PREFIX) and "개요" not in stem:
            deep_notes[stem] = (md, ids)
        elif stem == DEEP_OVERVIEW:
            # 개요 매핑표에서 화면ID→화면명 사전(| n | pdf | `id` | 이름 | ...)
            for m in re.finditer(r"\|\s*\d+\s*\|[^|]*\|\s*`(\w+)`\s*\|\s*([^|]+)\|", text):
                screen_names[m.group(1)] = m.group(2).strip()

    all_deep_ids = set().union(*(ids for _, ids in deep_notes.values())) if deep_notes else set()
    all_menu_ids = set().union(*(ids for _, ids in menu_notes.values())) if menu_notes else set()

    # ① 메뉴 노트 → 상세가이드 링크
    changed = 0
    for stem, (md, ids) in menu_notes.items():
        rows = []
        for dstem, (_, dids) in sorted(deep_notes.items()):
            hit = sorted(ids & dids)
            if not hit:
                continue
            named = ", ".join(f"`{i}`" + (f"({screen_names[i]})" if i in screen_names else "") for i in hit[:6])
            more = f" 외 {len(hit)-6}개" if len(hit) > 6 else ""
            rows.append(f"- [[{dstem}|{dstem}]] — {named}{more}")
        if not rows:
            continue
        section = ("## 상세 신청 가이드\n\n"
                   "아래 화면은 신청 방법 상세(필수입력·팝업·버튼)가 별도 가이드로 정리되어 있다:\n\n"
                   + "\n".join(rows))
        fm, body = split_fm(md.read_text(encoding="utf-8"))
        new = fm + inject(body, section)
        changed += 1
        if not args.dry_run:
            md.write_text(new, encoding="utf-8")

    # ② 상세가이드 노트 → 메뉴 노트 링크
    for dstem, (md, dids) in deep_notes.items():
        rows = []
        for mstem, (_, mids) in sorted(menu_notes.items()):
            n = len(dids & mids)
            if n:
                rows.append(f"- [[{mstem}|{mstem}]] — 화면 {n}개")
        if not rows:
            continue
        section = "## 관련 메뉴 노트\n\n이 화면들이 속한 ERP 메뉴 지도:\n\n" + "\n".join(rows)
        fm, body = split_fm(md.read_text(encoding="utf-8"))
        new = fm + inject(body, section)
        changed += 1
        if not args.dry_run:
            md.write_text(new, encoding="utf-8")

    # ③ 커버리지 리포트
    new_cover = sorted(all_deep_ids - all_menu_ids)
    unbacked = sorted(all_menu_ids - all_deep_ids)
    print(f"{'(dry-run) ' if args.dry_run else ''}교차 보강: 노트 {changed}개 갱신")
    print(f"메뉴 화면ID {len(all_menu_ids)} · 상세가이드 화면ID {len(all_deep_ids)} · 겹침 {len(all_menu_ids & all_deep_ids)}")
    print(f"\n▎상세가이드가 신규 커버(메뉴 노트에 없던 화면) {len(new_cover)}개:")
    for i in new_cover:
        print(f"   {i}" + (f"  {screen_names[i]}" if i in screen_names else ""))
    print(f"\n▎아직 상세가이드 없는 메뉴 화면(다음 수집 후보) {len(unbacked)}개:")
    for i in unbacked[:20]:
        print(f"   {i}")
    if len(unbacked) > 20:
        print(f"   … 외 {len(unbacked)-20}개")


if __name__ == "__main__":
    main()
