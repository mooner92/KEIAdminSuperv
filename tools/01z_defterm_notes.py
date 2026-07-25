#!/usr/bin/env python3
"""01z_defterm_notes.py — defterms.json(01j) 정의어를 30_용어집/규정정의/ 노트로 물질화.

배경(2026-07-25, 사용자 요청): 규정 원문에서 "X란 …을 말한다"로 정의된 용어는 검색 라우팅
(specs/01 P3)엔 쓰이지만 파생 인덱스(tools/index/)에만 있어 둘러보기에서 사람이 못 봤다.
"우리 문서는 우리의 자산" — 정의어 전부를 다듬어진 용어 노트로 볼트에 적재해 둘러보기
용어집 섹션('규정정의' 분류)에서 탐색 가능하게 한다.

원칙:
  · **정의형(form='정의')만** 물질화 — 약칭("이하 '연구원'이라 한다")은 노트 가치 없음(노이즈).
  · 정의 본문은 defterms의 **원문 복사 그대로**(⛔절대규칙2 — 의역 금지), 출처는 [[stem#조|…]] 위키링크.
  · 충돌 용어(여러 규정이 서로 다르게 정의)는 정의 전부 병기 + ⚠ 안내.
  · 기존 노트: '검수상태: 검수완료'면 보존(사람 확정 존중), 자동생성 미검수만 갱신.
    다른 용어집 폴더와 이름이 겹치면 스킵(볼트 슬러그 충돌 방지 — CLAUDE.md 규약).
  · 재실행 안전(멱등) — 산출이 같으면 파일 mtime 불변(무변경 skip).

실행: python tools/01z_defterm_notes.py --vault KEI-행정가이드 [--dry]
이후: 02 재색인(신규 노트 검색 편입) + 웹 재빌드(둘러보기·용어 툴팁 반영).
"""
import argparse
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
MARKER = "01z_defterm_notes 자동 생성"


def safe_name(term: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', " ", term).strip()


def note_body(term: str, binds: list, conflict: bool) -> str:
    regs = sorted({b["규정명"] for b in binds})
    fm = [
        "---",
        "type: term",
        f'용어: "{term}"',
        '영문: ""',
        '분류: "규정정의"',
        "관련규정: [" + ", ".join(f'"{r}"' for r in regs) + "]",
        f'원본파일: "{MARKER} (01j defterms.json — 규정 원문 정의 조항 기계 추출)"',
        '태그: ["행정용어", "규정정의"]',
        "검수상태: 미검수",
        "색인제외: true",   # 둘러보기 전용(specs/02) — 원문 복사라 RAG 색인 시 진짜 근거를 밀어냄(실측)
        "---",
        "",
        f"# {term}",
        "",
    ]
    out = fm
    if conflict and len(binds) > 1:
        out.append(f"> [!warning] 정의 충돌 — 이 용어는 **{len(binds)}개 규정**에서 서로 다르게 정의됩니다. "
                   "업무가 속한 규정의 정의를 기준으로 판단하세요.")
        out.append("")
    for b in binds:
        stem = pathlib.Path(b.get("path", "")).stem
        jo = (b.get("조") or "").strip()
        link = f"[[{stem}#{jo}|{b['규정명']} {jo}]]" if stem and jo else f"[[{stem}|{b['규정명']}]]" if stem else b["규정명"]
        out.append(f"> [!quote] 규정 원문 — {link}")
        # 정의 원문 그대로(여러 줄이면 인용 블록 유지)
        for ln in (b.get("정의") or "").splitlines() or [""]:
            out.append(f"> {ln}".rstrip())
        out.append("")
    out.append("---")
    out.append("*이 노트는 규정 원문의 정의 조항에서 자동 추출되었습니다(검수 전 초안). "
               "최종 판단은 링크된 원문 조항을 확인하세요.*")
    return "\n".join(out) + "\n"


def hub_body(made_terms: list, terms: dict, conflicts: set) -> str:
    """'규정 용어 사전' 허브 — 한 화면에서 전체 정의어를 규정별로 훑고 개별 노트로 진입."""
    by_reg: dict = {}
    for t in made_terms:
        for b in terms[t]:
            if b.get("form") != "정의":
                continue
            by_reg.setdefault(b["규정명"], set()).add(t)
    lines = [
        "---",
        "type: term",
        '용어: "규정 용어 사전"',
        '영문: ""',
        '분류: "규정정의"',
        "관련규정: []",
        f'원본파일: "{MARKER} (허브 — 규정 원문 정의 조항 색인)"',
        '태그: ["행정용어", "규정정의", "색인"]',
        "검수상태: 미검수",
        "색인제외: true",   # 둘러보기 전용(specs/02) — 색인 허브라 RAG 근거로는 무의미
        "---",
        "",
        "# 규정 용어 사전",
        "",
        f"규정 원문에서 **\"○○란 …을 말한다\"** 형태로 정의된 용어 **{len(made_terms)}개**를 "
        "규정별로 모았습니다. 용어를 누르면 정의 원문과 출처 조항으로 갑니다.",
        "",
        "> [!note] 이 사전은 규정 원문의 정의 조항을 기계로 추출한 **검수 전 초안**입니다. "
        "최종 판단은 각 노트에 링크된 원문 조항을 확인하세요.",
        "",
    ]
    conf_here = sorted(t for t in made_terms if t in conflicts)
    if conf_here:
        lines += ["## ⚠ 규정마다 다르게 정의된 용어", "",
                  "같은 낱말이라도 **어느 규정을 적용하느냐에 따라 뜻이 다릅니다.** 업무가 속한 규정의 정의를 보세요.",
                  ""]
        lines += [f"- [[{safe_name(t)}|{t}]]" for t in conf_here]
        lines.append("")
    lines += ["## 규정별 정의 용어", ""]
    for reg in sorted(by_reg):
        ts = sorted(by_reg[reg])
        lines.append(f"### {reg} ({len(ts)})")
        lines.append(" · ".join(f"[[{safe_name(t)}|{t}]]" for t in ts))
        lines.append("")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", default="KEI-행정가이드")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    vault = pathlib.Path(args.vault)
    outdir = vault / "30_용어집" / "규정정의"
    outdir.mkdir(parents=True, exist_ok=True)

    d = json.loads((HERE / "index" / "defterms.json").read_text(encoding="utf-8"))
    terms = d["terms"]
    conflicts = {(c.get("term") if isinstance(c, dict) else c) for c in d.get("conflicts", [])}

    # 다른 용어집 폴더의 기존 노트명(슬러그 충돌 방지)
    other = {p.stem for p in (vault / "30_용어집").rglob("*.md")} - {p.stem for p in outdir.glob("*.md")}

    made = updated = kept = skipped = 0
    materialized: list = []
    for term, binds in sorted(terms.items()):
        full = [b for b in binds if b.get("form") == "정의" and (b.get("정의") or "").strip()]
        if not full:
            continue  # 약칭만 있는 용어 — 물질화 제외
        name = safe_name(term)
        if not name or name in other:
            skipped += 1
            continue
        f = outdir / f"{name}.md"
        materialized.append(term)
        if f.exists():
            cur = f.read_text(encoding="utf-8")
            if "검수상태: 검수완료" in cur:
                kept += 1
                continue  # 사람 확정 노트 보존
        body = note_body(term, full[:4], term in conflicts)
        if f.exists():
            if f.read_text(encoding="utf-8") == body:
                kept += 1
                continue
            if not args.dry:
                f.write_text(body, encoding="utf-8")
            updated += 1
        else:
            if not args.dry:
                f.write_text(body, encoding="utf-8")
            made += 1

    # 허브 노트(사전 색인) — 개별 노트 뒤에 생성
    hub = outdir / "규정 용어 사전.md"
    hb = hub_body(materialized, terms, conflicts)
    if not args.dry and (not hub.exists() or hub.read_text(encoding="utf-8") != hb):
        hub.write_text(hb, encoding="utf-8")
    print(f"허브: {hub.name} ({len(materialized)}용어 색인)")

    print(f"{'[dry] ' if args.dry else ''}신규 {made} · 갱신 {updated} · 보존/무변경 {kept} · 충돌스킵 {skipped}"
          f" → {outdir} (총 {len(list(outdir.glob('*.md')))}노트)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
