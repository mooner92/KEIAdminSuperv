#!/usr/bin/env python3
"""01y_uplaw_ingest.py — 상위 법령 레이어 볼트 적재 (docs/61 K2).

kordoc → kordoc_adapt(--check --parity 통과) 산출 md를 `25_상위법령/<그룹>/`에
type: uplaw 노트로 기록한다. ⛔ 본문 무가공(어댑터 산출 그대로 — 의역 금지 절대규칙 2),
검수상태 미검수 고정. 웹(SECTIONS)·관리자 코퍼스 목록(type 필터)·02 메인 색인(디렉토리
스킵)은 uplaw를 자동 제외 — 노출·색인은 U3(kei_uplaw 컬렉션)·U4(라벨 회수)에서.

개정 시 재적재 절차(NRC — API 없음, 사람이 새 HWP 다운로드):
  npx -y kordoc <새파일.hwp> -o /tmp/x.md
  python tools/kordoc_adapt.py /tmp/x.md --check [--parity <직전 볼트본 대비는 부적합 — 신구
    조문 차이가 정상이므로 생략하고 diff를 사람이 검토>]
  python tools/01y_uplaw_ingest.py --src /tmp/x.adapted.md --name "<법령명>" --rev YYYY-MM-DD \
      --origin "<원본파일명>" [--group NRC] [--force]
사용례는 docs/61 §7-B.
"""
import argparse
import datetime
import re
import sys
from pathlib import Path

VAULT = Path(__file__).resolve().parent.parent / "KEI-행정가이드"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="kordoc_adapt 산출 md(검증 통과본)")
    ap.add_argument("--name", required=True, help="법령/규정명(파일명·법령명 프론트매터)")
    ap.add_argument("--rev", required=True, help="제·개정일 YYYY-MM-DD")
    ap.add_argument("--origin", default="", help="원본 파일명(HWP/HWPX)")
    ap.add_argument("--group", default="NRC", help="하위 폴더(기본 NRC — 경제·인문사회연구회)")
    ap.add_argument("--strength", default="준거", choices=["직접", "준거", "참고"],
                    help="적용강도(docs/61 §7) — 답변 라벨에 쓰임")
    ap.add_argument("--source-url", default="https://rule.nrc.re.kr/")
    ap.add_argument("--force", action="store_true", help="기존 노트 덮어쓰기(개정 재적재)")
    args = ap.parse_args()

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", args.rev):
        raise SystemExit("--rev 는 YYYY-MM-DD")
    body = Path(args.src).read_text(encoding="utf-8").strip()
    if not body:
        raise SystemExit("⛔ 본문이 비어 있음")

    out_dir = VAULT / "25_상위법령" / args.group
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / f"{args.name}.md"
    if dst.exists() and not args.force:
        raise SystemExit(f"이미 존재(개정 재적재는 --force): {dst}")

    fm = (
        "---\n"
        "type: uplaw\n"
        f"법령명: \"{args.name}\"\n"
        f"개정일: {args.rev}\n"
        f"소관: \"경제·인문사회연구회(NRC)\"\n"
        f"적용강도: {args.strength}\n"
        f"출처URL: \"{args.source_url}\"\n"
        f"원본파일: \"{args.origin}\"\n"
        f"변환기: \"kordoc+adapt\"\n"
        f"적재일: {datetime.date.today().isoformat()}\n"
        "검수상태: 미검수\n"
        "---\n\n"
    )
    dst.write_text(fm + body + "\n", encoding="utf-8")
    arts = len(re.findall(r"^\s*제\s*\d+\s*조", body, re.MULTILINE))
    print(f"✓ {dst.relative_to(VAULT)} — {len(body)}자 · 조문줄 {arts} · 적용강도 {args.strength}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
