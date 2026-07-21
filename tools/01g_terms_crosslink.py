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


def build_sysmap_by_cat(vault):
    """용어 '분류' → 대표 시스템 노트 (stem, 표시명). 용어 분류는 두 형태다:
      ⓐ 모듈명(ERP 용어: '복무관리'·'회계관리') → 그 모듈 노트('ERP 시스템 · 복무관리')  ← 세밀
      ⓑ 시스템 분류(PMS 용어: '연구관리(PMS)') → 그 시스템 '개요' 노트                  ← 시스템 단위
    그래서 노트마다 **모듈명 키와 분류 키를 둘 다** 등록한다(ERP·PMS·대외 공통). 충돌 시 세밀 우선.
    """
    mod, cat_over, cat_any = {}, {}, {}
    for md in (vault / "40_시스템").rglob("*.md"):
        if md.name == "README.md":
            continue
        meta, _, _ = split_fm(md.read_text(encoding="utf-8"))
        if meta.get("type") != "system":
            continue
        cat = (meta.get("분류") or "").strip()
        name = (meta.get("제목") or md.stem).strip()
        m = re.search(r"·\s*(.+)$", name)  # 'ERP 시스템 · 복무관리' → '복무관리'
        if m:
            mod.setdefault(m.group(1).strip(), (md.stem, name))
        if cat:
            cat_any.setdefault(cat, (md.stem, name))
            if "개요" in name:
                cat_over.setdefault(cat, (md.stem, name))
    out = {c: cat_over.get(c) or cat_any.get(c) for c in set(cat_over) | set(cat_any)}
    out.update(mod)  # 모듈명(세밀)이 분류명과 겹치면 세밀 우선
    return out


def main():
    ap = argparse.ArgumentParser(description="용어 ↔ ERP모듈/규정 교차링크")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    vault = Path(args.vault)
    regs = build_registry(vault, "20_규정원문", "regulation")          # 규정명 → stem
    sysmap = build_sysmap_by_cat(vault)  # 용어 분류 → (시스템 대표 노트 stem, 표시명) — ERP·PMS·대외 공통

    total_sys, total_reg, n_notes = 0, 0, 0
    for md in sorted((vault / "30_용어집").rglob("*.md")):
        meta, fm, body = split_fm(md.read_text(encoding="utf-8"))
        if meta.get("type") != "term":
            continue
        term = (meta.get("용어") or md.stem).strip()
        cat = (meta.get("분류") or "").strip()
        links = []
        # ① 같은 분류의 시스템 대표 노트(ERP·PMS·대외업무 등) — 용어→시스템 연결
        sys = sysmap.get(cat)
        if sys:
            links.append((sys[0], sys[1]))
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
    print(f"  (규정 {len(regs)}건, 시스템 분류맵 {len(sysmap)}개: {', '.join(sorted(sysmap))})")


if __name__ == "__main__":
    main()
