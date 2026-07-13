#!/usr/bin/env python3
"""01u_format_restore.py — 일반 텍스트 형식 복원 (docs/28 과업 C, 결정적·LLM 미사용).

01t(format_scan.json)가 찾은 형식 붕괴를 두 가지 결정적 규칙으로 복원한다:

  ① --ctrl   : PDF 변환 잔재 제어문자(0x01·0x07 등) 제거.
               두 비공백 문자 사이면 공백으로, 그 외엔 삭제(단어 경계 보존).
  ② --rebreak: 항(①②…)·호(1. 2. …)·목(가. 나. …) 인라인 병합 줄을 마커 앞에서 개행.
               - '제①항' 같은 인라인 참조(직전 문자 '제')는 절대 분리하지 않음
               - 호·목은 1(가)부터 증가하는 기대 카운터와 일치할 때만 분리(날짜 오탐 방지)
               - <개정 …> 각도괄호 태그 안은 오프셋 보존 마스킹으로 보호
               - 01t가 플래그한 '그 줄'만 손댐 — 문서 전체를 다시 쓰지 않는다

⛔ 내용 불변 검증(기계 강제): 편집 전후 본문을 정규화(공백·제어문자 제거)해 완전 동일할
때만 파일에 쓴다. 다르면 그 문서는 건너뛰고 사람 확인 대상으로 보고한다.
type:system(ERP 노트)은 생성물의 의도된 인라인 열거이므로 대상에서 제외.

실행: .venv/bin/python tools/01u_format_restore.py --vault KEI-행정가이드 [--ctrl] [--rebreak] [--dry]
산출: tools/index/format_restore.json + 백업 tools/index/format_restore/backup/
"""
import argparse
import json
import re
import shutil
import time
from pathlib import Path

CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮"
ANGLE = re.compile(r"<[^<>]{0,120}>")


def norm(s: str) -> str:
    """내용 불변 판정용 정규화: 공백·제어문자를 전부 제거(형식만 보고 내용만 남긴다)."""
    return re.sub(r"[\s\x00-\x1f]+", "", s)


def strip_ctrl(text: str) -> str:
    out = []
    for i, ch in enumerate(text):
        if CTRL.match(ch):
            prev = text[i - 1] if i else " "
            nxt = text[i + 1] if i + 1 < len(text) else " "
            out.append(" " if (not prev.isspace() and not nxt.isspace()) else "")
        else:
            out.append(ch)
    return "".join(out)


def _mask_angles(s: str) -> str:
    """<개정 …> 구간을 같은 길이 공백으로 치환(오프셋 보존) — 그 안의 날짜·마커 보호."""
    return ANGLE.sub(lambda m: " " * len(m.group()), s)


def rebreak_line(s: str, signals: set) -> str:
    """플래그된 병합 줄을 마커 앞 개행으로 복원. 문자 삽입/삭제 없음(개행 삽입만)."""
    masked = _mask_angles(s)
    cuts = set()

    if any("원문자" in x for x in signals):
        for i, ch in enumerate(masked):
            if ch in CIRCLED and i > 0 and masked[i - 1] != "제":
                cuts.add(i)

    if any("(호)" in x for x in signals):
        expected = 1
        for m in re.finditer(r"(?:^|(?<=\s))(\d{1,2})\.\s", masked):
            if int(m.group(1)) == expected and m.start() > 0:
                cuts.add(m.start())
                expected += 1

    if any("한글목" in x for x in signals):
        seq = "가나다라마바사아자차카타파하"
        expected = 0
        for m in re.finditer(r"(?:^|(?<=\s))([가-하])\.\s", masked):
            if m.group(1) == seq[expected] and m.start() > 0:
                cuts.add(m.start())
                if expected + 1 < len(seq):
                    expected += 1

    if not cuts:
        return s
    parts, prev = [], 0
    for c in sorted(cuts):
        parts.append(s[prev:c].rstrip())
        prev = c
    parts.append(s[prev:])
    return "\n".join(p for p in parts if p.strip())


def main():
    ap = argparse.ArgumentParser(description="형식 복원(결정적, 내용 불변 기계 검증)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--scan", default="tools/index/format_scan.json")
    ap.add_argument("--ctrl", action="store_true", help="제어문자 제거")
    ap.add_argument("--rebreak", action="store_true", help="항·호·목 인라인 병합 개행 복원")
    ap.add_argument("--only", default="", help="특정 문서 path 부분 일치 필터(파일럿용)")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--out", default="tools/index/format_restore.json")
    args = ap.parse_args()
    if not (args.ctrl or args.rebreak):
        raise SystemExit("--ctrl / --rebreak 중 하나 이상을 지정하세요.")

    vault = Path(args.vault)
    scan = json.loads(Path(args.scan).read_text(encoding="utf-8"))
    bdir = Path("tools/index/format_restore/backup")
    ts = time.strftime("%Y%m%d-%H%M%S")
    report = []

    for doc in scan["docs"]:
        if doc["type"] == "system":
            continue  # ERP 노트의 인라인 열거는 의도된 형식(생성물) — 제외
        if args.only and args.only not in doc["path"]:
            continue
        fp = vault / doc["path"]
        if not fp.is_file():
            continue
        text = fp.read_text(encoding="utf-8")
        new = text
        acts = []

        if args.ctrl and any(h["신호"] == "비정상문자" for h in doc["hits"]):
            n_before = len(CTRL.findall(new))
            new = strip_ctrl(new)
            acts.append(f"제어문자 {n_before}개 제거")

        if args.rebreak:
            by_line = {}
            for h in doc["hits"]:
                if h["신호"].startswith("마커병합"):
                    by_line.setdefault(h["표본"][:80], set()).add(h["신호"])
            if by_line:
                lines = new.splitlines()
                n_broken = 0
                for i, ln in enumerate(lines):
                    key = next((k for k in by_line if ln.strip()[:80] == k), None)
                    if key:
                        nl = rebreak_line(ln, by_line[key])
                        if nl != ln:
                            lines[i] = nl
                            n_broken += 1
                if n_broken:
                    new = "\n".join(lines) + ("\n" if new.endswith("\n") else "")
                    acts.append(f"병합 줄 {n_broken}개 개행 복원")

        if new == text or not acts:
            continue

        # ⛔ 내용 불변 기계 검증 — 다르면 절대 쓰지 않는다
        if norm(new) != norm(text):
            report.append({"path": doc["path"], "결과": "SKIP(내용 불변 검증 실패 — 사람 확인)"})
            print(f"⛔ {doc['path']}: 정규화 불일치 — 건너뜀")
            continue

        if not args.dry:
            bdir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(fp, bdir / (doc["path"].replace("/", "__") + f".orig-{ts}"))
            fp.write_text(new, encoding="utf-8")
        report.append({"path": doc["path"], "결과": ("DRY " if args.dry else "") + " · ".join(acts)})
        print(f"{'🔍' if args.dry else '✅'} {doc['path']}: {' · '.join(acts)}")

    Path(args.out).write_text(json.dumps({"at": ts, "docs": report}, ensure_ascii=False, indent=1),
                              encoding="utf-8")
    print(f"\n{len(report)}건 → {args.out}" + ("  (dry-run — 파일 불변)" if args.dry else ""))


if __name__ == "__main__":
    main()
