#!/usr/bin/env python3
"""organize_sources.py — erps/ 원본을 정본 8편 체계로 구조화 (docs/64).

목적: 원본 자료를 규정집구조.xlsx의 정본 분류(편→규정번호→하위기준)로 재배치하고,
      같은 규정의 여러 버전을 manifest로 추적해 **버전 갈아끼우기·구버전 관리**를 쉽게 한다.

⛔ 원본 erps/는 절대 수정하지 않는다 — 새 저장소로 **복사**만 한다(되돌리기 안전).
   기본은 dry-run(계획만 출력). --apply 로만 실제 복사.

  cd tools && .venv/bin/python organize_sources.py --src ~/erps --dest ~/kei-sources [--apply]
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from pathlib import Path

# ── 정본 편(編) — 규정번호 앞자리 → 편 이름 (xlsx 기준)
PYEON = {
    "1": "제1편_법령·정관",
    "2": "제2편_조직·위원회",
    "3": "제3편_인사·복무",
    "4": "제4편_보수·여비",
    "5": "제5편_사업·정보",
    "6": "제6편_서무·보안",
    "7": "제7편_회계·재산관리",
}
MISC = "제8편_기타"


def load_canon(xlsx: Path) -> list:
    """규정집구조.xlsx → [(규정번호|None, 정본명, 개정일_serial, 변경내역)] 순서 보존."""
    z = zipfile.ZipFile(xlsx)
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))

    def cn(ref):
        m = re.match(r"([A-Z]+)(\d+)", ref)
        c = 0
        for ch in m.group(1):
            c = c * 26 + (ord(ch) - 64)
        return c - 1, int(m.group(2))

    grid = {}
    for c in sheet.iter(f"{ns}c"):
        col, row = cn(c.get("r"))
        isel = c.find(f"{ns}is")
        t = ""
        if isel is not None:
            t = "".join(x.text or "" for x in isel.iter(f"{ns}t"))
        else:
            v = c.find(f"{ns}v")
            if v is not None:
                t = v.text or ""
        if t.strip():
            grid[(row, col)] = t.strip()

    out = []
    last_num = None  # 직전 규정번호 — <태그> 하위기준의 부모
    for r in sorted(set(row for row, _ in grid)):
        name = grid.get((r, 1), "")
        if not name or re.match(r"제\d+편", name) or "◆" in name or "목  " in name:
            continue
        num, parent = None, None
        m = re.match(r"(\d{4})\s", name)
        if m:
            num = m.group(1)
            last_num = num
        elif name.startswith("<"):
            parent = last_num  # <태그>는 직전 규정번호에 소속
        serial = grid.get((r, 2), "")
        change = grid.get((r, 3), "")
        out.append((num, name, serial, change, parent))
    return out


def serial_to_date(serial: str) -> str:
    """엑셀 날짜 serial → YYYY-MM-DD (1900 기준). 실패 시 원본."""
    try:
        from datetime import date, timedelta
        n = int(float(serial))
        # 엑셀 1900 윤년 버그 보정
        return (date(1899, 12, 30) + timedelta(days=n)).isoformat()
    except (ValueError, TypeError):
        return serial


def norm(s: str) -> str:
    return re.sub(r"[\s·ㆍ_\-()<>\[\].]", "", s)


def reg_number(fname: str) -> str | None:
    """파일명에서 4자리 규정번호 추출(앞부분 우선)."""
    m = re.match(r"[<(\[]?\s*(\d{4})", norm(fname))
    return m.group(1) if m else None


def canon_core(name: str) -> str:
    """정본명에서 번호·<태그>를 떼어낸 핵심 이름의 정규화."""
    return norm(re.sub(r"^\d{4}|^<[^>]+>", "", name))


def match_canon(fname: str, canon: list) -> tuple | None:
    """파일 → 정본 항목 매칭. ① 번호 ② 핵심어 substring ③ 토큰 겹침."""
    num = reg_number(fname)
    fn = norm(fname)
    if num:
        for c in canon:
            if c[0] == num:
                return c
    # ② 정본 핵심어가 파일명에 통째로 들어있는지(가장 긴 매칭 우선 — <태그> 하위기준 포함)
    best, best_len = None, 0
    for c in canon:
        core = canon_core(c[1])
        if len(core) >= 4 and core in fn and len(core) > best_len:
            best, best_len = c, len(core)
    if best:
        return best
    # ③ 토큰 겹침(3자+ 연속 조각) — 파일명이 정본명을 줄여 쓴 경우
    def frags(s):
        return {s[i:i + 4] for i in range(len(s) - 3)}
    ff = frags(fn)
    best, best_sc = None, 0
    for c in canon:
        core = canon_core(c[1])
        if len(core) < 6:
            continue
        sc = len(frags(core) & ff)
        if sc >= max(3, len(core) // 3) and sc > best_sc:
            best, best_sc = c, sc
    return best


def file_date(fname: str) -> str:
    """파일명에서 날짜 추정 → 정렬용(YYYYMMDD). 없으면 '00000000'."""
    for pat in [r"(\d{4})[.\-]?(\d{2})[.\-]?(\d{2})", r"(\d{2})(\d{2})(\d{2})"]:
        m = re.search(pat, fname)
        if m:
            g = m.groups()
            y = g[0] if len(g[0]) == 4 else ("20" + g[0])
            return f"{y}{g[1]}{g[2]}"
    return "00000000"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(Path.home() / "erps"))
    ap.add_argument("--dest", default=str(Path.home() / "kei-sources"))
    ap.add_argument("--apply", action="store_true", help="실제 복사(기본은 dry-run)")
    args = ap.parse_args()

    src = Path(args.src)
    dest = Path(args.dest)
    xlsx = src / "파일구조도" / "규정집구조.xlsx"
    canon = load_canon(xlsx)
    print(f"정본 항목 {len(canon)}개 로드 (번호 있음 {sum(1 for c in canon if c[0])}개)\n")

    # ── 규정집만 정본 트리로. 나머지 디렉터리는 카테고리 보존.
    reg_files = sorted((src / "규정집").glob("*"))
    by_reg = defaultdict(list)   # 규정번호 → [파일] (본칙)
    by_sub = defaultdict(list)   # 규정번호 → [(정본명, 파일)] (<태그> 하위기준)
    unmatched = []
    # 규정 원문이 아닌 관리문서·초안은 본칙 매칭에서 제외(사람 확인용 미분류로)
    NOT_REGULATION = re.compile(r"관리대장|목차|\(안\)")
    for f in reg_files:
        if not f.is_file():
            continue
        if NOT_REGULATION.search(f.name):
            unmatched.append(f)
            continue
        c = match_canon(f.name, canon)
        if not c:
            unmatched.append(f)
        elif c[0]:                       # 번호 있는 본칙
            by_reg[c[0]].append(f)
        elif c[4]:                       # <태그> 하위기준 → 부모 규정번호에 소속
            by_sub[c[4]].append((c[1], f))
        else:
            unmatched.append(f)

    # ── 버전: 같은 규정번호에 여러 파일 → 날짜 최신=현행, 나머지=구버전
    def is_english(fname: str) -> bool:
        return bool(re.search(r"영문|english|\(en\)", fname, re.I))

    manifest = {}
    multi = []
    for num, files in sorted(by_reg.items()):
        cinfo = next((c for c in canon if c[0] == num), None)
        # ⚠ 영문판은 국문의 '버전'이 아니라 별개 문서 — 버전 계산에서 분리한다
        #   (1200 정관: 영문 210909 / 국문 210819 를 버전으로 오판하던 결함)
        ko = [f for f in files if not is_english(f.name)]
        en = [f for f in files if is_english(f.name)]
        ko_sorted = sorted(ko, key=lambda f: file_date(f.name), reverse=True)
        files_sorted = ko_sorted or sorted(files, key=lambda f: file_date(f.name), reverse=True)
        current = files_sorted[0]
        olds = files_sorted[1:]
        subs = by_sub.get(num, [])
        manifest[num] = {
            "규정명": cinfo[1] if cinfo else "",
            "정본개정일": serial_to_date(cinfo[2]) if cinfo else "",
            "현행파일": current.name,
            "현행_추정일": file_date(current.name),
            "구버전": [f.name for f in olds],
            "영문판": [f.name for f in en],
            "하위기준": [{"명": name, "파일": f.name} for name, f in subs],
            "편": PYEON.get(num[0], MISC),
        }
        if olds:
            multi.append((num, [f.name for f in files_sorted]))

    # ── 고아 하위기준: <태그>인데 부모 규정 파일이 없어 배치처가 없는 것(파일 유실 방지)
    #    예: <위탁비>가 7160에 소속되나 7160은 제정(안)만 있어 누락 → 하위기준도 유실되던 결함
    orphan_subs = []
    for pnum, items in by_sub.items():
        if pnum not in by_reg:
            for name, f in items:
                orphan_subs.append((pnum, name, f))

    # ── 누락: 정본에 번호 있는데 매칭된 파일 0
    matched_nums = set(by_reg)
    missing = [(c[0], c[1]) for c in canon if c[0] and c[0] not in matched_nums]

    print(f"=== 규정집 {len(reg_files)}개 파일 → 정본 매칭 ===")
    print(f"  규정번호로 매칭: {sum(len(v) for v in by_reg.values())}개 ({len(by_reg)}개 규정)")
    print(f"  미매칭(하위기준·미분류): {len(unmatched)}개")
    print(f"\n=== ⚠ 정본에 있으나 파일 없음: {len(missing)}개 ===")
    for num, name in missing:
        print(f"  ✗ {name}")
    print(f"\n=== 같은 규정 여러 버전(구버전 관리 대상): {len(multi)}개 ===")
    for num, fs in multi:
        print(f"  {num}: 현행={fs[0]}")
        for old in fs[1:]:
            print(f"       구버전 ← {old}")
    if orphan_subs:
        print(f"\n=== ⚠ 고아 하위기준({len(orphan_subs)}개) — 부모 규정 파일 없음(유실 방지 배치) ===")
        for pnum, name, f in orphan_subs:
            print(f"  {pnum}(부모없음) ← {name}: {f.name}")
    print(f"\n=== 미매칭 파일({len(unmatched)}개) — 하위기준/수동 확인 ===")
    for f in unmatched[:40]:
        print(f"  ? {f.name}")

    if args.apply:
        print(f"\n[APPLY] {dest} 에 복사 중…")
        for num, info in manifest.items():
            d = dest / "규정집" / info["편"] / f"{num}_{norm(info['규정명'].split(' ',1)[-1])[:20]}"
            (d / "구버전").mkdir(parents=True, exist_ok=True)
            shutil.copy2(src / "규정집" / info["현행파일"], d / info["현행파일"])
            for old in info["구버전"]:
                shutil.copy2(src / "규정집" / old, d / "구버전" / old)
            for en_f in info["영문판"]:
                shutil.copy2(src / "규정집" / en_f, d / en_f)
            if info["하위기준"]:
                (d / "하위기준").mkdir(exist_ok=True)
                for sub in info["하위기준"]:
                    shutil.copy2(src / "규정집" / sub["파일"], d / "하위기준" / sub["파일"])
        # 미분류도 보존
        um = dest / "규정집" / MISC / "_미분류"
        um.mkdir(parents=True, exist_ok=True)
        for f in unmatched:
            shutil.copy2(f, um / f.name)
        # 고아 하위기준 — 부모 규정번호 폴더를 만들어 보존(본칙 파일은 없음 표시)
        for pnum, name, f in orphan_subs:
            od = dest / "규정집" / PYEON.get(pnum[0], MISC) / f"{pnum}_부모규정_파일없음" / "하위기준"
            od.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, od / f.name)
        mpath = dest / "sources_manifest.json"
        mpath.write_text(json.dumps({"규정": manifest, "누락": [m[1] for m in missing],
                                     "미분류": [f.name for f in unmatched],
                                     "고아_하위기준": [{"부모번호": p, "명": n, "파일": f.name}
                                                  for p, n, f in orphan_subs]},
                                    ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  manifest → {mpath}")
    else:
        print("\n(dry-run — 실제 복사하려면 --apply)")


if __name__ == "__main__":
    main()
