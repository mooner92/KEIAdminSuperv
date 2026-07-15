#!/usr/bin/env python3
"""calendar_lint.py — 시즌 캘린더(볼트 90_관리/_calendar/seasonal.json) 작성 규약 검사 (docs/35 §2).

자료 반입 절차: 근 몇 년치 일정 자료 → seasonal.json 작성 → 이 린트 → web 재빌드.
검사: ⓐ month 1~12·title 필수 ⓑ 상태 ∈ {예시, 확정} ⓒ 관련페이지는 내부 경로만
ⓓ ⛔ 확정값 금지 — title·desc·시기에 금액·'N일 이내'류 기한·비율(changelog_lint와 동일 강도)
ⓔ 근거 문서가 볼트에 실존(제목 일치). 실행: .venv/bin/python tools/calendar_lint.py --vault KEI-행정가이드
"""
import argparse
import json
import re
import sys
from pathlib import Path

# ⚠ 규정 값 패턴은 changelog_lint.py와 동기 유지(동일 강도) — 한쪽만 보강하면 다른 쪽이 구멍이 된다.
MONEY_RE = re.compile(
    r"\d{1,3}(?:,\d{3})+\s*원"        # 500,000원
    r"|\d+\s*[만천억]\s*원"            # 50만 원
    r"|[일이삼사오육칠팔구십백천만억]{2,}\s*원"  # 삼십만 원 · 오백만원
    r"|\d{4,}\s*원"                    # 500000원
)
DEADLINE_RE = re.compile(
    r"\d+\s*(?:일|주|개월|달|년|시간)\s*(?:이내|내에?\b|안에|전까지)"
    r"|[한두세네]\s*(?:달|주|해)\s*이내"
    r"|[일이삼사오육칠팔구십]{2,}일\s*이내"
)
RATIO_RE = re.compile(r"\d+(?:\.\d+)?\s*(?:%|퍼센트|프로\b)|\d+분의\s*\d+")
INTERNAL_PATH_RE = re.compile(r"^/[A-Za-z0-9가-힣/_#.?=%\-]*$")


def vault_titles(vault: Path) -> set:
    out = set()
    for md in vault.rglob("*.md"):
        if "90_관리" in md.parts or md.name == "README.md":
            continue
        head = md.read_text(encoding="utf-8", errors="ignore")[:1200]
        for ln in head.splitlines()[:30]:
            if ln.startswith(("규정명:", "제목:", "용어:")):
                out.add(ln.split(":", 1)[1].strip().strip('"').strip("'"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", default="KEI-행정가이드")
    args = ap.parse_args()
    vault = Path(args.vault)
    fp = vault / "90_관리" / "_calendar" / "seasonal.json"
    if not fp.exists():
        raise SystemExit(f"⛔ {fp} 없음")
    try:
        items = json.loads(fp.read_text(encoding="utf-8"))
    except ValueError as e:
        raise SystemExit(f"⛔ JSON 파싱 실패: {e}")
    if not isinstance(items, list):
        raise SystemExit("⛔ 최상위는 배열이어야 함")
    titles = vault_titles(vault)
    errs = []
    for i, it in enumerate(items):
        tag = f"[{i}] {it.get('title', '?')}"
        if not isinstance(it.get("month"), int) or not 1 <= it["month"] <= 12:
            errs.append(f"{tag}: month는 1~12 정수")
        if not (it.get("title") or "").strip():
            errs.append(f"{tag}: title 필수")
        if it.get("상태") not in ("예시", "확정"):
            errs.append(f"{tag}: 상태는 '예시'|'확정' — 현재 {it.get('상태')!r}")
        rel = it.get("관련페이지", "")
        if rel and not INTERNAL_PATH_RE.match(rel):
            errs.append(f"{tag}: 관련페이지는 내부 경로(/...)만 — {rel!r}")
        blob = f"{it.get('title', '')} {it.get('desc', '')} {it.get('시기', '')}"  # 제목도 스캔(린트 구멍 방지)
        for pat, label in ((MONEY_RE, "금액"), (DEADLINE_RE, "확정 기한"), (RATIO_RE, "비율")):
            m = pat.search(blob)
            if m:
                errs.append(f"{tag}: ⛔ {label} 금지 — '{m.group()}' (확정값은 규정 원문으로만)")
        basis = it.get("근거", "")
        if basis and basis not in titles:
            errs.append(f"{tag}: 근거 문서가 볼트에 없음 — {basis!r}")
    n_ex = sum(1 for it in items if isinstance(it, dict) and it.get("상태") == "예시")
    if errs:
        print(f"⛔ 캘린더 린트 실패 {len(errs)}건:")
        for e in errs:
            print("  -", e)
        sys.exit(1)
    print(f"✅ 캘린더 {len(items)}건 린트 통과 (예시 {n_ex}·확정 {len(items) - n_ex}) — 확정값 0·근거 실존")


if __name__ == "__main__":
    main()
