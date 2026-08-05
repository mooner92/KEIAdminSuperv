#!/usr/bin/env python3
"""corpus_amend.py — 개정안(신·구조문 대비표) 판별·해독 (specs/14 G).

## 왜 이 모듈이 생겼나 (2026-08-04 실측)

운영자가 실제로 코퍼스에 넣는 개정 파일을 받아 열어보니 **전문 개정본이 아니었다.**
「위임전결규정 개정(안)」(2026.7.15.) = 개정이유 + 신·구조문 대비표뿐이고, 정작 별표
전결 매트릭스 본문은 표 안에 **"생략"** 과 **"- 좌동 -"** 으로만 적혀 있었다.

  <td>1.기본계획~27. 홈페이지 운영</td><td>생략</td>      ← 335규칙 본문이 문서에 없다
  <td><공통사항><br>- 좌동 -<br><연구업무><br>- 좌동 -    ← 나머지는 "좌동"

이 파일로 `corpus_replace.replace()`를 돌리면 651줄 규정이 51줄 요약본으로 덮이고
`approval.json` 335규칙이 통째로 사라진다. spec 14 §3은 "부분 개정문은 교체 대상 아님"이라
적어두었지만 **거부할 수단이 없었다** — 그 수단이 이 모듈이다.

## 계약

  ① classify()  전문 / 개정안 / 혼합 / 불명 을 **결정적으로** 판별한다(LLM 0회).
                교체 경로는 이 판별을 통과해야만 진행한다(corpus_replace가 호출).
  ② parse()     개정이유·시행일·대비표 행(현행|개정(안)|비고)을 뽑는다. 표 안에 표가
                중첩되므로 깊이를 세는 파서를 쓴다(정규식 한 방으로는 셀이 뭉개진다).
  ③ propose()   각 행의 **현행 줄**을 볼트 문서에서 찾아 줄 번호를 매기고, 개정 줄을
                나란히 놓는다. 사람이 보고 고칠 수 있게 위치를 짚어주는 것까지가 자동이다.

⛔ 절대 하지 않는 것 — **자동 적용이 없다.** 개정안 텍스트를 볼트에 쓰는 코드는 이 파일에
   없다. "좌동"이 무엇을 가리키는지, "생략"된 매트릭스가 어떻게 바뀌는지는 사람만 안다.
   LLM이 그것을 메우면 그 순간 규정을 지어내는 것이다(⛔절대규칙 1·2).
   생략/좌동 행은 **경고를 달아 그대로 노출**한다 — 조용히 넘어가면 사람이 못 본다.
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from vault_parse import split_frontmatter  # noqa: E402

KIND_FULL = "전문"      # 전문 개정본 — 교체 가능
KIND_AMEND = "개정안"   # 신·구조문 대비표 — ⛔교체 금지, 변경 제안만
KIND_MIXED = "혼합"     # 전문 + 대비표가 한 파일에 — 사람이 잘라야 한다
KIND_UNKNOWN = "불명"

# 대비표 신호. 하나하나가 "이건 전문이 아니다"의 물증이다.
# ⚠ 강신호/약신호를 나눈다: 대비표의 **구조**(대비표 제목·현행/개정 표머리)만이 단독 판정 근거다.
#    '개정이유'·'좌동'·'개정(안)'은 전문 개정본에도 섞여 나올 수 있어 혼자서는 못 막는다 —
#    약신호만으로 막으면 멀쩡한 규정 교체가 거부된다.
_STRONG = [
    ("신구조문 대비표", re.compile(r"신[\s·‧・･]*구\s*조문\s*대비표")),
    ("현행/개정(안) 대조표 머리(HTML)", re.compile(r"<t[hd]>\s*현\s*행\s*</t[hd]>\s*<t[hd]>\s*개\s*정")),
    # ⚠ 실제 업로드 경로는 kordoc이 아니라 **01c(hwp-hwpx-parser)**를 쓰고, 이건 표를 HTML이
    #   아니라 마크다운 파이프(`| 현행 | 개정(안) | 비고 |`)로 낸다(2026-08-05 실측). 신호를 하나만
    #   지원하면 실제 업로드는 강신호가 부족해 오판되거나 대비표를 아예 못 찾는다.
    ("현행/개정(안) 대조표 머리(파이프)", re.compile(r"^\|\s*현\s*행\s*\|\s*개\s*정", re.MULTILINE)),
]
_SOFT = [
    ("개정이유 절", re.compile(r"[□ㅁ○]\s*개\s*정\s*이\s*유")),
    ("'좌동' 표기", re.compile(r"좌\s*동")),
    ("제목이 개정(안)", re.compile(r"개\s*정\s*\(\s*안\s*\)")),
]
# 조문 **세기** 전용. vault_parse.ARTICLE(분할용 lookahead)을 세기에 쓰면 안 된다:
#   ⓐ 너비 0이라 findall이 ''를 돌려준다(set()으로 묶으면 항상 1로 붕괴)
#   ⓑ `\s*`가 줄바꿈을 건너뛰어 **빈 줄에서도** 매칭돼 조문 2개가 3개로 샌다(2026-08-04 실측)
# 분할에서는 과잉매칭이 무해하지만 판별에서는 그대로 오판이 된다 — 그래서 여기만 [ \t]*를 쓴다.
_ART_COUNT = re.compile(r"^[ \t]*제\s*\d+\s*조", re.MULTILINE)
_OMITTED = re.compile(r"^\s*생\s*략\s*$")
_SAME_AS = re.compile(r"^\s*-?\s*좌\s*동\s*-?\s*$")
# ⚠ 경고용은 **포함** 판정이어야 한다: 중첩 표를 펴면 "8. 대외활동 생략"처럼 앞 셀과 붙어
#   단독 매치가 빗나간다(2026-08-04 실측 — 가장 위험한 경고가 조용히 안 떴다).
_OMITTED_ANY = re.compile(r"(^|[\s>|])생\s*략($|[\s<|])")


# ───────────────────────── ① 판별 ─────────────────────────
def classify(md: str) -> dict:
    """→ {kind, 조문수, 점수, 근거[]}. 근거는 그대로 화면에 나간다 — 왜 그렇게 봤는지 보여야 한다."""
    _, body = split_frontmatter(md)
    body = body or md
    n_art = len(_ART_COUNT.findall(body))   # 세기 전용 정규식 — 위 주석 참조
    strong = [n for n, rx in _STRONG if rx.search(body)]
    soft = [n for n, rx in _SOFT if rx.search(body)]
    why = list(strong) + list(soft)

    if strong and n_art >= 5:
        kind = KIND_MIXED
        why.append(f"조문 {n_art}개가 함께 있음 — 전문과 대비표가 섞였다")
    elif strong or (len(soft) >= 2 and n_art == 0):
        kind = KIND_AMEND
    elif n_art >= 1:
        kind = KIND_FULL
        why.append(f"조문 {n_art}개 · 대비표 구조 없음")
    else:
        kind = KIND_UNKNOWN
        why.append("조문이 하나도 없고 대비표 구조도 없음 — 규정 문서가 맞는지 확인 필요")
    return {"kind": kind, "조문수": n_art, "강신호": strong, "약신호": soft, "근거": why}


def replaceable(md: str) -> tuple[bool, str]:
    """교체 경로의 관문. → (허용?, 사유). corpus_replace가 이걸 통과해야 백업·교체를 한다."""
    c = classify(md)
    if c["kind"] == KIND_FULL:
        return True, f"전문 개정본(조문 {c['조문수']}개)"
    if c["kind"] == KIND_AMEND:
        return False, ("신·구조문 대비표(개정안)다 — 규정 본문이 '생략/좌동'으로만 적혀 있어 "
                       "교체하면 기존 조문이 사라진다. '개정 반영' 흐름으로 처리할 것")
    if c["kind"] == KIND_MIXED:
        return False, "전문과 대비표가 한 파일에 섞여 있다 — 전문 부분만 남겨 다시 올릴 것"
    return False, "조문이 하나도 없다 — 규정 전문이 아니다. 사람이 확인할 것"


# ───────────────────────── 중첩 표 파서 ─────────────────────────
def _top_level_blocks(chunk: str, tag: str) -> list:
    """<table> 중첩을 세면서 **가장 바깥 레벨의** <tag>…</tag>만 잘라낸다.
    ⚠ 대비표는 셀 안에 표가 또 있다 — 정규식 하나로 훑으면 안쪽 <tr>이 섞여 셀이 뭉개진다."""
    out, depth_tbl, start = [], 0, None
    tok = re.compile(r"<\s*(/?)\s*(table|" + tag + r")\b[^>]*>", re.I)
    for m in tok.finditer(chunk):
        closing, name = m.group(1) == "/", m.group(2).lower()
        if name == "table":
            depth_tbl += -1 if closing else 1
            continue
        if depth_tbl != 0:          # 안쪽 표의 행/셀은 건너뛴다
            continue
        if not closing and start is None:
            start = m.end()
        elif closing and start is not None:
            out.append(chunk[start:m.start()])
            start = None
    return out


def _html_compare_rows(body: str) -> list:
    """HTML `<table>`(kordoc 변환) 대비표의 (현행, 개정, 비고, 표?) 원시 셀 텍스트."""
    out = []
    for tbl in _outer_tables(body):
        if not re.search(r"<t[hd]>\s*현\s*행\s*</t[hd]>", tbl):
            continue
        for tr in _top_level_blocks(tbl, "tr"):
            cells = _top_level_blocks(tr, "td") + _top_level_blocks(tr, "th")
            if len(cells) < 2:
                continue
            in_table = bool(re.search(r"<\s*table", cells[0] + cells[1], re.I))
            out.append((cells[0], cells[1], cells[2] if len(cells) > 2 else "", in_table))
    return out


_PIPE_LINE = re.compile(r"^\|(.*)\|[ \t]*$")


def _pipe_cells(line: str) -> list:
    inner = line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|"):
        inner = inner[:-1]
    return [c.strip() for c in inner.split("|")]


def _is_pipe_sep(line: str) -> bool:
    """`| --- | --- | --- |` 같은 머리-본문 구분선인지. 열 개수가 표마다 달라 셀 단위로 검사한다."""
    if not _PIPE_LINE.match(line or ""):
        return False
    cells = _pipe_cells(line)
    return bool(cells) and all(re.fullmatch(r":?-{2,}:?", c) for c in cells)


def _pipe_compare_rows(body: str) -> list:
    """마크다운 파이프 표(**01c/hwp-hwpx-parser** 산출 — 실제 업로드 경로의 기본 변환기) 대비표의
    (현행, 개정, 비고, 표?) 원시 셀 텍스트.

    ⚠ 변환기가 둘이다: kordoc은 표를 HTML `<table>`로 내고(개발·테스트에 씀), 01c는 파이프
       마크다운으로 낸다. 하나만 지원하면 실제 업로드가 **대비표 0행**으로 파싱된다
       (2026-08-05 실측 — 335규칙 별표 매트릭스가 통째로 '개정이유' 목록에 흘러들고 반영 항목이
       하나도 안 나왔다). 표 안 표는 01c가 이미 한 셀 안에 평탄화해 내놓으므로(줄바꿈 없는
       공백 나열) HTML 쪽과 달리 중첩을 따로 다룰 필요가 없다.
    """
    lines = body.splitlines()
    out, n, i = [], len(lines), 0
    while i < n - 1:
        if _PIPE_LINE.match(lines[i]) and _is_pipe_sep(lines[i + 1]):
            header = _pipe_cells(lines[i])
            is_cmp = (len(header) >= 2 and re.search(r"현\s*행", header[0])
                      and re.search(r"개\s*정", header[1]))
            j = i + 2
            while j < n and _PIPE_LINE.match(lines[j]):
                if is_cmp:
                    cells = _pipe_cells(lines[j])
                    cur = cells[0] if cells else ""
                    new = cells[1] if len(cells) > 1 else ""
                    note = cells[2] if len(cells) > 2 else ""
                    # 표 안 표가 평탄화되며 HTML 쪽의 '<table 존재' 신호가 사라진다 — 매트릭스
                    # 헤더 어휘로 대신 짚는다. ⛔ 이걸 못 잡아도 '생략' 경고가 백스톱이다(아래).
                    out.append((cur, new, note, "전결권자" in (cur + new)))
                j += 1
            i = j
        else:
            i += 1
    return out


def _outer_tables(md: str) -> list:
    """문서의 최상위 <table>의 **안쪽 내용**(중첩 표는 그 안에 통째로 포함).

    ⚠ 바깥 <table> 태그를 붙여서 돌려주면 안 된다 — _top_level_blocks가 그 태그를 세어
       깊이를 1로 올리고, 모든 <tr>이 '중첩'으로 걸러져 **대비표 0행**이 된다(2026-08-04 실측).
       두 함수의 깊이 기준을 여기서 0으로 맞춘다.
    """
    out, depth, start = [], 0, None
    for m in re.finditer(r"<\s*(/?)\s*table\b[^>]*>", md, re.I):
        if m.group(1) != "/":
            if depth == 0:
                start = m.end()      # 여는 태그 '다음'부터가 내용
            depth += 1
        else:
            depth -= 1
            if depth == 0 and start is not None:
                out.append(md[start:m.start()])
                start = None
    return out


def _cell_lines(cell: str) -> list:
    """셀 → 사람이 읽는 줄 목록. 중첩 표의 행 경계도 줄바꿈으로 살린다.

    ⚠ **꺾쇠를 전부 태그로 보면 규정 원문이 지워진다**(2026-08-04 실측).
       `부 칙<2026. 7. 27.>`의 시행 날짜와 `<공통사항>`·`<연구업무>` 같은 구획 표시가
       통째로 사라졌고, 그 탓에 부칙 표제가 '부 칙'만 남아 문서에 이미 있는 옛 부칙과
       같아 보였다(→ 신설 부칙이 '이미 반영됨'으로 오판). HWP 문서는 꺾쇠를 본문 기호로
       쓴다 — **태그명이 영문으로 시작하는 것만** 지운다.
    """
    s = re.sub(r"</\s*tr\s*>", "\n", cell, flags=re.I)
    s = re.sub(r"<\s*br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</\s*t[dh]\s*>", " ", s, flags=re.I)
    s = re.sub(r"</?[a-zA-Z][^>]*>", "", s)   # ⛔ `<[^>]+>` 금지 — 위 주석 참조
    s = html.unescape(s)
    return [ln.strip() for ln in s.split("\n") if ln.strip()]


# 「위임전결규정 개정(안)」의 '주요내용' 요약표는 대비표(생략/좌동)와 달리 **정확한 지시**를
# 담는다: "(현행) 팀장 ▶ (변경) 실･팀장". 대비표 쪽 별표 셀은 통째로 잠그지만, 이 문장은
# 문서가 스스로 "무엇을 무엇으로" 말하고 있으므로 여전히 전사다(판단이 아니다) — 2026-08-05,
# 실제 볼트에서 대상 셀이 정확히 한 곳뿐임을 확인하고 추가했다(운영자 지적: "자동화하려고
# 만든 건데 사람이 직접 보는 건 원칙에 어긋난다").
_SUMMARY_CHANGE = re.compile(r"\(현\s*행\)\s*([^\s▶<|]+)\s*▶\s*\(변\s*경\)\s*([^\s<|]+)")
_SECTION_MARK = re.compile(r"<([^/>][^>]{0,20})>")


def _summary_changes(body: str) -> list:
    """→ [{구획, 현행, 개정}]. 구획은 같은 줄에서 그 앞에 나온 마지막 한글 꺾쇠 표시
    (`<기획·행정>`)를 쓴다 — 표시는 화면용일 뿐, 매칭은 아래 propose()에서 '현행' 값이
    볼트 전체에서 유일한지로 다시 검증한다(구획 오독이 안전을 대신하지 않는다)."""
    out = []
    for ln in body.splitlines():
        for m in _SUMMARY_CHANGE.finditer(ln):
            secs = _SECTION_MARK.findall(ln[:m.start()])
            sec = next((s for s in reversed(secs) if re.search(r"[가-힣]", s)), "")
            out.append({"구획": sec, "현행": m.group(1).strip(), "개정": m.group(2).strip()})
    return out


# ───────────────────────── ② 해독 ─────────────────────────
def parse(md: str) -> dict:
    """→ {제목, 개정이유[], 시행일, 행[]}. 행 = {현행[], 개정[], 비고, 종류, 경고[]}."""
    _, body = split_frontmatter(md)
    body = body or md

    # 제목 — 첫 비어있지 않은 줄. ⚠ 01c는 표제도 파이프 표 한 칸("|  |\n| --- |\n| 제목 |")으로
    # 낸다 — 그대로 첫 줄을 집으면 "|  |"가 뽑힌다(2026-08-05 실측, 화면에 그대로 노출됨).
    title = ""
    for ln in body.splitlines():
        ln = ln.strip()
        if not ln or _is_pipe_sep(ln):
            continue
        if _PIPE_LINE.match(ln):
            cells = [c for c in _pipe_cells(ln) if c]
            if cells:
                title = cells[0]
                break
            continue
        title = ln
        break

    # 대상 규정명 — 파일명보다 훨씬 믿을 만한 매칭 근거다. 공문은 스스로
    # "「위임전결규정」을 개정"이라고 말한다. 파일명 유사도는 배포 시 붙는 접미사
    # (버전 "(1)", 날짜 "260721" 등)에 취약해 실제로 매칭이 깨진 적이 있다(2026-08-05 실측).
    m = re.search(r"「([^」]{2,40})」\s*(을|를)\s*개정", body)
    target_reg = m.group(1) if m else ""

    reasons = []
    # ⚠ 경계로 `<table`만 보면 안 된다 — 01c(실제 업로드 경로)는 HTML 태그 없이 파이프 마크다운
    #   표를 바로 이어 붙인다. 그러면 다음 '□'까지의 첫 표 전체가 개정이유에 흘러들어간다
    #   (2026-08-05 실측: 개정이유 3개가 8개로 부풀고 원시 표 텍스트가 그대로 노출됐다).
    #   '\n|' = 파이프 표 시작 신호를 추가 경계로 쓴다.
    m = re.search(r"[□ㅁ]\s*개\s*정\s*이\s*유(.*?)(?=[□ㅁ]|<table|\n\s*\||\Z)", body, re.S)
    if m:
        reasons = [re.sub(r"^[ㅇo○\-\s]+", "", ln).strip()
                   for ln in m.group(1).splitlines() if ln.strip()]

    # 시행일 — 부칙 조문 원문에서만 읽는다(추측 금지)
    enforce = ""
    m = re.search(r"제\s*1\s*조\s*\(\s*시행일\s*\)[^<\n]*?(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일", body)
    if m:
        enforce = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"

    # 대비표 = 현행/개정 머리를 가진 최상위 표. 변환기가 둘이라(kordoc=HTML, 01c=파이프
    # 마크다운) 두 형식을 다 스캔해 합친다 — 하나만 지원하면 실제 업로드가 0행으로 파싱된다.
    rows = []
    for cur_raw, new_raw, note_raw, in_table_hint in (_html_compare_rows(body)
                                                        + _pipe_compare_rows(body)):
        cur, new = _cell_lines(cur_raw), _cell_lines(new_raw)
        note = " ".join(_cell_lines(note_raw)) if note_raw else ""
        if not cur and not new:
            continue
        if re.fullmatch(r"\s*현\s*행\s*", " ".join(cur)):   # 머리행
            continue

        warn = []
        if any(_OMITTED_ANY.search(x) for x in cur + new):
            warn.append("표에 '생략'이 있다 — 규정 본문이 이 문서에 없다. ⛔반영 금지")
        same = [x for x in new if _SAME_AS.match(x)]
        if same:
            warn.append(f"'좌동' {len(same)}건 — 그 부분은 변경 없음(현행 유지)")
        # 셀 안에 표가 또 있으면 이 행은 별표(매트릭스) 내용이다. 볼트에서는 표 안에 살아
        # 있어 줄 단위 대조가 성립하지 않는다 — '미발견'을 결함으로 오해하지 않도록 밝힌다.
        if in_table_hint:
            warn.append("별표(표) 내용이다 — 줄 대조가 성립하지 않으니 원문 표에서 직접 확인할 것")

        kind = ("신설" if not cur else "삭제" if not new
                else "좌동" if all(_SAME_AS.match(x) for x in new) else "변경")
        rows.append({"현행": cur, "개정": new, "비고": note, "종류": kind,
                     "경고": warn, "표": in_table_hint})
    return {"제목": title, "대상규정": target_reg, "개정이유": reasons, "시행일": enforce,
            "행": rows, "요약변경": _summary_changes(body)}


# ───────────────────────── ③ 위치 짚기 ─────────────────────────
# 대비표와 볼트가 가운뎃점 이형(·/･/‧)·공백만 다른 경우가 흔하다 — 그걸로 '못 찾음'이 되면 안 된다.
_MIDDOT = str.maketrans({"･": "·", "‧": "·", "・": "·", "ㆍ": "·"})
_NUMHEAD = re.compile(r"\s*([0-9]{1,2}[.)])")


def _norm(s: str) -> str:
    s = html.unescape(s or "").translate(_MIDDOT)
    s = re.sub(r"[*_`~]", "", s)
    return re.sub(r"\s+", "", s)


_BUCHIK_HEAD = re.compile(r"^\s*부\s{0,8}칙")


def _gate(row: dict, item: dict) -> tuple:
    """spec 15 §3 다섯 관문 → (반영가능, 불가사유). ⛔ 사유는 그대로 화면에 나간다:
    버튼을 조용히 감추면 사람이 '누락'으로 오해한다. 왜 못 누르는지 항상 쓴다."""
    if row.get("표"):
        return False, "별표(표) 내용 — 줄 대조가 성립하지 않습니다. 원문 표에서 직접 확인하세요."
    if any("생략" in w for w in row.get("경고", [])):
        return False, "'생략' 포함 — 규정 본문이 이 문서에 없어 옮길 글자가 없습니다."
    if row["종류"] == "좌동":
        return False, "'좌동'(변경 없음) — 반영할 것이 없습니다."
    if item["모드"] == "delete":
        # ⛔ 짝 없는 현행 줄은 '삭제'인지 '순서 이동'인지 대비표만으로 단정할 수 없다.
        #    지우는 것은 되돌리기가 가장 어려운 조작이다 — 자동화하지 않는다.
        return False, "대응하는 개정 문구가 없습니다(삭제 여부는 원문으로 확인) — 사람이 직접."
    if not item["개정줄"]:
        return False, "개정 문구가 비어 있습니다."
    if item["모드"] == "replace" and item["상태"] != "확정":
        return False, ("볼트에서 여러 곳과 일치합니다 — 어느 줄인지 사람이 확인하세요."
                       if item["상태"] == "모호" else
                       "볼트에서 이 줄을 찾지 못했습니다 — 문구가 다르거나 표 안에 있습니다.")
    if item["모드"] == "insert" and not item["앵커줄"]:
        return False, "넣을 자리(바로 앞줄)를 볼트에서 특정하지 못했습니다 — 사람이 직접 넣으세요."
    if item["모드"] == "cell" and item["상태"] != "확정":
        return False, ("표 셀 값이 볼트 여러 곳에 있어 어느 것인지 특정할 수 없습니다 — 사람이 확인하세요."
                       if item["상태"] == "모호" else
                       "요약표가 말하는 문구를 원문 표에서 찾지 못했습니다 — 사람이 확인하세요.")
    return True, ""


def propose(doc_md: str, parsed: dict) -> list:
    """대비표 행 → 볼트 문서 줄 번호 + 반영 가능 여부(spec 15 §3·§5).

    → [{행, 종류, 변경[], 경고[], 비고}]
      변경 항목 = {현행줄, 개정줄, 볼트줄, 상태, 모드, 앵커줄, 반영가능, 불가사유}
      상태 = 확정(1곳)|모호(여러 곳)|미발견|신설
      모드 = replace(그 줄 교체) | insert(앵커 다음 줄에 삽입) | append(문서 끝에 블록 추가)
    """
    lines = (doc_md or "").splitlines()
    idx: dict = {}
    for i, ln in enumerate(lines, 1):
        k = _norm(ln)
        if k:
            idx.setdefault(k, []).append(i)

    def uniq(text: str) -> int:
        """볼트에서 **1곳만** 일치할 때 그 줄 번호. 여러 곳이면 0 — 앵커로 못 쓴다."""
        hits = idx.get(_norm(text), [])
        return hits[0] if len(hits) == 1 else 0

    out = []
    for n, row in enumerate(parsed["행"], 1):
        if row["종류"] == "좌동":
            out.append({"행": n, "종류": "좌동", "변경": [],
                        "경고": row["경고"], "비고": row["비고"]})
            continue

        cur = [x for x in row["현행"] if not _OMITTED.match(x)]
        new = [x for x in row["개정"] if not _OMITTED.match(x) and not _SAME_AS.match(x)]

        # 부칙 신설은 **블록 하나**로 다룬다: 표제·제1조·제2조가 한 덩어리이고,
        # 규정에서 부칙은 언제나 문서 끝이라 앵커를 찾을 필요가 없다(spec 15 §5-4).
        if not cur and new and _BUCHIK_HEAD.match(new[0]):
            item = {"현행줄": "", "개정줄": "\n".join(new), "볼트줄": 0, "상태": "신설",
                    "모드": "append", "앵커줄": len(lines)}
            item["반영가능"], item["불가사유"] = _gate(row, item)
            out.append({"행": n, "종류": "신설·부칙", "변경": [item],
                        "경고": row["경고"], "비고": row["비고"]})
            continue

        curn, newn = {_norm(x) for x in cur}, {_norm(x) for x in new}

        gone, added = [], []
        for ln in cur:                       # 사라지거나 바뀌는 줄
            if _norm(ln) in newn:
                continue                     # 양쪽에 그대로 = 변경 아님
            hits = idx.get(_norm(ln), [])
            gone.append({"현행줄": ln, "개정줄": "",
                         "볼트줄": hits[0] if len(hits) == 1 else 0,
                         "상태": "확정" if len(hits) == 1 else ("모호" if hits else "미발견")})
        for k_new, ln in enumerate(new):     # 새로 들어오는 줄
            if _norm(ln) in curn:
                continue
            # 앵커 = 개정 칸에서 **바로 앞줄** 중 볼트에서 유일하게 찾히는 것(spec 15 §5).
            # ⛔ 못 찾으면 0 — "적당한 곳에 넣기"는 없다.
            anchor = next((a for a in (uniq(new[j]) for j in range(k_new - 1, -1, -1)) if a), 0)
            added.append({"현행줄": "", "개정줄": ln, "볼트줄": 0, "상태": "신설",
                          "앵커줄": anchor})

        # 같은 번호로 시작하는 현행/개정 줄은 한 쌍으로 묶는다("4. …" → "4. …")
        items, taken = [], set()
        for a in gone:
            h = _NUMHEAD.match(a["현행줄"])
            mate = None
            if h:
                for k, b in enumerate(added):
                    hb = _NUMHEAD.match(b["개정줄"])
                    if k not in taken and hb and hb.group(1) == h.group(1):
                        mate, _ = b, taken.add(k)
                        break
            items.append({**a, "개정줄": mate["개정줄"]} if mate else a)
        items += [b for k, b in enumerate(added) if k not in taken]

        # 모드 확정 + 관문 판정. 짝지어진 항목(현행+개정)은 그 줄을 교체, 나머지 신설은 삽입.
        for it in items:
            it.setdefault("앵커줄", 0)
            it["모드"] = ("replace" if it["현행줄"] and it["개정줄"]
                          else "delete" if it["현행줄"] else "insert")
            it["반영가능"], it["불가사유"] = _gate(row, it)

        out.append({"행": n, "종류": row["종류"], "변경": items,
                    "경고": row["경고"], "비고": row["비고"]})

    # 요약표 기반 별표 셀 치환("(현행) 팀장 ▶ (변경) 실･팀장") — 대비표 본문은 '생략'이라
    # 잠기지만, 이 문장은 문서가 스스로 "무엇을 무엇으로"라 말하는 명확한 지시다(2026-08-05,
    # 운영자 지적으로 추가). 판단이 아니라 여전히 전사다. 안전장치는 동일: 대상 셀 값이
    # **볼트 전체에서 정확히 한 줄에만** 있을 때만 열린다(모호·미발견은 그대로 잠김).
    for k, sc in enumerate(parsed.get("요약변경", []), 1):
        cur_cell, new_cell = f"<td>{sc['현행']}</td>", f"<td>{sc['개정']}</td>"
        hits = [i for i, ln in enumerate(lines, 1) if cur_cell in ln]
        item = {"현행줄": sc["현행"], "개정줄": sc["개정"], "볼트줄": hits[0] if len(hits) == 1 else 0,
                "앵커줄": 0, "모드": "cell",
                "상태": "확정" if len(hits) == 1 else ("모호" if hits else "미발견")}
        item["반영가능"], item["불가사유"] = _gate({"종류": "변경", "경고": []}, item)
        out.append({"행": f"별표·{sc['구획'] or k}", "종류": "별표 헤더 변경", "변경": [item],
                    "경고": [] if item["반영가능"] else
                    [f"요약표 지시: {sc['구획'] or '구획 미상'} — 현행 '{sc['현행']}' → 개정 '{sc['개정']}'"],
                    "비고": sc.get("구획", "")})
    return out


# ───────────────────────── CLI ─────────────────────────
def report(md: str, doc: str | None) -> str:
    c = classify(md)
    L = [f"판별: {c['kind']}  (조문 {c['조문수']}개 · 강신호 {len(c['강신호'])})"]
    L += [f"  · {w}" for w in c["근거"]]
    ok, why = replaceable(md)
    L.append(f"교체 가능: {'예' if ok else '아니오'} — {why}")
    if c["kind"] not in (KIND_AMEND, KIND_MIXED):
        return "\n".join(L)

    p = parse(md)
    L += ["", f"제목: {p['제목']}", f"시행일: {p['시행일'] or '(문서에 없음)'}"]
    L += ["개정이유:"] + [f"  - {r}" for r in p["개정이유"]]
    L.append(f"\n대비표 {len(p['행'])}행" + ("" if doc else "  (--doc 없이는 줄 번호를 못 짚는다)"))
    for pr in propose(doc, p):
        L.append(f"\n[{pr['행']}] {pr['종류']}" + (f"  · 비고: {pr['비고']}" if pr["비고"] else ""))
        for w in pr["경고"]:
            L.append(f"    ⚠ {w}")
        for it in pr["변경"]:
            loc = (f"볼트 {it['볼트줄']}줄" if it["볼트줄"]
                   else f"{it['앵커줄']}줄 뒤" if it.get("앵커줄") else it["상태"])
            mark = "✅반영가능" if it["반영가능"] else "🔒"
            if it["현행줄"] and it["개정줄"]:
                L += [f"    {mark} ({loc}) - {it['현행줄']}", f"                 + {it['개정줄']}"]
            elif it["현행줄"]:
                L.append(f"    {mark} ({loc}) - {it['현행줄']}")
            else:
                head = it["개정줄"].split("\n")[0]
                more = it["개정줄"].count("\n")
                L.append(f"    {mark} ({loc})  + {head}" + (f"  …외 {more}줄" if more else ""))
            if not it["반영가능"]:
                L.append(f"         └ {it['불가사유']}")
    return "\n".join(L)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="개정안(신·구조문 대비표) 판별·해독 — ⛔자동 적용 없음")
    ap.add_argument("--file", required=True, help="변환된 개정안 md")
    ap.add_argument("--doc", help="대조할 볼트 문서 md(줄 번호를 짚어준다)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    src = Path(a.file).read_text(encoding="utf-8")
    tgt = Path(a.doc).read_text(encoding="utf-8") if a.doc else None
    if a.json:
        pp = parse(src)
        print(json.dumps({"판별": classify(src), "개정안": pp,
                          "제안": propose(tgt, pp) if tgt else []}, ensure_ascii=False, indent=2))
    else:
        print(report(src, tgt))
