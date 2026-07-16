#!/usr/bin/env python3
"""01h — 규정 정의 조항에서 행정용어를 추출해 용어집 노트 생성 (docs/49).

⛔ 절대 규칙 1(지어내기 금지) 준수: 정의문은 규정 원문을 그대로 인용한다.
  - 패턴 A: "X"란 …을 말한다  (제N조 정의 조항)
  - 패턴 B: …(이하 "X"라 한다) — 선언 문장(원문 줄)을 통째로 인용
후보는 코드 내 ALLOWLIST(사람 큐레이션 — 약칭 선언·위원회명·자명어 제외)만 생성.

실행: python tools/01h_defs_to_terms.py --vault KEI-행정가이드 [--dry]
출력: 30_용어집/규정정의/<용어>.md (검수상태: 미검수)
"""
import argparse
import pathlib
import re
import unicodedata

# 용어 → (분류, 원출처 규정 stem 매칭 힌트) — 사람 큐레이션 결과(2026-07-16)
ALLOWLIST = {
    # 감사
    "감사인": ("감사", "내부감사규정"),
    "협동감사제도": ("감사", "내부감사규정"),
    "감독관청": ("감사", "내부감사규정"),
    # 윤리·행동강령
    "금품등": ("윤리·행동강령", "행동강령"),
    "직무관련자": ("윤리·행동강령", "행동강령"),
    "직무관련임직원": ("윤리·행동강령", "행동강령"),
    "외부강의등": ("윤리·행동강령", "행동강령"),
    "초과사례금": ("윤리·행동강령", "행동강령"),
    "행동강령책임관": ("윤리·행동강령", "행동강령"),
    "사적이해관계자": ("윤리·행동강령", "퇴직자"),
    "이해충돌방지담당관": ("윤리·행동강령", "이해충돌"),
    # 인권·고충
    "성희롱": ("인권·고충", "성희롱"),
    "성폭력": ("인권·고충", "성희롱"),
    "직장 내 괴롭힘": ("인권·고충", "인권경영"),
    "인권경영": ("인권·고충", "인권경영"),
    "인권침해행위": ("인권·고충", "인권경영"),
    # 연구윤리
    "연구부정행위": ("연구윤리", "연구윤리"),
    # 저작권
    "공공누리": ("저작권", "공공저작물"),
    "2차적저작물": ("저작권", "공공저작물"),
    "저작재산권": ("저작권", "공공저작물"),
    "비독점적 이용허락": ("저작권", "공공저작물"),
    "재이용허락": ("저작권", "공공저작물"),
    # 보안·개인정보
    "비밀": ("보안", "보안관리규정"),
    "개인정보 보호책임자": ("개인정보", "개인정보보호지침"),
    "개인정보취급자": ("개인정보", "개인정보보호지침"),
    # 복무·문서·회계·기관
    "대체휴일": ("복무", "복무규정"),
    "시행문": ("문서", "문서관리규정"),
    "불용품": ("회계·계약", "물품"),
    "수의계약": ("회계·계약", "퇴직자"),
    "예산책임자": ("회계·계약", "회계규정"),
    "정부출연연구기관": ("기관", "정부출연연구기관등의설립"),
}

PAT_A = re.compile(r'["“]([가-힣A-Za-z0-9·\s]{2,14})["”]\s*(?:이)?란[,\s]*')
PAT_B = re.compile(r'\(이하\s*["“]([가-힣A-Za-z0-9·\s]{2,12})["”]\s*(?:이)?라\s*한다\)')
ART = re.compile(r'^(제\s*\d+조(?:의\d+)?)')

def norm(t: str) -> str:
    return unicodedata.normalize("NFC", t.replace(" ", ""))

def find_definition(lines, idx, term, pattern):
    """정의 줄 + '다음 각 목/호' 연속 항목(들여쓰기 줄 최대 8개)을 원문 그대로 수집."""
    out = [lines[idx].strip()]
    if re.search(r"다음\s*각\s*[목호]", lines[idx]):
        j = idx + 1
        while j < len(lines) and len(out) < 9:
            ln = lines[j]
            if re.match(r"^\s+(?:[가-힣]\.|\d+\.|[①-⑳])", ln) or (ln.startswith("  ") and ln.strip()):
                out.append(ln.rstrip())
                j += 1
            else:
                break
    return "\n".join(out)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", default="KEI-행정가이드")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    vault = pathlib.Path(args.vault)
    src_dir = vault / "20_규정원문"
    out_dir = vault / "30_용어집" / "규정정의"
    existing = {norm(p.stem) for p in (vault / "30_용어집").rglob("*.md")}

    made = []
    remaining = dict(ALLOWLIST)
    for f in sorted(src_dir.rglob("*.md")):
        text = f.read_text(encoding="utf-8")
        lines = text.splitlines()
        reg_name = f.stem.split("_", 1)[-1]
        cur_art = ""
        for i, line in enumerate(lines):
            m = ART.match(line.strip())
            if m:
                cur_art = m.group(1).replace(" ", "")
            for pat in (PAT_A, PAT_B):
                for t in pat.findall(line):
                    term = t.strip()
                    if term not in remaining:
                        continue
                    cat, hint = remaining[term]
                    if hint not in f.stem:
                        continue
                    if norm(term) in existing:
                        remaining.pop(term)
                        continue
                    quote = find_definition(lines, i, term, pat)
                    art_label = cur_art or ""
                    anchor = f"#{art_label}" if art_label else ""
                    q_md = "\n".join("> " + l for l in quote.splitlines())
                    note = f"""---
type: term
용어: "{term}"
영문: ""
분류: "{cat}"
관련규정: ["{reg_name}"]
원본파일: "20_규정원문/{f.relative_to(src_dir)} {art_label}(정의 조항 자동 추출 01h)"
태그: ["행정용어", "규정정의"]
검수상태: 미검수
---

# {term}

> [!quote] 규정 원문 — [[{f.stem}{anchor}|{reg_name} {art_label}]]
{q_md}

*관련: [[{f.stem}]]*
"""
                    made.append((term, f.stem, art_label))
                    remaining.pop(term)
                    if not args.dry:
                        out_dir.mkdir(parents=True, exist_ok=True)
                        safe = term.replace("/", "·")
                        (out_dir / f"{safe}.md").write_text(note, encoding="utf-8")
    print(f"생성 {len(made)}건 → {out_dir}")
    for t, s, a in made:
        print(f"  • {t} ← {s} {a}")
    if remaining:
        print("⚠ 미발견(수동 확인 필요):", ", ".join(remaining))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
