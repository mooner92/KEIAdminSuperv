#!/usr/bin/env python3
"""
01_hwp_to_md.py  —  HWP/HWPX -> Markdown (볼트 20_규정원문/ 적재)

- hwp-hwpx-parser 로 본문 텍스트 + 표(마크다운) 추출
- 파일명에서 규정번호/규정명/개정일 추정해 프론트매터 생성
- 분류 폴더(4000_보수·여비 등)는 규정번호 첫 자리로 자동 배치

스켈레톤이므로 실제 파일로 돌려보며 정규식/표 처리만 다듬으면 됩니다.
"""
import argparse, re, datetime
from pathlib import Path

try:
    from hwp_hwpx_parser import Reader
except ImportError:
    raise SystemExit("pip install hwp-hwpx-parser 먼저 실행하세요.")

CATEGORY = {  # 규정번호 첫 자리 -> 20_규정원문/ 하위 폴더
    "1": "1000_기관", "2": "2000_감사·규정", "3": "3000_인사",
    "4": "4000_보수·여비", "5": "5000_연구·정보", "6": "6000_총무·보안·회계",
    "7": "6000_총무·보안·회계",  # 7xxx(회계/구매)도 총무·보안·회계로
}

def parse_filename(name: str):
    """'4300여비규정_250324.hwp' -> (번호, 이름, 개정일)"""
    stem = Path(name).stem
    num = (re.match(r"(\d{3,4})", stem) or [None, ""])[1]
    date = None
    m = re.search(r"(\d{2})(\d{2})(\d{2})", stem)        # _YYMMDD
    if m:
        yy, mm, dd = m.groups()
        date = f"20{yy}-{mm}-{dd}"
    title = re.sub(r"^\d{3,4}", "", stem)
    title = re.sub(r"[_\(].*$", "", title).strip() or stem
    return num, title, date

def to_markdown(path: Path) -> str:
    with Reader(str(path)) as r:
        if getattr(r, "is_encrypted", False):
            return ""  # 암호화 파일은 건너뜀(로그 처리 권장)
        body = r.extract_text() or ""
        # 표는 본문 끝에 마크다운으로 부록 처리(인라인 치환은 추후 고도화)
        try:
            tables = r.get_tables_as_markdown() or []
        except Exception:
            tables = []
    if tables:
        body += "\n\n## (부록) 표\n\n" + "\n\n".join(tables)
    return body

def build_note(num, title, date, original, body) -> str:
    fm = [
        "---", "type: regulation", f'규정번호: "{num}"', f'규정명: "{title}"',
        f'분류: "{CATEGORY.get(num[:1], "")}"',
        f"개정일: {date}" if date else "개정일:",
        f'원본파일: "{original}"', "태그: []", "검수상태: 미검수", "---", "",
        f"# {title}", "",
        "> [!warning] 자동 변환 — 의역 금지. 표/별표 깨짐과 오타만 검수 후 `검수완료`로.",
        "", body.strip(), ""
    ]
    return "\n".join(fm)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="HWP들이 있는 폴더")
    ap.add_argument("--vault", required=True, help="Obsidian 볼트 루트")
    args = ap.parse_args()

    out_root = Path(args.vault) / "20_규정원문"
    files = list(Path(args.src).glob("*.hwp")) + list(Path(args.src).glob("*.hwpx"))
    print(f"{len(files)}개 파일 변환 시작 ({datetime.date.today()})")

    for f in files:
        num, title, date = parse_filename(f.name)
        body = to_markdown(f)
        if not body.strip():
            print(f"  [skip] {f.name} (빈 본문/암호화 가능)")
            continue
        sub = CATEGORY.get((num or "9")[:1], "")
        dest_dir = out_root / sub if sub else out_root
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{num}_{title}.md"
        dest.write_text(build_note(num, title, date, f.name, body), encoding="utf-8")
        print(f"  [ok] {f.name} -> {dest.relative_to(args.vault)}")

if __name__ == "__main__":
    main()
