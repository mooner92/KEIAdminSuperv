#!/usr/bin/env python3
"""01t_format_scan.py — 일반 텍스트 형식 붕괴 진단 스캐너 (docs/28 과업 C, 결정적·읽기 전용).

변환(HWP/HWPX/PDF/PPTX → md) 과정에서 무너진 '표 밖' 형식을 신호 기반으로 점수화한다.
표 손상은 01o가 담당 — 여기서는 겹치지 않게 비표 라인만 본다. 판정·복원은 후속 단계
(원문 대조 재추출 + 내용 불변 검증)에서, 이 스크립트는 후보와 근거 표본만 만든다.

신호(비표 라인 대상):
  ① 초장문 단락: 한 줄 ≥400자 + 문장 종결(다./함./음./됨./것. 등) ≥3 — 문단 경계 소실
  ② 리스트 마커 인라인 병합: 한 줄에 원문자(①②…)·한글목(가. 나. …)·호(1. 2. …) 3개 이상
  ③ 비정상 문자: 사설영역(U+E000–F8FF)·대체문자(U+FFFD)·제어문자 잔재
  ④ 목차 붕괴: 리더(…·······)와 쪽번호가 본문 한 줄에 3회 이상 병합

실행: .venv/bin/python tools/01t_format_scan.py --vault KEI-행정가이드 [--top 20]
산출: tools/index/format_scan.json (문서별 신호·표본·원본파일 — 복원 단계 소비용)
"""
import argparse
import json
import os
import re
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))

# 문장 종결 어미(개조식 포함) — 초장문 단락의 '여러 문장 병합' 판정용
SENT_END = re.compile(r"[다함음됨임요것음]\.\s")
CIRCLED = re.compile(r"[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]")
KO_ITEM = re.compile(r"(?:^|\s)([가나다라마바사아자차카타파하])\.\s")
NUM_ITEM = re.compile(r"(?:^|\s)(\d{1,2})\.\s")
BULLET = re.compile(r"(?:^|\s)[ㅇ◦•]\s")
BAD_CHAR = re.compile(r"[-�\x00-\x08\x0b\x0c\x0e-\x1f]")
TOC_LEADER = re.compile(r"[·…\.]{6,}\s*\d{1,3}")


def split_fm(text):
    if text.startswith("---"):
        try:
            _, fm, body = text.split("---", 2)
        except ValueError:
            return {}, text
        meta = {}
        for ln in fm.strip().splitlines():
            if ":" in ln:
                k, v = ln.split(":", 1)
                meta[k.strip()] = v.strip().strip('"').strip("'")
        return meta, body
    return {}, text


def seq_run(nums):
    """[1,2,3,7] → 최장 '1부터 이어지는' 연속열 길이(3). 마커 병합 오탐(연도·조번호)을 줄인다."""
    best = run = 0
    prev = None
    for n in nums:
        run = run + 1 if (prev is not None and n == prev + 1) else 1
        prev = n
        best = max(best, run)
    return best


def _seg_lens(s: str, marker_re):
    """마커 위치로 자른 구간 길이들. 의도된 인라인 열거('① 검색 / ② 결과')는 구간이 짧고,
    문단 병합('…할 수 있다.② "계약자"는…')은 구간이 문장 길이 — 평균 길이로 구분한다."""
    pos = [m.start() for m in marker_re.finditer(s)]
    if len(pos) < 2:
        return []
    return [pos[i + 1] - pos[i] for i in range(len(pos) - 1)]


def _merged(s: str, marker_re, min_n=3, min_avg=20):
    segs = _seg_lens(s, marker_re)
    return len(segs) + 1 >= min_n and segs and (sum(segs) / len(segs)) >= min_avg


def scan_line(ln: str):
    """비표 한 줄의 형식 붕괴 신호 → (신호명, 세부) 리스트."""
    s = ln.strip()
    if not s or s.startswith("|") or s.startswith(">"):
        return []          # 표는 01o 담당, 인용 박스는 의도된 한 줄일 수 있음
    sig = []
    if len(s) >= 400 and len(SENT_END.findall(s)) >= 3:
        sig.append(("초장문", f"{len(s)}자·문장{len(SENT_END.findall(s))}"))
    # <개정 2007. 7. 2., …> 같은 각도괄호 태그의 날짜가 호 마커로 오탐되지 않게 제거 후 검사
    t = re.sub(r"<[^<>]{0,120}>", " ", s)
    if _merged(t, CIRCLED):
        sig.append(("마커병합(원문자)", "".join(CIRCLED.findall(t)[:6])))
    ko_pos = [(m.start(), ord(m.group(1)) - ord("가") + 1) for m in KO_ITEM.finditer(t)]
    # 한글 목은 가나다 순서를 이룰 때만(가./나./다.) — 일반 서술 '다. ' 오탐 방지
    if seq_run([k for _, k in ko_pos]) >= 3 and _merged(t, KO_ITEM):
        sig.append(("마커병합(한글목)", f"{len(ko_pos)}개"))
    nums = [int(n) for n in NUM_ITEM.findall(t)]
    if seq_run(nums) >= 3 and _merged(t, NUM_ITEM):
        sig.append(("마커병합(호)", f"{len(nums)}개"))
    if _merged(t, BULLET):
        sig.append(("마커병합(불릿)", f"{len(BULLET.findall(t))}개"))
    bad = BAD_CHAR.findall(s)
    if bad:
        sig.append(("비정상문자", f"{len(bad)}개 {[hex(ord(c)) for c in bad[:3]]}"))
    if len(TOC_LEADER.findall(s)) >= 3:
        sig.append(("목차붕괴", f"{len(TOC_LEADER.findall(s))}리더"))
    return sig


W = {"초장문": 3, "마커병합(원문자)": 4, "마커병합(한글목)": 4, "마커병합(호)": 3,
     "마커병합(불릿)": 3, "비정상문자": 5, "목차붕괴": 2}


def main():
    ap = argparse.ArgumentParser(description="형식 붕괴 진단(읽기 전용)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--out", default=os.path.join(_HERE, "index", "format_scan.json"))
    args = ap.parse_args()
    vault = Path(args.vault)

    docs = []
    for md in sorted(vault.rglob("*.md")):
        if md.name == "README.md" or "_templates" in md.parts or "90_관리" in md.parts:
            continue
        meta, body = split_fm(md.read_text(encoding="utf-8", errors="ignore"))
        if not meta.get("type"):
            continue
        hits = []
        for i, ln in enumerate(body.splitlines(), 1):
            for name, detail in scan_line(ln):
                hits.append({"line": i, "신호": name, "세부": detail,
                             "표본": ln.strip()[:160]})
        if not hits:
            continue
        score = sum(W.get(h["신호"], 1) for h in hits)
        docs.append({
            "path": str(md.relative_to(vault)),
            "제목": (meta.get("규정명") or meta.get("제목") or md.stem).strip(),
            "type": meta.get("type"),
            "원본파일": meta.get("원본파일", ""),
            "score": score,
            "신호수": len(hits),
            "hits": hits[:40],   # 표본 상한(파일 크기 제어)
        })

    docs.sort(key=lambda d: -d["score"])
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"n": len(docs), "docs": docs}, ensure_ascii=False, indent=1),
                   encoding="utf-8")

    print(f"형식 붕괴 의심 {len(docs)}개 문서 → {args.out}")
    for d in docs[:args.top]:
        kinds = {}
        for h in d["hits"]:
            kinds[h["신호"]] = kinds.get(h["신호"], 0) + 1
        print(f"  [{d['type']:<10}] {d['제목'][:30]:<32} score {d['score']:>3} · "
              + ", ".join(f"{k}×{v}" for k, v in sorted(kinds.items(), key=lambda x: -x[1])))


if __name__ == "__main__":
    main()
