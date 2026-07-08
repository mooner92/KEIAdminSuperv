#!/usr/bin/env python3
"""01i_clause_xref.py — 조문↔조문 참조 해소 그래프 (Track A: 준용·인용 자동 링크).

원문을 **읽기 전용**으로 훑어 각 제N조 본문이 참조하는 조문을 해소한다(clause-level 그래프):
  · intra  — 같은 규정 내 다른 제N조/제N조의M 참조 (본문 '제2조 규정에 의거…')
  · cross  — 타 규정 참조 '○○규정 … 제N조' (02.find_reg_refs식, 규정명 뒤 25자 내 조문)
  · byeol  — 별표/별지 참조 '별표 N'/'별지 제N호'
관계(rel)는 참조 주변에 '준용'이 있으면 '준용', 없으면 '인용'(별표는 '별표참조').

산출: tools/index/clause_xref.json = {meta, edges:{src:[{target,rel,scope}]}, reverse:{target:[src]}}
용도: ⓐ 웹 문서 드로어 '준용/참조 ↔ 피참조' 양방향 칩(1클릭 점프)
      ⓑ rag_core reg 확장의 **더 완전한** 근거(기존 chunk reg_refs 보완, graph_expand_regs 플래그)
      ⓒ Track C(개정 파급·경로찾기·함께보는 조문)의 기반 엣지.

실행: python tools/01i_clause_xref.py --vault KEI-행정가이드
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import vault_parse as vp

_HEADER = re.compile(r"^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)]*\))?")
_ART_REF = re.compile(r"제\s*(\d+)\s*조(?:\s*의\s*(\d+))?")
_BYEOL = re.compile(r"별표\s*제?\s*(\d+)|별지\s*제?\s*(\d+)\s*호")
_MAX_EDGES = 16   # 조당 엣지 상한(폭주 방지)


def _lbl(n, m2) -> str:
    return f"제{n}조의{m2}" if m2 else f"제{n}조"


def _rel(body: str, at: int) -> str:
    """참조 위치 주변(뒤 40자)에 '준용'이 있으면 준용, 아니면 인용."""
    return "준용" if "준용" in body[at: at + 40] else "인용"


def extract(vault: str):
    regs = list(vp.iter_regulations(vault))
    names = sorted({r["규정명"] for r in regs if r["규정명"]}, key=len, reverse=True)
    edges, reverse = {}, {}
    n_intra = n_cross = n_byeol = n_junyong = 0

    for r in regs:
        own = r["규정명"]
        own_labels = {lab for lab, _, _ in r["articles"]}
        for label, _title, body in r["articles"]:
            src = f"{own}#{label}"
            hm = _HEADER.match(body)
            scan = body[hm.end():] if hm else body        # 자기 헤더 제외
            seen = set()
            out = []

            # intra — 같은 규정 다른 조 (실재 조문만 채택)
            for m in _ART_REF.finditer(scan):
                tl = _lbl(m.group(1), m.group(2))
                if tl == label or tl not in own_labels:
                    continue
                rel = _rel(scan, m.start())
                k = (f"{own}#{tl}", rel, "intra")
                if k not in seen:
                    seen.add(k); out.append({"target": k[0], "rel": rel, "scope": "intra"})

            # cross — 타 규정 제N조 (규정명 뒤 25자 내 조문; find_reg_refs 정합)
            for nm in names:
                if not nm or nm == own or len(nm) < 4 or nm not in scan:
                    continue
                for m in re.finditer(re.escape(nm), scan):
                    j = _ART_REF.search(scan[m.end(): m.end() + 25])
                    if not j:
                        continue
                    tl = _lbl(j.group(1), j.group(2))
                    rel = _rel(scan, m.start())
                    k = (f"{nm}#{tl}", rel, "cross")
                    if k not in seen:
                        seen.add(k); out.append({"target": k[0], "rel": rel, "scope": "cross"})
                    break

            # byeol — 별표/별지 참조(같은 규정)
            for m in _BYEOL.finditer(scan):
                num = m.group(1) or m.group(2)
                tgt = f"{own}#별표 {num}" if m.group(1) else f"{own}#별지 제{num}호"
                k = (tgt, "별표참조", "byeol")
                if k not in seen:
                    seen.add(k); out.append({"target": tgt, "rel": "별표참조", "scope": "byeol"})

            if not out:
                continue
            out = out[:_MAX_EDGES]
            edges[src] = out
            for e in out:
                if e["scope"] == "intra":
                    n_intra += 1
                elif e["scope"] == "cross":
                    n_cross += 1
                else:
                    n_byeol += 1
                if e["rel"] == "준용":
                    n_junyong += 1
                if e["scope"] in ("intra", "cross"):       # 피참조 역인덱스(조 대상만)
                    reverse.setdefault(e["target"], [])
                    if src not in reverse[e["target"]]:
                        reverse[e["target"]].append(src)

    meta = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "규정수": len(regs), "출발조문": len(edges),
        "엣지_intra": n_intra, "엣지_cross": n_cross, "엣지_byeol": n_byeol,
        "준용엣지": n_junyong, "피참조조문": len(reverse),
    }
    return {"meta": meta, "edges": edges, "reverse": reverse}


def main():
    ap = argparse.ArgumentParser(description="조문↔조문 참조 그래프 추출(Track A)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--out", default=str(Path(__file__).parent / "index" / "clause_xref.json"))
    args = ap.parse_args()
    data = extract(args.vault)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    m = data["meta"]
    print(f"✅ {args.out}")
    print(f"   출발조문 {m['출발조문']} · intra {m['엣지_intra']} · cross {m['엣지_cross']} · byeol {m['엣지_byeol']} · 준용 {m['준용엣지']} · 피참조 {m['피참조조문']}")


if __name__ == "__main__":
    main()
