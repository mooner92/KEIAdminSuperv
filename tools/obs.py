"""obs.py — P0 관측('죽으면 안다', docs/56)의 순수 로직.

04_rag_api.py가 이 함수들을 배선한다(엔진·backend·http는 주입). 사이드이펙트(warmup 스레드)
없이 단위 테스트 가능하게 분리했다. Sentry 전체 이식이 아니라 최소 P0만:
  ⓐ 주기 헬스체크(벡터DB stale 핸들 + LLM) → 상태 전이 시 MaintNotice
  ⓑ 미처리 예외(500) → 지문+시간창 스로틀로 MaintNotice
⛔ 프라이버시(docs/56 §5): 알림에 질문·입력값·쿼리스트링 미포함 — 예외형·라우트 경로만.
"""
from __future__ import annotations

import time
from typing import Callable


def health_probe(backend: Callable, http_get: Callable, vllm_base: str) -> tuple[bool, str]:
    """가벼운 헬스 판정 → (정상?, 사유).
    ⚠ 오늘 사고(재색인 후 옛 컬렉션 핸들)를 잡으려면 backend()의 '캐시된' 핸들로 실제 count()를
    때려야 stale이 드러난다. backend=rag_core.backend, http_get=httpx.get 주입."""
    try:
        _, col, _ = backend()
        col.count()  # stale 핸들이면 여기서 NotFoundError
    except Exception as e:  # noqa: BLE001
        return False, f"벡터DB 이상: {type(e).__name__}: {str(e)[:120]}"
    try:
        base = vllm_base.rstrip("/").removesuffix("/v1")
        if http_get(base + "/api/tags", timeout=3).status_code != 200:
            return False, "LLM(Ollama) 응답 이상"
    except Exception as e:  # noqa: BLE001
        return False, f"LLM(Ollama) 연결 실패: {type(e).__name__}"
    return True, "ok"


class ErrorThrottle:
    """지문(예외형:라우트)별 시간창 스로틀 — 같은 오류 폭주 시 알림 1건/창."""

    def __init__(self, window_sec: int = 600) -> None:
        self.window = window_sec
        self._seen: dict[str, float] = {}

    def should_notify(self, fingerprint: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        if now - self._seen.get(fingerprint, 0.0) > self.window:
            self._seen[fingerprint] = now
            return True
        return False


def health_transition(prev_ok: bool, now_ok: bool, why: str):
    """상태 전이 → (알림?, kind, summary, detail) | None. 같은 상태 유지면 None(스팸 방지)."""
    if prev_ok and not now_ok:
        return ("health", f"🚨 서비스 이상 감지 — {why}",
                "자동 헬스체크. 재색인 직후라면 API 재기동(pm2 restart)이 필요할 수 있습니다.")
    if not prev_ok and now_ok:
        return ("health", "✅ 서비스 정상 복구됨", "자동 헬스체크")
    return None
