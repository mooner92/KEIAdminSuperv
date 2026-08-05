#!/usr/bin/env python3
"""test_changelog_amend.py — 개정 반영 → 패치노트 초안 파이프라인 회귀.

⛔ 픽스처는 전부 합성이고, 볼트·로그·상태 파일은 임시 디렉터리다(실데이터 미접촉).

못박는 계약:
  ① 초안은 **상태: 초안**을 달고 쓴다 — 사이트가 걸러낼 신호다.
  ② **중복 생성 없음** — 같은 반영으로 두 번 run()해도 초안이 두 번 안 생긴다.
  ③ 본문에 **규정 값을 옮기지 않는다** — changelog_lint를 항상 통과해야 한다(초안도 대상).
  ④ **publish()는 lint 위반이면 되돌린다** — 게시된 것처럼 보이는 깨진 파일을 남기지 않는다.
  ⑤ 반영 없으면(run) 아무것도 안 만든다.
실행: python tools/test_changelog_amend.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import changelog_amend as CG  # noqa: E402
import changelog_lint as CL  # noqa: E402

REL = "20_규정원문/9000_합성/합성규정.md"


def _vault(tmp: str) -> Path:
    v = Path(tmp)
    (v / "20_규정원문/9000_합성").mkdir(parents=True)
    (v / REL).write_text('---\ntype: regulation\n규정명: "합성규정"\n---\n\n# 합성규정\n',
                         encoding="utf-8")
    CG.STATE_PATH = v / "state.json"
    CG.LOG_PATH = v / "log.jsonl"
    return v


def _log(v: Path, *rows):
    with open(CG.LOG_PATH, "a", encoding="utf-8") as f:
        import json
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def test_run_creates_draft_with_초안_status():
    """① 초안은 상태: 초안을 달고 쓰인다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        _log(v, {"ts": "2026-08-05 10:00:00", "event": "amend_apply", "target": REL,
                 "mode": "replace", "시행일": "2026-08-03"},
             {"ts": "2026-08-05 10:00:05", "event": "amend_apply", "target": REL, "mode": "cell"})
        paths = CG.run(v)
        assert len(paths) == 1, paths
        text = (v / paths[0]).read_text(encoding="utf-8")
        assert "상태: 초안" in text and "type: changelog" in text
        assert "합성규정" in text and "2026-08-03" in text


def test_no_pending_change_makes_nothing():
    """⑤ 반영 로그가 없으면 초안도 없다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        assert CG.run(v) == []


def test_rerun_does_not_duplicate():
    """② 같은 반영으로 두 번 run()해도 초안이 두 번 생기지 않는다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        _log(v, {"ts": "2026-08-05 10:00:00", "event": "amend_apply", "target": REL, "mode": "insert"})
        first = CG.run(v)
        assert len(first) == 1
        second = CG.run(v)
        assert second == [], second


def test_new_amend_after_draft_makes_another():
    """추가 반영이 새로 생기면(시각이 더 나중) 그건 다시 초안화돼야 한다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        _log(v, {"ts": "2026-08-05 10:00:00", "event": "amend_apply", "target": REL, "mode": "insert"})
        CG.run(v)
        _log(v, {"ts": "2026-08-05 11:00:00", "event": "amend_apply", "target": REL, "mode": "append"})
        second = CG.run(v)
        assert len(second) == 1, second


def test_draft_body_passes_changelog_lint():
    """③ 초안 본문에 규정 값·인프라 정보가 없어야 한다 — lint는 초안도 검사 대상이다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        _log(v, {"ts": "2026-08-05 10:00:00", "event": "amend_apply", "target": REL,
                 "mode": "replace", "시행일": "2026-08-03"})
        CG.run(v)
        errs = CL.lint(v)
        assert errs == [], errs


def test_publish_removes_draft_flag_and_survives_lint():
    """④ 정상 초안은 게시되면 '상태: 초안'이 사라지고 lint를 통과한다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        _log(v, {"ts": "2026-08-05 10:00:00", "event": "amend_apply", "target": REL, "mode": "cell"})
        paths = CG.run(v)
        ok, msg = CG.publish(v, paths[0])
        assert ok, msg
        text = (v / paths[0]).read_text(encoding="utf-8")
        assert "상태: 초안" not in text
        assert CL.lint(v) == []
        drafts = CG.list_drafts(v)
        assert drafts == [], "게시된 뒤에는 초안 목록에 남으면 안 된다"


def test_publish_reverts_on_lint_violation():
    """④ lint 위반 초안은 게시해도 되돌아간다 — 깨진 채로 사이트에 노출되면 안 된다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        _log(v, {"ts": "2026-08-05 10:00:00", "event": "amend_apply", "target": REL, "mode": "replace"})
        paths = CG.run(v)
        p = v / paths[0]
        # 인위적으로 위반 삽입(내부 경로 노출) — 게시 시 되돌아가야 한다
        bad = p.read_text(encoding="utf-8").replace("합성규정이 개정됐어요", "tools/ 경로 유출")
        p.write_text(bad, encoding="utf-8")
        ok, msg = CG.publish(v, paths[0])
        assert not ok, "규약 위반인데 게시됐다"
        assert "상태: 초안" in p.read_text(encoding="utf-8"), "되돌리지 않고 게시 시도 흔적이 남았다"


def test_publish_missing_or_already_published():
    """존재하지 않거나 이미 게시된 파일은 명확한 사유로 거부된다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        ok, msg = CG.publish(v, "90_관리/_changelog/없음.md")
        assert not ok and "찾지" in msg, msg
        _log(v, {"ts": "2026-08-05 10:00:00", "event": "amend_apply", "target": REL, "mode": "insert"})
        paths = CG.run(v)
        CG.publish(v, paths[0])
        ok2, msg2 = CG.publish(v, paths[0])
        assert not ok2 and "이미" in msg2, msg2


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 패치노트 초안 파이프라인") or 0)
