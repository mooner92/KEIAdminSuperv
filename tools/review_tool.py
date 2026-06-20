#!/usr/bin/env python3
"""review_tool.py — 미검수 노트 검수 CLI (P1.2). ⛔ '검수완료' 확정은 오직 사람의 명시적 승인으로만.

흐름: 검수 큐(review_queue) → 노트를 보여주고(별표/별지 강조 + 원본파일 안내) → 사람이 직접 판단 →
  명시적 'approve' 입력 시에만 프론트매터 `검수상태: 검수완료`(+검수일/검토자) 기록 + 그 노트만 재임베딩.

⛔ 가드레일:
  - 에이전트·스크립트는 절대 자동 승인하지 않는다. approve는 사람이 키보드로 'approve' 전체를 입력해야 한다.
  - 원문(별표·숫자·표) 의역 금지 — 이 도구는 표시만 한다. 본문 수정은 사람이 에디터에서.
  - 승인 시 재임베딩 전 Chroma 백업(reembed_note가 자동). 반영하려면 이후 `pm2 restart kei-rag-api`.

읽기 전용(승인 없음):
  python tools/review_tool.py --vault KEI-행정가이드 --show 4300_여비규정      # 한 노트 렌더(별표 강조)
  python tools/review_tool.py --vault KEI-행정가이드 --list 10                 # 큐 상위 10개만
대화형(사람 승인):
  python tools/review_tool.py --vault KEI-행정가이드 --reviewer "홍길동"        # 큐 순서대로 검수
"""
import argparse
import importlib.util
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(modname, filename):
    spec = importlib.util.spec_from_file_location(modname, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
BYEOLPYO = re.compile(r"(\[?\s*별표\s*\d*|\[?\s*별지\s*제?\d*호?|별첨)")


def split_fm(text):
    if text.startswith("---"):
        try:
            _, fm, body = text.split("---", 2)
        except ValueError:
            return None, text
        return fm, body
    return None, text


def fm_get(fm, key):
    m = re.search(rf"(?m)^{re.escape(key)}:\s*(.*)$", fm or "")
    return m.group(1).strip().strip('"').strip("'") if m else ""


def render(md: Path, vault: Path):
    text = md.read_text(encoding="utf-8")
    fm, body = split_fm(text)
    typ = fm_get(fm, "type")
    name = fm_get(fm, "규정명") or fm_get(fm, "제목") or fm_get(fm, "용어") or md.stem
    src = fm_get(fm, "원본파일")
    reviewed = fm_get(fm, "검수상태") or "미검수"
    n_by = len(BYEOLPYO.findall(body))
    print("=" * 78)
    print(f"  {name}   [{typ}]   검수상태: {reviewed}")
    print(f"  경로: {md.relative_to(vault)}")
    if src:
        print(f"  원본파일(대조용): {src}   ← 표·별표는 원본과 직접 대조")
    print(f"  별표/별지/별첨 표시: {n_by}건" + ("  ⚠ 표 깨짐 위험 — 원본 대조 필수" if n_by else ""))
    print("=" * 78)
    for ln in body.strip().split("\n"):
        mark = ">>별표>> " if BYEOLPYO.search(ln) else "        "
        print(mark + ln)
    print("=" * 78)


def mark_reviewed(md: Path, reviewer: str) -> bool:
    """프론트매터 검수상태 미검수→검수완료 + 검수일/검토자. (사람 승인 후에만 호출)"""
    text = md.read_text(encoding="utf-8")
    fm, body = split_fm(text)
    if fm is None:
        print("  프론트매터 없음 — 건너뜀")
        return False
    today = datetime.now().strftime("%Y-%m-%d")
    if re.search(r"(?m)^검수상태:", fm):
        fm = re.sub(r"(?m)^검수상태:.*$", "검수상태: 검수완료", fm)
    else:
        fm = fm.rstrip("\n") + "\n검수상태: 검수완료\n"
    # 검수일/검토자(가이드는 최종검토일/검토자 스키마 사용)
    datekey = "최종검토일" if re.search(r"(?m)^최종검토일:", fm) else "검수일"
    if re.search(rf"(?m)^{datekey}:", fm):
        fm = re.sub(rf"(?m)^{datekey}:.*$", f"{datekey}: {today}", fm)
    else:
        fm = fm.rstrip("\n") + f"\n{datekey}: {today}\n"
    if reviewer:
        if re.search(r"(?m)^검토자:", fm):
            fm = re.sub(r"(?m)^검토자:.*$", f"검토자: {reviewer}", fm)
        else:
            fm = fm.rstrip("\n") + f"\n검토자: {reviewer}\n"
    md.write_text(f"---{fm}---{body}", encoding="utf-8")
    print(f"  ✅ 검수완료 기록: {datekey}={today}" + (f", 검토자={reviewer}" if reviewer else ""))
    return True


def reembed(md: Path, vault: Path, db: str):
    rel = str(md.relative_to(vault))
    print(f"  ↻ 재임베딩: {rel} (백업 자동)")
    r = subprocess.run([sys.executable, str(HERE / "reembed_note.py"),
                        "--vault", str(vault), "--path", rel, "--db", db],
                       capture_output=True, text=True)
    sys.stdout.write(r.stdout[-600:])
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-600:])
        print("  ⚠ 재임베딩 실패 — 검수완료 표시는 유지되나 색인 미반영. 수동 확인 필요.")


def resolve(vault: Path, key: str):
    cands = [p for p in vault.rglob("*.md")
             if p.name != "README.md" and (p.stem == key or str(p.relative_to(vault)) == key)]
    return cands


def main():
    ap = argparse.ArgumentParser(description="미검수 검수 CLI (사람 승인 전용)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--show", help="한 노트만 렌더(읽기 전용): stem 또는 상대경로")
    ap.add_argument("--list", type=int, metavar="N", help="검수 큐 상위 N개 나열(읽기 전용)")
    ap.add_argument("--db", default="tools/chroma")
    ap.add_argument("--reviewer", default="", help="검토자 이름(검수완료 기록에 들어감)")
    ap.add_argument("--limit", type=int, default=20, help="대화형에서 다룰 큐 상위 건수")
    args = ap.parse_args()
    vault = Path(args.vault)

    if args.show:
        cands = resolve(vault, args.show)
        if not cands:
            raise SystemExit(f"노트를 찾지 못함: {args.show}")
        for md in cands:
            render(md, vault)
        return

    # 큐 로드(review_queue.py의 split_fm·TYPE_W 재사용 — 우선순위 동일)
    rq = _load("review_queue", "review_queue.py")
    notes = []
    for md in vault.rglob("*.md"):
        if md.name == "README.md":
            continue
        meta, body = rq.split_fm(md.read_text(encoding="utf-8"))
        if not meta.get("type") or meta.get("검수상태") == "검수완료":
            continue
        notes.append((md, meta, body))
    queue = sorted(notes, key=lambda x: -(rq.TYPE_W.get(x[1].get("type"), 5)
                   + (15 if re.search(r"별표|별지|별첨", x[2]) else 0)))

    if args.list:
        print(f"검수 큐 상위 {min(args.list, len(queue))} (전체 미검수 {len(queue)})")
        for md, meta, _ in queue[:args.list]:
            nm = meta.get("규정명") or meta.get("제목") or meta.get("용어") or md.stem
            print(f"  [{meta.get('type'):<10}] {nm}")
        return

    # 대화형 — ⛔ 'approve' 전체 입력해야 승인
    print(f"검수 시작: 미검수 {len(queue)}건. 각 노트에서 'approve'=검수완료+재임베딩 / Enter=건너뜀 / q=종료")
    print("⛔ 자동 승인 없음. 원문(별표·숫자) 의역 금지 — 의심되면 건너뛰고 사람이 원본 대조.\n")
    for md, meta, _ in queue[:args.limit]:
        render(md, vault)
        try:
            ans = input("\n승인하려면 'approve' 입력 (Enter=건너뜀, q=종료): ").strip()
        except EOFError:
            print("\n비대화형 입력 — 승인 없이 종료(가드레일).")
            break
        if ans == "q":
            break
        if ans == "approve":
            if mark_reviewed(md, args.reviewer):
                reembed(md, vault, args.db)
        else:
            print("  — 건너뜀(미검수 유지)")
    print("\n검수 세션 종료. 반영하려면: pm2 restart kei-rag-api")


if __name__ == "__main__":
    main()
