#!/usr/bin/env python3
"""test_alerts.py — 알림 카탈로그 정합 + 유출 금지 백스톱 회귀 (docs/66).

이 테스트가 지키는 두 계약:
  ① **정책 문서 = 정본.** docs/66 §3 카탈로그의 키 집합과 ALERT_REGISTRY가 정확히 같아야 한다.
     문서에 없는 알림을 코드에 몰래 넣거나, 문서에만 적고 배선을 잊는 걸 막는다.
  ② **런북 없는 알림은 없다.** 레지스트리의 모든 runbook 파일이 실제로 존재해야 한다.
     '받고 나서 뭘 할지 없는 알림'이 들어오는 경로를 구조적으로 차단한다(docs/66 §2).

⛔ 네트워크 미사용 — SLACK_BOT_TOKEN을 강제로 비워 notify()가 전송 전에 반환하게 한다.

실행: cd tools && .venv/bin/python test_alerts.py
"""
import os
import re
import sys
from pathlib import Path

# ⛔ 실발송 방지 — 테스트가 실제 채널을 울리면 안 된다(import 전에 비운다).
os.environ["SLACK_BOT_TOKEN"] = ""

sys.path.insert(0, str(Path(__file__).resolve().parent))
import alerts  # noqa: E402

DOCS = Path(__file__).resolve().parent.parent / "docs"
RUNBOOKS = DOCS / "runbooks"


# ── ① 정책 문서 ↔ 레지스트리 정합 ─────────────────────────────────────────────
def test_registry_matches_policy_doc():
    """docs/66 §3 표의 키 열과 ALERT_REGISTRY가 정확히 일치해야 한다."""
    doc = (DOCS / "66-알림정책.md").read_text(encoding="utf-8")
    body = doc.split("## 3. 호롱 알림 카탈로그")[1].split("\n## 4.")[0]
    # 표 첫 열의 `키` 형태만 — 본문 인라인 코드(`inhibited_by` 등)에 걸리지 않게 행 시작 한정
    doc_keys = set(re.findall(r"^\|\s*`([a-z_]+)`\s*\|", body, re.M))
    code_keys = set(alerts.ALERT_REGISTRY)
    assert doc_keys, "§3 카탈로그 표에서 키를 못 읽었다 — 표 형식이 바뀌었나"
    assert doc_keys == code_keys, (
        f"문서와 코드 불일치 — 문서만: {doc_keys - code_keys} / 코드만: {code_keys - doc_keys}")


# ── ② 런북 존재 — 조치 없는 알림 차단 ────────────────────────────────────────
def test_every_alert_has_runbook():
    missing = [f"{k}→{a.runbook}" for k, a in alerts.ALERT_REGISTRY.items()
               if not (RUNBOOKS / a.runbook).exists()]
    assert not missing, f"⛔ 런북 없는 알림(등록 금지): {missing}"


def test_registry_shape():
    """SEV는 1~3, notice_kind는 기존 MaintNotice 값만(프론트 🔔 호환 — 새 값 만들지 않는다)."""
    known_kinds = {"health", "error", "autofix", "autofix-fail", "plan", "quality"}
    for k, a in alerts.ALERT_REGISTRY.items():
        assert a.sev in (1, 2, 3), f"{k}: SEV {a.sev}"
        assert a.notice_kind in known_kinds, f"{k}: 미지의 notice_kind '{a.notice_kind}'"
        assert a.name and a.name[0].isupper(), f"{k}: 알림명은 CamelCase여야 한다"
        # inhibited_by는 실제 존재하는 키를 가리켜야 한다(오타면 억제가 조용히 안 걸린다)
        for up in a.inhibited_by:
            assert up in alerts.ALERT_REGISTRY, f"{k}: inhibited_by '{up}' 미등록"


# ── ③ 유출 금지 백스톱 — 이게 이 파일의 핵심 ─────────────────────────────────
def test_scrub_blocks_leaks():
    """⛔ 실수로 넘긴 내부 콘텐츠가 채널로 나가지 않아야 한다(docs/66 §6)."""
    leaks = [
        ("복무규정 제19조의2에 따라 육아시간은", "규정 조문"),
        ('사용자 질문: "출장 여비 정산할 때 숙박비 상한이 얼마인지 알려주세요 급합니다"', "장문 인용"),
        ("제보자 someone@example.com 이 신고", "이메일"),
        ("KEI-행정가이드/20_규정원문/3000_인사/복무규정.md 파싱 실패", "볼트 경로"),
        ("가" * 200, "길이 초과"),
    ]
    for text, why in leaks:
        safe, reason = alerts._scrub(text)
        assert safe == "" and reason, f"⛔ 유출 통과({why}): {text[:40]}"


def test_scrub_allows_legitimate_summaries():
    """⛔ 정상 요약을 막으면 알림이 무의미해진다 — 오탐이 없어야 한다."""
    ok = [
        "벡터DB 이상: NotFoundError",
        "전체 88.1% · 재시험 80.0%(20건) · 신규 92.3%(40건)",
        "오토픽스 #42 완료 — 관문 5/5 통과, 브랜치 autofix/42",
        "⛔ 서버 오류 KeyError — /app/chats/12/messages",
        "재시험 코호트 92.3% → 80.0% (-12.3%p, 20건)",
    ]
    for s in ok:
        safe, reason = alerts._scrub(s)
        assert safe and not reason, f"오탐: '{s}' 가 '{reason}'으로 차단됐다"


def test_render_keeps_runbook_when_scrubbed():
    """축소돼도 알림 자체는 가야 한다 — '조용해지는' 실패가 최악이다.
    알림명·런북은 남고 요약만 사라진다."""
    msg = alerts.render("service_down", "복무규정 제19조 관련 오류")
    assert "ServiceDown" in msg and "service-down.md" in msg
    assert "제19조" not in msg, "⛔ 축소 후에도 조문이 남았다"
    assert "요약 비공개" in msg, "왜 축소됐는지 채널에 적어야 한다(은폐 금지)"


def test_render_format():
    """docs/66 §7 — 3줄(등급·요약·런북)."""
    msg = alerts.render("quality_digest", "전체 88.1% · 재시험 80.0%")
    lines = msg.split("\n")
    assert len(lines) == 3, f"3줄이어야 한다: {lines}"
    assert lines[0].startswith("⚪") and "[SEV3] QualityDigest" in lines[0]
    assert "88.1%" in lines[1]
    assert lines[2].startswith("런북: https://")


# ── ④ 라우팅 — 억제·상한·미등록 키 ───────────────────────────────────────────
def test_unknown_key_raises():
    """⛔ 미등록 키를 조용히 넘기면 배선 실수가 침묵한다."""
    try:
        alerts.notify("존재하지않는키", "x")
    except KeyError as e:
        assert "미등록" in str(e)
    else:
        raise AssertionError("미등록 키인데 예외가 안 났다")


def test_inhibition():
    """LLM이 죽었으면 500은 결과다 — service_down 중이면 unhandled_error를 안 보낸다."""
    r = alerts.notify("unhandled_error", "KeyError — /v1/chat", suppressed=("service_down",))
    assert not r["sent"] and "inhibited_by" in r["why"], r
    # 상위 알림이 없으면 정상 경로로 간다(토큰 미설정이라 sent=False, 사유가 달라야 함)
    r2 = alerts.notify("unhandled_error", "KeyError — /v1/chat")
    assert "inhibited" not in r2["why"], r2


def test_no_send_without_token():
    """토큰 미설정이면 발송을 건너뛴다(fail-safe: 기본은 안 보냄)."""
    r = alerts.notify("service_down", "벡터DB 이상: NotFoundError")
    assert not r["sent"] and "SLACK_BOT_TOKEN 미설정" in r["why"], r


def test_api_base_avoids_blocked_host():
    """⛔ 맨 slack.com은 사내 방화벽이 SNI로 끊는다(2026-07-30 실측) — 기본 base가 그리 가면 안 된다."""
    assert "//slack.com" not in alerts.API_BASE, f"차단 호스트: {alerts.API_BASE}"
    assert alerts.API_BASE.startswith("https://"), alerts.API_BASE


def test_min_sev_gate():
    """ALERT_MIN_SEV=2면 SEV3(다이제스트)는 조용해야 한다."""
    os.environ["ALERT_MIN_SEV"] = "2"
    try:
        r = alerts.notify("quality_digest", "전체 88.1%")
        assert not r["sent"] and "ALERT_MIN_SEV" in r["why"], r
    finally:
        os.environ.pop("ALERT_MIN_SEV", None)


def test_daily_cap():
    """상한 초과 시 전송 생략, 날짜가 바뀌면 리셋."""
    cap = alerts.DailyCap()
    assert cap.allow(2, "2026-07-30") and cap.allow(2, "2026-07-30")
    assert not cap.allow(2, "2026-07-30"), "상한 초과인데 통과했다"
    assert cap.allow(2, "2026-07-31"), "날짜가 바뀌면 리셋돼야 한다"


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 카탈로그 정합·런북 존재·유출 백스톱") or 0)
