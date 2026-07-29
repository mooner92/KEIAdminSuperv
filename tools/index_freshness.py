#!/usr/bin/env python3
"""index_freshness.py — 파생 인덱스가 **조용히 죽는 것**을 잡는다 (docs/63 §12).

왜 필요한가: 2026-07-23 kordoc 재변환으로 별표가 파이프 표 → HTML 표로 바뀌자
01n_approval 파서가 **0건을 반환하기 시작했는데 며칠 동안 아무도 몰랐다.**
approval.json은 낡은 값을 그대로 들고 있었고 화면은 정상으로 보였다.
"에러 없이 빈 결과"가 가장 위험한 실패다 — 아무 알람도 울리지 않는다.

검사 항목:
  ① 파일 없음
  ② 건수 0 (0이 정상인 산출물은 zero_ok로 예외 — 사유를 함께 적는다)
  ③ **직전 대비 급락** (기본 30% 이상 감소 → 경고). 기준선은 .freshness.json
  ④ 소스보다 오래됨 (볼트가 더 새것이면 재생성이 밀린 것)

실행:  cd tools && .venv/bin/python index_freshness.py [--update] [--quiet]
       --update : 현재 건수를 기준선으로 저장(의도된 변화를 승인할 때)
반환:  문제 있으면 1 (크론·PM2에서 알람으로 쓸 수 있게)
"""
import argparse
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
IDX = HERE / "index"
VAULT = HERE.parent / "KEI-행정가이드"
BASELINE = IDX / ".freshness.json"
DROP_PCT = 30.0
STALE_DAYS = 14  # 볼트 대비 이만큼 밀리면 알림(그 아래는 잡음)

# (파일, 건수 키, 생성 스크립트, 0건 허용 사유)
SPECS = [
    ("approval.json", "rules", "01n_approval.py", None),
    ("amount_rules.json", "rules", "01r2_amount_rules.py", None),
    ("article_status.json", "articles", "01k_article_status.py", None),
    ("clause_xref.json", "edges", "01i_clause_xref.py", None),
    ("defterms.json", "terms", "01j_defterms.py", None),
    ("deadlines.json", "deadlines", "01m_deadlines.py", None),
    ("graph_analytics.json", "impact_by_article", "01l_graph_analytics.py", None),
    ("byeolji_manifest.json", None, "01p_byeolji_pdf.py", None),  # 최상위가 규정 매핑
    ("table_integrity.json", "docs", "01o_table_integrity.py",
     "손상 표가 실제로 없을 수 있음 — 다만 0건이 계속되면 스캐너 고장을 의심할 것"),
    ("value_store.json", "rows", "01q_table_store.py",
     "검수완료 표만 담는다 — 코퍼스가 전건 미검수면 0건이 정상(docs/63 §11)"),
]


def count_of(data, key):
    """건수 — key가 있으면 그 컬렉션의 길이, key가 None이면 최상위 매핑의 항목 수.

    ⚠ '알아서 세는' 휴리스틱을 쓰지 않는다. 처음엔 '최상위 컬렉션 중 최대 길이'로 짰다가
      byeolji_manifest(62규정×6키)를 6건으로 셌고, 고치자 이번엔 defterms(282)를 2로 셌다.
      **무엇을 세는지는 산출물마다 다르므로 SPECS에 명시한다** — 추측보다 명시가 낫다.
    """
    if isinstance(data, list):
        return len(data)
    if not isinstance(data, dict):
        return 0
    if key:
        v = data.get(key)
        return len(v) if isinstance(v, (list, dict)) else 0
    return len({k: v for k, v in data.items() if k not in ("meta", "counts")})


def newest_mtime(root: pathlib.Path, pattern="**/*.md") -> float:
    try:
        return max((p.stat().st_mtime for p in root.glob(pattern)), default=0.0)
    except OSError:
        return 0.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true", help="현재 건수를 기준선으로 저장")
    ap.add_argument("--quiet", action="store_true", help="문제만 출력")
    args = ap.parse_args()

    base = {}
    if BASELINE.exists():
        try:
            base = json.loads(BASELINE.read_text(encoding="utf-8")).get("counts", {})
        except (json.JSONDecodeError, OSError):
            base = {}

    vault_m = newest_mtime(VAULT)
    problems, now_counts = [], {}

    for name, key, producer, zero_ok in SPECS:
        path = IDX / name
        if not path.exists():
            problems.append(f"❌ {name}: 파일 없음 — {producer} 실행 필요")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            problems.append(f"❌ {name}: 읽기/파싱 실패 ({e}) — {producer}")
            continue

        n = count_of(data, key)
        now_counts[name] = n
        prev = base.get(name)
        mtime = path.stat().st_mtime
        age_d = (time.time() - mtime) / 86400
        notes = []

        # ② 0건
        if n == 0:
            if zero_ok:
                notes.append(f"0건(허용) — {zero_ok}")
            else:
                problems.append(f"❌ {name}: **0건** — {producer}가 조용히 실패했을 수 있다")
                continue
        # ③ 급락
        if prev and prev > 0 and n < prev:
            drop = (prev - n) / prev * 100
            if drop >= DROP_PCT:
                problems.append(f"❌ {name}: {prev} → {n}건 (**{drop:.0f}% 감소**) — {producer} 확인")
            else:
                notes.append(f"{prev}→{n}건")
        # ④ 소스보다 오래됨
        # 볼트는 노트 하나만 고쳐도 mtime이 갱신되므로 짧은 지연은 정상이다.
        # 오래 밀린 것만 알린다(문턱 아래는 잡음 — 전 항목에 경고가 뜨면 아무도 안 본다).
        if vault_m and mtime < vault_m:
            lag = (vault_m - mtime) / 86400
            if lag >= STALE_DAYS:
                notes.append(f"볼트보다 {lag:.0f}일 오래됨 — 재생성 검토")

        if not args.quiet:
            tail = ("  · " + " · ".join(notes)) if notes else ""
            print(f"  ✅ {name:26} {n:>6}건  ({age_d:.0f}일 전){tail}")

    if problems:
        print("\n".join(("" if args.quiet else "") + p for p in problems))

    if args.update:
        BASELINE.write_text(json.dumps({"updated": time.strftime("%F %T"), "counts": now_counts},
                                       ensure_ascii=False, indent=1), encoding="utf-8")
        BASELINE.chmod(0o600)
        print(f"\n기준선 갱신 — {len(now_counts)}개 산출물")

    print(f"\n{'🎉 이상 없음' if not problems else f'⚠ {len(problems)}건 확인 필요'} "
          f"({len(now_counts)}개 검사)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
