#!/usr/bin/env python3
"""01k2_journey_freshness.py — 업무 한 장(여정)의 신선도 감시 (specs/13 T01).

여정은 **사람이 손으로** 만든다(docs/25). 그래서 규정이 개정·삭제되면 조용히 낡는다 —
지금은 낡았는지 알 방법이 아예 없다. 틀린 안내는 없는 안내보다 나쁘다
(⛔절대규칙 1의 확장: 지어내지 않는 것뿐 아니라, 지어낸 적 없는 말이 사실이 아니게 된 것도 잡는다).

하는 일: 여정 노드의 `근거`(규정명·조)를 `article_status.json`(01k)과 결정적으로 대조.
  · 삭제 조문을 가리키는 노드        → `삭제`(가장 급함 — 없는 조문을 안내 중)
  · 최근 개정된 조문을 가리키는 노드 → `개정`(내용이 달라졌을 수 있음)
  · 인덱스에 없는 근거               → `미확인`(오타·규정명 변경 의심)
⛔ 고치지 않는다 — 리포트만. 여정 수정은 사람이 원문을 보고 한다(볼트 큐레이션 원칙).
   LLM 미사용·결정적. 재색인(02) 후 조문효력(01k) 다음에 돌린다.

출력: tools/index/journey_freshness.json
실행: python tools/01k2_journey_freshness.py --vault KEI-행정가이드 [--since 2026-01-01]
"""
import argparse
import collections
import datetime
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
INDEX = ROOT / "tools" / "index"
SEVERITY = {"삭제": 3, "미확인": 2, "개정": 1}   # 여정 배지는 하나만 — 가장 급한 것


def _norm_date(s: str) -> str:
    """'2023.11.27' · '2023-11-27' → '2023-11-27'. 형식이 섞여 있어 비교 전 통일한다."""
    parts = [p for p in (s or "").strip().replace(".", "-").split("-") if p]
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return ""
    y, m, d = parts
    return f"{y}-{int(m):02d}-{int(d):02d}"


def scan(vault: pathlib.Path, since: str) -> dict:
    st_path = INDEX / "article_status.json"
    if not st_path.exists():
        print(f"⚠ {st_path} 없음 — 01k_article_status.py를 먼저 실행하세요", file=sys.stderr)
        return {}
    articles = json.loads(st_path.read_text(encoding="utf-8")).get("articles") or {}

    # ⚠ 여정의 `근거`는 규정만 가리키지 않는다 — ERP 상세가이드·시스템 문서도 같은 필드를 쓴다
    #   (실측 2026-08-03: 첫 실행에서 '미확인' 22건이 전부 ERP 문서였다. 규정이 아닌 것을
    #   "조문이 사라졌다"고 경고하면 경보가 무의미해진다). 조문 인덱스에 **규정명 자체가
    #   없으면** 애초에 규정이 아니므로 감시 대상에서 뺀다(집계에만 남긴다).
    known_regs = {k.split("#", 1)[0] for k in articles}
    jdir = vault / "90_관리" / "_journeys"
    out, counts = [], collections.Counter()
    for f in sorted(jdir.glob("*.json")):
        j = json.loads(f.read_text(encoding="utf-8"))
        for node in j.get("nodes") or []:
            for b in node.get("근거") or []:
                reg, art = (b.get("규정명") or "").strip(), (b.get("조") or "").strip()
                if not reg:
                    continue
                # 별표·별지는 조문 효력 인덱스의 대상이 아니다(조문 단위가 아님) — 미확인으로 몰지 않는다
                if art.startswith(("별표", "별지", "서식")):
                    # ⚠ 감시 사각지대다 — 별표는 조문 단위가 아니라 효력 인덱스에 없다.
                    #   별표가 개정돼도 이 도구는 모른다. 숨기지 말고 세어서 드러낸다.
                    counts["미감시-별표"] += 1
                    continue
                if reg not in known_regs:      # 규정이 아닌 근거(ERP·가이드 문서) — 감시 대상 아님
                    counts["비규정"] += 1
                    continue
                counts["감시"] += 1
                rec = articles.get(f"{reg}#{art}") if art else None
                if art and rec is None:
                    sev, why = "미확인", "조문 효력 인덱스에 없음(규정명·조 표기 확인 필요)"
                elif rec and rec.get("status") == "삭제":
                    sev, why = "삭제", f"삭제된 조문(삭제일 {rec.get('삭제일') or '미상'})"
                elif rec and _norm_date(rec.get("최근개정일", "")) >= since:
                    sev, why = "개정", f"최근 개정 {_norm_date(rec.get('최근개정일', ''))}"
                else:
                    continue
                counts[sev] += 1
                out.append({"여정": j.get("id") or f.stem, "제목": j.get("title") or "",
                            "노드": node.get("id"), "단계": node.get("stage"),
                            "노드명": node.get("name"), "규정명": reg, "조": art,
                            "심각도": sev, "사유": why})

    per: dict = {}
    for r in out:
        cur = per.setdefault(r["여정"], {"여정": r["여정"], "제목": r["제목"],
                                         "최고심각도": "", "건수": 0})
        cur["건수"] += 1
        if SEVERITY[r["심각도"]] > SEVERITY.get(cur["최고심각도"], 0):
            cur["최고심각도"] = r["심각도"]
    return {"generated": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
            "기준일": since, "집계": dict(counts), "여정별": per, "항목": out,
            # 감시한 근거 수 — 경고 0건이 "전부 확인됨"으로 오독되지 않게 분모를 같이 준다
            "커버리지": {"감시": counts["감시"], "미감시_별표": counts["미감시-별표"],
                       "비규정": counts["비규정"]}}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", default=str(ROOT / "KEI-행정가이드"))
    ap.add_argument("--since", default="", help="이 날짜 이후 개정을 '개정'으로 본다(기본 1년 전)")
    a = ap.parse_args()
    since = a.since or (datetime.date.today() - datetime.timedelta(days=365)).isoformat()
    res = scan(pathlib.Path(a.vault), since)
    if not res:
        return 1
    INDEX.mkdir(parents=True, exist_ok=True)
    (INDEX / "journey_freshness.json").write_text(
        json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    c = res["집계"]
    print(f"여정 신선도: 삭제 {c.get('삭제', 0)} · 미확인 {c.get('미확인', 0)} · "
          f"개정 {c.get('개정', 0)} (기준일 {since}) → tools/index/journey_freshness.json")
    # 커버리지를 함께 찍는다 — "경고 0건"이 "다 봤는데 괜찮다"로 읽히면 안 된다.
    print(f"  커버리지: 감시 {res['커버리지']['감시']}건 · "
          f"미감시(별표) {c.get('미감시-별표', 0)}건 · 비규정 근거 {c.get('비규정', 0)}건")
    for r in res["항목"]:
        if r["심각도"] in ("삭제", "미확인"):
            print(f"  {'⛔' if r['심각도'] == '삭제' else '⚠'} {r['여정']}/{r['노드']} "
                  f"{r['노드명']} — {r['규정명']} {r['조']}: {r['사유']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
