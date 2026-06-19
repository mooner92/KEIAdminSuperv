#!/usr/bin/env python3
"""
01g_terms_crosslink.py — 용어 노트 ↔ ERP 모듈/관련 규정 교차링크(그래프 연결 강화)

용어는 ERP 화면에서 뽑은 개념이라 카테고리(복무관리 등)가 ERP 모듈과 일치한다.
각 용어 노트에 `## 관련` 섹션(`[[stem|이름]]`)을 주입:
  ① 같은 카테고리의 ERP 모듈 노트(항상) — 용어→시스템 연결(정확)
  ② 용어명이 규정명에 포함되는 규정(있으면, 최대 3) — 용어→규정 연결(특정)
→ 고립 주황 노드가 시스템·규정 클러스터에 연결됨. (01e와 동형)

멱등: `<!-- terms-crosslink -->` 마커 블록 교체. ⛔ 정의 본문 불변. 검수상태 불변.
순서: 01f(생성) → 01g(교차링크) → 01b(나머지 autolink) → 02(임베딩)
실행:  python 01g_terms_crosslink.py --vault KEI-행정가이드
"""
import argparse
import re
from pathlib import Path

MARKER = "<!-- terms-crosslink -->"
MAX_REGS = 3


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


def build_registry(vault, subdir, type_):
    reg = {}
    for md in (vault / subdir).rglob("*.md"):
        if md.name == "README.md":
            continue
        meta, _, _ = split_fm(md.read_text(encoding="utf-8"))
        if meta.get("type") == type_:
            name = (meta.get("규정명") or meta.get("제목") or "").strip()
            if name and name != "목차":
                reg.setdefault(name, md.stem)
    return reg


def main():
    ap = argparse.ArgumentParser(description="용어 ↔ ERP모듈/규정 교차링크")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    vault = Path(args.vault)
    regs = build_registry(vault, "20_규정원문", "regulation")          # 규정명 → stem
    sysnotes = build_registry(vault, "40_시스템", "system")            # 'ERP 시스템 · X' → stem
    # 카테고리 → ERP 모듈 stem
    sysmap, overview = {}, None
    for name, stem in sysnotes.items():
        m = re.search(r"·\s*(\S+)", name)
        if m:
            sysmap[m.group(1)] = stem
        elif "개요" in name:
            overview = stem

    total_sys, total_reg, n_notes = 0, 0, 0
    for md in sorted((vault / "30_용어집").rglob("*.md")):
        meta, fm, body = split_fm(md.read_text(encoding="utf-8"))
        if meta.get("type") != "term":
            continue
        term = (meta.get("용어") or md.stem).strip()
        cat = (meta.get("분류") or "").strip()
        links = []
        # ① ERP 모듈
        sys_stem = sysmap.get(cat) or overview
        if sys_stem:
            label = f"ERP 시스템 · {cat}" if cat in sysmap else "ERP 시스템 개요"
            links.append((sys_stem, label))
            total_sys += 1
        # ② 규정명에 용어가 포함되면(길이>=2), 짧은 규정명 우선 최대 3
        if len(term) >= 2:
            cand = sorted(((nm, st) for nm, st in regs.items() if term in nm), key=lambda x: len(x[0]))
            for nm, st in cand[:MAX_REGS]:
                links.append((st, nm))
                total_reg += 1

        body = re.sub(rf"\n*{re.escape(MARKER)}.*?{re.escape(MARKER)}\n*", "\n", body, flags=re.S)
        if links:
            seen, uniq = set(), []
            for st, nm in links:
                if st in seen:
                    continue
                seen.add(st)
                uniq.append(f"- [[{st}|{nm}]]")
            section = f"\n\n{MARKER}\n## 관련\n\n" + "\n".join(uniq) + f"\n{MARKER}\n"
            wm = re.search(r"(> \[!warning\][^\n]*\n)", body)
            body = (body[: wm.end()] + section + body[wm.end():]) if wm else (body.rstrip() + section)
            n_notes += 1
            if not args.dry_run:
                md.write_text(fm + body, encoding="utf-8")

    print(f"{'(dry-run) ' if args.dry_run else ''}용어 {n_notes}개에 교차링크 — ERP모듈 {total_sys} + 규정 {total_reg}")
    print(f"  (규정 {len(regs)}건, ERP 모듈맵 {len(sysmap)}개, 개요={'있음' if overview else '없음'})")


if __name__ == "__main__":
    main()
