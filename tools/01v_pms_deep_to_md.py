#!/usr/bin/env python3
"""01v_pms_deep_to_md.py — PMS 상세 기능정리(도움말 PDF·화면 캡처 판독본) → 탭별 상세가이드 노트

ERP 상세가이드(01d_system_to_md.py --deep-guide)의 PMS판. 원자료는 여러 묶음 파일로 나뉘고
같은 탭(예: 과제관리)이 여러 파일에 흩어져 있어 **탭 기준으로 병합**한다.

입력 구조(pms_raw/*.md):
  `# KEI 연구관리시스템(PMS) 기능정리 N - 주제`   문서 제목(내용 아님)
  `## 1. 원본 파일 및 화면 매핑` / `## 2. 공통 …`  머리말 → 개요 노트
  `# <탭> 탭`                                      탭 경계
  `## N. <화면>`(+ `### N-1. 검색조건` …)          화면 상세 → 탭 노트
  문서레벨 섹션(연계도·매트릭스·시나리오·검증 등)   → 부록 노트(제목 패턴으로 판정)

출력(40_시스템/):
  연구관리시스템(PMS) 상세가이드 개요.md
  연구관리시스템(PMS) 상세가이드 · <탭>.md        (탭 9종)
  연구관리시스템(PMS) 상세가이드 부록 · 연계·상태·검증.md

⛔ 본문 불변(의역 금지). 구조 조정은 딱 하나 — H2 제목의 일련번호 접두("3. ", "5-4. ",
   "부록 A. ")만 제거한다(여러 파일을 한 탭으로 합치면 번호가 충돌·무의미해지므로).
✅ 누락 0 검증: 원본 본문 줄의 멀티셋이 출력 본문 줄의 멀티셋과 일치하는지 대사한다.

실행: python 01v_pms_deep_to_md.py --src ../pms_raw --vault ../KEI-행정가이드 [--dry-run]
"""
import argparse
import re
from collections import Counter
from pathlib import Path

SYS = "연구관리시스템(PMS) 상세가이드"
CAT = "연구관리(PMS)"
TAGS = ["PMS", "연구관리", "상세가이드", "신청", "시스템"]
WARN = ("> [!warning] 자동 판독 자료(PMS 도움말 PDF·화면 캡처 판독본) — 예시 값(건수·날짜·금액)은 "
        "캡처 시점 값이다. 실제 화면·규정과 다를 수 있어 검수 후 `검수상태: 검수완료`로.")

# 문서레벨(부록행) 섹션 제목 패턴 — 특정 화면 설명이 아니라 묶음 전체를 가로지르는 정리물.
META_TITLE = re.compile(
    r"화면 간 .*연계|연계관계|데이터 엔터티|데이터 객체|RAG|동의어|검색키워드|반영 위치|"
    r"버튼[·・]?\s*상태 매트릭스|버튼 빠른 참조|화면별 버튼|업무 시나리오|후속|추가 확인|"
    r"검증 체크리스트|업무 검증|요약|핵심 정리|역할[·・]권한|상태전이|공통 오류"
)
NUM_PREFIX = re.compile(r"^(?:\d+(?:-\d+)?\.|부록\s+[A-Z]\.)\s*")
DOC_TITLE = re.compile(r"^KEI 연구관리시스템")


def norm_tab(h1: str) -> str:
    """'연구윤리/특허 탭' → '연구윤리·특허' (파일명 안전 + 기존 tier-1 노트명과 일치)."""
    return re.sub(r"\s*탭\s*$", "", h1).replace("/", "·").strip()


def parse(path: Path):
    """→ (doc_title, [ (zone, tab, title, body_lines) ])  zone ∈ 머리말|화면|문서레벨"""
    lines = path.read_text(encoding="utf-8").splitlines()
    doc_title, tab, out = "", None, []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("# ") and not ln.startswith("## "):
            t = ln[2:].strip()
            if DOC_TITLE.match(t):
                doc_title = t
            else:
                tab = norm_tab(t)
            i += 1
            continue
        if ln.startswith("## ") and not ln.startswith("### "):
            title = NUM_PREFIX.sub("", ln[3:].strip())
            j, body = i + 1, []
            while j < len(lines):
                nxt = lines[j]
                if (nxt.startswith("# ") and not nxt.startswith("## ")) or \
                   (nxt.startswith("## ") and not nxt.startswith("### ")):
                    break
                body.append(nxt)
                j += 1
            zone = "머리말" if tab is None else ("문서레벨" if META_TITLE.search(title) else "화면")
            out.append((zone, tab, title, body))
            i = j
            continue
        i += 1
    return doc_title, out


def fm(title: str, srcs: list) -> str:
    return ("---\n"
            "type: system\n"
            f'제목: "{title}"\n'
            f'분류: "{CAT}"\n'
            '대상: "전직원"\n'
            "관련규정: []\n"
            "관련서식: []\n"
            "개정일:\n"
            "최종검토일:\n"
            "검토자:\n"
            f'원본파일: "{", ".join(srcs)}"\n'
            f'태그: [{", ".join(chr(34) + t + chr(34) for t in TAGS)}]\n'
            "검수상태: 미검수\n"
            "---\n\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="원자료 디렉터리(pms_raw)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src_dir, vault = Path(args.src), Path(args.vault)
    files = sorted(src_dir.glob("PMS_기능정리_*.md"))
    if not files:
        print(f"⛔ {src_dir}에 PMS_기능정리_*.md 없음")
        return 1

    tabs: dict = {}       # 탭 → [(title, body, src)]
    head: list = []       # 머리말 → 개요
    meta: list = []       # 문서레벨 → 부록
    src_lines = Counter()  # 누락 검증용(원본 본문 줄)
    doc_titles = []

    for f in files:
        dt, secs = parse(f)
        doc_titles.append((f.name, dt))
        for zone, tab, title, body in secs:
            src_lines.update(body)
            item = (title, body, f.name)
            if zone == "머리말":
                head.append(item)
            elif zone == "문서레벨":
                meta.append(item)
            else:
                tabs.setdefault(tab, []).append(item)

    notes: dict = {}  # 파일명 → 본문
    out_lines = Counter()

    def render(title: str, intro: list, items: list, srcs: list) -> str:
        buf = [fm(title, sorted(set(srcs))), f"# {title}\n\n", WARN + "\n\n"]
        buf += intro
        for t, body, sf in items:
            buf.append(f"## {t}\n")
            buf.append("\n".join(body) + "\n")
            out_lines.update(body)
        return "".join(buf)

    # ① 탭별 상세가이드 노트
    for tab, items in tabs.items():
        title = f"{SYS} · {tab}"
        intro = [f"> 관련 메뉴 노트: [[연구관리시스템(PMS) · {tab}]] — 같은 탭의 메뉴·기능 지도\n\n"]
        notes[f"{title}.md"] = render(title, intro, items, [s for _, _, s in items])

    # ② 개요 노트(머리말 + 탭 목차)
    toc = ["## 이 상세가이드의 구성\n\n"]
    for tab in tabs:
        toc.append(f"- [[{SYS} · {tab}|{tab}]] — 화면 {len(tabs[tab])}개\n")
    toc.append(f"- [[{SYS} 부록 · 연계·상태·검증]] — 화면 간 연계·상태전이·시나리오·검증 항목\n\n")
    toc.append("## 원자료 묶음\n\n")
    for fn, dt in doc_titles:
        toc.append(f"- `{fn}` — {dt}\n")
    toc.append("\n")
    notes[f"{SYS} 개요.md"] = render(f"{SYS} 개요", toc, head, [s for _, _, s in head])

    # ③ 부록 노트(문서레벨)
    notes[f"{SYS} 부록 · 연계·상태·검증.md"] = render(
        f"{SYS} 부록 · 연계·상태·검증",
        ["> 개별 화면 설명이 아니라 묶음 전체를 가로지르는 정리물(연계도·상태전이·권한·시나리오·검증 항목).\n\n"],
        meta, [s for _, _, s in meta])

    # ④ 누락 0 대사
    missing = src_lines - out_lines
    extra = out_lines - src_lines
    print(f"📊 원자료 {len(files)}개 · 탭 {len(tabs)}개 · 화면 {sum(len(v) for v in tabs.values())}개 "
          f"· 머리말 {len(head)} · 문서레벨 {len(meta)}")
    for tab, items in sorted(tabs.items(), key=lambda kv: -len(kv[1])):
        print(f"   · {tab}: 화면 {len(items)}개")
    if missing or extra:
        print(f"⛔ 누락 검증 실패 — 누락 {sum(missing.values())}줄 / 초과 {sum(extra.values())}줄")
        for ln, n in list(missing.items())[:5]:
            print(f"     누락 예: {ln[:70]!r} ×{n}")
        return 2
    print(f"✅ 누락 0 — 본문 {sum(src_lines.values())}줄이 모두 노트에 반영됨")

    if args.dry_run:
        print("\n[dry-run] 생성 예정 노트:")
        for fn, txt in notes.items():
            print(f"   {fn}  ({len(txt.splitlines())}줄)")
        return 0

    dst = vault / "40_시스템"
    dst.mkdir(parents=True, exist_ok=True)
    for fn, txt in notes.items():
        (dst / fn).write_text(txt, encoding="utf-8")
        print(f"   ✍ {fn}  ({len(txt.splitlines())}줄)")
    print(f"\n다음: python 01e_system_crosslink.py --vault {vault}  →  02_chunk_and_embed.py 재색인")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
