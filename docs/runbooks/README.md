# 런북 (Runbooks)

알림 하나당 한 장. **알림을 받은 사람이 무엇을 할지**만 적는다 — 배경 설명은 정책 문서(`../66-알림정책.md`)에.

⛔ `tools/alerts.py`의 `ALERT_REGISTRY`가 가리키는 런북 파일이 없으면 `test_alerts.py`가 실패한다.
이게 "조치 없는 알림"이 들어오는 걸 구조적으로 막는 장치다(docs/66 §2).

| 런북 | 알림 |
|---|---|
| [service-down.md](service-down.md) | `ServiceDown` · `ServiceRecovered` |
| [unhandled-error.md](unhandled-error.md) | `UnhandledError` |
| [autofix-review.md](autofix-review.md) | `AutofixReady` · `AutofixFailed` |
| [feedback-plan.md](feedback-plan.md) | `FeedbackPlan` |
| [quality-digest.md](quality-digest.md) | `QualityDigest` |
| [quality-drop.md](quality-drop.md) | `QualityDrop` |
