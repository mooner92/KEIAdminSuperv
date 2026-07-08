#!/usr/bin/env python3
"""01l_graph_analytics.py — 조문 참조 그래프 분석 (Track C, clause_xref 위에서 파생).

`tools/index/clause_xref.json`(01i)의 조문↔조문 엣지를 소비해 세 가지 그래프 분석을 산출한다
(원문 재파싱 없음, 재임베딩 불필요):
  · 개정 파급(impact) — 규정 A의 조문이 규정 B를 준용/참조하면 A는 B에 '의존'한다. B가 개정되면
    영향받는 = B를 (전이적으로) 참조하는 규정들 = **역방향 전이폐포**(reverse transitive closure).
  · 함께 보는 조문(cocitation) — 같은 조문에서 함께 인용된 조문 쌍(공동인용) 빈도 → 조문별 이웃.
  · 고립 노드(isolated) — cross 엣지(in·out)가 하나도 없는 규정 = 그래프 사각지대(autolink 보강 후보).

산출: tools/index/graph_analytics.json = {meta, impact:{규정명:[[규정명,hop]]}, cocitation:{조키:[[조키,n]]}, isolated:[규정명]}
용도: 웹 문서 드로어 '개정 파급·함께 보는 조문' 패널(flag graph_impact) + 고립 진단(유지보수 리포트).

실행: python tools/01l_graph_analytics.py   (기본 tools/index/clause_xref.json 소비)
"""
import argparse
import json
from collections import Counter, defaultdict, deque
from pathlib import Path

IMPACT_MAXDEPTH = 3   # 개정 파급 전이 최대 홉(과확산 방지)
IMPACT_CAP = 40       # 규정당 파급 목록 상한
COCITE_TOPN = 6       # 조문당 공동인용 이웃 상한


def _reg_of(key: str) -> str:
    return key.rsplit("#", 1)[0]


def build(index_dir: Path):
    cx = json.loads((index_dir / "clause_xref.json").read_text(encoding="utf-8"))
    edges = cx.get("edges", {})

    # ── 규정 의존 그래프: A가 B를 참조(cross)하면 A→B. 파급은 역방향(B를 참조하는 A들) ──
    reg_rev = defaultdict(set)   # B → {A : A가 B 참조}
    for src, es in edges.items():
        A = _reg_of(src)
        for e in es:
            if e.get("scope") != "cross":
                continue
            B = _reg_of(e.get("target", ""))
            if B and B != A:
                reg_rev[B].add(A)

    # 개정 파급 = 역방향 전이폐포(BFS, 홉 기록)
    impact = {}
    for B in reg_rev:
        seen = {}
        q = deque((A, 1) for A in reg_rev[B])
        while q:
            A, d = q.popleft()
            if A == B or (A in seen and seen[A] <= d):
                continue
            seen[A] = d
            if d < IMPACT_MAXDEPTH:
                for A2 in reg_rev.get(A, ()):
                    if A2 != B:
                        q.append((A2, d + 1))
        if seen:
            impact[B] = sorted(seen.items(), key=lambda x: (x[1], x[0]))[:IMPACT_CAP]

    # ── 공동인용: 같은 source가 함께 인용한 target 쌍 빈도(intra+cross) ──
    pair = Counter()
    for es in edges.values():
        tgts = sorted({e["target"] for e in es if e.get("scope") in ("intra", "cross") and e.get("target")})
        for i in range(len(tgts)):
            for j in range(i + 1, len(tgts)):
                pair[(tgts[i], tgts[j])] += 1
    cocite = defaultdict(list)
    for (a, b), c in pair.items():
        cocite[a].append((b, c))
        cocite[b].append((a, c))
    cocitation = {k: sorted(v, key=lambda x: -x[1])[:COCITE_TOPN] for k, v in cocite.items()}

    # ── 고립 노드: cross 엣지(in·out) 없는 규정 ──
    try:
        st = json.loads((index_dir / "article_status.json").read_text(encoding="utf-8"))["articles"]
        all_regs = {_reg_of(k) for k in st}
    except Exception:
        all_regs = set()
    reg_out = set()
    for src, es in edges.items():
        if any(e.get("scope") == "cross" for e in es):
            reg_out.add(_reg_of(src))
    connected = reg_out | set(reg_rev)
    isolated = sorted(all_regs - connected) if all_regs else []

    # 파급 상위(가장 많이 참조되는 = 개정 시 파장 큰) 규정
    top_impact = sorted(((k, len(v)) for k, v in impact.items()), key=lambda x: -x[1])[:12]
    meta = {
        "규정수": len(all_regs),
        "파급대상규정": len(impact),
        "공동인용조문": len(cocitation),
        "고립규정": len(isolated),
        "파급_top": top_impact,
        "고립_예": isolated[:12],
    }
    return {"meta": meta, "impact": impact, "cocitation": cocitation, "isolated": isolated}


def main():
    ap = argparse.ArgumentParser(description="조문 참조 그래프 분석(Track C)")
    ap.add_argument("--index", default=str(Path(__file__).parent / "index"))
    args = ap.parse_args()
    idx = Path(args.index)
    data = build(idx)
    out = idx / "graph_analytics.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    m = data["meta"]
    print(f"✅ {out}")
    print(f"   규정 {m['규정수']} · 파급대상 {m['파급대상규정']} · 공동인용조문 {m['공동인용조문']} · 고립 {m['고립규정']}")
    print("   개정 파장 top:", ", ".join(f"{k}({n})" for k, n in m["파급_top"][:6]))
    if m["고립_예"]:
        print("   고립(연결 없음) 예:", ", ".join(m["고립_예"][:6]))


if __name__ == "__main__":
    main()
