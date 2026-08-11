#!/usr/bin/env python3
"""test_corpus_amend_apply.py — 개정 반영 쓰기 경로 회귀 (specs/15 T02).

⛔ 픽스처는 전부 합성이고, 볼트·로그는 임시 디렉터리다(실데이터 미접촉).
   이 파일이 지키는 것은 **"쓰지 말아야 할 때 쓰지 않는다"**이다.

못박는 계약:
  ① **신선도 재확인이 진짜 조건** — 줄 번호가 맞아도 내용이 다르면 쓰지 않는다(stale).
     앞선 반영으로 줄이 밀린 상황에서 이 방어가 없으면 **엉뚱한 조문을 덮는다**.
  ② **멱등** — 두 번 눌러도 안전. already는 오류가 아니다(오류로 처리하면 사람이 다시 눌러
     이중 적용을 시도한다). 삽입도 중복 줄을 만들지 않는다.
  ③ **백업이 먼저** — 쓰기 전에 원본이 남아 있어야 한다.
  ④ **검수상태는 무조건 미검수** — 내용이 바뀌었으면 사람이 다시 본다(예외 없음).
  ⑤ **관문 실패는 파일 미접촉** — 표·생략·좌동·모호·삭제는 쓰지 않고, 거부도 로그에 남는다.
  ⑥ 부칙은 **문서 끝에 블록으로** 들어간다(표제·조문이 흩어지면 안 된다).
실행: python tools/test_corpus_amend_apply.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import corpus_amend as CA  # noqa: E402
import corpus_amend_apply as AP  # noqa: E402
import corpus_replace as CR  # noqa: E402

REL = "20_규정원문/9000_합성/합성규정.md"
DOC = """---
type: regulation
규정번호: "1999"
규정명: "합성규정"
개정일: 2026-01-01
검수상태: 검수완료
---

# 합성규정

제1조(목적) 합성 테스트를 목적으로 한다.

4. 실·팀장은 합성부서의 실장, 합성센터의 실장, 기획·행정부서의 팀장임

5. 합성센터장의 위임은 실장 체계를 준용함

부 칙<2026. 1. 1.>

제1조(시행일) 이 규정은 2026년 1월 1일부터 시행한다.

<기획･행정>

<table>
<tr><td>과제<br>책임자(담당)</td><td>팀장</td><td>부서장</td><td>부원장</td></tr>
</table>
"""
CUR4 = "4. 실·팀장은 합성부서의 실장, 합성센터의 실장, 기획·행정부서의 팀장임"
NEW4 = "4. 실장은 합성부서, 합성센터, 기획·행정부서의 실장임"


def _vault(tmp: str):
    """임시 볼트 + 임시 로그. ⛔ CR.LOG_PATH를 갈아끼워 실로그를 건드리지 않는다."""
    v = Path(tmp)
    (v / "20_규정원문/9000_합성").mkdir(parents=True)
    (v / REL).write_text(DOC, encoding="utf-8")
    CR.LOG_PATH = v / "log.jsonl"
    return v


def _line_of(v, prefix: str) -> int:
    """1-based 줄 번호 — 픽스처가 바뀌어도 테스트가 따라오게(하드코딩 금지)."""
    for i, ln in enumerate((v / REL).read_text(encoding="utf-8").splitlines(), 1):
        if ln.startswith(prefix):
            return i
    raise AssertionError(f"픽스처에 '{prefix}' 줄이 없다")


def _item(**kw):
    base = {"현행줄": "", "개정줄": "", "볼트줄": 0, "앵커줄": 0,
            "모드": "replace", "반영가능": True, "불가사유": ""}
    base.update(kw)
    return base


def test_replace_writes_backup_and_resets_review():
    """③④ 백업 우선 · 검수상태 미검수 복귀 · 개정일은 부칙 시행일로."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        r = AP.apply_item(v, REL, _item(현행줄=CUR4, 개정줄=NEW4, 볼트줄=_line_of(v, "4.")),
                          actor="tester", 시행일="2026-08-03")
        assert r["ok"] and not r.get("already"), r
        assert (v / r["backup"]).exists(), "백업이 없으면 되돌릴 수 없다"
        assert "팀장임" in (v / r["backup"]).read_text(encoding="utf-8"), "백업이 원본이 아니다"

        after = (v / REL).read_text(encoding="utf-8")
        assert NEW4 in after and "실·팀장은" not in after, "교체가 안 됐거나 옛 줄이 남았다"
        assert "검수상태: 미검수" in after, "내용이 바뀌었으면 다시 검수해야 한다"
        assert "개정일: 2026-08-03" in after, after.split("---")[1]


def test_stale_line_is_refused_without_touching_file():
    """① 줄 번호가 맞아도 **내용이 다르면** 쓰지 않는다 — 없으면 엉뚱한 조문을 덮는다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        before = (v / REL).read_text(encoding="utf-8")
        r = AP.apply_item(v, REL, _item(현행줄="4. 이 문서에 없는 다른 문구다",
                                        개정줄="4. 바뀐 문구", 볼트줄=_line_of(v, "4.")), "tester")
        assert not r["ok"] and r["reason"] == "stale", r
        assert (v / REL).read_text(encoding="utf-8") == before, "거부인데 파일이 바뀌었다"
        assert any(x["event"] == "amend_blocked" for x in CR.read_log(5)), "거부 로그가 없다"


def test_apply_twice_is_idempotent():
    """② 두 번 눌러도 안전. already는 오류가 아니다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        it = _item(현행줄=CUR4, 개정줄=NEW4, 볼트줄=_line_of(v, "4."))
        assert AP.apply_item(v, REL, it, "t")["ok"]
        r2 = AP.apply_item(v, REL, it, "t")
        assert r2["ok"] and r2.get("already"), r2
        assert (v / REL).read_text(encoding="utf-8").count(NEW4) == 1, "이중 적용으로 줄이 늘었다"


def test_insert_lands_after_anchor_and_does_not_duplicate():
    """②⑤ 앵커 다음에 삽입하고, 다시 눌러도 중복 줄을 만들지 않는다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        it = _item(개정줄="6. 합성단장의 위임은 실장 체계를 준용함",
                   앵커줄=_line_of(v, "5."), 모드="insert")
        assert AP.apply_item(v, REL, it, "t")["ok"]
        lines = (v / REL).read_text(encoding="utf-8").splitlines()
        i5 = next(i for i, x in enumerate(lines) if x.startswith("5. 합성센터장"))
        i6 = next(i for i, x in enumerate(lines) if x.startswith("6. 합성단장"))
        assert i6 > i5, (i5, i6)
        assert AP.apply_item(v, REL, it, "t").get("already"), "두 번째 삽입이 막히지 않았다"
        assert (v / REL).read_text(encoding="utf-8").count("6. 합성단장") == 1


def test_buchik_block_appends_at_end_intact():
    """⑥ 부칙은 문서 끝에 **블록 통째로** — 표제와 조문이 흩어지면 안 된다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        blk = ("부 칙<2026. 7. 27.>\n제1조(시행일) 이 규정은 2026년 8월 3일부터 시행한다.\n"
               "제2조(경과조치) 종전 규정에 따른다.")
        assert AP.apply_item(v, REL, _item(개정줄=blk, 모드="append"), "t", "2026-08-03")["ok"]
        lines = [x for x in (v / REL).read_text(encoding="utf-8").splitlines() if x.strip()]
        assert lines[-3].startswith("부 칙") and lines[-1].startswith("제2조"), lines[-4:]
        assert AP.apply_item(v, REL, _item(개정줄=blk, 모드="append"), "t").get("already")


def test_new_buchik_is_not_confused_with_existing_ones():
    """⑥' 부칙은 개정 때마다 **누적**된다 — 표제 한 줄로 멱등을 판정하면 새 부칙이
    '이미 반영됨'으로 오판돼 조용히 누락된다(2026-08-04 실측). 블록 전체로 본다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        assert "부 칙<2026. 1. 1.>" in (v / REL).read_text(encoding="utf-8"), "픽스처 전제"
        blk = "부 칙<2026. 7. 27.>\n제1조(시행일) 이 규정은 2026년 8월 3일부터 시행한다."
        r = AP.apply_item(v, REL, _item(개정줄=blk, 모드="append"), "t", "2026-08-03")
        assert r["ok"] and not r.get("already"), r
        body = (v / REL).read_text(encoding="utf-8")
        assert "부 칙<2026. 1. 1.>" in body and "부 칙<2026. 7. 27.>" in body, "옛 부칙이 사라졌다"


def test_gate_failure_never_writes():
    """⑤ 관문 실패(표·좌동·생략·모호·삭제)는 **파일을 건드리지 않는다**."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        before = (v / REL).read_text(encoding="utf-8")
        r = AP.apply_item(v, REL, _item(현행줄="x", 개정줄="y", 볼트줄=13,
                                        반영가능=False, 불가사유="별표(표) 내용"), "t")
        assert not r["ok"] and r["reason"] == "gate", r
        assert (v / REL).read_text(encoding="utf-8") == before
        assert not (v / "90_관리/_backup").exists(), "쓰지도 않았는데 백업이 생겼다"


def test_cell_mode_replaces_only_the_wrapped_value():
    """운영자 지적(2026-08-05): 표 전체를 일괄 잠그면 자동화 취지에 어긋난다. 요약표
    "(현행) X ▶ (변경) Y"는 명확한 지시라 옮길 수 있어야 한다 — 단, 셀 경계(<td>…</td>) 밖의
    같은 줄 다른 값("과제책임자(담당)"·"부서장"·"부원장")은 그대로여야 한다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        n = _line_of(v, "<tr><td>과제")
        r = AP.apply_item(v, REL, _item(현행줄="팀장", 개정줄="실･팀장", 볼트줄=n, 모드="cell"), "t")
        assert r["ok"] and not r.get("already"), r
        after = (v / REL).read_text(encoding="utf-8").splitlines()[n - 1]
        assert "<td>실･팀장</td>" in after and "<td>팀장</td>" not in after, after
        assert "과제<br>책임자(담당)" in after and "부서장" in after and "부원장" in after, after

        r2 = AP.apply_item(v, REL, _item(현행줄="팀장", 개정줄="실･팀장", 볼트줄=n, 모드="cell"), "t")
        assert r2["ok"] and r2.get("already"), r2   # 멱등


def test_cell_mode_refuses_when_line_has_duplicate_cell():
    """같은 줄에 같은 셀 값이 두 번 있으면(대상 특정 불가) 쓰지 않는다."""
    with tempfile.TemporaryDirectory() as t:
        v = _vault(t)
        lines = (v / REL).read_text(encoding="utf-8").splitlines()
        n = next(i for i, ln in enumerate(lines, 1) if ln.startswith("<tr><td>과제"))
        lines[n - 1] = lines[n - 1] + "<td>팀장</td>"          # 인위적으로 중복 생성
        (v / REL).write_text("\n".join(lines), encoding="utf-8")
        before = (v / REL).read_text(encoding="utf-8")
        r = AP.apply_item(v, REL, _item(현행줄="팀장", 개정줄="실･팀장", 볼트줄=n, 모드="cell"), "t")
        assert not r["ok"] and r["reason"] == "stale", r
        assert (v / REL).read_text(encoding="utf-8") == before


def test_propose_gates_match_spec():
    """관문 판정이 spec 15 §3대로인지 — 표 행은 전부 잠기고, 확정 변경만 열린다.
    ⚠ 픽스처는 test_corpus_amend의 합성 대비표를 재사용한다(한 곳에서 관리)."""
    import test_corpus_amend as T
    props = CA.propose(DOC, CA.parse(T.AMEND))
    tbl = props[0]["변경"]
    assert tbl and not any(x["반영가능"] for x in tbl), "표 행이 열려 있다"
    assert all("별표" in x["불가사유"] for x in tbl), tbl[0]["불가사유"]
    ok = [x for r in props for x in r["변경"] if x["반영가능"]]
    assert ok, "반영 가능한 항목이 하나도 없다(관문이 과하게 잠갔다)"
    assert all(x["모드"] in ("replace", "insert", "append") for x in ok), ok


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
    sys.exit(1 if bad else print(f"\n✅ {len(fns)}개 통과 — 개정 반영 쓰기 경로") or 0)
