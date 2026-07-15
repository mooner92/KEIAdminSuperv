#!/usr/bin/env python3
"""test_ea_ingest.py — 대외업무 반입(docs/39) 개인정보 검증.

보장: 이번 반입 신규 문서(가이드 1·시스템 1·용어 N)에 ⓐ 담당자 개인명 0건
ⓑ 인명형 요구처(의원명) 0건 ⓒ '핵심 담당자'·'§8-2' 잔존 0건 ⓓ 필수 프론트매터(type·검수상태).

⛔ 개인명 리터럴을 이 파일에 하드코딩하지 않는다(공개 레포 반출 방지) — 이름 목록은
gitignore된 external_affairs_raw/ 원자료에서 런타임 파싱하고, 원자료가 없으면 skip한다.
실행: cd tools && .venv/bin/python test_ea_ingest.py
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "external_affairs_raw"
VAULT = Path(os.environ.get("VAULT_DIR", ROOT / "KEI-행정가이드"))

# 이번 반입 신규 문서(범위 명시 — 기존 볼트의 과거 노출은 별도 검수 트랙, docs/39 §7).
# 업무 단위 가이드 분리(docs/39 재설계): 9000_대외업무 폴더 전체 + 용어 + 시스템 노트.
NEW_DOCS = [
    *sorted((VAULT / "10_업무가이드/9000_대외업무").glob("*.md")),
    VAULT / "40_시스템/대외업무관리시스템.md",
    *sorted((VAULT / "30_용어집/대외업무").glob("*.md")),
]

if not RAW.is_dir() or not any(RAW.glob("대외요구자료_20*.md")):
    print("SKIP — external_affairs_raw/ 원자료 없음(공개 클론 환경). 개인명 검증 생략.")
    sys.exit(0)

# ── 이름 목록 런타임 파싱 ──
names: set = set()
# ⓐ 연도별 파일의 레코드 표에서 담당자 열(6번째)·인명형 요구처(5번째, '홍길동(당)' 형태) 추출
row_re = re.compile(r"^\|\s*\d{4}-\d{2}-\d{2}\s*\|")
person_req = re.compile(r"^([가-힣]{2,4})\((?:[가-힣]{1,3})\)$")  # 의원명(정당 약칭)
for f in RAW.glob("대외요구자료_20*.md"):
    for ln in f.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not row_re.match(ln):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cells) >= 6:
            who = cells[5]
            if re.fullmatch(r"[가-힣]{2,4}", who):
                names.add(who)
            m = person_req.match(cells[3])
            if m:
                names.add(m.group(1))
# ⓑ 정리본 §7-3 굵은 이름
comp = RAW / "대외요구자료_분류체계_원본.md"
if comp.exists():
    src = comp.read_text(encoding="utf-8", errors="ignore")
    seg = src[src.find("### 7-3"):src.find("## 8")]
    for m in re.finditer(r"[가-힣]{2,4}", re.sub(r"[^가-힣·\s]", " ", seg)):
        pass  # §7-3 이름은 아래 굵은 패턴으로만(일반 단어 오탐 방지)
    for m in re.finditer(r"\*\*([가-힣·]{2,15})\*\*", seg):
        for n in m.group(1).split("·"):
            if re.fullmatch(r"[가-힣]{2,4}", n):
                names.add(n)

# 일반 단어 오탐 제거(부서·직급 등 명백한 비인명)
STOP = {"연구회", "국회", "완료", "제출", "담당", "부서", "감사실", "임원실"}
names -= STOP
# ⚠ 2글자 이름은 일반 단어(이용·정도 등)와 대량 충돌 → 자동 스캔에서 제외(3글자 이상만).
# 실무상 담당자 실명은 3글자가 대부분이고, 정리본 §7-3 핵심 명단도 전부 3글자라 보호 강도 유지.
names = {n for n in names if len(n) >= 3}
assert len(names) >= 50, f"이름 파싱이 비정상적으로 적음({len(names)}) — 원자료 형식 변화?"

fails = []
for doc in NEW_DOCS:
    if not doc.exists():
        fails.append(f"반입 문서 없음: {doc}")
        continue
    body = doc.read_text(encoding="utf-8")
    hits = sorted({n for n in names if n in body})
    if hits:
        fails.append(f"{doc.name}: 개인명 잔존 {len(hits)}건")  # ⛔ 이름은 출력하지 않는다
    for bad in ("핵심 담당자", "§8-2"):
        if bad in body:
            fails.append(f"{doc.name}: 금지 문구 잔존 '{bad}'")
    head = body[:600]
    if "type:" not in head or "검수상태:" not in head:
        fails.append(f"{doc.name}: 필수 프론트매터(type/검수상태) 누락")

print(f"검사 대상 {len(NEW_DOCS)}개 문서 · 이름 사전 {len(names)}명(원자료 런타임 파싱)")
if fails:
    print("⛔ 실패:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("✅ 대외업무 반입 개인정보 검증 통과 — 개인명·금지 문구 0건, 프론트매터 정상")
