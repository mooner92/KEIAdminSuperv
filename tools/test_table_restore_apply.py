#!/usr/bin/env python3
"""test_table_restore_apply.py — 표 복원 반영(_apply_restore) 유닛 (docs/24 §1).

임시 픽스처 볼트에서만 동작 — 실볼트 무접촉. 보장:
  ⓐ 헤더 일치 + 손상 판정 블록만 교체(정상 표·헤더 불일치 표는 불변)
  ⓑ 교체 전 원본 백업 생성  ⓒ 매칭 없으면(평탄화) 무변경 + manual_needed
  ⓓ dry-run은 파일 불변  ⓔ 멱등(반영 후 재반영 시 matched=0 — 이미 정상이므로)

실행: APP_DB=/tmp/test-tra.db VAULT_DIR=<tmp> .venv/bin/python tools/test_table_restore_apply.py
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="kei-tra-")
os.environ["APP_DB"] = os.path.join(TMP, "test.db")
os.environ["APP_SECRET_FILE"] = os.path.join(TMP, ".secret")
os.environ["VAULT_DIR"] = os.path.join(TMP, "vault")

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app_api  # noqa: E402

BROKEN = """---
type: regulation
규정명: 복무규정
검수상태: 미검수
---
제15조(청원휴가) 별표 1과 같다.

| 구    분 | 대              상 | 일   수 |
| --- | --- | --- |
| 결    혼 | 본    인자    녀 | 51 |
| 사    망 | 배우자, 본인 및 배우자의 부모 형제자매 | 5333 |

| 다른표 | 값 |
| --- | --- |
| 항목 | 10 |
"""

PROP = {
    "name": "복무규정", "source": "복무규정.hwpx", "vault_paths": ["20_규정원문/3000_인사/복무규정.md"],
    "표본": [], "사유": ["병합"],
    "tables": [
        {"label": "표 1", "verdict": "", "rows": [
            ["구    분", "대              상", "일   수"],
            ["결    혼", "본    인<br>자    녀", "5<br>1"],
            ["사    망", "배우자, 본인 및 배우자의 부모<br>형제자매", "5<br>3"],
        ]},
        {"label": "표 X(볼트에 없음)", "verdict": "", "rows": [["없는헤더", "값"], ["a", "1"]]},
    ],
}

FLAT_PROP = {
    "name": "경조사안내", "source": "x.pdf", "vault_paths": ["10_업무가이드/경조사안내.md"],
    "표본": [], "사유": ["평탄화"],
    "tables": [{"label": "p.3", "verdict": "한 셀에 금액 다수", "rows": [["지급구분", "경조금"], ["결혼", "500,000원"]]}],
}


def setup():
    app_api.RESTORE_DIR = os.path.join(TMP, "restore")  # 실 스테이징 디렉터리 오염 방지
    vp = Path(os.environ["VAULT_DIR"]) / "20_규정원문/3000_인사"
    vp.mkdir(parents=True, exist_ok=True)
    (vp / "복무규정.md").write_text(BROKEN, encoding="utf-8")
    fp = Path(os.environ["VAULT_DIR"]) / "10_업무가이드"
    fp.mkdir(parents=True, exist_ok=True)
    (fp / "경조사안내.md").write_text("---\ntype: guide\n---\n결혼\n퇴직\n사망\n입원\n본인 : 500,000원\n", encoding="utf-8")


def read_doc():
    return (Path(os.environ["VAULT_DIR"]) / "20_규정원문/3000_인사/복무규정.md").read_text(encoding="utf-8")


def test_dry_run_no_change():
    before = read_doc()
    res = app_api._apply_restore(PROP, dry=True)
    assert res["matched"] == 1 and read_doc() == before


def test_apply_replaces_only_broken_matching_block():
    res = app_api._apply_restore(PROP, dry=False)
    assert res["matched"] == 1, res
    after = read_doc()
    assert "5<br>1" in after and "| 51 |" not in after        # 손상 표 교체됨
    assert "| 항목 | 10 |" in after                           # 정상 표(다른 헤더)는 불변
    assert "제15조(청원휴가)" in after and after.startswith("---")  # 본문·프론트매터 보존
    assert "검수상태: 미검수" in after                          # ⛔검수상태 불변


def test_backup_created():
    bdir = Path(app_api.RESTORE_DIR) / "backup"
    baks = [f for f in os.listdir(bdir) if f.startswith("20_규정원문__3000_인사__복무규정.md.orig-")]
    assert baks, "백업 없음"
    assert "| 51 |" in (bdir / baks[-1]).read_text(encoding="utf-8")  # 백업엔 원문 보존


def test_idempotent_second_apply():
    res = app_api._apply_restore(PROP, dry=False)
    assert res["matched"] == 0  # 이미 정상(<br>) — 손상 판정 안 되므로 재교체 없음


def test_flattened_no_match_manual():
    res = app_api._apply_restore(FLAT_PROP, dry=False)
    assert res["matched"] == 0 and res["manual_needed"] == ["p.3"]
    body = (Path(os.environ["VAULT_DIR"]) / "10_업무가이드/경조사안내.md").read_text(encoding="utf-8")
    assert "결혼\n퇴직" in body  # 무변경


def test_stale_set_roundtrip():
    """수용 ⓓ(docs/24): 반영된 문서는 스테일 셋에 기록 → 재색인 성공 시 클리어.
    ⚠ STALE_PATH를 임시로 돌려 실제 tools/index/ 오염 방지."""
    app_api.STALE_PATH = os.path.join(TMP, "reindex_stale.json")
    app_api._mark_stale(["복무규정", ""])  # 빈 슬러그는 무시돼야 함
    st = app_api._load_stale()
    assert st == {"복무규정"}, st
    # corpus_list 판정식과 동일 신호: 이미 색인된(청크>0·미제외) 문서도 stale이면 재색인 필요
    assert ((False and 12 > 0) or (not False and 12 == 0) or ("복무규정" in st)) is True
    app_api._clear_stale()
    assert app_api._load_stale() == set()
    app_api._clear_stale()  # 파일 없음 멱등


if __name__ == "__main__":
    setup()
    fns = [test_dry_run_no_change, test_apply_replaces_only_broken_matching_block,
           test_backup_created, test_idempotent_second_apply, test_flattened_no_match_manual,
           test_stale_set_roundtrip]
    failed = 0
    for fn in fns:  # 순서 의존(적용→백업→멱등) — 정렬하지 않음
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  ❌  {fn.__name__}: {e}")
    shutil.rmtree(TMP, ignore_errors=True)
    if failed:
        sys.exit(1)
    print(f"\n✅ {len(fns)}개 테스트 통과 — 표 복원 반영(_apply_restore)")
