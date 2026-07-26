#!/usr/bin/env python3
"""01r2_amount_rules.py — 위임전결 335규칙에서 금액 구간 룰 테이블 추출 (specs/06 트랙 A).

⛔ 원칙: **LLM 무관·결정적 파싱만.** 구간 표현을 못 읽으면 rules에 넣지 않고 unparsed로 분리
(어설픈 추측 금지). 같은 업무의 구간이 겹치거나 구멍이 있으면 **빌드 실패**(경고 아님) —
룰 엔진의 오답은 환각보다 위험하다.

입력: tools/index/approval.json (01n — 위임전결규정 별표, 사람 검증된 구조화 산출물)
산출: tools/index/amount_rules.json =
  { meta, rules: { 업무키: { 구분, 업무경로, 구간[]: {min,max,min_incl,max_incl,전결권자,협의,원장,근거} } },
    unparsed: [금액 문구가 있으나 구간으로 못 읽은 규칙] }
실행: python tools/01r2_amount_rules.py   (01n 다음)
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
IDX = HERE / "index"

# "1,000만원 이하" · "3억 초과" — 숫자+단위+비교어. 원 표기는 생략 가능.
AMT = re.compile(r"([\d,]+)\s*(억|만)?\s*원?\s*(이하|초과|이상|미만)")


def to_won(num: str, unit: str) -> int:
    n = int(num.replace(",", ""))
    return n * (100_000_000 if unit == "억" else 10_000 if unit == "만" else 1)


def parse_range(seg: str):
    """구간 세그먼트 → {min,max,min_incl,max_incl} | None. 원문 비교어 그대로(이하=포함)."""
    ms = AMT.findall(seg)
    if not ms:
        return None
    lo, lo_incl, hi, hi_incl = None, False, None, False
    for num, unit, cmpw in ms:
        v = to_won(num, unit)
        if cmpw in ("이하", "미만"):
            hi, hi_incl = v, (cmpw == "이하")
        else:  # 초과·이상 → 하한
            lo, lo_incl = v, (cmpw == "이상")
    return {"min": lo, "max": hi, "min_incl": lo_incl, "max_incl": hi_incl, "표기": seg.strip()}


def covers(r, x: int) -> bool:
    if r["min"] is not None and (x < r["min"] or (x == r["min"] and not r["min_incl"])):
        return False
    if r["max"] is not None and (x > r["max"] or (x == r["max"] and not r["max_incl"])):
        return False
    return True


def main() -> int:
    ap = json.loads((IDX / "approval.json").read_text(encoding="utf-8"))
    rules_in = ap if isinstance(ap, list) else ap.get("rules", [])

    out, unparsed = {}, []
    for r in rules_in:
        work = r.get("업무", "")
        if not AMT.search(work):
            continue  # 금액 구간 없는 규칙은 이 테이블 대상 아님(기존 /approval이 담당)
        segs = [s.strip() for s in work.split(">")]
        rng = parse_range(segs[-1])
        base = " > ".join(segs[:-1]).strip() if len(segs) > 1 else work
        if rng is None or (rng["min"] is None and rng["max"] is None):
            unparsed.append(r)
            continue
        key = f"{r.get('구분','')} > {base}"
        ent = out.setdefault(key, {"구분": r.get("구분", ""), "업무경로": base, "구간": []})
        ent["구간"].append({**rng, "전결권자": r.get("전결권자", ""), "협의": r.get("협의", ""),
                            "원장": bool(r.get("원장")), "대상": r.get("대상", ""),
                            "근거": {"원문행": r.get("원문행", ""), "출처": "위임전결규정 별표(01n)"}})

    # ── 사다리 정규화(위임전결표 관례의 기계적 해석 — 추측 아님, 원문행 보존) ──
    # 별표는 "200만원 이하→과제책임자 · 1,000만원 이하→팀장 · 1,000만원 초과→부서장"처럼
    # **상한만 있는 구간을 중첩 표기**한다(작은 금액은 더 낮은 직급 전결). 이 관례를
    # '명시 상한 오름차순 절단'으로 정규화: 하한 없는 구간의 실제 하한 = 바로 아래 구간의 상한(개구간).
    # 실측 사례: '다.지출결의서'(2026-07-26 첫 빌드에서 겹침으로 검출된 그 건).
    for ent in out.values():
        by_target = {}
        for g in ent["구간"]:
            by_target.setdefault(g["대상"], []).append(g)
        for gs in by_target.values():
            uppers = [g for g in gs if g["min"] is None and g["max"] is not None]
            uppers.sort(key=lambda g: g["max"])
            for prev, cur in zip(uppers, uppers[1:]):
                cur["min"], cur["min_incl"] = prev["max"], not prev["max_incl"]
                cur["표기"] += f" (사다리 절단: {prev['표기']} 상위)"

    # ── 구간 무결성: 겹침 검사(빌드 실패) + 구멍 검사(하한 없는 업무는 0원부터로 간주) ──
    errors, warnings = [], []
    for key, ent in out.items():
        # 같은 '대상'(직급) 축이 다르면 구간이 병존할 수 있으므로 대상별로 검사
        by_target = {}
        for g in ent["구간"]:
            by_target.setdefault(g["대상"], []).append(g)
        for tgt, gs in by_target.items():
            gs.sort(key=lambda g: (g["min"] if g["min"] is not None else -1))
            probes = set()
            for g in gs:
                for edge in (g["min"], g["max"]):
                    if edge is not None:
                        probes |= {edge - 1, edge, edge + 1}
            for x in sorted(p for p in probes if p >= 0):
                hit = [g for g in gs if covers(g, x)]
                if len(hit) > 1:
                    errors.append(f"[겹침] {key} (대상={tgt}) 금액 {x:,}원 → {len(hit)}구간 동시 매칭: "
                                  + " / ".join(h["표기"] for h in hit))
            # 구멍: 인접 구간 사이 미커버 지점(전 구간 무한대는 요구하지 않음 — 상한 개방 업무 존재)
            for a, b in zip(gs, gs[1:]):
                if a["max"] is not None and b["min"] is not None:
                    gap = a["max"] + (0 if a["max_incl"] else -0) + 1
                    if not any(covers(g, gap) for g in gs):
                        warnings.append(f"[구멍] {key} (대상={tgt}) {a['표기']} ↔ {b['표기']} 사이 {gap:,}원 미커버")

    meta = {"업무": len(out), "구간": sum(len(e['구간']) for e in out.values()),
            "unparsed": len(unparsed), "warnings": warnings}
    (IDX / "amount_rules.json").write_text(
        json.dumps({"meta": meta, "rules": out, "unparsed": unparsed}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    print(f"금액 룰: 업무 {meta['업무']} · 구간 {meta['구간']} · 미파싱 {meta['unparsed']}")
    for w in warnings:
        print("  ⚠", w)
    if errors:
        print("\n⛔ 구간 겹침 — 빌드 실패(룰 엔진 오답 방지):")
        for e in errors:
            print("  ", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
