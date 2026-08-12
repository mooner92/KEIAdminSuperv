# specs/14 T04 — 재색인 워커의 파생 인덱스 재생성·정본 색인 레시피 회귀 (소스 스캔).
# corpus_amend.py처럼 '쓰기 경로 없음'류 계약은 소스를 grep해 지킨다 — 워커는 스레드+GPU라
# 유닛으로 실행하기보다 계약(무엇을 반드시 돌리는가)을 고정하는 쪽이 실효적이다.
import os
import re
import sys

SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "app_api.py"),
           encoding="utf-8").read()
WORKER = SRC[SRC.index("def _reindex_worker"):SRC.index("def corpus_reindex")]

# 재색인 후 반드시 재생성해야 하는 파생 인덱스 8종(런타임 소비 — 낡으면 삭제 조문 강등·
# 전결 335규칙·여정 신선도가 개정 전 상태로 답한다).
DERIVED = [
    "01i_clause_xref.py", "01j_defterms.py", "01k_article_status.py",
    "01l_graph_analytics.py", "01m_deadlines.py", "01n_approval.py",
    "01k2_journey_freshness.py", "01o_table_integrity.py",
]


def test_derived_scripts_all_wired():
    for name in DERIVED:
        assert name in WORKER, f"파생 인덱스 {name}가 재색인 워커에서 빠짐(specs/14 T04)"


def test_embed_ctx_label_pinned():
    # 정본 색인(kei_regs)은 검색 라벨(specs/01 P1)로 구웠다 — 관리자 버튼 재색인이
    # 상속 env에 의존하면 라벨 없는 색인으로 조용히 회귀한다(실측 2026-08-12: PM2 env에 없음).
    assert re.search(r'"EMBED_CTX_LABEL":\s*"1"', WORKER), \
        "02 서브프로세스에 EMBED_CTX_LABEL=1 명시 고정이 없다"


def test_partial_failure_tolerated():
    # 파생 인덱스 실패는 재색인 전체를 죽이면 안 된다(부분 실패 허용 — 로그로 알리고 계속).
    assert "실패(계속)" in WORKER


def test_derived_before_reload():
    # 재생성 → rag_core.reload() 순서 — reload가 파생 인덱스 캐시를 초기화해 산출물이 살아난다.
    assert WORKER.index("01i_clause_xref.py") < WORKER.index("rag_core.reload()")


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    bad = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except AssertionError as e:
            bad += 1
            print(f"  ❌  {fn.__name__}: {e}")
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 재색인 워커 파생 인덱스·정본 레시피 계약") or 0)
