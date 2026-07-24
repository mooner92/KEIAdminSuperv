#!/usr/bin/env python3
"""01r_seasonal_survey.py — 대외요구자료 시즌캘린더 3개년 원본 → 캘린더 월 상세 데이터 + 볼트 노트.

배경(2026-07-24 사용자 지적): 원본 전수조사 722KB가 볼트에 6%(44KB)만 적재돼 /calendar가
부실 — 원본의 정수(월별 건수 3개년·월별 특징·국정감사/결산 연간 사이클)를 결정적으로 추출한다.
⛔ 전부 '운영 통계 — 규정 아님' 라벨(docs/39 규약). 수치는 원본 관측치 그대로(창작 0).

산출:
  ① KEI-행정가이드/90_관리/_calendar/monthly_survey.json — /calendar 월 상세 뷰 데이터
  ② KEI-행정가이드/50_대외업무/대외업무 연간 사이클.md — RAG용 노트(월별 특징·사이클 원문)
실행: python tools/01r_seasonal_survey.py [--src ~/erps/"대외업무 시즌캘린더"]
"""
import argparse
import json
import re
from pathlib import Path

VAULT = Path(__file__).resolve().parent.parent / "KEI-행정가이드"

# 월 상세 카드 → 관련 볼트 노트(50_대외업무) 키워드 수동 맵(소규모·결정적)
NOTE_MAP = [
    (r"국정감사|국감", ["국정감사총괄표", "국정감사본감사", "국정감사후속조치"]),
    (r"결산", ["결산회계대외업무"]),
    (r"예산", ["예산편성심의"]),
    (r"인력|현원|정원", ["인력현황제출", "인력증원심의"]),
    (r"채용|인사", ["채용인사대외업무"]),
    (r"법인카드", ["법인카드모니터링"]),
    (r"출연금|집행률", ["출연금교부집행률"]),
    (r"공시", ["통합공시수정공시"]),
    (r"수요조사", ["수요조사대응"]),
]


def year_label(name: str) -> str:
    m = re.search(r"(\d{4})(\d{4})-(\d{4})(\d{4})", name)
    return f"{m.group(1)}.{m.group(2)[:2]}~{m.group(3)}.{m.group(4)[:2]}" if m else name


def section(text: str, head_pat: str) -> str:
    """### 헤딩(head_pat 매칭)부터 다음 동급 헤딩 전까지."""
    m = re.search(rf"^(#{{2,3}} .*(?:{head_pat}).*)$", text, re.M)
    if not m:
        return ""
    start = m.end()
    level = m.group(1).split(" ")[0]
    nxt = re.search(rf"^#{{2,{len(level)}}} ", text[start:], re.M)
    return text[start:start + nxt.start()].strip() if nxt else text[start:].strip()


def parse_year(p: Path) -> dict:
    t = p.read_text(encoding="utf-8")
    out = {"label": year_label(p.name), "counts": {}, "features": {}, "common": "",
           "cycle_gam": "", "cycle_fin": "", "total": ""}
    m = re.search(r"총\s*\*?\*?([\d,]+)건\*?\*?", t)
    if m:
        out["total"] = m.group(1)
    # §2 월별 건수 표 — 연도별 표기 변형 흡수: '2025년 7월' | '2023-08'
    for mm in re.finditer(r"\|\s*(\d{4})(?:년\s*|[-.])(\d{1,2})월?\s*\|\s*([\d,]+)\s*건", t):
        out["counts"][int(mm.group(2))] = int(mm.group(3).replace(",", ""))
    # §3-2 월별 특징 — 3변형 흡수: '- **7월**:' | '- **2024년 7월**:' | '**9월(271건…)**:'
    feat = section(t, r"3-2")
    pat = re.compile(r"^(?:- )?\*\*(?:\d{4}년\s*)?(\d{1,2})월(?:\([^)]*\))?\*\*[:：]?\s*(.+?)(?=^(?:- )?\*\*(?:\d{4}년\s*)?\d{1,2}월|\Z)", re.M | re.S)
    for mm in pat.finditer(feat):
        out["features"][int(mm.group(1))] = re.sub(r"\s+", " ", mm.group(2)).strip()
    out["common"] = section(t, r"3-1")
    out["cycle_gam"] = section(t, r"3-3")
    out["cycle_fin"] = section(t, r"3-4")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(Path.home() / "erps" / "대외업무 시즌캘린더"))
    args = ap.parse_args()
    files = sorted(Path(args.src).glob("대외요구자료_시즌캘린더_*.md"))
    if not files:
        raise SystemExit("⛔ 원본 시즌캘린더 md 없음")
    years = [parse_year(p) for p in files]
    print("연도:", [y["label"] for y in years],
          "| 건수월 추출:", [len(y["counts"]) for y in years],
          "| 특징월:", [len(y["features"]) for y in years])

    # ① monthly_survey.json — 월별(1~12) 3개년 병합
    months = {}
    for mo in range(1, 13):
        works = set()
        feats = []
        for y in years:
            f = y["features"].get(mo, "")
            if f:
                feats.append({"year": y["label"], "text": f})
                for pat, notes in NOTE_MAP:
                    if re.search(pat, f):
                        works.update(notes)
        months[str(mo)] = {
            "counts": [{"year": y["label"], "n": y["counts"].get(mo)} for y in years],
            "features": feats,
            "notes": sorted(works),
        }
    out = {"generated_from": [p.name for p in files],
           "totals": [{"year": y["label"], "n": y["total"]} for y in years],
           "months": months}
    dst = VAULT / "90_관리" / "_calendar" / "monthly_survey.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"① {dst.relative_to(VAULT)} 기록")

    # ② 볼트 노트 — 최신 연도 중심 + 3개년 사이클 원문 인용
    latest = years[-1]
    note_lines = ["""---
type: guide
제목: "대외업무 연간 사이클"
분류: "대외업무"
대상: "전직원"
관련규정: []
관련서식: []
개정일: 2026-07
최종검토일:
검토자:
원본파일: "대외요구자료 시즌캘린더 3개년(01r_seasonal_survey 자동 추출)"
태그: ["대외업무", "운영통계", "캘린더"]
검수상태: 미검수
---

# 대외업무 연간 사이클

아래 수치·주기·건수는 대외업무관리시스템 3개년 관측 통계이며, 규정상 의무·기준값이 아니다.
월별 상세는 [[업무 캘린더|/calendar]]에서, 업무별 대응은 각 노트([[국정감사본감사]] 등) 참조.
"""]
    note_lines.append("#### 매월 공통 반복(상시)\n" + latest["common"] + "\n")
    note_lines.append("#### 월별 특징 (최신 관측연도 " + latest["label"] + ")")
    for mo in range(1, 13):
        f = latest["features"].get(mo)
        if f:
            note_lines.append(f"- **{mo}월**: {f}")
    note_lines.append("\n#### 정기국회·국정감사 연간 사이클\n" + latest["cycle_gam"])
    note_lines.append("\n#### 결산·회계 연간 사이클\n" + latest["cycle_fin"])
    npath = VAULT / "50_대외업무" / "대외업무 연간 사이클.md"
    npath.write_text("\n".join(note_lines) + "\n", encoding="utf-8")
    print(f"② {npath.relative_to(VAULT)} 기록 ({npath.stat().st_size//1024}KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
