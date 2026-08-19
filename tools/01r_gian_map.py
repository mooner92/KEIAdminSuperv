#!/usr/bin/env python3
"""01r_gian_map.py — 기안 도우미 매핑 인덱스 (docs/72 P4).

`/approval`은 "누가 결재하나"까지만 답한다. 실사용 질문의 나머지 절반은 그 다음이다 —
**"무슨 문서로 기안하지 · 뭘 첨부하지 · 기록물철은 뭘 고르지 · 협조냐 결재냐"**.
이 도구는 그 답이 이미 적혀 있는 볼트 문서 5종을 **결정적으로** 파싱해 한 장으로 합친다.

읽는 곳(전부 볼트 실재 — ⛔ 창작 0):
  ⓐ 40_시스템/전자결재 기안 · 업무별 적용        → 업무군 5종(문서종류·확인사항·첨부'권장'·결재정보 주의)
  ⓑ 40_시스템/전자결재 기안 · 기록물철 코드표    → 공통(ZA)·담당(AA) 철 + '고르는 요령' 예시 매핑
  ⓒ 40_시스템/전자결재 기안 · 결재상신 공통      → 결재선 역할 7종·일상감사 기준·편철 원칙·체크리스트
  ⓓ 20_규정원문/…/6100_문서관리규정              → 기안문 형식·전결·대결·협조 조문(원문 그대로)
  ⓔ 20_규정원문/…/6120_기록물관리규정            → 편철·보존기간 조문(원문 그대로)
  ⓕ tools/index/approval.json(01n)               → 업무군↔전결규칙 조인(키워드는 ⓐ에서 파생)

⛔ 절대 규칙
 1. 이 파일은 **옮겨 적을 뿐 만들지 않는다.** 모든 항목에 출처(문서명·조·원문줄)를 함께 싣는다.
 2. 첨부서류는 규정 근거가 아니라 시스템 노트의 **'첨부 권장'** 서술이다 → `권장` 라벨을 달고
    단정하지 않는다(화면도 같은 라벨을 그대로 노출한다).
 3. 볼트는 읽기 전용. 검수상태 변경 없음. LLM 0회.
 4. 파싱 실패는 조용히 넘기지 않는다 — 커버리지를 stdout으로 보고한다.

출력: tools/index/gian_map.json
실행: python tools/01r_gian_map.py --vault KEI-행정가이드
"""
import argparse
import datetime
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
INDEX = ROOT / "tools" / "index"

SYS_DIR = "40_시스템"
DOC_APPLY = "전자결재 기안 · 업무별 적용"
DOC_CODES = "전자결재 기안 · 기록물철 코드표"
DOC_COMMON = "전자결재 기안 · 결재상신 공통"
REG_DOC = "20_규정원문/6000_총무·보안·회계/6100_문서관리규정"
REG_REC = "20_규정원문/6000_총무·보안·회계/6120_기록물관리규정"

# 기안문 작성·결재에 직접 쓰이는 조문(문서관리규정). 조 번호는 원문에 실재하는 것만 나열한다.
ART_GIAN = ["제4조", "제11조", "제12조", "제13조", "제14조", "제15조", "제16조", "제17조", "제18조",
            "제22조", "제23조", "제24조", "제25조", "제26조", "제27조", "제29조", "제30조"]
ART_REC = ["제10조", "제11조", "제12조", "제14조"]  # 기록물관리규정 — 기준표·정리·이관·보존기간

# 결재선 역할 → 규정 조문 조인 키(조문 **제목에 그 낱말이 그대로 있는** 것만 잇는다).
ROLE_ART = {"결재": "결재", "전결": "전결", "대결": "대결",
            "협조(순차)": "협조", "협조(병렬)": "협조"}

# 편철 후보를 뽑을 때 철명에 흔해서 변별력이 없는 낱말(이게 없으면 '관리'가 전 철을 다 물어온다).
STOP = {"관리", "업무", "성격", "관련", "선택", "검토", "우선", "확인", "기준", "문서", "편철",
        "기록물철", "사항", "경우", "필요", "처리", "가능성", "높다", "한다", "맞게", "여부",
        "지정", "정확히", "금액", "공개", "보안", "등급", "개인정보", "포함", "과제선택", "예산분류"}
# 업무군 문서명에서 떼어내는 행위 접미(그래야 '국내출장신청'→'국내출장'으로 전결표와 만난다).
SUFFIX = ["결과보고", "정산신청", "취소신청", "지급신청", "변경신청", "신청서", "신청", "신고",
          "보고", "품의", "변경", "취소", "제출", "등"]


def read(vault: pathlib.Path, rel: str) -> tuple[dict, str]:
    """볼트 문서 1개 → (프론트매터, 본문). 없으면 ({}, '')."""
    p = vault / f"{rel}.md"
    if not p.exists():
        return {}, ""
    text = p.read_text(encoding="utf-8")
    meta = {}
    body = text
    if text.startswith("---"):
        _, fm, body = text.split("---", 2)
        for line in fm.strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
    return meta, body


def _demark(s: str) -> str:
    """마크다운 강조·코드 표시만 제거(**굵게**·`코드`). 낱말은 하나도 바꾸지 않는다 —
    화면이 별표를 그대로 노출하던 실측 결함 수정(vault_parse.strip_wikilinks와 같은 성격)."""
    return re.sub(r"\*\*(.+?)\*\*", r"\1", s).replace("`", "").strip()


def _bullet(line: str) -> tuple[int, str]:
    """'  * 내용' → (들여쓰기, '내용'). 불릿이 아니면 (-1, '')."""
    m = re.match(r"^(\s*)\*\s+(.*)$", line)
    return (len(m.group(1)), _demark(m.group(2))) if m else (-1, "")


def parse_apply(body: str) -> list:
    """업무별 적용 → 업무군 5종. `## 제목` 아래 `* 라벨:` + 들여쓴 항목 구조를 그대로 옮긴다."""
    LABELS = {"적용 문서": "문서종류", "확인사항": "확인사항",
              "첨부 권장": "첨부권장", "결재정보 주의": "결재정보주의"}
    out, cur, key = [], None, None
    for line in body.split("\n"):
        h = re.match(r"^##\s+(.+?)\s*$", line)
        if h:
            title = h.group(1).strip()
            if title == "관련 규정":          # 01e 크로스링크 블록 — 업무군 아님
                cur, key = None, None
                continue
            cur = {"id": re.sub(r"\s*관련 기안$", "", title), "이름": title, "섹션": title,
                   "문서종류": [], "확인사항": [], "첨부권장": [], "결재정보주의": []}
            out.append(cur)
            key = None
            continue
        if cur is None:
            continue
        indent, txt = _bullet(line)
        if indent < 0:
            continue
        label = txt.rstrip(":").strip()
        if indent == 0 and label in LABELS:
            key = LABELS[label]
        elif indent > 0 and key:
            cur[key].append(txt)
    return out


def parse_codes(body: str) -> dict:
    """기록물철 코드표 → 공통(ZA)·담당(AA) 표 + '고르는 요령'의 예시 매핑."""
    common, dept, cur = [], [], None
    for line in body.split("\n"):
        h = re.match(r"^####\s+(.+?)\s*$", line)
        if h:
            t = h.group(1)
            cur = common if "공통 단위업무" in t else (dept if "담당 단위업무" in t else None)
            continue
        if cur is None or not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[0] in ("코드", "---") or set(cells[0]) <= {"-"}:
            continue
        if not re.match(r"^[A-Z]{2}\d{6}$", cells[0]):
            continue
        cur.append({"코드": cells[0], "단위업무": cells[1], "철명": cells[2], "보존기간": cells[3]})

    # '고르는 요령'의 `예: 출장 기안 → ZA000102 → (공통)출장 · 휴가/복무 → ZA000104 · …'
    # ⚠ 이 절의 불릿은 `-`이고 '예:' 줄은 **불릿이 아닌 이어진 줄**이다(실측). 그래서 불릿
    #   모양을 가리지 않고 줄 단위로 화살표 매핑을 훑는다 — 처음엔 `*`만 봐서 0건이었다.
    tips, hints = [], []
    m = re.search(r"####\s+고르는 요령(.*?)(?:\n####|\Z)", body, re.S)
    if m:
        for line in m.group(1).split("\n"):
            txt = line.strip()
            if not txt:
                continue
            if re.match(r"^[-*]\s+", txt):
                tips.append(_demark(re.sub(r"^[-*]\s+", "", txt)))
            for seg in re.split(r"\s[·]\s", txt):
                mm = re.search(r"([가-힣/ ]+?)\s*→\s*([A-Z]{2}\d{6})", seg)
                if mm:
                    words = [w for w in re.split(r"[/\s]+", mm.group(1).strip()) if len(w) >= 2]
                    words = [re.sub(r"(기안|→)$", "", w) for w in words]
                    hints.append({"낱말": [w for w in words if w and w != "기안"],
                                  "코드": mm.group(2), "원문": txt})
    return {"공통": common, "담당예시": dept, "요령": tips, "요령매핑": hints}


def _section(body: str, head: str) -> str:
    m = re.search(rf"####\s+{re.escape(head)}(.*?)(?:\n#{{1,4}}\s|\Z)", body, re.S)
    return m.group(1) if m else ""


def _flat_bullets(chunk: str) -> list:
    return [t for _, t in (_bullet(l) for l in chunk.split("\n")) if t]


def parse_common(body: str) -> dict:
    """결재상신 공통 → 결재선 역할·일상감사·편철 원칙·체크리스트."""
    roles = []
    for line in _section(body, "결재선 역할 선택").split("\n"):
        indent, txt = _bullet(line)
        if indent < 0:
            continue
        if indent == 0:
            roles.append({"역할": txt, "설명": []})
        elif roles:
            roles[-1]["설명"].append(txt)

    audit = {"안내문": "", "적용문서": [], "사용방법": []}
    sec = _section(body, "일상감사신청")
    key = None
    for line in sec.split("\n"):
        indent, txt = _bullet(line)
        if indent < 0:
            continue
        if indent == 0:
            key = ("적용문서" if txt.startswith("적용 필요 문서")
                   else "사용방법" if txt.startswith("사용 방법") else
                   "안내" if txt.startswith("화면 하단 안내문") else None)
        elif key == "안내":
            audit["안내문"] = txt.strip("`")
        elif key:
            audit[key].append(txt)

    return {"결재선역할": roles, "일상감사": audit,
            "편철원칙": _flat_bullets(_section(body, "편철 선택 원칙")),
            "체크리스트": {
                "결재올림전": [t.lstrip("✔ ") for t in _flat_bullets(_section(body, "결재올림 전 최종 체크리스트"))],
                "첨부확인": [t.lstrip("✔ ") for t in _flat_bullets(_section(body, "첨부 확인 체크리스트"))],
            },
            "첨부대표업무": _flat_bullets(_section(body, "첨부가 필요한 대표 업무"))}


def parse_articles(body: str, want: list, reg: str, slug: str) -> list:
    """규정 원문 → 지정 조문만 (제목·원문 그대로). 원문층은 의역 금지(⛔절대규칙2)."""
    # 조 경계로 자른 뒤 라벨이 want에 있는 것만. 부칙·별지 뒤 재등장은 첫 번째만 채택.
    parts = re.split(r"(?=^\s*제\s*\d+\s*조)", body, flags=re.M)
    out, seen = [], set()
    for chunk in parts:
        m = re.match(r"\s*제\s*(\d+)\s*조", chunk)
        if not m:
            continue
        label = f"제{int(m.group(1))}조"
        if label not in want or label in seen:
            continue
        # 다음 절/장 제목이 붙어 오면 잘라낸다(원문 문장은 그대로 두고 머리글만 제거)
        lines = []
        for ln in chunk.strip().split("\n"):
            if re.match(r"^제\d+\s*[절장]\s", ln.strip()) or ln.strip().startswith("<별지"):
                break
            lines.append(ln.rstrip())
        text = "\n".join(lines).strip()
        title = ""
        tm = re.match(r"제\s*\d+\s*조\s*\(([^)]*)\)", text)
        if tm:
            title = tm.group(1).strip()
        seen.add(label)
        out.append({"규정명": reg, "slug": slug, "조": label, "제목": title, "원문": text})
    out.sort(key=lambda x: int(re.sub(r"\D", "", x["조"])))
    return out


def _norm(s: str) -> str:
    """전결표 조인용 정규화 — 공백·가운뎃점 제거('원외 겸직활동'과 '원외겸직활동'을 같게 본다)."""
    return re.sub(r"[\s･·、,.]+", "", s or "")


def keywords(group: dict) -> list:
    """업무군 → 전결표 조인 키워드. **문서에서 파생**한다(내가 고른 낱말이 아니다):
    ⓐ 업무군 제목의 낱말(관련·기안 제외) ⓑ 적용 문서명에서 행위 접미를 뗀 어간."""
    # ⚠ 제목의 일반 행위어(신고·신청·보고)는 뺀다 — 전결표 어디에나 있어서 무관한 규칙을
    #   끌어온다(실측: '신고' 하나가 건강보험 자격취득신고까지 원외겸직 기안에 붙였다).
    GENERIC = {"관련", "기안", "신고", "신청", "보고", "관리", "기타"}
    words = set()
    for w in re.split(r"[·,/\s]+", group["id"]):
        w = w.strip()
        if len(w) >= 2 and w not in GENERIC:
            words.add(w)
    for doc in group["문서종류"]:
        base = re.split(r"[ /(]", doc)[0].strip()
        for suf in SUFFIX:
            if base.endswith(suf) and len(base) > len(suf) + 1:
                base = base[: -len(suf)]
                break
        if len(base) >= 2:
            words.add(base)
    return sorted(words)


def join_approval(groups: list, rules: list) -> dict:
    """업무군 ↔ 위임전결 규칙(01n) 조인. 매칭어를 규칙마다 남겨 '왜 걸렸는지'를 화면이 보여준다."""
    stat = {}
    for g in groups:
        kws = keywords(g)
        hit, hitkw = [], set()
        for r in rules:
            hay = _norm(f"{r.get('구분','')} {r.get('업무','')}")
            matched = [k for k in kws if _norm(k) and _norm(k) in hay]
            if not matched:
                continue
            hit.append({**{k: r.get(k, "") for k in ("구분", "업무", "대상", "전결권자", "협의", "원문행")},
                        "원장": bool(r.get("원장")), "매칭어": matched})
            hitkw.update(matched)
        # 같은 업무·대상 중복 제거(전결표는 구분이 달라도 같은 줄이 반복될 수 있다)
        seen, uniq = set(), []
        for h in hit:
            key = (h["구분"], h["업무"], h["대상"], h["전결권자"])
            if key in seen:
                continue
            seen.add(key)
            uniq.append(h)
        # 일치한 낱말이 많은 규칙부터 — 화면 첫 페이지가 가장 관련 있는 규칙이어야 한다
        # (실측: 단순 구분순은 회계 기안 1페이지가 '10.보수·16.차량관리'로 채워졌다).
        uniq.sort(key=lambda x: (-len(x["매칭어"]), x["구분"], x["업무"], x["대상"]))
        g["전결"] = uniq
        g["전결키워드"] = kws
        g["전결매칭어"] = sorted(hitkw)
        stat[g["id"]] = len(uniq)
    return stat


def join_files(groups: list, codes: dict) -> dict:
    """업무군 ↔ 기록물철 후보. 근거 2종을 각각 라벨링한다(추측 금지 — 못 찾으면 빈칸).
    ⓐ '결재정보 주의'의 편철 문장 낱말 ↔ 공통 철명/단위업무명
    ⓑ 코드표 '고르는 요령'의 예시 매핑(`출장 기안 → ZA000102`)"""
    stat = {}
    for g in groups:
        cands, seen = [], set()
        notes = [n for n in g["결재정보주의"] if "기록물철" in n or "편철" in n]
        toks = set()
        for n in notes:
            for w in re.split(r"[^가-힣A-Za-z]+", n):
                if len(w) >= 2 and w not in STOP:
                    toks.add(w)
        for f in codes["공통"]:
            # ⚠ **철명만** 본다. 단위업무명까지 보면 형제 철이 딸려온다(실측: '인사' 한 낱말이
            #   단위업무 (공통)인사관리 밑의 '(공통)자율연구'까지 휴가 기안 후보로 끌어올렸다).
            m = sorted({t for t in toks if t in f["철명"]})
            if not m:
                continue
            key = (f["코드"], f["철명"])
            seen.add(key)
            cands.append({**f, "근거종류": "결재정보 주의", "매칭어": m,
                          "근거": notes[0] if notes else ""})
        by_code = {}
        for f in codes["공통"]:
            by_code.setdefault(f["코드"], []).append(f)
        for hint in codes["요령매핑"]:
            if not any(w in " ".join(g["문서종류"] + [g["id"]]) for w in hint["낱말"]):
                continue
            for f in by_code.get(hint["코드"], []):
                key = (f["코드"], f["철명"])
                if key in seen:
                    continue
                seen.add(key)
                cands.append({**f, "근거종류": "코드표 고르는 요령", "매칭어": hint["낱말"],
                              "근거": hint["원문"]})
        cands.sort(key=lambda x: (x["코드"], x["철명"]))
        g["기록물철후보"] = cands
        stat[g["id"]] = len(cands)
    return stat


def join_roles(roles: list, arts: list) -> int:
    """결재선 역할 ↔ 문서관리규정 조문. 조문 **제목에 역할 낱말이 그대로 있는** 것만 잇는다.
    없으면 null — '참조·후열'은 규정 근거가 확인되지 않는다(화면이 그대로 말한다)."""
    joined = 0
    for r in roles:
        word = ROLE_ART.get(r["역할"])
        r["규정근거"] = None
        if not word:
            continue
        for a in arts:
            if word in a["제목"]:
                r["규정근거"] = {"규정명": a["규정명"], "slug": a["slug"], "조": a["조"],
                                "제목": a["제목"], "원문": a["원문"]}
                joined += 1
                break
    return joined


def forms_of(reg_stem: str) -> list:
    """별지 서식(01p manifest) — 기안문 서식 <별지 제1·2호>의 미리보기 PDF 경로."""
    try:
        mf = json.loads((INDEX / "byeolji_manifest.json").read_text(encoding="utf-8"))
    except Exception:
        return []
    e = mf.get(reg_stem) or {}
    return [{"규정명": e.get("규정명", ""), "호": b.get("label", ""), "이름": b.get("name", ""),
             "pdf": f"/{b['pdf']}" if b.get("pdf") else None}
            for b in (e.get("별지") or []) if b.get("label") in ("별지 제1호", "별지 제2호")]


def build(vault: pathlib.Path) -> dict:
    warn = []
    m_apply, b_apply = read(vault, f"{SYS_DIR}/{DOC_APPLY}")
    m_codes, b_codes = read(vault, f"{SYS_DIR}/{DOC_CODES}")
    m_common, b_common = read(vault, f"{SYS_DIR}/{DOC_COMMON}")
    m_reg, b_reg = read(vault, REG_DOC)
    m_rec, b_rec = read(vault, REG_REC)
    for name, body in ((DOC_APPLY, b_apply), (DOC_CODES, b_codes), (DOC_COMMON, b_common),
                       (REG_DOC, b_reg), (REG_REC, b_rec)):
        if not body:
            warn.append(f"원본 문서 없음: {name}")

    groups = parse_apply(b_apply)
    codes = parse_codes(b_codes)
    common = parse_common(b_common)
    arts_gian = parse_articles(b_reg, ART_GIAN, "문서관리규정", "6100_문서관리규정")
    arts_rec = parse_articles(b_rec, ART_REC, "기록물관리규정", "6120_기록물관리규정")

    try:
        rules = json.loads((INDEX / "approval.json").read_text(encoding="utf-8")).get("rules") or []
    except Exception:
        rules = []
        warn.append("approval.json 없음 — 전결 조인 생략(01n_approval.py 먼저 실행)")

    stat_appr = join_approval(groups, rules)
    stat_file = join_files(groups, codes)
    roles_joined = join_roles(common["결재선역할"], arts_gian)

    miss_art = sorted(set(ART_GIAN) - {a["조"] for a in arts_gian})
    if miss_art:
        warn.append(f"문서관리규정에서 못 찾은 조문: {' '.join(miss_art)}")
    miss_rec = sorted(set(ART_REC) - {a["조"] for a in arts_rec})
    if miss_rec:
        warn.append(f"기록물관리규정에서 못 찾은 조문: {' '.join(miss_rec)}")
    for g in groups:
        for f in ("문서종류", "첨부권장"):
            if not g[f]:
                warn.append(f"업무군 '{g['id']}'의 {f} 파싱 0건")
        if not g["전결"]:
            warn.append(f"업무군 '{g['id']}' 전결 조인 0건(키워드 {g['전결키워드']})")
        if not g["기록물철후보"]:
            warn.append(f"업무군 '{g['id']}' 기록물철 후보 0건")

    return {
        "generated": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "sources": [
            {"문서": DOC_APPLY, "slug": DOC_APPLY, "검수상태": m_apply.get("검수상태", "")},
            {"문서": DOC_CODES, "slug": DOC_CODES, "검수상태": m_codes.get("검수상태", "")},
            {"문서": DOC_COMMON, "slug": DOC_COMMON, "검수상태": m_common.get("검수상태", "")},
            {"문서": "문서관리규정", "slug": "6100_문서관리규정", "검수상태": m_reg.get("검수상태", "")},
            {"문서": "기록물관리규정", "slug": "6120_기록물관리규정", "검수상태": m_rec.get("검수상태", "")},
        ],
        "업무군": groups,
        "기록물철": codes,
        "결재선역할": common["결재선역할"],
        "일상감사": common["일상감사"],
        "편철원칙": common["편철원칙"],
        "체크리스트": common["체크리스트"],
        "첨부대표업무": common["첨부대표업무"],
        "규정근거": {"기안문": arts_gian, "편철": arts_rec},
        "서식": forms_of("6100_문서관리규정"),
        "커버리지": {
            "업무군": len(groups),
            "문서종류": sum(len(g["문서종류"]) for g in groups),
            "첨부권장": sum(len(g["첨부권장"]) for g in groups),
            "기록물철_공통": len(codes["공통"]),
            "기록물철_담당예시": len(codes["담당예시"]),
            "결재선역할": len(common["결재선역할"]),
            "역할_조문조인": roles_joined,
            "조문_기안문": len(arts_gian),
            "조문_편철": len(arts_rec),
            "전결_전체규칙": len(rules),
            "전결_업무군별": stat_appr,
            "전결_조인성공업무군": sum(1 for v in stat_appr.values() if v),
            "기록물철_업무군별": stat_file,
            "서식": len(forms_of("6100_문서관리규정")),
        },
        "경고": warn,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", default=str(ROOT / "KEI-행정가이드"))
    ap.add_argument("--out", default=str(INDEX / "gian_map.json"))
    a = ap.parse_args()
    res = build(pathlib.Path(a.vault))
    if not res["업무군"]:
        print("⛔ 업무군 0건 — 원본 문서 경로를 확인하세요", file=sys.stderr)
        for w in res["경고"]:
            print(f"  ⚠ {w}", file=sys.stderr)
        return 1
    INDEX.mkdir(parents=True, exist_ok=True)
    pathlib.Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    c = res["커버리지"]
    print(f"기안 매핑: 업무군 {c['업무군']}개 · 문서종류 {c['문서종류']}종 · 첨부(권장) {c['첨부권장']}건 · "
          f"기록물철 공통 {c['기록물철_공통']}철(담당 예시 {c['기록물철_담당예시']}철)")
    print(f"  결재선 역할 {c['결재선역할']}종(규정 조문 조인 {c['역할_조문조인']}종) · "
          f"조문 기안문 {c['조문_기안문']}개·편철 {c['조문_편철']}개 · 서식 {c['서식']}종")
    print(f"  전결 조인: {c['전결_조인성공업무군']}/{c['업무군']} 업무군 "
          f"({', '.join(f'{k} {v}건' for k, v in c['전결_업무군별'].items())})")
    print(f"  기록물철 후보: {', '.join(f'{k} {v}철' for k, v in c['기록물철_업무군별'].items())}")
    for w in res["경고"]:
        print(f"  ⚠ {w}")
    print(f"→ {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
