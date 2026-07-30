"""alerts.py — 운영자 알림 카탈로그·라우팅·Slack 발송.

정책 정본 = `docs/66-알림정책.md`. 이 파일의 ALERT_REGISTRY는 그 문서 §3 카탈로그를 코드로
옮긴 것이고, 둘이 어긋나면 **코드가 틀린 것**이다(정합은 test_alerts.py가 강제).

설계는 FLAG_REGISTRY(app_api)와 같은 '코드 레지스트리 = 단일 출처' 방식이다. 알림 하나를
추가하려면 ⓐ 레지스트리 한 줄 ⓑ 런북 한 장 — 둘 다여야 테스트가 통과한다(조치 없는 알림 차단).

⛔ **Slack은 외부 서비스다.** 알림 본문은 '무슨 일이 생겼다 + 보러 와라'까지만 보낸다.
   사용자 질문·답변, 규정 조문, 제보 본문, 계정명은 절대 나가지 않는다(docs/66 §6).
   호출부의 선의에 기대지 않고 _scrub()이 전송 직전 결정적으로 축소한다.

⚠ 사내 방화벽이 TLS SNI로 **맨 `slack.com` 호스트만** 끊는다. `www.slack.com`·`api.slack.com`은
  열려 있고 전자는 공식 slack_sdk의 기본 base URL이라 Web API(chat.postMessage)가 그대로 된다.
  → SLACK_API_BASE 기본값이 www.slack.com인 이유(2026-07-30 실측, docs/66 §5.1).
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from dataclasses import dataclass, field

# ───────────────────────── 등급 ─────────────────────────
SEV_EMOJI = {1: "🔴", 2: "🟡", 3: "⚪"}


@dataclass(frozen=True)
class Alert:
    """알림 1종의 계약. name은 영문 CamelCase(채널 검색·런북 키), title은 레지스트리 가독성용
    한국어 라벨이다(채널 2줄에 들어가는 실제 요약은 호출부가 관측값과 함께 넘긴다)."""

    name: str
    sev: int
    title: str
    runbook: str                 # docs/runbooks/<파일> — ⛔ 실제 파일이 없으면 등록 실패
    notice_kind: str             # 기존 MaintNotice.kind 보존(프론트 🔔 호환 — 새 값 만들지 않음)
    inhibited_by: tuple[str, ...] = field(default_factory=tuple)


# docs/66 §3 카탈로그. ⛔ 새 항목은 §2 게이트 4문항을 통과해야 한다.
ALERT_REGISTRY: dict[str, Alert] = {
    # ── 3.1 가용성 ──
    "service_down": Alert(
        "ServiceDown", 1, "서비스 이상(벡터DB·LLM)", "service-down.md", "health"),
    "service_recovered": Alert(
        "ServiceRecovered", 3, "서비스 복구", "service-down.md", "health"),
    "unhandled_error": Alert(
        "UnhandledError", 2, "미처리 서버 오류(500)", "unhandled-error.md", "error",
        # LLM이 죽었으면 500은 원인이 아니라 결과다 — 상위 알림이 이미 상황을 설명한다.
        inhibited_by=("service_down",)),
    # ── 3.2 자기개선 루프 ──
    "autofix_ready": Alert(
        "AutofixReady", 2, "오토픽스 검토 대기", "autofix-review.md", "autofix"),
    "autofix_failed": Alert(
        "AutofixFailed", 2, "오토픽스 관문 탈락", "autofix-review.md", "autofix-fail"),
    "feedback_plan": Alert(
        "FeedbackPlan", 2, "제보 분석 계획 생성", "feedback-plan.md", "plan"),
    # ── 3.3 품질 ──
    "quality_digest": Alert(
        "QualityDigest", 3, "일일 자가평가 결과", "quality-digest.md", "quality"),
    "quality_drop": Alert(
        "QualityDrop", 2, "재시험 코호트 정답률 급락", "quality-drop.md", "quality"),
}

# ───────────────────────── 설정 ─────────────────────────
REPO_URL = os.environ.get("PUBLIC_REPO_URL", "https://github.com/mooner92/KEIAdminSuperv")
RUNBOOK_BASE = f"{REPO_URL}/blob/main/docs/runbooks/"


# ⛔ 맨 slack.com은 사내 방화벽이 SNI로 끊는다. www.slack.com이 공식 slack_sdk 기본 base URL이며
#    열려 있다(api.slack.com도 가능). 방화벽 정책이 바뀌어도 이 기본값은 계속 유효하다.
API_BASE = os.environ.get("SLACK_API_BASE", "https://www.slack.com/api").rstrip("/")


def _token() -> str:
    """⛔ 시크릿(xoxb-…). 미설정이면 발송을 건너뛴다(fail-safe: 기본은 안 보냄)."""
    return os.environ.get("SLACK_BOT_TOKEN", "").strip()


def _channel() -> str:
    return os.environ.get("SLACK_CHANNEL", "#horong").strip()


def _min_sev() -> int:
    return int(os.environ.get("ALERT_MIN_SEV", "3"))


def _max_per_day() -> int:
    return int(os.environ.get("ALERT_MAX_PER_DAY", "50"))


# ───────────────────── 유출 금지 백스톱 (docs/66 §6.1) ─────────────────────
# 호출부가 실수로 본문을 넘길 수 있다. 프롬프트나 규약이 아니라 코드로 막는다.
# 검출되면 차단이 아니라 **축소** — 알림은 가고 내용은 안 간다(알림 유실이 더 위험하다).
_LEAK_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"제\s*\d+\s*조", "규정 조문 인용"),           # 「제19조의2」 = 규정 본문 인용 신호
    # 따옴표로 감싼 20자+ = 질문·답변·제보 본문. ⚠ 40자로 뒀더니 실제 사용자 질문(35자)이
    # 통과했다 — 한국어는 20자면 이미 문장이다. 정상 요약은 예외명 같은 짧은 것만 인용한다.
    (r"[\"“'][^\"”']{20,}[\"”']", "장문 인용"),
    (r"[\w.+-]+@[\w-]+\.[\w.]+", "이메일"),           # 계정·담당자 식별정보
    (r"KEI-행정가이드/", "볼트 내부 경로"),
)
_MAX_SUMMARY = 160  # 이보다 길면 요약이 아니라 본문이다


def _scrub(summary: str) -> tuple[str, str]:
    """(보낼 요약, 축소 사유). 사유가 빈 문자열이면 통과."""
    s = " ".join((summary or "").split())  # 개행·중복공백 정규화(패턴 회피 방지)
    for pat, why in _LEAK_PATTERNS:
        if re.search(pat, s):
            return "", why
    if len(s) > _MAX_SUMMARY:
        return "", f"요약 {len(s)}자(상한 {_MAX_SUMMARY})"
    return s, ""


# ───────────────────────── 전송 상한 ─────────────────────────
class DailyCap:
    """일일 전송 상한 — 버그로 알림이 폭주해도 채널이 죽지 않게. 프로세스 메모리로 충분
    (재기동되면 리셋되지만, 상한의 목적은 '폭주 중 채널 보호'라 그걸로 족하다)."""

    def __init__(self) -> None:
        self._day = ""
        self._n = 0

    def allow(self, limit: int, today: str | None = None) -> bool:
        day = today or time.strftime("%Y-%m-%d")
        if day != self._day:
            self._day, self._n = day, 0
        if self._n >= limit:
            return False
        self._n += 1
        return True


_cap = DailyCap()


# ───────────────────────── 메시지 조립 ─────────────────────────
def render(key: str, summary: str) -> str:
    """docs/66 §7의 3줄 형식. 유출 백스톱을 통과한 요약만 2줄에 들어간다."""
    a = ALERT_REGISTRY[key]
    safe, why = _scrub(summary)
    lines = [f"{SEV_EMOJI[a.sev]} *[SEV{a.sev}] {a.name}*"]
    if safe:
        lines.append(safe)
    else:
        # 내용은 버리고 '보러 와라'만 남긴다. 왜 버렸는지도 채널에 적는다(은폐 금지).
        lines.append(f"{a.title} — 내용은 /admin 에서 확인 (요약 비공개: {why})")
    lines.append(f"런북: {RUNBOOK_BASE}{a.runbook}")
    return "\n".join(lines)


def _send(text: str, timeout: float = 5.0) -> bool:
    """chat.postMessage 1건. 실패는 예외를 올리지 않고 False(호출부가 삼킬 필요 없게).

    ⚠ Slack은 실패도 **HTTP 200**으로 준다 — 본문의 {"ok":false,"error":…}를 봐야 한다.
      상태코드만 보면 봇이 채널에 초대 안 됐을 때(not_in_channel) 알림이 조용히 사라진다."""
    token = _token()
    if not token:
        return False
    body = json.dumps({"channel": _channel(), "text": text}).encode("utf-8")
    req = urllib.request.Request(  # noqa: S310 — 고정 https(API_BASE)
        f"{API_BASE}/chat.postMessage", data=body,
        headers={"Content-Type": "application/json; charset=utf-8",
                 "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
            res = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[alerts] Slack 전송 실패({type(e).__name__}) — 무시(🔔은 정상)")
        return False
    if not res.get("ok"):
        # 흔한 값: not_in_channel(봇 미초대) · channel_not_found · invalid_auth · missing_scope
        print(f"[alerts] Slack 거부: {res.get('error')} — 채널 {_channel()}")
        return False
    return True


# ───────────────────────── 단일 진입점 ─────────────────────────
def notify(key: str, summary: str, detail: str = "", *, engine=None,
           suppressed: tuple[str, ...] = ()) -> dict:
    """알림 1건 — MaintNotice 기록(주 채널) + Slack 발송(부가 채널).

    ⛔ 순서가 중요하다: MaintNotice를 **먼저** 기록한다. Slack이 죽어도 🔔은 정상이어야 한다.
    engine=None이면 DB 기록을 건너뛴다(테스트·CLI에서 Slack만 보낼 때).
    suppressed = 현재 발화 중인 상위 알림 키들 — inhibited_by에 걸리면 조용히 넘긴다.

    반환: {"noticed": bool, "sent": bool, "why": str} — 호출부가 로깅에 쓴다."""
    a = ALERT_REGISTRY.get(key)
    if a is None:
        # ⛔ 조용히 넘기지 않는다. 미등록 키는 배선 실수다(정책 문서와 어긋난 상태).
        raise KeyError(f"미등록 알림 키 '{key}' — docs/66 §3 카탈로그와 ALERT_REGISTRY를 먼저 갱신하라")

    out = {"noticed": False, "sent": False, "why": ""}

    if any(k in suppressed for k in a.inhibited_by):
        out["why"] = f"inhibited_by {a.inhibited_by}"
        return out

    if engine is not None:
        try:
            from sqlmodel import Session  # noqa: PLC0415
            import app_api  # noqa: PLC0415
            with Session(engine) as s:
                s.add(app_api.MaintNotice(kind=a.notice_kind, summary=summary[:200],
                                          detail_path=detail[:500]))
                s.commit()
            out["noticed"] = True
        except Exception as e:  # noqa: BLE001
            print(f"[alerts] MaintNotice 실패({type(e).__name__}) — 무시")

    if a.sev > _min_sev():
        out["why"] = f"sev{a.sev} > ALERT_MIN_SEV"
        return out
    if not _token():
        out["why"] = "SLACK_BOT_TOKEN 미설정"
        return out
    if not _cap.allow(_max_per_day()):
        out["why"] = f"일일 상한 {_max_per_day()}건 초과"
        print(f"[alerts] {out['why']} — 전송 생략({a.name})")
        return out

    out["sent"] = _send(render(key, summary))
    return out


if __name__ == "__main__":  # 실발송 점검: python tools/alerts.py [키]
    import sys
    k = sys.argv[1] if len(sys.argv) > 1 else "quality_digest"
    msg = render(k, "발송 점검 — 실제 장애가 아닙니다")
    print(msg)
    print("→", "전송됨" if _send(msg) else "미전송(URL 미설정 또는 실패)")
