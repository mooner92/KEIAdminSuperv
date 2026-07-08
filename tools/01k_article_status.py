#!/usr/bin/env python3
"""01k_article_status.py — 조문 효력·개정 시계열 추출 (Track A: 삭제 무결성 + 개정태그 마이닝).

원문(20_규정원문)을 **읽기 전용**으로 훑어 조문별 메타를 뽑는다(원문 불변·재임베딩 불필요):
  · 삭제 조문: '제N조 삭제' / '제N조(…) 삭제 <YYYY…>' / 본문이 '삭제'뿐인 조 → status=삭제(+삭제일)
  · 개정 시계열: 인라인 <개정 YYYY…> <신설 …> <전조개정 …> <전문개정 …> 태그 → 최근개정일·개정횟수·이력
  · 신설 조문: <신설 …> 태그 보유 → 신설=true(+신설일)

산출: tools/index/article_status.json = {meta, articles:{"규정명#제N조":{status,삭제일,신설,최근개정일,개정횟수,개정이력}}}
용도: rag_core 회수 시 '삭제 조문'을 근거에서 강등(절대 규칙1 방어) + 효력/최근개정 배지(웹).

실행: python tools/01k_article_status.py --vault KEI-행정가이드
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import vault_parse as vp

# "2024. 12. 2." | "2024.6.24" | "'02.10.1" (약식 2자리 연도) — 공백 유연
_DATE = re.compile(r"(?:(\d{4})|'(\d{2}))\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})")
# 효력·개정 관련 인라인 태그
_REV_TAG = re.compile(r"<\s*(개정|신설|전조개정|전문개정)\s*([^>]*)>")
_HEADER = re.compile(r"제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)]*\))?")


def _norm_year(y4, y2) -> int:
    if y4:
        return int(y4)
    yy = int(y2)                      # 약식: '97 → 1997, '02/'24 → 2002/2024 (KEI 설립 1993 기준)
    return 1900 + yy if yy >= 90 else 2000 + yy


def _dates(s: str):
    """문자열에서 (연,월,일, 표시문자열) 리스트. 정렬·비교용 튜플과 원문식 표기 동시 반환."""
    out = []
    for m in _DATE.finditer(s):
        y = _norm_year(m.group(1), m.group(2))
        mo, d = int(m.group(3)), int(m.group(4))
        out.append((y, mo, d, f"{y}.{mo}.{d}"))
    return out


def _is_deleted(body: str):
    """조 본문이 '삭제'만 남는지 판정(헤더·태그 제거 후). → (삭제여부, 삭제일 표시문자열)."""
    lead = body.lstrip()
    hm = _HEADER.match(lead)
    rest = lead[hm.end():] if hm else lead
    rest_notag = re.sub(r"<[^>]*>", "", rest)
    if re.sub(r"\s+", "", rest_notag) != "삭제":
        return False, ""
    ds = _dates(rest)                                # 삭제일: <삭제 …> 또는 뒤 날짜
    return True, (sorted(ds)[-1][3] if ds else "")


def extract(vault: str):
    articles = {}
    n_reg = n_art = n_del = n_new = 0
    hi_vol = []                                      # 고변동 조문(개정 잦음)
    for r in vp.iter_regulations(vault):
        n_reg += 1
        for label, title, body in r["articles"]:
            n_art += 1
            key = f"{r['규정명']}#{label}"
            deleted, del_date = _is_deleted(body)
            rev_dates, is_new, new_date = [], False, ""
            for kind, payload in _REV_TAG.findall(body):
                ds = _dates(payload)
                rev_dates += ds
                if kind == "신설":
                    is_new = True
                    if ds:
                        new_date = sorted(ds)[-1][3]
            uniq = sorted({(y, m, d): s for y, m, d, s in rev_dates}.items())
            latest = uniq[-1][1] if uniq else ""
            rec = {
                "규정명": r["규정명"], "규정번호": r["규정번호"], "분류": r["분류"],
                "조": label, "제목": title, "path": r["path"],
                "검수상태": r["검수상태"],
                "status": "삭제" if deleted else "유효",
                "삭제일": del_date,
                "신설": is_new, "신설일": new_date,
                "최근개정일": latest,
                "개정횟수": len(uniq),
                "개정이력": [s for _, s in uniq],
            }
            articles[key] = rec
            if deleted:
                n_del += 1
            if is_new:
                n_new += 1
            if len(uniq) >= 5:
                hi_vol.append((key, len(uniq)))
    hi_vol.sort(key=lambda x: -x[1])
    meta = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "규정수": n_reg, "조문수": n_art, "삭제조문": n_del, "신설조문": n_new,
        "고변동조문(개정5+)": len(hi_vol),
        "고변동_top": hi_vol[:15],
    }
    return {"meta": meta, "articles": articles}


def main():
    ap = argparse.ArgumentParser(description="조문 효력·개정 시계열 추출(Track A)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--out", default=str(Path(__file__).parent / "index" / "article_status.json"))
    args = ap.parse_args()
    data = extract(args.vault)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    m = data["meta"]
    print(f"✅ {args.out}")
    print(f"   규정 {m['규정수']} · 조문 {m['조문수']} · 삭제 {m['삭제조문']} · 신설 {m['신설조문']} · 고변동(5+) {m['고변동조문(개정5+)']}")
    print("   고변동 top:", ", ".join(f"{k}({n})" for k, n in m["고변동_top"][:6]))


if __name__ == "__main__":
    main()
