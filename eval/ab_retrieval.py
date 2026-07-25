#!/usr/bin/env python3
"""ab_retrieval.py — 검색 라벨(specs/01 P1) 회수 A/B: kei_regs(구) vs kei_regs_v2(라벨).

서비스 동일 경로(rag_core.retrieve — 리랭커 포함)로 골든 100문 + 표적 2건 + 거부형 12문을
양 컬렉션에서 회수해 Hit@1/Hit@5·표적 회수·거부형 최근접 거리를 비교한다(§3.3 관문 1~3).
실행(컬렉션별 1회): RAG_COLLECTION=<컬렉션> python ab_retrieval.py --tag <이름>
비교:               python ab_retrieval.py --compare --tags old,new
"""
import argparse
import importlib.util
import json
import pathlib
import random
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
AB = HERE / "ab"
AB.mkdir(exist_ok=True)
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "tools"))  # rag_core 내부 import(bm25_index 등) 해석용
from daily_common import load_bank  # noqa: E402

# 표적 실측 케이스(2026-07-24 A/B에서 검색실패로 확정 — specs/01 §0)
TARGETS = [
    {"질문": "중복게재란 무엇입니까?", "정답규정": "연구부정행위"},
    {"질문": "단순 명패 제작 시 공란으로 몇 개씩 여분을 준비해야 하나요?", "정답규정": "학술행사진행가이드"},
]


def pick():
    bank = load_bank()
    golden = [b for b in bank if b.get("골든") and b.get("유형") != "거부형"
              and b.get("상태") not in ("retire", "stale")]
    refuse = [b for b in bank if b.get("유형") == "거부형"]
    random.seed(42)  # ab_model_test와 동일 세트
    return random.sample(golden, min(100, len(golden))), refuse


def name_hit(want: str, got: str) -> bool:
    w, g = (want or "").strip(), (got or "").strip()
    return bool(w and g and (w in g or g in w))


def run(tag: str) -> int:
    spec = importlib.util.spec_from_file_location("rag_core", ROOT / "tools" / "rag_core.py")
    rc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rc)
    print(f"[{tag}] COLLECTION={rc.COLLECTION}")
    golden, refuse = pick()
    out = []
    for b in golden:
        want = (b.get("출처") or {}).get("규정명", "")
        _, srcs = rc.retrieve(b["질문"])
        names = [s.get("규정명", "") for s in srcs]
        out.append({"kind": "golden", "질문": b["질문"], "want": want, "got": names,
                    "hit1": name_hit(want, names[0] if names else ""),
                    "hit5": any(name_hit(want, n) for n in names[:5])})
    for t in TARGETS:
        _, srcs = rc.retrieve(t["질문"])
        names = [s.get("규정명", "") for s in srcs]
        out.append({"kind": "target", "질문": t["질문"], "want": t["정답규정"], "got": names,
                    "hit5": any(name_hit(t["정답규정"], n) for n in names[:5])})
    for b in refuse:
        _, srcs = rc.retrieve(b["질문"])
        out.append({"kind": "refuse", "질문": b["질문"],
                    "got": [s.get("규정명", "") for s in srcs][:3]})
    (AB / f"retrieval.{tag}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    g = [r for r in out if r["kind"] == "golden"]
    print(f"[{tag}] Hit@1 {sum(r['hit1'] for r in g)}/{len(g)} · Hit@5 {sum(r['hit5'] for r in g)}/{len(g)}"
          f" · 표적 {sum(r['hit5'] for r in out if r['kind'] == 'target')}/2")
    return 0


def compare(tags):
    data = {t: json.loads((AB / f"retrieval.{t}.json").read_text(encoding="utf-8")) for t in tags}
    old, new = tags
    go = [r for r in data[old] if r["kind"] == "golden"]
    gn = [r for r in data[new] if r["kind"] == "golden"]
    print(f"| 지표 | {old} | {new} |")
    print("|---|---|---|")
    print(f"| Hit@1 | {sum(r['hit1'] for r in go)}/{len(go)} | {sum(r['hit1'] for r in gn)}/{len(gn)} |")
    print(f"| Hit@5 | {sum(r['hit5'] for r in go)}/{len(go)} | {sum(r['hit5'] for r in gn)}/{len(gn)} |")
    to = {r["질문"]: r for r in data[old] if r["kind"] == "target"}
    tn = {r["질문"]: r for r in data[new] if r["kind"] == "target"}
    for q in to:
        print(f"| 표적: {q[:22]} | {'✅' if to[q]['hit5'] else '❌'} {to[q]['got'][:3]} | "
              f"{'✅' if tn[q]['hit5'] else '❌'} {tn[q]['got'][:3]} |")
    # 회귀(구에서 hit였는데 신에서 미스)
    lost = [(a["질문"], a["want"], b["got"][:3]) for a, b in zip(go, gn) if a["hit5"] and not b["hit5"]]
    won = sum(1 for a, b in zip(go, gn) if not a["hit5"] and b["hit5"])
    print(f"\n신규 회수 +{won} · 손실 -{len(lost)}")
    for q, w, g2 in lost:
        print(f"  ⚠ 손실: {q[:40]} (want {w}) → {g2}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag")
    ap.add_argument("--compare", action="store_true")
    ap.add_argument("--tags", default="old,new")
    a = ap.parse_args()
    if a.compare:
        sys.exit(compare([t.strip() for t in a.tags.split(",")]))
    if not a.tag:
        ap.error("--tag 필요")
    sys.exit(run(a.tag))
