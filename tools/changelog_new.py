#!/usr/bin/env python3
"""changelog_new.py — 업데이트 노트 템플릿 생성 도우미 (docs/32 §4).

기능 출시 절차의 마지막 단계: 플래그 on → **노트 작성** → web 재빌드.
실행: .venv/bin/python tools/changelog_new.py --title "제목" --category 신규 --date 2026-07-14
생성 후: 본문 채우기 → changelog_lint.py 통과 확인 → web 빌드.
"""
import argparse
import re
from pathlib import Path

TEMPLATE = """---
type: changelog
제목: {title}
날짜: {date}
분류: {category}
요약: (배너에 보일 한 줄 — 60자 이내, 사용자 언어)
관련페이지: /
---
**무엇이 바뀌었나** — (2~3문장. ⛔ 규정 값·서버/포트 등 인프라 정보 금지)

**어떻게 쓰나** — (어디를 눌러 어떻게 쓰는지 1~2문장)
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", default="KEI-행정가이드")
    ap.add_argument("--title", required=True)
    ap.add_argument("--category", default="신규", choices=["신규", "개선", "수정", "데이터"])
    ap.add_argument("--date", required=True, help="YYYY-MM-DD")
    args = ap.parse_args()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", args.date):
        raise SystemExit("--date 는 YYYY-MM-DD")
    slug = re.sub(r"[^\w가-힣]+", "-", args.title).strip("-")[:30]
    out = Path(args.vault) / "90_관리" / "_changelog" / f"{args.date}-{slug}.md"
    if out.exists():
        raise SystemExit(f"이미 존재: {out}")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(TEMPLATE.format(title=args.title, date=args.date, category=args.category),
                   encoding="utf-8")
    print(f"생성 → {out}\n본문을 채운 뒤: python tools/changelog_lint.py --vault {args.vault}")


if __name__ == "__main__":
    main()
