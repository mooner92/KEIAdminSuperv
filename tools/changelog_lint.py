#!/usr/bin/env python3
"""changelog_lint.py — 업데이트 노트('새로워진 점') 작성 규약 검사 (docs/32 §5ⓐ).

노트는 사용자용 문구다. 기계로 강제하는 것(적대 리뷰 2026-07-14로 보강):
  ⓐ 필수 프론트매터: type=changelog · 제목 · 날짜(YYYY-MM-DD) · 분류(신규|개선|수정|데이터) · 요약
  ⓑ ⛔ 규정 값 금지 — 금액(콤마·만천억·한글 수사·4자리 이상 순숫자), 기한(일/주/개월/년/시간
     + 이내·안에·전까지, 한글 수사 포함), 비율(%·퍼센트·N분의 M)
  ⓒ ⛔ 내부 인프라 정보 금지 — IP·포트(':9000'·'포트 9000'·'9000번 포트')·내부 경로·서버명
  ⓓ 요약 = 배너용 한 줄(≤60자·개행/블록 스칼라 불가·플레이스홀더 불가)
  ⓔ 검사 범위 = 요약+본문만이 아니라 **모든 프론트매터 값**(제목도 노출 필드)
  ⓕ 관련페이지 = 사이트 내부 경로(`/...`)만 허용(외부 URL·인프라 주소 차단)

실행: .venv/bin/python tools/changelog_lint.py --vault KEI-행정가이드   (위반 시 exit 1)
"""
import argparse
import re
import sys
from pathlib import Path

REQUIRED = ["제목", "날짜", "분류", "요약"]
CATEGORIES = {"신규", "개선", "수정", "데이터"}
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
INFRA_RE = re.compile(
    r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|:\d{4,5}\b"
    r"|포트\s*\d{2,5}|\d{2,5}\s*번\s*포트"
    r"|/home/|/KEIAdmin|localhost|data0\d"
    r"|\btools/|\bweb/|app\.db|\.app_secret|ecosystem\."
)
PLACEHOLDER_RE = re.compile(r"배너에 보일 한 줄|무엇이 바뀌었나\*\* — \(|어떻게 쓰나\*\* — \(")
INTERNAL_PATH_RE = re.compile(r"^/[A-Za-z0-9가-힣/_#.\-]*$")


def split_fm(text):
    if not text.startswith("---"):
        return None, text
    try:
        _, fm, body = text.split("---", 2)
    except ValueError:
        return None, text
    meta = {}
    for ln in fm.strip().splitlines():
        if ":" in ln:
            k, v = ln.split(":", 1)
            meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, body


def lint(vault: Path) -> list:
    errs = []
    cdir = vault / "90_관리" / "_changelog"
    if not cdir.is_dir():
        return [f"{cdir} 없음"]
    for md in sorted(cdir.glob("*.md")):
        raw = md.read_text(encoding="utf-8")
        meta, body = split_fm(raw)
        name = md.name
        if not meta or meta.get("type") != "changelog":
            errs.append(f"{name}: type: changelog 프론트매터 필요")
            continue
        for k in REQUIRED:
            if not meta.get(k):
                errs.append(f"{name}: 필수 필드 누락 — {k}")
        if meta.get("분류") and meta["분류"] not in CATEGORIES:
            errs.append(f"{name}: 분류는 {sorted(CATEGORIES)} 중 하나 — 현재 '{meta['분류']}'")
        if meta.get("날짜") and not re.match(r"^\d{4}-\d{2}-\d{2}$", meta["날짜"]):
            errs.append(f"{name}: 날짜는 YYYY-MM-DD — 현재 '{meta['날짜']}'")
        summary = meta.get("요약", "")
        if len(summary) > 60:
            errs.append(f"{name}: 요약이 60자 초과({len(summary)}자) — 배너용 한 줄")
        if summary in ("|", ">") or (summary and len(summary) < 5):
            errs.append(f"{name}: 요약이 비정상({summary!r}) — YAML 블록 스칼라(|·>) 금지, 실제 한 줄로")
        # ⓔ 노출 필드 전수 스캔: 모든 프론트매터 값 + 본문 (제목·관련페이지도 사용자 노출)
        full = "\n".join([*(str(v) for v in meta.values()), body])
        if PLACEHOLDER_RE.search(full):
            errs.append(f"{name}: 템플릿 플레이스홀더가 남아 있음 — 본문·요약을 채우세요")
        for pat, label in ((MONEY_RE, "규정 값(금액)"), (DEADLINE_RE, "규정 값(기한)"),
                           (RATIO_RE, "규정 값(비율)"), (INFRA_RE, "인프라 정보")):
            for m in pat.finditer(full):
                errs.append(f"{name}: ⛔ {label} 금지 — '{m.group()}'")
        # ⓕ 관련페이지는 사이트 내부 경로만
        rel = meta.get("관련페이지", "")
        if rel and not INTERNAL_PATH_RE.match(rel):
            errs.append(f"{name}: 관련페이지는 내부 경로(/...)만 — 현재 '{rel}'")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", default="KEI-행정가이드")
    args = ap.parse_args()
    errs = lint(Path(args.vault))
    n = len(list((Path(args.vault) / "90_관리" / "_changelog").glob("*.md")))
    if errs:
        print(f"⛔ 노트 린트 실패 {len(errs)}건 (노트 {n}건):")
        for e in errs:
            print("  -", e)
        sys.exit(1)
    print(f"✅ 노트 {n}건 린트 통과 — 필수 필드·규정 값 0·인프라 정보 0·내부 경로만")


if __name__ == "__main__":
    main()
