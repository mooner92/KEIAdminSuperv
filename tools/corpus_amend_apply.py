#!/usr/bin/env python3
"""corpus_amend_apply.py — 대비표 한 줄을 볼트에 적용 (specs/15 T02).

## 경계 (specs/15 §2)

`corpus_amend.py`는 **읽기 전용**(판별·해독·위치 짚기)이고, 볼트에 쓰는 코드는 **이 파일뿐**이다.
위험한 코드는 작고 한 곳에 모여 있어야 감사가 가능하다.
(`test_corpus_amend.test_no_write_path_exists`가 그 경계를 강제한다.)

## 이 모듈이 하는 일은 '전사'이지 '판단'이 아니다

`개정(안)` 칸에 적힌 글자를 볼트의 그 줄에 **그대로 옮긴다.** 무엇으로 바꿀지 고르는 순간이 없다.
"좌동"이 무엇을 가리키는지, "생략"된 매트릭스가 어떻게 바뀌는지는 문서에 없으므로 애초에 여기까지
오지 않는다(관문이 `corpus_amend._gate`에서 걸러낸다) — ⛔절대규칙 1·2.

## 가장 중요한 것: 신선도 재확인 (specs/15 §4)

줄 번호는 **미리보기 시점의 스냅숏**이다. 그사이 문서가 바뀌었거나 앞선 반영으로 줄이 밀렸으면
그 번호는 다른 줄을 가리킨다. 그래서 쓰기 직전에 **대상 줄의 현재 내용**이 `현행줄`과 같은지 다시
본다. 줄 번호는 힌트일 뿐이고 **내용 일치가 진짜 조건**이다.

  일치        → 적용
  이미 개정줄 → `already`(멱등). ⚠ 오류로 처리하면 사람이 다시 눌러 이중 적용을 시도한다.
  그 외       → `stale` 거부. 파일은 손대지 않는다.

⛔ 일괄 적용 없음 — 한 번에 한 항목. 사람이 보게 하는 것이 관문의 존재 이유다.
"""
from __future__ import annotations

import re
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import corpus_amend as CA  # noqa: E402
from corpus_replace import BACKUP_SUB, log  # noqa: E402 — 로그·백업 규약을 교체와 공유
from vault_parse import split_frontmatter  # noqa: E402

MODES = ("replace", "insert", "append")


def _backup(vault: Path, target: Path) -> str:
    """⛔ 쓰기 전에 항상 먼저. 되돌릴 수 없는 조작은 만들지 않는다."""
    bdir = vault / BACKUP_SUB
    bdir.mkdir(parents=True, exist_ok=True)
    bak = bdir / f"{target.stem}-{time.strftime('%Y-%m-%d-%H%M%S')}.md"
    shutil.copy2(target, bak)
    return str(bak.relative_to(vault))


def _touch_frontmatter(text: str, 시행일: str = "") -> str:
    """검수상태 → 미검수(예외 없음) · 개정일 → 부칙 시행일(문서에 있을 때만).

    ⛔ 내용이 바뀌었으면 사람이 다시 본다. 시행일이 없으면 개정일은 **건드리지 않는다**(추측 금지).
    """
    fm, _ = split_frontmatter(text)
    parts = text.split("---", 2)
    if not fm or len(parts) < 3:
        return text
    block = parts[1]
    if re.search(r"^검수상태:", block, re.MULTILINE):
        block = re.sub(r"^검수상태:.*$", "검수상태: 미검수", block, flags=re.MULTILINE)
    else:
        block = block.rstrip("\n") + "\n검수상태: 미검수\n"
    if 시행일:
        block = re.sub(r"^개정일:.*$", f"개정일: {시행일}", block, flags=re.MULTILINE)
    return "---" + block + "---" + parts[2]


def apply_item(vault, rel_path: str, item: dict, actor: str, 시행일: str = "") -> dict:
    """한 항목 적용. → {ok, event, ...}. ⛔ 거부해도 **반드시 로그를 남긴다**(왜 안 됐는지가 단서).

    item = corpus_amend.propose()가 만든 변경 항목 그대로
           {현행줄, 개정줄, 볼트줄, 앵커줄, 모드, 반영가능, 불가사유}
    """
    vault = Path(vault)
    target = vault / rel_path
    mode = item.get("모드", "")
    base = {"target": rel_path, "mode": mode, "actor": actor}

    if not item.get("반영가능"):
        return {"ok": False, **log("amend_blocked", reason="gate",
                                   detail=item.get("불가사유", ""), **base)}
    if mode not in MODES:
        return {"ok": False, **log("amend_blocked", reason="mode", detail=mode, **base)}
    if not target.is_file():
        return {"ok": False, **log("amend_blocked", reason="missing", detail=rel_path, **base)}

    text = target.read_text(encoding="utf-8")
    lines = text.splitlines()
    new_line = item.get("개정줄", "")

    if mode == "replace":
        n = int(item.get("볼트줄") or 0)
        if not (1 <= n <= len(lines)):
            return {"ok": False, **log("amend_blocked", reason="range", detail=str(n), **base)}
        now = lines[n - 1]
        # ── 신선도 재확인(specs/15 §4). 줄 번호가 아니라 **내용**이 조건이다.
        if CA._norm(now) == CA._norm(new_line):
            return {"ok": True, "already": True,
                    **log("amend_already", line=n, detail=now[:120], **base)}
        if CA._norm(now) != CA._norm(item.get("현행줄", "")):
            return {"ok": False, **log("amend_blocked", reason="stale", line=n,
                                       기대=item.get("현행줄", "")[:120], 실제=now[:120], **base)}
        backup = _backup(vault, target)
        lines[n - 1] = new_line
        before, at = now, n

    elif mode == "insert":
        a = int(item.get("앵커줄") or 0)
        if not (1 <= a <= len(lines)):
            return {"ok": False, **log("amend_blocked", reason="anchor", detail=str(a), **base)}
        # 이미 들어가 있으면 다시 넣지 않는다(멱등) — 두 번 눌러도 중복 줄이 생기면 안 된다.
        if any(CA._norm(x) == CA._norm(new_line) for x in lines):
            return {"ok": True, "already": True,
                    **log("amend_already", line=a, detail=new_line[:120], **base)}
        backup = _backup(vault, target)
        # 앵커 **앞**이 빈 줄이면 이 문서는 항목을 빈 줄로 나눈다 — 그 간격을 그대로 따른다.
        # ⚠ 앵커 '뒤'로 판정하면 앵커가 마지막 줄일 때 항상 붙여 써서 문단이 무너진다(실측).
        gap = [""] if (a >= 2 and not lines[a - 2].strip()) else []
        before = lines[a - 1]
        lines[a:a] = gap + [new_line]
        at = a + len(gap) + 1

    else:  # append — 부칙은 언제나 문서 끝(specs/15 §5-4)
        blk = [x for x in new_line.split("\n") if x.strip()]
        if not blk:
            return {"ok": False, **log("amend_blocked", reason="empty", **base)}
        # 멱등 판정은 **블록 전체**로 한다. 표제 한 줄('부 칙')로 보면 개정 때마다 누적된
        # 옛 부칙과 같아 보여, 새 부칙이 '이미 반영됨'으로 오판된다(2026-08-04 실측).
        if CA._norm("\n".join(blk)) in CA._norm("\n".join(lines)):
            return {"ok": True, "already": True,
                    **log("amend_already", detail=blk[0][:120], **base)}
        backup = _backup(vault, target)
        while lines and not lines[-1].strip():
            lines.pop()
        for x in blk:
            lines += ["", x]
        before, at = "", len(lines)

    out = "\n".join(lines) + "\n"
    target.write_text(_touch_frontmatter(out, 시행일), encoding="utf-8")
    return {"ok": True, "backup": backup,
            **log("amend_apply", line=at, before=before[:200], after=new_line[:200],
                  backup=backup, 시행일=시행일, **base)}


if __name__ == "__main__":   # 점검용 — 실제 적용은 관리자 화면에서
    import argparse
    import json
    ap = argparse.ArgumentParser(description="대비표 한 줄 적용 — ⛔한 번에 하나, 사람이 승인")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--doc", required=True, help="볼트 기준 상대경로")
    ap.add_argument("--item", required=True, help="propose() 항목 JSON")
    ap.add_argument("--actor", default="cli")
    ap.add_argument("--enforce", default="", help="부칙 시행일(YYYY-MM-DD)")
    a = ap.parse_args()
    print(json.dumps(apply_item(a.vault, a.doc, json.loads(a.item), a.actor, a.enforce),
                     ensure_ascii=False, indent=2))
