#!/usr/bin/env python3
"""01s_conflict_scan.py — 코퍼스 정합성 감사: 문서 간 충돌 후보 채굴 (결정적).

세 갈래로 '이해충돌 후보'를 찾는다(판정은 사람/후속 검증 — 이 스크립트는 후보만):
  ① 주제-수치 충돌: 같은 주제 앵커(숙박비 상한·경조금·자문수당…) 주변 수치가 문서마다 다름
  ② 가이드 낙후: 가이드 작성/검토 시점보다 인용 규정의 개정일이 최신(가이드가 옛 규정 기준일 위험)
  ③ 중복 수록: 같은 제목 문서가 규정원문/가이드 양쪽에 존재(버전 불일치 위험)

실행: .venv/bin/python tools/01s_conflict_scan.py --vault KEI-행정가이드
산출: tools/index/conflict_candidates.json (검증 파이프라인·검수 큐 소비용)
"""
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

# 주제 앵커: (주제명, 앵커 정규식, 값 단위 정규식). 앵커 ±80자 창에서 값을 캔다.
TOPICS = [
    ("숙박비 상한", r"숙박비[^\n]{0,20}(상한|한도|기준)?", r"\d{1,3}(?:,\d{3})+원?|\d+만\s*원"),
    ("일비", r"일비", r"\d{1,3}(?:,\d{3})+원?|\d+만\s*원"),
    ("식비", r"식비", r"\d{1,3}(?:,\d{3})+원?|\d+만\s*원"),
    ("자문수당", r"자문(수당|료)", r"\d{1,3}(?:,\d{3})+원?|\d+만\s*원"),
    ("회의수당", r"회의(수당|비)", r"\d{1,3}(?:,\d{3})+원?|\d+만\s*원"),
    ("원고료", r"원고료", r"\d{1,3}(?:,\d{3})+원?|\d+만\s*원"),
    ("강사료·강의료", r"강(사|의)료", r"\d{1,3}(?:,\d{3})+원?|\d+만\s*원"),
    ("경조금", r"경조금|경조사비|조의금|축의금", r"\d{1,3}(?:,\d{3})+원?|\d+만\s*원"),
    ("연차휴가 일수", r"연차\s*(유급)?휴가", r"\d{1,2}\s*일"),
    ("출산휴가", r"출산(전후)?휴가", r"\d{1,3}\s*일"),
    ("육아휴직 기간", r"육아휴직", r"\d{1,2}\s*(년|개월)"),
    ("배우자 출산휴가", r"배우자\s*출산", r"\d{1,3}\s*일"),
    ("일상감사 기준", r"일상감사", r"\d{1,3}(?:,\d{3})+원?|\d+(?:천|백)?만\s*원|\d+억\s*원"),
    ("수의계약 한도", r"수의계약", r"\d{1,3}(?:,\d{3})+원?|\d+(?:천|백)?만\s*원|\d+억\s*원"),
    ("법인카드 한도", r"법인카드[^\n]{0,25}(한도|이내|초과)", r"\d{1,3}(?:,\d{3})+원?|\d+(?:천|백)?만\s*원"),
    ("초과근무 수당율", r"(연장|초과|야간|휴일)근(로|무)[^\n]{0,25}(수당|가산)", r"\d{2,3}\s*(퍼센트|%)|100분의\s*\d+"),
    ("정산 기한(출장)", r"(출장|여비)[^\n]{0,30}정산", r"\d{1,2}\s*일\s*이내"),
    ("복명 기한", r"복명|출장복명서", r"\d{1,2}\s*일\s*이내"),
    ("퇴직금 지급 기한", r"퇴직금", r"\d{1,2}\s*일\s*이내"),
    ("겸직 허가", r"겸직", r"\d{1,2}\s*(년|개월|시간)"),
]

DATE_RE = re.compile(r"(20\d{2})[.\-/년\s]{1,3}(\d{1,2})[.\-/월\s]{1,3}(\d{1,2})")


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


def doc_date(meta, stem):
    """문서의 기준 시점 근사: 개정일 > 최종검토일 > 파일명/제목의 연도 표기."""
    for k in ("개정일", "최종검토일", "검토일"):
        v = meta.get(k, "")
        m = DATE_RE.search(v or "")
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.search(r"(20\d{2})", stem)
    if m:
        return f"{m.group(1)}-01-01"
    m2 = re.search(r"\((\d{2})\.(\d{2})", stem)  # (25.09.) 표기
    if m2:
        return f"20{m2.group(1)}-{m2.group(2)}-01"
    return ""


def norm_value(v: str) -> str:
    v = v.replace(" ", "")
    m = re.match(r"^([\d,]+)원?$", v)
    if m:
        return f"{int(m.group(1).replace(',', '')):,}원"
    m = re.match(r"^(\d+)만원?$", v)
    if m:
        return f"{int(m.group(1)) * 10000:,}원"
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", required=True)
    ap.add_argument("--out", default="tools/index/conflict_candidates.json")
    args = ap.parse_args()
    vault = Path(args.vault)

    # RAG 코퍼스 제외 문서(구판·이중수록 등, exclude.json)는 충돌 스캔에서도 제외 —
    # 이 감사의 목적이 'RAG가 답할 수 있는 텍스트'의 정합성이기 때문.
    excluded = set()
    exp = Path(__file__).parent / "index" / "exclude.json"
    if exp.exists():
        try:
            excluded = set(json.loads(exp.read_text(encoding="utf-8")).get("excluded", []))
        except Exception:
            pass

    docs = []  # (title, type, date, rel, body)
    for md in sorted(vault.rglob("*.md")):
        if "90_관리" in md.parts or md.stem in excluded:
            continue
        meta, body = split_fm(md.read_text(encoding="utf-8", errors="ignore"))
        if not meta.get("type"):
            continue
        # 최신값 단일화(docs/28): 취소선 옛값·outdated 주석은 RAG에서 제외되므로 스캔에서도 제거
        body = re.sub(r"<!--outdated[^>]*-->", "", body)
        body = re.sub(r"~~[^~\n]+~~ ?", "", body)
        title = (meta.get("규정명") or meta.get("제목") or md.stem).strip()
        docs.append((title, meta.get("type"), doc_date(meta, md.stem), str(md.relative_to(vault)), body))

    # ① 주제-수치 충돌
    topic_hits = defaultdict(lambda: defaultdict(list))  # topic -> value -> [(title, type, date, 문장)]
    for topic, anchor, valre in TOPICS:
        a_re, v_re = re.compile(anchor), re.compile(valre)
        for title, typ, date, rel, body in docs:
            for m in a_re.finditer(body):
                win = body[max(0, m.start() - 80): m.end() + 80]
                for vm in v_re.finditer(win):
                    val = norm_value(vm.group())
                    sent = win.replace("\n", " ").strip()
                    rows = topic_hits[topic][val]
                    if len(rows) < 50 and all(r["문서"] != title for r in rows):
                        rows.append({"문서": title, "type": typ, "날짜": date,
                                     "파일": rel, "문맥": sent[:180]})
    value_conflicts = []
    for topic, byval in topic_hits.items():
        vals = {v: rows for v, rows in byval.items() if rows}
        # 서로 다른 문서에서 서로 다른 값 → 후보(같은 문서 내 다중 값은 조건별 정상일 수 있어 제외)
        if len(vals) >= 2:
            docs_per_val = {v: sorted({r["문서"] for r in rows}) for v, rows in vals.items()}
            all_docs = set().union(*docs_per_val.values())
            if len(all_docs) >= 2:
                value_conflicts.append({
                    "주제": topic,
                    "값들": {v: {"문서들": docs_per_val[v], "예": rows[0]} for v, rows in vals.items()},
                })

    # ② 가이드 낙후: 가이드가 인용([[규정명...]])한 규정의 개정일 > 가이드 날짜
    reg_date = {t: d for t, ty, d, _, _ in docs if ty == "regulation" and d}
    stale = []
    LINK = re.compile(r"\[\[([^\]|#]+)")
    for title, typ, date, rel, body in docs:
        if typ != "guide" or not date:
            continue
        for m in set(LINK.findall(body)):
            ref = m.strip()
            base = re.sub(r"^\d{4}_", "", ref)
            rd = reg_date.get(base) or reg_date.get(ref)
            if rd and rd > date:
                stale.append({"가이드": title, "가이드날짜": date, "인용규정": base,
                              "규정개정일": rd, "파일": rel})

    # ③ 중복 수록(같은 제목이 규정/가이드 양쪽)
    by_title = defaultdict(list)
    for title, typ, date, rel, _ in docs:
        by_title[title].append({"type": typ, "날짜": date, "파일": rel})
    dups = [{"제목": t, "수록": rows} for t, rows in by_title.items()
            if len({r["type"] for r in rows}) >= 2 or len(rows) >= 2]

    out = {"value_conflicts": value_conflicts, "stale_guides": stale, "duplicates": dups}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"① 주제-수치 충돌 후보: {len(value_conflicts)}주제")
    for c in value_conflicts:
        print(f"   [{c['주제']}] 값 {len(c['값들'])}종 — " +
              " vs ".join(f"{v}({len(d['문서들'])}문서)" for v, d in list(c["값들"].items())[:4]))
    print(f"② 낙후 의심 가이드(규정 개정일 > 가이드 날짜): {len(stale)}건")
    for s in stale[:10]:
        print(f"   {s['가이드']}({s['가이드날짜']}) ← {s['인용규정']} 개정 {s['규정개정일']}")
    print(f"③ 중복 수록: {len(dups)}건")
    for d in dups[:10]:
        print(f"   {d['제목']}: " + ", ".join(f"{r['type']}({r['날짜'] or '?'})" for r in d["수록"]))
    print(f"\n→ {args.out}")


if __name__ == "__main__":
    main()
