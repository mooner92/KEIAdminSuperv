# 거부 트리거 2차 검색(docs/71 ①) 회귀 — 소스 계약 + 순수 가드. 합성 데이터만.
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RC = open(os.path.join(HERE, "rag_core.py"), encoding="utf-8").read()
APP = open(os.path.join(HERE, "app_api.py"), encoding="utf-8").read()


def test_reform_guard():
    sys.path.insert(0, HERE)
    import rag_core as rc
    ok = rc._reform_ok
    assert not ok("", "질문")                      # 빈 출력
    assert not ok("x" * 130, "질문")               # 과장
    assert not ok("조직도 어디서 봐?", "조직도 어디서 봐?")   # 원문 복사
    assert not ok("규정에서 확인되지 않습니다", "질문")       # 거부문 복사
    assert ok("구성원 인적사항 부서 조회", "조직도 어디서 봐?")


def test_fail_closed():
    # 2차도 거부면 None(1차 거부 유지) — 복구가 거부를 강제로 답변으로 바꾸지 않는다
    assert "if is_refusal(ans2):" in RC and RC.index("if is_refusal(ans2):") < RC.index('rec["답변"]')


def test_refusal_detect_is_canonical():
    # ⛔ 거부 정규식 복제 금지(docs/62) — 정본 위임만
    assert "import refusal_detect" in RC


def test_note_contract():
    # 백스톱 노트는 NOTE_MARKERS 규약('ℹ️ ' 시작) + 정본 NOTE_TITLES 등록(채점 오염 방지)
    assert 'RECOVERY_NOTE = ("ℹ️ ' in RC
    rd = open(os.path.join(HERE, "refusal_detect.py"), encoding="utf-8").read()
    assert "ℹ️ 질문하신 명칭" in rd


def test_guard_appends_not_replaces_system():
    # 절대 규칙 4: SYSTEM 가드레일 불변 — extra_system은 덧붙임만
    assert 'sys_content = SYSTEM + (("\\n" + extra_system) if extra_system else "")' in RC


def test_sse_meta_after_decision():
    # SSE: meta는 복구 결정 '뒤'에 발송(프로토콜 순서 meta→delta 유지, 근거 교체 무결)
    g = APP[APP.index("스트리밍(SSE)"):]
    assert g.index("refusal_retry_search") < g.index('"type": "meta"')


def test_telemetry_keys():
    assert '"refusal_retry")' in RC.split("_GATE_FLAG_KEYS")[1][:400]
    da = open(os.path.join(HERE, "..", "eval", "daily_answer.py"), encoding="utf-8").read()
    assert '"refusal_retry"' in da


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 거부 복구 계약(fail-closed·정본 위임·노트 규약·SSE 순서)") or 0)
