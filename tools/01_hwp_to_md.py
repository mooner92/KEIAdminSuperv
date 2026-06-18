#!/usr/bin/env python3
"""
01_hwp_to_md.py  —  HWP/HWPX -> Markdown (볼트 20_규정원문/ 적재)

- hwp-hwpx-parser 로 본문 텍스트 추출. 표는 extract_text() 가 이미 마크다운으로
  '인라인' 삽입하므로 별도 부록 처리하지 않는다(중복 방지). 표가 본문 속 제N조에
  그대로 붙어 있어 02 단계의 제N조 청킹과도 잘 맞는다.
- 규정번호: ① 파일명 맨 앞 4자리(KEI 1000~7000) → ② 없으면 본문 머리(예: '3200-복무규정')
  에서 'NNNN-한글' 패턴으로 회수. 둘 다 없으면 0000_미분류로.
- 개정일: 파일명에서 다양한 형식(YYYYMMDD / YYMMDD / YYYY.MM.DD. / YY.MM.DD. /
  YYYY년 M월 D일 / YYYY.MM / YYYYMM)을 검증과 함께 추출.
- 분류 폴더(4000_보수·여비 등)는 규정번호 첫 자리로 자동 배치. 7xxx 도 6000 으로.

⛔ 절대 규칙: 원문 의역 금지. 변환 문구를 보존하고, 표/별표 깨짐과 오타만 사람이
교정한다. 변환 직후는 항상 '검수상태: 미검수'. 금액·한도·기한을 임의 보정하지 않는다.

테스트:  python 01_hwp_to_md.py --src rule_files --vault KEI-행정가이드 --dry-run
실행:    python 01_hwp_to_md.py --src rule_files --vault KEI-행정가이드
"""
import argparse
import datetime
import multiprocessing as mp
import queue as _queue
import re
import unicodedata
from pathlib import Path

try:
    from hwp_hwpx_parser import Reader
except ImportError:
    raise SystemExit("pip install hwp-hwpx-parser 먼저 실행하세요. (tools/requirements.txt)")

# 규정번호 첫 자리 -> 20_규정원문/ 하위 폴더
CATEGORY_NAMES = {
    "1": "1000_기관", "2": "2000_감사·규정", "3": "3000_인사",
    "4": "4000_보수·여비", "5": "5000_연구·정보", "6": "6000_총무·보안·회계",
    "7": "6000_총무·보안·회계",  # 7xxx(회계/구매)도 총무·보안·회계로
}
UNCLASSIFIED = "0000_미분류"      # 규정번호를 못 찾은 문서
FS_FORBIDDEN = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


# ─────────────────────────────────────────────────────────────────────
# 날짜 파싱: 파일명에서 개정일 추출 → 'YYYY-MM-DD' (일이 없으면 'YYYY-MM')
# ─────────────────────────────────────────────────────────────────────
def _valid(y, m, d=1):
    try:
        datetime.date(y, m, d)
        return True
    except ValueError:
        return False


def parse_date(text: str):
    t = text
    # 1) 한국어: 2025년 12월 22일 / 2026년도 3월 23일
    m = re.search(r"(\d{4})\s*년\s*도?\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일", t)
    if m:
        y, mo, d = map(int, m.groups())
        if _valid(y, mo, d):
            return f"{y:04d}-{mo:02d}-{d:02d}"
    # 2) YYYY.MM.DD. (점 구분, 공백 허용): 2025.07.30. / 2026.5.19.
    m = re.search(r"(?<!\d)(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?", t)
    if m:
        y, mo, d = map(int, m.groups())
        if _valid(y, mo, d):
            return f"{y:04d}-{mo:02d}-{d:02d}"
    # 3) YY.MM.DD. : 24.11.25.
    m = re.search(r"(?<!\d)(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.", t)
    if m:
        yy, mo, d = map(int, m.groups())
        y = 2000 + yy
        if _valid(y, mo, d):
            return f"{y:04d}-{mo:02d}-{d:02d}"
    # 4) YYYYMMDD (8자리): 20231004 / (20220218)
    for m in re.finditer(r"(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)", t):
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1990 <= y <= 2099 and _valid(y, mo, d):
            return f"{y:04d}-{mo:02d}-{d:02d}"
    # 5) YYYY.MM (일 없음): 2025.03.
    m = re.search(r"(?<!\d)(\d{4})\.\s*(\d{1,2})\.(?!\s*\d)", t)
    if m:
        y, mo = int(m.group(1)), int(m.group(2))
        if 1990 <= y <= 2099 and 1 <= mo <= 12:
            return f"{y:04d}-{mo:02d}"
    # 6) 6자리: YYMMDD(우선) → 아니면 YYYYMM
    for m in re.finditer(r"(?<!\d)(\d{6})(?!\d)", t):
        s = m.group(1)
        yy, mo, d = int(s[:2]), int(s[2:4]), int(s[4:6])
        y = 2000 + yy
        if _valid(y, mo, d):
            return f"{y:04d}-{mo:02d}-{d:02d}"
        y4, mo2 = int(s[:4]), int(s[4:6])
        if 1990 <= y4 <= 2099 and 1 <= mo2 <= 12:
            return f"{y4:04d}-{mo2:02d}"
    return None


# ─────────────────────────────────────────────────────────────────────
# 규정번호 / 제목
# ─────────────────────────────────────────────────────────────────────
def reg_num_from_name(stem: str):
    """파일명 맨 앞 4자리가 KEI 규정번호(1000~7999)면 반환."""
    m = re.match(r"(\d{4})", stem)
    if m and 1000 <= int(m.group(1)) <= 7999:
        return m.group(1)
    return None


def clean_title(stem: str, num) -> str:
    """파일명에서 규정번호·날짜·리스트마커·장식을 제거해 사람이 읽을 제목으로.
    (영문) 같은 판본 표시는 유지해 한글본과 구분한다."""
    t = stem
    if num and t.startswith(num):
        t = t[len(num):]
    t = t.lstrip("_ .")
    t = re.sub(r"^[★☆■◆●▶]+\s*", "", t)            # 장식 머리
    t = re.sub(r"^\d{1,3}\.\s*", "", t)             # 리스트 마커 '2.' '50.'
    # 한국어 날짜: 2025년 12월 22일 (개정)
    t = re.sub(r"\(?\s*\d{4}\s*년\s*도?\s*\d{1,2}\s*월\s*\d{1,2}\s*일\s*개?정?\s*\)?", " ", t)
    # 점 구분 날짜: 2025.07.30. / 24.11.25.
    t = re.sub(r"\(?\s*\d{2,4}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*\)?", " ", t)
    t = re.sub(r"\(?\s*\d{4}\.\s*\d{1,2}\.?\s*\)?", " ", t)        # YYYY.MM
    # 숫자 날짜 토큰(6~8자리): 한글에 붙어 있어도 제거 (정관210819 → 정관)
    t = re.sub(r"[_(]?\s*\d{6,8}\.?\s*[_)]?", " ", t)
    # 마커성 괄호 — (영문)은 유지해 판본 구분
    t = re.sub(r"\((?:최종|안|제정|개정|수정|[^)]*수정|\d+)\)", " ", t)
    t = t.replace("_", " ")
    t = re.sub(r"\s+", " ", t).strip(" -_·.")
    # 꼬리 마커 단어
    t = re.sub(r"\s*(전문개정|개정본|최종|제정|수정)$", "", t).strip(" -_·.")
    t = FS_FORBIDDEN.sub("", t)
    return t[:80] or stem[:80]


# ─────────────────────────────────────────────────────────────────────
# 변환
# ─────────────────────────────────────────────────────────────────────
def _extract_worker(path_str, q):
    try:
        with Reader(path_str) as r:
            enc = r.is_encrypted
            enc = enc() if callable(enc) else enc
            if enc:
                q.put(("", "encrypted")); return
            valid = r.is_valid
            valid = valid() if callable(valid) else valid
            if valid is False:
                q.put(("", "invalid")); return
            body = r.extract_text() or ""        # 표는 이미 인라인 마크다운
        body = body.strip()
        q.put((body, "ok" if body else "empty"))
    except Exception as e:
        q.put((f"{type(e).__name__}: {e}", "error"))


def extract_body(path: Path, timeout: int = 90):
    """별도 프로세스에서 추출 + 하드 타임아웃. 깨진(무한루프) 파일 하나가 배치
    전체를 막지 못하게 격리한다. status ∈ {ok, encrypted, invalid, empty, error, timeout}."""
    ctx = mp.get_context("fork")          # 이미 import된 Reader 상속(재import 비용 없음)
    q = ctx.Queue()
    p = ctx.Process(target=_extract_worker, args=(str(path), q), daemon=True)
    p.start()
    try:
        result = q.get(timeout=timeout)
    except _queue.Empty:
        result = ("", "timeout")
    except Exception as e:
        result = (f"{type(e).__name__}: {e}", "error")
    finally:
        if p.is_alive():
            p.terminate()
            p.join(5)
            if p.is_alive():
                p.kill()
        else:
            p.join(1)
    return result


def build_note(num, title, date, original, body) -> str:
    if num:
        cat = CATEGORY_NAMES.get(num[:1], UNCLASSIFIED)
    else:
        cat = UNCLASSIFIED
    fm = [
        "---",
        "type: regulation",
        f'규정번호: "{num or ""}"',
        f'규정명: "{title}"',
        f'분류: "{cat}"',
        f"개정일: {date}" if date else "개정일:",
        f'원본파일: "{original}"',
        "태그: []",
        "검수상태: 미검수",
        "---",
        "",
        f"# {title}",
        "",
        "> [!warning] 자동 변환 — 의역 금지. 표/별표 깨짐과 오타만 검수 후 `검수상태: 검수완료`로.",
        "",
        body,
        "",
    ]
    return "\n".join(fm)


def main():
    ap = argparse.ArgumentParser(description="HWP/HWPX → Markdown (20_규정원문/ 적재)")
    ap.add_argument("--src", required=True, help="HWP/HWPX 들이 있는 폴더")
    ap.add_argument("--vault", required=True, help="Obsidian 볼트 루트")
    ap.add_argument("--dry-run", action="store_true", help="쓰지 않고 추출 결과만 미리보기")
    ap.add_argument("--limit", type=int, default=0, help="처음 N개만(테스트)")
    ap.add_argument("--timeout", type=int, default=90, help="파일당 추출 제한(초). 초과 시 skip:timeout")
    args = ap.parse_args()

    out_root = Path(args.vault) / "20_규정원문"
    files = sorted(
        list(Path(args.src).glob("*.hwp")) + list(Path(args.src).glob("*.hwpx"))
    )
    if args.limit:
        files = files[: args.limit]
    mode = "미리보기" if args.dry_run else "변환"
    print(f"{len(files)}개 파일 {mode} 시작 ({datetime.date.today()})")

    seen_dest: dict[str, int] = {}
    stats = {"ok": 0, "skip": 0, "by_name": 0, "unclassified": 0, "no_date": 0}
    by_cat: dict[str, int] = {}
    rows = []

    for i, f in enumerate(files, 1):
        stem = nfc(f.stem)
        body, status = extract_body(f, timeout=args.timeout)
        print(f"  [{i:>3}/{len(files)}] {status:<9} {f.name}", flush=True)
        if status != "ok":
            stats["skip"] += 1
            continue

        # 번호는 파일명 맨 앞 4자리(현행 공식 코드)만 신뢰한다. 본문에 박힌 'NNNN-'
        # 코드는 과거/내부 코드라 현행 파일명 번호와 충돌(예: 복무규정 본문 '3200'은
        # 파일명 3200=공로연수운영지침과 겹침)하므로 분류에 쓰지 않는다.
        num = reg_num_from_name(stem)
        src = "name" if num else "—"
        if num:
            stats["by_name"] += 1
        else:
            stats["unclassified"] += 1

        date = parse_date(stem)
        if not date:
            stats["no_date"] += 1
        title = clean_title(stem, num)

        cat = CATEGORY_NAMES.get((num or "")[:1], UNCLASSIFIED) if num else UNCLASSIFIED
        by_cat[cat] = by_cat.get(cat, 0) + 1
        fname = f"{num}_{title}.md" if num else f"{title}.md"
        dest = out_root / cat / fname
        key = str(dest)
        if key in seen_dest:
            seen_dest[key] += 1
            n = seen_dest[key]
            fname = f"{num}_{title}_{n}.md" if num else f"{title}_{n}.md"
            dest = out_root / cat / fname
        else:
            seen_dest[key] = 1

        arts = len(re.findall(r"^\s*제\s*\d+\s*조", body, re.M))
        rows.append((num or "—", src, date or "—", cat, title, arts))
        stats["ok"] += 1

        if not args.dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(build_note(num, title, date, f.name, body), encoding="utf-8")

    # 리포트
    print("\n" + "=" * 100)
    print(f"{'번호':<6}{'출처':<6}{'개정일':<12}{'분류':<20}{'조':>4}  제목")
    print("-" * 100)
    for num, src, date, cat, title, arts in rows:
        print(f"{num:<6}{src:<6}{date:<12}{cat:<20}{arts:>4}  {title[:38]}")
    print("=" * 100)
    print(f"성공 {stats['ok']} / 건너뜀 {stats['skip']}  |  번호: 파일명 {stats['by_name']}, 미분류 {stats['unclassified']}  |  개정일 없음 {stats['no_date']}")
    print("분류별:", ", ".join(f"{k} {v}" for k, v in sorted(by_cat.items())))
    if args.dry_run:
        print("\n(dry-run: 파일을 쓰지 않았습니다. 결과가 괜찮으면 --dry-run 빼고 실행)")


if __name__ == "__main__":
    main()
