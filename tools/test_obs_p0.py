#!/usr/bin/env python3
"""test_obs_p0.py — P0 관측 로직 회귀(docs/56). obs.py 순수 함수만(사이드이펙트 없음).

실행: cd tools && .venv/bin/python test_obs_p0.py
"""
import obs

fails = []


def ok(cond, msg):
    print(("✅ " if cond else "❌ ") + msg)
    if not cond:
        fails.append(msg)


# ── ① health_probe: 정상 ──
class _Col:
    def count(self): return 5558


def _backend_ok():
    return (None, _Col(), None)


class _Resp:
    status_code = 200


def _http_ok(url, timeout=3):
    return _Resp()


good, why = obs.health_probe(_backend_ok, _http_ok, "http://x/v1")
ok(good and why == "ok", f"① 정상 → (True, ok) [{good}, {why}]")

# ── ② health_probe: 벡터DB stale 핸들(오늘 사고) ──
class _StaleCol:
    def count(self): raise Exception("Collection [abc] does not exist")


def _backend_stale():
    return (None, _StaleCol(), None)


bad, why = obs.health_probe(_backend_stale, _http_ok, "http://x/v1")
ok(not bad and "벡터DB" in why, f"② stale 컬렉션 핸들 → 이상 감지 [{why}]")

# ── ③ health_probe: LLM 다운 ──
def _http_down(url, timeout=3):
    raise Exception("ConnectionRefused")


bad2, why2 = obs.health_probe(_backend_ok, _http_down, "http://x/v1")
ok(not bad2 and "LLM" in why2, f"③ Ollama 연결 실패 → 이상 감지 [{why2}]")

# ── ④ 상태 전이: 정상→이상만 알림, 유지 시 무알림 ──
ok(obs.health_transition(True, True, "ok") is None, "④a 정상 유지 → 무알림")
t = obs.health_transition(True, False, "벡터DB 이상")
ok(t and t[0] == "health" and "이상" in t[1], "④b 정상→이상 → 🚨 알림")
r = obs.health_transition(False, True, "ok")
ok(r and "복구" in r[1], "④c 이상→정상 → 복구 알림")
ok(obs.health_transition(False, False, "x") is None, "④d 이상 유지 → 무알림(스팸 방지)")

# ── ⑤ 예외 스로틀: 같은 지문 1건/창, 창 지나면 다시 ──
th = obs.ErrorThrottle(window_sec=600)
ok(th.should_notify("NotFoundError:/v1/chat", now=1000), "⑤a 첫 발생 → 알림")
ok(not th.should_notify("NotFoundError:/v1/chat", now=1100), "⑤b 창 안 재발 → 무알림")
ok(th.should_notify("NotFoundError:/v1/chat", now=1700), "⑤c 창 지나면 → 다시 알림")
ok(th.should_notify("OtherError:/app/x", now=1100), "⑤d 다른 지문 → 독립 알림")

print(f"\n{'❌ ' + str(len(fails)) + '건 실패' if fails else '✅ 전부 통과'}")
raise SystemExit(1 if fails else 0)
