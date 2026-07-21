#!/usr/bin/env python3
"""01w_pms_terms_to_md.py — PMS 시스템 용어 선별 정의 → 용어 노트(30_용어집/연구관리(PMS)/)

01f_terms_to_md.py의 PMS판. 01f는 경고문이 ERP 전용이고 KEI_admin_terms.md 형식을 받으므로,
PMS 용어(시스템 용법 정의)는 이 스크립트로 별도 적재한다.

입력: pms_raw/PMS_용어_정의.md  — `**용어**` + 다음 줄들이 정의. (머리말 `>` 인용은 건너뜀)
출력: 30_용어집/연구관리(PMS)/<용어>.md  (type:term, 분류: 연구관리(PMS), 검수상태 미검수)
⛔ 정의는 시스템 용법(원문 근거) — 규정 수치·법적 정의 단정 금지. 「TODO: 원문 확인」 보존.

실행: python 01w_pms_terms_to_md.py --src ../pms_raw/PMS_용어_정의.md --vault ../KEI-행정가이드 [--dry-run]
"""
import argparse
import re
import unicodedata
from pathlib import Path

CAT = "연구관리(PMS)"
WARN = ("> [!warning] 자동 작성 초안(PMS 화면·도움말 기반 시스템 용법) — 규정상 정의와 다를 수 있어 "
        "공식 규정집과 함께 검수. 금액·요건 등은 원문 확인 필요.")
FS_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
HEAD = re.compile(r"^\*\*(.+?)\*\*\s*$")


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def parse(text: str):
    """→ [(용어, 정의본문)]  — `**용어**` 헤더 + 이후 비어있지 않은 줄들(다음 헤더 전까지)."""
    out, term, buf = [], None, []
    for ln in text.splitlines():
        if ln.strip().startswith(">") or ln.strip().startswith("#"):
            continue  # 머리말 인용·제목 스킵
        m = HEAD.match(ln.strip())
        if m:
            if term and buf:
                out.append((term, "\n".join(buf).strip()))
            term, buf = m.group(1).strip(), []
        elif term is not None:
            buf.append(ln)
    if term and buf:
        out.append((term, "\n".join(buf).strip()))
    return out


def note(term: str, body: str) -> str:
    return "\n".join([
        "---", "type: term", f'용어: "{term}"', '영문: ""', f'분류: "{CAT}"',
        "관련규정: []", '원본파일: "PMS_용어_정의.md"', '태그: ["PMS", "연구관리", "시스템"]',
        "검수상태: 미검수", "---", "", f"# {term}", "", WARN, "", body, "",
    ])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    terms = parse(Path(args.src).read_text(encoding="utf-8"))
    if not terms:
        print("⛔ 파싱된 용어 없음"); return 1
    dst = Path(args.vault) / "30_용어집" / CAT
    print(f"📊 용어 {len(terms)}개 → {dst}")
    for term, body in terms:
        safe = FS_BAD.sub("_", nfc(term))
        print(f"   {'(dry)' if args.dry_run else '✍'} {safe}.md  ({len(body)}자)")
        if not args.dry_run:
            dst.mkdir(parents=True, exist_ok=True)
            (dst / f"{safe}.md").write_text(note(term, body), encoding="utf-8")
    if not args.dry_run:
        print(f"\n다음: 01g_terms_crosslink → 02 재색인 → web 재빌드(terms-tooltip.json)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
