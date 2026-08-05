#!/usr/bin/env python3
"""changelog_amend.py — 개정 반영 → 패치노트 초안 자동 생성 (specs/15 확장, 2026-08-05).

## 왜

운영자 요청: "이 줄 반영해서 재색인 진행하게 되면 패치노트 생성해서 올릴 수 있도록
파이프라인 구축해줘." 재색인이 끝나면(`app_api._reindex_worker`) 그 사이 실제로 반영된
개정(`amend_apply` 로그)을 모아 사용자용 패치노트 **초안**을 자동으로 쓴다.

## 설계 원칙 (기존 changelog 관례를 그대로 따른다 — 새 규칙 만들지 않는다)

⛔ **자동 게시 없음** — 초안은 프론트매터에 `상태: 초안`을 달고, `web/lib/vault.ts`가 그
   값을 보고 사이트에서 걸러낸다. 사람이 `publish()`를 부를 때까지 아무도 못 본다
   ("자동은 준비까지, 확정은 사람" — 이 프로젝트 전체에 일관된 원칙).
⛔ **규정 값을 본문에 옮기지 않는다** — `changelog_lint.py`가 금액·기한·비율을 막는
   이유(수치가 나중에 바뀌면 패치노트가 낡은 근거가 된다)와 같다. "무엇이 바뀌었는지
   범주"만 말하고 정확한 내용은 원문으로 유도한다.
⛔ **중복 생성 없음** — 상태 파일이 대상 문서별 마지막 처리 시각을 기억해, 재색인마다
   같은 반영을 다시 초안으로 만들지 않는다.
✅ **초안도 lint 대상이다** — `changelog_lint.lint()`는 `_changelog/` 디렉터리 전체를
   훑는다(상태 무관). 그래서 `publish()`는 새로 검사하지 않고, "상태: 초안" 줄을 지운
   다음 그 파일 이름이 낀 오류가 있는지만 보면 된다 — 있으면 되돌리고 게시하지 않는다.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from vault_parse import split_frontmatter  # noqa: E402

STATE_PATH = HERE / "index" / "changelog_amend_state.json"
LOG_PATH = HERE / "index" / "corpus_replace_log.jsonl"
CHANGELOG_DIR = ("90_관리", "_changelog")

_LABEL = {"replace": "조문 문구 정리", "insert": "새 항목 추가",
          "append": "부칙 신설", "cell": "별표 항목 명칭 변경"}


def _load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_state(st: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")


def _read_log() -> list:
    try:
        lines = LOG_PATH.read_text(encoding="utf-8").strip().splitlines()
    except OSError:
        return []
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except ValueError:
            continue
    return out


def pending_targets(state: dict | None = None) -> dict:
    """{target: [amend_apply 로그...]} — 아직 초안으로 안 만든 반영만."""
    st = state if state is not None else _load_state()
    out: dict = {}
    for r in _read_log():
        if r.get("event") != "amend_apply":
            continue
        target = r.get("target", "")
        if not target or r.get("ts", "") <= st.get(target, ""):
            continue
        out.setdefault(target, []).append(r)
    return out


def _slug(name: str) -> str:
    return re.sub(r"[^\w가-힣]+", "-", name).strip("-")[:30] or "규정개정"


def draft_one(vault, target: str, entries: list) -> dict:
    """target 1건의 초안 dict(파일에 쓰지 않는다 — write_draft가 쓴다)."""
    doc = Path(vault) / target
    fm = {}
    if doc.is_file():
        fm, _ = split_frontmatter(doc.read_text(encoding="utf-8"))
    name = (fm or {}).get("규정명") or Path(target).stem
    enforce = next((e.get("시행일") for e in entries if e.get("시행일")), "")

    labels, seen = [], set()
    for e in entries:
        lab = _LABEL.get(e.get("mode", ""), "조문 변경")
        if lab not in seen:
            labels.append(lab)
            seen.add(lab)

    when = f" {enforce}부터" if enforce else ""
    body = (f"**무엇이 바뀌었나** — {name}{when} 개정 내용이 반영됐습니다. "
            f"이번 개정으로 {', '.join(labels)}이(가) 있었어요. "
            "정확한 조문은 문서에서 확인해 주세요.\n\n"
            "**어떻게 쓰나** — 따로 할 일은 없어요. 질문하면 최신 조문 기준으로 답해드려요.")
    return {"target": target, "제목": f"{name}이 개정됐어요", "날짜": time.strftime("%Y-%m-%d"),
            "분류": "데이터", "요약": f"{name} 조문 일부가 개정 시행됩니다"[:60],
            "관련페이지": "/browse", "body": body, "건수": len(entries), "슬러그": _slug(name)}


def write_draft(vault, draft: dict) -> str:
    """`_changelog/<날짜>-<슬러그>-초안.md`로 쓴다. → 볼트 기준 상대경로."""
    out_dir = Path(vault, *CHANGELOG_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    base, i = out_dir / f"{draft['날짜']}-{draft['슬러그']}-초안.md", 2
    path = base
    while path.exists():
        path = out_dir / f"{draft['날짜']}-{draft['슬러그']}-초안-{i}.md"
        i += 1
    fm = (f"---\ntype: changelog\n제목: {draft['제목']}\n날짜: {draft['날짜']}\n"
          f"분류: {draft['분류']}\n요약: {draft['요약']}\n관련페이지: {draft['관련페이지']}\n"
          f"상태: 초안\n대상문서: {draft['target']}\n---\n")
    path.write_text(fm + draft["body"] + "\n", encoding="utf-8")
    return str(path.relative_to(Path(vault)))


def run(vault) -> list:
    """재색인 성공 후 호출(app_api._reindex_worker). 새 반영이 있는 대상마다 초안 1건."""
    pend = pending_targets()
    if not pend:
        return []
    st = _load_state()
    paths = []
    for target, entries in pend.items():
        paths.append(write_draft(vault, draft_one(vault, target, entries)))
        st[target] = max(e.get("ts", "") for e in entries)
    _save_state(st)
    return paths


def list_drafts(vault) -> list:
    """게시 대기 중인 초안 목록(읽기 전용)."""
    out = []
    d = Path(vault, *CHANGELOG_DIR)
    if not d.is_dir():
        return out
    for f in sorted(d.glob("*.md")):
        try:
            fm, body = split_frontmatter(f.read_text(encoding="utf-8"))
        except OSError:
            continue
        if (fm or {}).get("상태") == "초안":
            out.append({"path": str(f.relative_to(Path(vault))), "body": body.strip(), **(fm or {})})
    return out


def publish(vault, rel_path: str) -> tuple[bool, str]:
    """초안 → 게시(상태: 초안 제거). lint 위반이면 되돌리고 게시하지 않는다."""
    import changelog_lint as CL
    p = Path(vault) / rel_path
    if not p.is_file():
        return False, "초안 파일을 찾지 못했습니다."
    original = p.read_text(encoding="utf-8")
    if "상태: 초안\n" not in original:
        return False, "이미 게시됐거나 초안이 아닙니다."
    p.write_text(original.replace("상태: 초안\n", "", 1), encoding="utf-8")
    errs = [e for e in CL.lint(Path(vault)) if e.startswith(p.name + ":")]
    if errs:
        p.write_text(original, encoding="utf-8")   # 되돌리기 — 게시 안 함
        return False, "규약 위반(되돌림): " + " / ".join(errs)
    return True, "게시됨"


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="개정 반영 → 패치노트 초안(⛔자동 게시 없음)")
    ap.add_argument("--vault", default="KEI-행정가이드")
    ap.add_argument("--publish", metavar="REL_PATH", help="초안 경로를 지정하면 게시만 수행")
    a = ap.parse_args()
    if a.publish:
        ok, msg = publish(a.vault, a.publish)
        print(("✅ " if ok else "❌ ") + msg)
        raise SystemExit(0 if ok else 1)
    made = run(a.vault)
    print(f"초안 {len(made)}건" + (": " + ", ".join(made) if made else " — 새 반영 없음"))
