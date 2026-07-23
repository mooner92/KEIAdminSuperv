#!/usr/bin/env python3
"""kordoc_adapt.py — kordoc 마크다운 출력 → 볼트 규약 정규화 (docs/61 K1).

kordoc(HWP/HWPX/PDF 파서, Node CLI)의 출력은 내용은 동급(실측 3-그램 99.5%+)이나
조문 형식이 볼트 규약과 달라 그대로는 청킹(02)·조문 파서(vault_parse)가 못 읽는다:
  볼트 규약   : 평문 `제N조(제목) 본문…` 줄 시작  (경계 정규식 `^\\s*제\\s*\\d+\\s*조`)
  kordoc 변형 : `### 제N조(제목) …`(헤딩) | `**제N조(제목)** …`(볼드) | 평문(혼재)

이 어댑터는 **형식만** 결정적으로 정규화한다(⛔ 내용 불변 — 절대규칙 2):
  1) 헤딩 조문  `#… 제N조…`      → 평문 `제N조…`
  2) 볼드 조문  `**제N조(…)** …` → 평문 `제N조(…) …`  (제N조의M 가지번호 포함)
  3) 이미지     `![image](…)`    → `[IMAGE]` 마커(현행 스택과 동일 동작; --images keep 시 유지)
손대지 않는 것: HTML 표(<table> — 병합 셀 보존이 kordoc 도입 이유), `[별표]` 라벨
(kordoc이 이미 볼트 규약으로 출력), 원문 텍스트 전부(제0조 등 원문 유래 표기 포함).

검증(--check): 정규화 전후 "형식 기호 제거 텍스트"가 동일해야 통과(내용 불변 증명).
사용:  python tools/kordoc_adapt.py <in.md> [-o out.md] [--images keep] [--check]
"""
import argparse
import re
import sys
from pathlib import Path

# 조문 머리: 제N조 / 제N조의M (+선택적 (제목)) — 02/vault_parse와 동일한 관대함(공백 허용)
_ART = r"제\s*\d+\s*조(?:\s*의\s*\d+)?"

# 1) 헤딩 조문: `### 제N조…` → `제N조…`  (헤딩 마커만 제거, 줄 나머지 보존)
RE_HEADING_ART = re.compile(rf"^#{{1,6}}\s*(?={_ART})", re.MULTILINE)
# 1b) 헤딩 별표/별지: `## [별표 1] …` → `[별표 1] …` — 헤딩이면 02 경계(^[별표)에 안 걸려
#     별표 청크가 소실된다(실측: 복무규정 별표1 누락, K3)
RE_HEADING_BYEOL = re.compile(r"^#{1,6}\s*(?=\[\s*별[표지])", re.MULTILINE)
# 2) 볼드 조문 헤더: `**제N조(제목)**` → `제N조(제목)` — 조 머리로 시작하는 볼드 스팬 전체를
#    벗긴다. 제목 괄호를 `\([^)]*\)`로 잡으면 중첩 괄호(예: '계획(안) 수립')에서 실패(실측
#    기본연구 제7조 누락) → 볼드 닫힘(`**`)까지를 경계로 사용(제목에 `*`는 없음).
RE_BOLD_ART = re.compile(rf"^\*\*({_ART}[^*\n]*)\*\*[ \t]*", re.MULTILINE)
# 3) 이미지 → [IMAGE] 마커(현행 01 스택과 동일 표기)
RE_IMG = re.compile(r"!\[[^\]]*\]\([^)]*\)")


def adapt(text: str, images: str = "marker") -> str:
    out = RE_HEADING_ART.sub("", text)
    out = RE_HEADING_BYEOL.sub("", out)
    out = RE_BOLD_ART.sub(r"\1 ", out)
    if images == "marker":
        out = RE_IMG.sub("[IMAGE]", out)
    return out


def _strip_format(t: str) -> str:
    """내용 불변 검증용: 어댑터가 만지는 형식 기호만 제거한 순수 텍스트."""
    t = RE_IMG.sub("", t)
    t = re.sub(r"^#{1,6}\s*", "", t, flags=re.MULTILINE)
    t = re.sub(r"\*\*", "", t)
    t = re.sub(r"\[IMAGE\]", "", t)
    return re.sub(r"\s+", "", t)


def chunk_labels(text: str) -> list:
    """02와 동일한 경계(BOUNDARY)로 분할한 조/별표 라벨 시퀀스 — parity 게이트용."""
    boundary = re.compile(r"(?=^\s*제\s*\d+\s*조)|(?=^\s*\[\s*별표)|(?=^\s*\[\s*별지)", re.MULTILINE)
    labs = []
    for part in (x for x in boundary.split(text) if x.strip()):
        m = re.match(r"\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?", part)
        if m:
            labs.append(f"제{m.group(1)}조의{m.group(2)}" if m.group(2) else f"제{m.group(1)}조")
        elif re.match(r"\s*\[\s*별표", part):
            labs.append("[별표]")
        elif re.match(r"\s*\[\s*별지", part):
            labs.append("[별지]")
        else:
            labs.append("(전문)")
    return labs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("-o", "--output", help="기본: <input>.adapted.md")
    ap.add_argument("--images", choices=["marker", "keep"], default="marker")
    ap.add_argument("--check", action="store_true", help="내용 불변 검증 후 실패 시 기록 안 함")
    ap.add_argument("--parity", metavar="REF_MD",
                    help="기존 변환본(현행 스택)과 조/별표 라벨 시퀀스 대조 — 불일치 시 exit 2"
                         "(재변환 승인 게이트: 불일치 문서는 사람 검수로). 신규 문서엔 생략.")
    args = ap.parse_args()

    src = Path(args.input)
    text = src.read_text(encoding="utf-8")
    out = adapt(text, images=args.images)

    if args.check and _strip_format(text) != _strip_format(out):
        print("⛔ 내용 불변 검증 실패 — 기록하지 않음", file=sys.stderr)
        return 1

    dst = Path(args.output) if args.output else src.with_suffix(".adapted.md")
    dst.write_text(out, encoding="utf-8")
    n_head = len(RE_HEADING_ART.findall(text))
    n_bold = len(RE_BOLD_ART.findall(text))
    n_img = len(RE_IMG.findall(text)) if args.images == "marker" else 0
    print(f"{src.name}: 헤딩조문 {n_head} · 볼드조문 {n_bold} · 이미지 {n_img} 정규화 → {dst.name}")

    if args.parity:
        ref = chunk_labels(Path(args.parity).read_text(encoding="utf-8"))
        ada = chunk_labels(out)
        if ref == ada:
            print(f"  parity ✅ 라벨 시퀀스 일치({len(ref)}청크)")
        else:
            diff = [(i, a, b) for i, (a, b) in enumerate(zip(ref, ada)) if a != b][:5]
            print(f"  parity ❌ 현행 {len(ref)} vs 어댑터 {len(ada)}청크 — diff {diff}"
                  f" — 사람 검수 필요", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
