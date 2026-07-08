#!/usr/bin/env python3
"""01j_defterms.py — 규정 원문 정의어 사전 + 교차 정의충돌 탐지 (Track A).

원문을 **읽기 전용**으로 훑어 법적 정의 바인딩을 규정별로 인덱싱한다:
  · 정의형 — '"X"란 …을 말한다' / '"X"라 함은 …' (완전 정의)
  · 약칭형 — '한국환경연구원(이하 "연구원"이라 한다)' (앞 확장명이 정의)
같은 용어가 2개 이상 규정에서 **서로 다르게** 정의되면 conflict로 표시.

산출: tools/index/defterms.json = {meta, terms:{term:[{규정명,조,정의,form,path}]}, conflicts:[…]}
용도: ⓐ 웹 '이 규정 기준 정의(제N조)' 원문 표시 + 규정마다 다른 정의 비교
      ⓑ /browse '정의어' 검색 범위(term→규정 역탐색).
⚠ 손으로 쓴 30_용어집(term 노트)과 별개 — 이건 규정 원문 자체의 정의를 기계 추출한 것.

실행: python tools/01j_defterms.py --vault KEI-행정가이드
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import vault_parse as vp

_Q = '"“”‘’' + "'"                       # 직선·곡선 따옴표 모두
_TERM = rf'[{_Q}]([^{_Q}\n]{{1,30}})[{_Q}]'
# 완전 정의만 — '이라 한다/라 한다'는 약칭(아래)이라 제외해야 목적문 오탐(연구원=…목적…)을 막는다.
_DEF_FULL = re.compile(_TERM + r'\s*(?:이란|란|이라 함은|라 함은)')
_ABBR = re.compile(r'이하\s*' + _TERM + r'\s*(?:이라|라)\s*(?:한다|약칭한다|칭한다)')  # 약칭


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip(" .\"'“”·,")


def _norm(s: str) -> str:
    return re.sub(r"\W", "", s)                              # 충돌 비교용 정규화


def extract(vault: str):
    terms = {}
    n_bind = 0
    for r in vp.iter_regulations(vault):
        for label, _title, body in r["articles"]:
            found = []
            # 완전 정의: 뒤 ~140자에 '말한다'가 있을 때만 채택(없으면 목적문 오탐) — 정의문만
            for m in _DEF_FULL.finditer(body):
                term = _clean(m.group(1))
                tail = body[m.end(): m.end() + 140]
                cut = tail.find("말한다")
                if cut < 0:
                    continue                                # '…을 말한다'로 끝나는 진짜 정의만
                found.append((term, _clean(tail[: cut + 3]) or "(정의문 확인)", "정의"))
            # 약칭: '…EXPANSION(이하 "X"라 한다)' → 확장명(괄호 앞 마지막 어절)만 취해 주어절 잡음 제거
            for m in _ABBR.finditer(body):
                term = _clean(m.group(1))
                clause = [s for s in re.split(r"[(（]", body[max(0, m.start() - 45): m.start()]) if s.strip()]
                toks = (clause[-1] if clause else "").split()
                head = _clean(toks[-1]) if toks else ""      # 예 '이 요령은 한국환경연구원' → 한국환경연구원
                found.append((term, head or "(원문 확인)", "약칭"))
            for term, dfn, form in found:
                # 잡음 용어 제외: 너무 짧거나, 서술어/괄호/따옴표 파편이 섞인 오추출('라 한다)' 등)
                if len(term) < 2 or re.search(r"한다|말한다|[)(」「”“]", term):
                    continue
                terms.setdefault(term, []).append({
                    "규정명": r["규정명"], "규정번호": r["규정번호"], "분류": r["분류"],
                    "조": label, "정의": dfn, "form": form, "path": r["path"],
                    "검수상태": r["검수상태"],
                })
                n_bind += 1

    # 교차 정의충돌: 같은 용어가 서로 다른 규정에서 상이하게 '정의'(…을 말한다)됨.
    # ⚠ 약칭(기관명 확장)은 제외 — '연구원=한국환경연구원'류는 의미충돌 아님(표기·오탈자 잡음).
    conflicts = []
    for term, defs in terms.items():
        full = [d for d in defs if d["form"] == "정의"]
        by_norm = {}
        for d in full:
            by_norm.setdefault(_norm(d["정의"]), d)
        regset = {d["규정명"] for d in full}
        if len(by_norm) >= 2 and len(regset) >= 2:
            conflicts.append({
                "term": term,
                "정의수": len(by_norm),
                "규정수": len(regset),
                "정의들": [{"규정명": d["규정명"], "조": d["조"], "정의": d["정의"], "form": d["form"]}
                          for d in by_norm.values()],
            })
    conflicts.sort(key=lambda c: (-c["규정수"], -c["정의수"]))

    meta = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "정의바인딩": n_bind, "고유용어": len(terms), "충돌용어": len(conflicts),
        "충돌_top": [c["term"] for c in conflicts[:12]],
    }
    return {"meta": meta, "terms": terms, "conflicts": conflicts}


def main():
    ap = argparse.ArgumentParser(description="규정 정의어 사전 + 충돌 탐지(Track A)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--out", default=str(Path(__file__).parent / "index" / "defterms.json"))
    args = ap.parse_args()
    data = extract(args.vault)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    m = data["meta"]
    print(f"✅ {args.out}")
    print(f"   정의바인딩 {m['정의바인딩']} · 고유용어 {m['고유용어']} · 충돌용어 {m['충돌용어']}")
    print("   충돌 top:", ", ".join(m["충돌_top"][:8]))


if __name__ == "__main__":
    main()
