#!/usr/bin/env python3
"""daily_report.py — 아침 분석서(1단, LLM 0회·결정적).

배경: 매일 채점 결과(graded.json)는 쌓이는데 **해석은 사람이 손으로** 했다(2026-08-03에도
즉석 파이썬으로 어휘 갭·검색실패율을 계산했다). 그 계산을 코드로 굳힌 것이 이 파일이다.
⛔ LLM을 쓰지 않는다 — 매일 무인으로 도는 것은 틀릴 수 없어야 한다. 판단이 필요한 부분
   ("왜 틀렸나")은 2단(LLM 진단)의 몫으로 남긴다.

핵심은 **'수술 대기'와 '측정 노이즈'의 분리**다:
  · 수술 대기 = 검색실패·생성환각 — 서비스가 실제로 못 한 것
  · 측정 노이즈 = 출제결함·골든품질·판정불가 — 시험지가 이상했던 것
둘을 섞으면 "오답 40건"이고, 나누면 "고칠 것 13건 + 시험지 손볼 것 27건"이 된다.

출력: web/public/quality/reports/<date>.md(사람이 읽음 — 로그인 게이트 뒤 직서빙)
      web/public/quality/reports/<date>.json(게시판·2단이 소비)
실행: cd eval && ../tools/.venv/bin/python daily_report.py --date 2026-08-03
"""
import argparse
import collections
import datetime
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
DAILY = HERE / "daily"
REPORTS = ROOT / "web" / "public" / "quality" / "reports"

# 이 두 줄이 리포트의 뼈대다 — 무엇이 서비스 결함이고 무엇이 시험지 결함인가.
# '근거부적합'(2026-08-06 신설) = 근거는 회수됐는데 거부 — 검색이 아니라 인덱스 귀속·골든·
# 기능 배선을 봐야 하는 사안이다. 검색실패에 뭉뚱그리면 진짜 원인이 라벨 뒤에 숨는다
# (실측: 56건 중 9건이 그렇게 숨어 있었고, 1건은 7회차 연속 잘못 집계됐다).
SURGERY = ("검색실패", "생성환각", "근거부적합")
NOISE = ("출제결함", "골든품질", "판정불가-기타", "검토필요-기타")


def _rate(c: collections.Counter) -> float:
    """정답률 = 정답 / 채점된 것. ⛔ 폐기·판정불가는 분모에서 뺀다 — 채점이 성립하지 않은
    문항을 분모에 넣으면 시험지 결함이 서비스 점수를 깎는다(측정 오염)."""
    scored = sum(c.values()) - c["폐기"] - c["판정불가"]
    return round(100 * c["정답"] / scored, 1) if scored else 0.0


def _prev_round(date: str) -> str:
    """직전 회차명(같은 날 b·c 포함해 이름 순서상 바로 앞). 없으면 빈 문자열."""
    names = sorted(p.name[: -len(".graded.json")] for p in DAILY.glob("*.graded.json"))
    if date not in names:
        return ""
    i = names.index(date)
    return names[i - 1] if i > 0 else ""


def analyze(date: str) -> dict:
    g = json.loads((DAILY / f"{date}.graded.json").read_text(encoding="utf-8"))
    items = g.get("문항") or []

    by_layer: dict = collections.defaultdict(collections.Counter)
    sf_layer: collections.Counter = collections.Counter()
    by_topic: dict = collections.defaultdict(collections.Counter)
    by_reg: collections.Counter = collections.Counter()
    surgery, noise = [], collections.Counter()
    for q in items:
        lay = q.get("어휘층") or "기타"
        by_layer[lay][q["판정"]] += 1
        ft = q.get("실패유형") or ""
        if ft == "검색실패":
            sf_layer[lay] += 1
            by_reg[(q.get("출처") or {}).get("규정명") or "(출처없음)"] += 1
        for t in (q.get("주제") or ["(무주제)"]):
            by_topic[t][q["판정"]] += 1
        if ft in SURGERY:
            surgery.append({"id": q["id"], "질문": q["질문"], "판정": q["판정"], "실패유형": ft,
                            "규정": (q.get("출처") or {}).get("규정명") or "",
                            "조": (q.get("출처") or {}).get("조") or "",
                            "어휘층": q.get("어휘층") or "", "증거": (q.get("증거") or "")[:120]})
        elif ft in NOISE:
            noise[ft] += 1

    layers = {k: {"문항수": sum(v.values()), "정답률": _rate(v),
                  "검색실패": sf_layer.get(k, 0),
                  "검색실패율": round(100 * sf_layer.get(k, 0) / sum(v.values()), 1) if v else 0.0}
              for k, v in sorted(by_layer.items())}
    gap = None
    if "문서어" in layers and "일상어" in layers:
        gap = {"정답률차": round(layers["문서어"]["정답률"] - layers["일상어"]["정답률"], 1),
               "검색실패배수": round(layers["일상어"]["검색실패율"] / layers["문서어"]["검색실패율"], 1)
               if layers["문서어"]["검색실패율"] else None}

    # 짝 대조 — 같은 골든을 두 어휘로 물어 결과가 갈린 것(어휘 갭의 개별 증거)
    by_hash = {q.get("hash"): q for q in items if q.get("hash")}
    pairs = []
    for q in items:
        if q.get("어휘층") == "일상어" and q.get("쌍id") in by_hash:
            d = by_hash[q["쌍id"]]
            if d["판정"] != q["판정"]:
                pairs.append({"문서어": d["질문"], "문서어판정": d["판정"],
                              "일상어": q["질문"], "일상어판정": q["판정"],
                              "실패유형": q.get("실패유형") or d.get("실패유형") or ""})

    prev = _prev_round(date)
    prev_rate = None
    if prev:
        try:
            prev_rate = json.loads(
                (DAILY / f"{prev}.graded.json").read_text(encoding="utf-8")).get("정답률")
        except Exception:  # noqa: BLE001
            prev_rate = None

    weak = sorted(((t, _rate(c), sum(c.values())) for t, c in by_topic.items() if sum(c.values()) >= 5),
                  key=lambda x: x[1])[:5]
    return {
        "date": date, "문항수": len(items), "정답률": g.get("정답률"),
        "직전회차": prev, "직전정답률": prev_rate,
        "코호트별": g.get("코호트별") or {}, "실패유형별": g.get("실패유형별") or {},
        "어휘층": layers, "어휘갭": gap, "짝불일치": pairs,
        "수술대기": surgery, "측정노이즈": dict(noise),
        "검색실패규정": by_reg.most_common(5), "약점주제": weak,
        "행동후보": _actions(gap, surgery, noise, len(items), by_reg),
    }


def _actions(gap, surgery, noise, n, by_reg) -> list:
    """다음 행동 후보 — **규칙이** 만든다(LLM 아님). 같은 입력이면 같은 출력이어야 신뢰가 쌓인다.
    ⛔ 추측 금지: 각 항목에 근거 수치를 함께 적는다."""
    out = []
    if gap and gap["정답률차"] >= 3:
        out.append(f"검색 어휘 보강(별칭 사전) 검토 — 문서어와 일상어 정답률 차 {gap['정답률차']}%p"
                   + (f", 검색실패 {gap['검색실패배수']}배" if gap.get("검색실패배수") else ""))
    sf = [s for s in surgery if s["실패유형"] == "검색실패"]
    if sf:
        top = ", ".join(f"{r}({c})" for r, c in by_reg.most_common(3))
        out.append(f"검색실패 {len(sf)}건 — 몰린 규정: {top}")
    hal = [s for s in surgery if s["실패유형"] == "생성환각"]
    if hal:
        out.append(f"생성환각 {len(hal)}건 — 신뢰 게이트(수치·표) 통과 여부 확인 대상")
    # 근거는 붙었는데 거부 — 검색 개선 대상이 아니다. 어디를 봐야 하는지 명시한다.
    unfit = [s for s in surgery if s["실패유형"] == "근거부적합"]
    if unfit:
        regs = ", ".join(dict.fromkeys(s["규정"] for s in unfit if s["규정"]))
        out.append(f"근거부적합 {len(unfit)}건 — 근거는 회수됐으나 기대 답이 없음. "
                   f"인덱스 귀속(defterms·clause_xref)·골든 출처·기능 배선 점검"
                   + (f" — 대상: {regs}" if regs else ""))
    nz = sum(noise.values())
    if n and nz / n >= 0.10:
        # ⚠ dict를 그대로 찍지 않는다 — 이 문장은 화면(게시판 카드)에도 그대로 나간다.
        detail = " · ".join(f"{k} {v}" for k, v in noise.most_common())
        out.append(f"출제 위생 점검 — 측정 노이즈 {nz}건({100 * nz / n:.0f}%): {detail}")
    if not out:
        out.append("특이 없음 — 수술 대기 0건")
    return out


def render_md(a: dict) -> str:
    L = [f"# 품질 분석서 · {a['date']}", ""]
    delta = ""
    if a["직전정답률"] is not None:
        d = round((a["정답률"] or 0) - a["직전정답률"], 1)
        delta = f" (직전 {a['직전회차']} {a['직전정답률']}% · {d:+.1f}%p)"
    L += [f"**전체 {a['정답률']}%** · {a['문항수']}문항{delta}", ""]

    co = a["코호트별"]
    if co:
        L.append("## 코호트")
        for k, v in co.items():
            L.append(f"- {k}: {v.get('정답률')}% ({v.get('문항수')}건)")
        # ⚠ 재시험이 낮은 건 정상이다(전에 틀린 것만 모은 코호트) — 오해 방지 문구를 고정한다.
        if "재시험" in co and "신규" in co:
            L.append("  · 재시험은 전에 틀린 문항만 모은 코호트라 낮게 나오는 것이 정상 — "
                     "볼 것은 **재시험의 추이**(오르면 개선된 것)")
        L.append("")

    if a["어휘층"]:
        L += ["## 어휘층 — 문서 용어로 물었을 때 vs 평소 말로 물었을 때", "",
              "| 어휘층 | 문항 | 정답률 | 검색실패 |", "|---|---|---|---|"]
        for k, v in a["어휘층"].items():
            L.append(f"| {k} | {v['문항수']} | {v['정답률']}% | {v['검색실패']}건 ({v['검색실패율']}%) |")
        if a["어휘갭"]:
            g = a["어휘갭"]
            L += ["", f"**어휘 갭 {g['정답률차']}%p**"
                  + (f" · 검색실패 {g['검색실패배수']}배" if g.get("검색실패배수") else "")
                  + " — 같은 골든을 평소 말로 물으면 이만큼 못 찾는다."]
        L.append("")

    if a["수술대기"]:
        L += [f"## 🔧 수술 대기 {len(a['수술대기'])}건 — 서비스가 실제로 못 한 것", ""]
        for s in a["수술대기"][:15]:
            tag = f"{s['실패유형']}·{s['어휘층']}" if s["어휘층"] else s["실패유형"]
            L.append(f"- **[{tag}]** {s['질문'][:70]}")
            if s["규정"]:
                L.append(f"  · 근거: {s['규정']} {s['조']}")
            if s["증거"]:
                L.append(f"  · 증거: {s['증거']}")
        if len(a["수술대기"]) > 15:
            L.append(f"- … 외 {len(a['수술대기']) - 15}건(게시판에서 전체 열람)")
        L.append("")

    if a["측정노이즈"]:
        L += [f"## 측정 노이즈 {sum(a['측정노이즈'].values())}건 — 시험지 쪽 문제(서비스 아님)", "",
              "  " + " · ".join(f"{k} {v}" for k, v in a["측정노이즈"].items()), ""]

    if a["짝불일치"]:
        L += [f"## 짝 불일치 {len(a['짝불일치'])}건 — 같은 정답, 다른 어휘, 다른 결과", ""]
        for p in a["짝불일치"][:8]:
            L += [f"- 문서어({p['문서어판정']}): {p['문서어'][:60]}",
                  f"  일상어({p['일상어판정']}): {p['일상어'][:60]}"]
        L.append("")

    if a["약점주제"]:
        L += ["## 약점 주제(표본 5건 이상)", ""]
        L += [f"- {t}: {r}% ({n}건)" for t, r, n in a["약점주제"]]
        L.append("")

    L += ["## 다음 행동 후보", ""] + [f"{i}. {x}" for i, x in enumerate(a["행동후보"], 1)]
    L += ["", "---", "이 분석서는 채점 결과에서 **규칙으로** 생성됩니다(생성 모델 미사용). "
          "판단이 필요한 진단은 사람 또는 2단이 담당합니다."]
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--stdout", action="store_true", help="파일 대신 표준출력(미리보기)")
    args = ap.parse_args()
    a = analyze(args.date)
    md = render_md(a)
    if args.stdout:
        print(md)
        return 0
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / f"{args.date}.md").write_text(md, encoding="utf-8")
    (REPORTS / f"{args.date}.json").write_text(
        json.dumps(a, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"분석서 → {REPORTS / (args.date + '.md')} "
          f"(수술대기 {len(a['수술대기'])} · 노이즈 {sum(a['측정노이즈'].values())})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
