#!/usr/bin/env python3
"""corpus_replace.py — 개정본 '교체' 엔진 (specs/14 C·E).

왜 필요한가: 지금 업로드는 언제나 **새 문서**다. 개정본을 올리면 기존 문서를 대체하지 않고
사본이 하나 더 생기고, 같은 규정의 두 판본이 함께 색인된다 — 답변이 어느 쪽 조문을 인용할지
운에 맡기게 된다(⛔절대규칙 1이 막으려는 상황 그 자체).

이 모듈이 하는 일(전부 결정적·LLM 0회):
  ① convert()         업로드 파일 → md. **kordoc 우선**(표를 HTML로 보존) + kordoc_adapt(--check로
                      내용 불변 증명) → 실패 시 기존 파서로 폴백.
                      ⚠ 변환기가 다르면 형식 차이만으로 전 조문이 '변경됨'으로 보인다(볼트 규정
                      다수가 이미 kordoc+adapt 산출물) — 같은 변환기를 쓰는 것이 정확도의 전제다.
  ② find_candidates() 기존 문서 매칭: 규정번호(정확) > 규정명 일치 > 제목 유사도(후보 제시)
  ③ diff_articles()   조문 단위 비교 + **변경 조문 본문 diff**(운영자 선택 '나')
  ④ replace()         백업 → 본문 교체 → 프론트매터 갱신(개정일·원본파일) → 검수상태 미검수
  ⑤ log()/read_log()  모든 단계를 JSONL로 남긴다(고치려면 무엇이 일어났는지 보여야 한다)

⛔ 자동 확정 없음 — 준비·계산만 하고, 실제 교체는 사람이 승인한 뒤 replace()를 부른다.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LOG_PATH = HERE / "index" / "corpus_replace_log.jsonl"
BACKUP_SUB = "90_관리/_backup"

sys.path.insert(0, str(HERE))
import corpus_amend  # noqa: E402 — 교체 관문(개정안 거부)
from vault_parse import ARTICLE, article_label, split_frontmatter  # noqa: E402


# ───────────────────────── ⑤ 로그 ─────────────────────────
def log(event: str, **fields) -> dict:
    """한 줄 = 한 사건. ⛔ 조용히 실패하지 않는다 — 로그 기록 실패도 stderr에 남긴다."""
    rec = {"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "event": event, **fields}
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as e:  # noqa: BLE001
        print(f"⚠ 교체 로그 기록 실패: {e}", file=sys.stderr)
    return rec


def read_log(limit: int = 50) -> list:
    """최근 N건(최신 우선). 화면·CLI 공용."""
    try:
        lines = LOG_PATH.read_text(encoding="utf-8").strip().splitlines()
    except Exception:  # noqa: BLE001 — 로그가 없는 것은 정상(아직 교체 안 함)
        return []
    out = []
    for ln in reversed(lines):
        try:
            out.append(json.loads(ln))
        except Exception:  # noqa: BLE001 — 깨진 줄은 건너뛴다(로그가 기능을 막으면 안 된다)
            continue
        if len(out) >= max(1, limit):
            break
    return out


# ───────────────────────── ① 변환 ─────────────────────────
def kordoc_available() -> bool:
    try:
        r = subprocess.run(["npx", "--no-install", "kordoc", "--version"],
                           capture_output=True, text=True, timeout=25)
        return r.returncode == 0 and bool(r.stdout.strip())
    except Exception:  # noqa: BLE001
        return False


def convert(path: str, ext: str, timeout: int = 240) -> tuple:
    """(md, converter, warn). kordoc → kordoc_adapt(--check) 우선, 실패 시 기존 파서 폴백."""
    ext = (ext or "").lower()
    if ext == ".md":
        return Path(path).read_text(encoding="utf-8", errors="ignore"), "raw-md", ""
    if ext in (".hwp", ".hwpx", ".pdf") and kordoc_available():
        try:
            out = Path(path).with_suffix(".kordoc.md")
            r = subprocess.run(["npx", "-y", "kordoc", path, "-o", str(out)],
                               capture_output=True, text=True, timeout=timeout)
            if r.returncode == 0 and out.exists():
                a = subprocess.run([sys.executable, str(HERE / "kordoc_adapt.py"), str(out), "--check"],
                                   capture_output=True, text=True, timeout=180)
                md = out.read_text(encoding="utf-8")
                if a.returncode == 0:
                    return md, "kordoc+adapt", ""
                return md, "kordoc(무검증)", f"adapt --check 실패 — 형식 정규화 미적용: {a.stderr.strip()[:160]}"
            log("convert_kordoc_fail", file=os.path.basename(path), rc=r.returncode,
                stderr=(r.stderr or "")[:200])
        except Exception as e:  # noqa: BLE001 — 폴백이 있으므로 실패가 편입을 막지 않는다
            log("convert_kordoc_error", file=os.path.basename(path), error=str(e)[:200])
    # 폴백: 기존 업로드 경로(hwp-hwpx-parser / PyMuPDF)
    import importlib.util
    spec = importlib.util.spec_from_file_location("c01c", HERE / "01c_guides_to_md.py")
    c = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(c)
    if ext in (".hwp", ".hwpx"):
        body, st = c.extract_hwp(Path(path), timeout=90)
        return body, "hwp-parser", "" if st == "ok" else f"변환 상태 {st} — 표/서식 확인 필요"
    body, st = c.extract_pdf(Path(path))
    return body, "pdf-parser", "" if st == "ok" else f"변환 상태 {st}"


# ───────────────────────── ② 매칭 ─────────────────────────
def _fm(text: str) -> dict:
    meta, _ = split_frontmatter(text)
    return meta or {}


def _norm_title(s: str) -> str:
    """비교용 제목 정규화 — 확장자·앞 번호·괄호(개정일)·구분자 제거."""
    s = re.sub(r"\.(hwpx?|pdf|md)$", "", (s or "").strip(), flags=re.I)
    s = re.sub(r"^\s*[0-9]{4}[_\-\s]*", "", s)
    s = re.sub(r"[（(][^)）]*[)）]", "", s)
    return re.sub(r"[\s_·．.\-]+", "", s)


def find_candidates(vault, upload_name: str, body: str = "", limit: int = 5) -> list:
    """기존 문서 후보(점수 내림차순). 규정번호 정확일치 > 규정명 완전일치 > 제목 유사도."""
    import vault_structure as vs
    no = vs.reg_no_of(upload_name, body)
    tnorm = _norm_title(upload_name)
    out = []
    for p in sorted(Path(vault).glob("20_규정원문/*/*.md")):
        if p.name == "README.md":
            continue
        try:
            meta = _fm(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        name = str(meta.get("규정명") or p.stem)
        n2 = _norm_title(name)
        score, why = 0.0, ""
        if no and str(meta.get("규정번호") or "").strip() == no:
            score, why = 1.0, f"규정번호 {no} 정확 일치"
        elif n2 and n2 == tnorm:
            score, why = 0.9, "규정명 완전 일치"
        else:
            r = difflib.SequenceMatcher(None, n2, tnorm).ratio()
            if r >= 0.6:
                score, why = round(r * 0.8, 3), f"제목 유사도 {r:.2f}"
        if score:
            out.append({"slug": p.stem, "path": str(p.relative_to(Path(vault))), "규정명": name,
                        "규정번호": str(meta.get("규정번호") or ""), "개정일": str(meta.get("개정일") or ""),
                        "score": score, "why": why})
    out.sort(key=lambda x: -x["score"])
    return out[:limit]


# ───────────────────────── ③ 조문 diff ─────────────────────────
# 부칙 표제 — 줄 전체가 '부 칙'(굵게 포함)인 경우만. 본문에 인용된 '부칙'이라는 낱말은 제외한다.
_BUCHIK = re.compile(r"^\s*\**\s*부\s{0,8}칙\s*\**\s*$", re.MULTILINE)


def parse_articles(md: str) -> dict:
    """{조 라벨: 본문}. 조문 경계는 02·vault_parse와 **같은 정규식**을 쓴다(사본 금지).

    ⚠ 라벨만으로는 키가 안 된다 — 규정은 **부칙마다 제1조가 다시 시작**한다.
      실측(위임전결규정): 조문 35개 중 27개가 중복 라벨이라 dict가 8건으로 붕괴했다.
      그래서 부칙 구간은 `부칙N·제1조`로 스코프를 붙인다. 이래야 "부칙 하나 추가"가
      개정 diff에서 **신설**로 정확히 잡힌다(본칙 제1조를 덮어쓰지 않는다)."""
    _, body = split_frontmatter(md)
    text = body if body else md
    out: dict = {}
    buchik = 0
    for chunk in ARTICLE.split(text):
        lab = article_label(chunk)
        # ⚠ 순서 주의: 부칙 표제는 조문 경계 **뒤**에 오므로 앞 조문 청크의 꼬리에 실린다.
        #   그래서 라벨을 먼저 매기고, 그 다음에 이 청크가 품은 부칙 수를 더해야
        #   다음 청크부터 부칙 소속이 된다(먼저 더하면 본칙 마지막 조가 부칙으로 밀린다).
        key = ""
        if lab:
            key = lab if buchik == 0 else f"부칙{buchik}·{lab}"
        buchik += len(_BUCHIK.findall(chunk))
        if not lab:
            continue
        # ⚠ 꼬리 자르기: 청크 끝에 다음 부칙 표제가 딸려 온다. 그대로 두면 부칙이 하나
        #   추가될 때 **직전 조문까지 '변경'으로 오탐**한다(실측 — 모의 개정에서 확인).
        m = _BUCHIK.search(chunk)
        if m:
            chunk = chunk[: m.start()]
        if key in out:                      # 그래도 겹치면(파싱 이상) 순번을 붙여 유실 방지
            key = f"{key}#{sum(1 for k in out if k.startswith(key)) + 1}"
        out[key] = chunk.strip()
    return out


def _norm_text(s: str) -> str:
    """비교용 본문 정규화 — 공백·마크다운 강조만 제거(내용은 손대지 않는다)."""
    s = re.sub(r"[*_`>#]+", " ", s or "")
    return re.sub(r"\s+", " ", s).strip()


def _split_lines(s: str) -> list:
    """항(①②…) 단위로 끊어 diff 가독성을 높인다 — 조문 한 덩어리 diff는 읽을 수 없다."""
    s = re.sub(r"\s+", " ", s or "").strip()
    parts = re.split(r"(?=[①-⑳])", s)
    return [p.strip() for p in parts if p.strip()]


def _jo_key(lab: str):
    """정렬 키 — 부칙 스코프(부칙N·제M조)를 앞자리로 둬 본칙이 먼저, 부칙이 순서대로 온다."""
    b = re.match(r"부칙(\d+)·", lab or "")
    m = re.search(r"제\s*(\d+)\s*조(?:의\s*(\d+))?", lab or "")
    return (int(b.group(1)) if b else 0,
            int(m.group(1)) if m else 9999, int(m.group(2) or 0) if m else 0)


def diff_articles(old_md: str, new_md: str, detail_limit: int = 20) -> dict:
    """조문 단위 비교 + 변경 조문 본문 diff(운영자 선택 '나').
    ⚠ 정규화 후 비교한다 — 공백·강조 차이로 '변경'이 부풀면 사람이 진짜 변경을 못 본다."""
    a, b = parse_articles(old_md), parse_articles(new_md)
    ka, kb = set(a), set(b)
    changed, same = [], []
    for k in sorted(ka & kb, key=_jo_key):
        (changed if _norm_text(a[k]) != _norm_text(b[k]) else same).append(k)
    added = sorted(kb - ka, key=_jo_key)
    removed = sorted(ka - kb, key=_jo_key)
    details = []
    for k in changed[:detail_limit]:
        d = [x for x in difflib.unified_diff(_split_lines(a[k]), _split_lines(b[k]), lineterm="", n=1)
             if not x.startswith(("---", "+++"))]
        details.append({"조": k, "상태": "변경", "diff": d[:60]})
    for k in added[:detail_limit]:
        details.append({"조": k, "상태": "신설", "diff": ["+" + x for x in _split_lines(b[k])[:12]]})
    for k in removed[:detail_limit]:
        details.append({"조": k, "상태": "삭제", "diff": ["-" + x for x in _split_lines(a[k])[:12]]})
    return {"요약": {"변경": len(changed), "신설": len(added), "삭제": len(removed), "동일": len(same)},
            "변경조": changed, "신설조": added, "삭제조": removed, "항목": details,
            "조문수": {"기존": len(a), "신규": len(b)}}


# ───────────────────────── ④ 교체 ─────────────────────────
_DATE_IN_NAME = re.compile(r"(\d{4})\s*년\s*도?\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")


def revision_date(upload_name: str, fallback_today: bool = True) -> str:
    """파일명에서 개정일 추출('위임전결규정(2026년4월6일개정).hwpx' → 2026-04-06).
    못 찾으면 오늘 날짜(호출자가 fallback_today=False로 빈 값을 받을 수도 있다)."""
    m = _DATE_IN_NAME.search(upload_name or "")
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return time.strftime("%Y-%m-%d") if fallback_today else ""


def replace(vault, rel_path: str, new_body: str, upload_name: str, actor: str,
            converter: str = "", keep_review: bool = False) -> dict:
    """백업 → 본문 교체 → 프론트매터 갱신. 반환 = 감사·로그용 기록.
    ⛔ 규정번호·규정명·분류는 **기존 값을 승계**한다(업로드 파일명이 아니라 — 파일명엔 번호가
       없는 경우가 흔하다). 검수상태는 항상 '미검수'로 되돌린다: 내용이 바뀌었으니 사람이 다시 본다."""
    # ⛔ 관문 — 개정안(신·구조문 대비표)이면 여기서 멈춘다. 2026-08-04 실측: 운영자가 실제로
    #    올리는 개정 파일이 전문이 아니라 대비표였고, 본문이 '생략/좌동'으로만 적혀 있었다.
    #    그대로 교체하면 위임전결규정 651줄이 51줄 요약본으로 덮이고 별표 335규칙이 사라진다.
    ok, why = corpus_amend.replaceable(new_body)
    if not ok:
        log("replace_blocked", target=rel_path, upload=upload_name, actor=actor, 사유=why)
        raise ValueError(f"교체 거부: {why}")

    vault = Path(vault)
    target = vault / rel_path
    old = target.read_text(encoding="utf-8")
    meta = _fm(old)

    ts = time.strftime("%Y-%m-%d-%H%M%S")
    bdir = vault / BACKUP_SUB
    bdir.mkdir(parents=True, exist_ok=True)
    backup = bdir / f"{target.stem}-{ts}.md"
    shutil.copy2(target, backup)   # ⛔ 백업이 먼저 — 교체는 되돌릴 수 있어야 한다

    rev = revision_date(upload_name)
    fm = ["---", "type: regulation",
          f'규정번호: "{meta.get("규정번호", "")}"',
          f'규정명: "{meta.get("규정명", target.stem)}"',
          f'분류: "{meta.get("분류", "")}"',
          f"개정일: {rev}",
          f'원본파일: "{upload_name}"',
          f'태그: {meta.get("태그", [])}',
          f'검수상태: {"검수완료" if keep_review else "미검수"}']
    if converter:
        fm.append(f'변환기: "{converter} (교체 {ts})"')
    fm.append("---")
    _, body_only = split_frontmatter(new_body)
    target.write_text("\n".join(fm) + "\n\n" + (body_only or new_body).lstrip(), encoding="utf-8")

    rec = {"target": rel_path, "backup": str(backup.relative_to(vault)), "개정일": rev,
           "이전개정일": str(meta.get("개정일") or ""), "converter": converter, "actor": actor}
    log("replace_done", **rec)
    return rec


if __name__ == "__main__":   # CLI 점검: 로그 열람
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", type=int, default=20, help="최근 N건 로그 출력")
    a = ap.parse_args()
    for r in read_log(a.log):
        print(json.dumps(r, ensure_ascii=False))
