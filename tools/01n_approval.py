#!/usr/bin/env python3
"""01n_approval.py — 위임전결규정 별표(전결권한 ○-매트릭스) 파싱 (Track B: 결재선 판정기).

위임전결규정 별표는 4개 섹션의 표로, 각 행이
  구분(대분류) | 직무내용(업무·직급) | 과제책임자 | 실·팀장 | 부서장 | 부원장 | 원장
이고, ○가 찍힌 열이 그 업무·신청자직급의 **전결권자**다('○:연/경'은 연구/경영 협의).
섹션마다 레벨 라벨이 조금씩 다르므로(예 실장 vs 실·팀장) 각 섹션 서브헤더를 읽어 매핑한다.

산출: tools/index/approval.json = {meta, rules:[{구분,업무,대상,전결권자,협의,원장,원문행}]}
용도: 웹 '결재선 판정기' — 업무·직급으로 필터 → 전결권자 즉답. ⛔ 공식 전결기준(별표 원문)이며,
      실무 결재선은 부서마다 다를 수 있어 UI에 "실제 결재선은 부서 확인" 면책을 함께 노출한다.

실행: python tools/01n_approval.py --vault KEI-행정가이드
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import vault_parse as vp

_REG = "위임전결규정"
_MAIN_HDR = re.compile(r"^\|\s*구\s*분\s*\|\s*직무내용\s*\|\s*전결권자\s*\|\s*원장\s*\|")
_MARK = re.compile(r"[○●◯]")
_TOP = re.compile(r"^[가-힣]\.")       # 가.출장
_SUB = re.compile(r"^\d+\)")           # 1) 국내 출장
_LEAF = re.compile(r"^-\s*")           # - 부서장/센터장
# leaf 행 중 '신청자 직급'인 것(정확 일치). 그 외 leaf(금액구간·문서종류·범위 등)는 조건 → 업무 경로에 편입.
_ROLE = re.compile(r"^(부원장|부서장/센터장|부서장|센터장|실[･·\s]?팀장|실장|팀장|일반직원|"
                   r"비정규직(\(연구직\))?|정규직|과제책임자|일용직)$")


def _cells(line: str):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _clean_level(s: str) -> str:
    return re.sub(r"\((담당|연/경)\)", "", s).strip()


def _find_reg_file(vault: str):
    for md in Path(vault).rglob("*.md"):
        meta, _ = vp.split_frontmatter(md.read_text(encoding="utf-8"))
        if meta.get("규정명") == _REG:
            return md
    return None


def parse(vault: str):
    md = _find_reg_file(vault)
    if not md:
        return {"meta": {"error": f"{_REG} 파일 없음"}, "rules": []}
    lines = md.read_text(encoding="utf-8").splitlines()

    rules = []
    i = 0
    n_sections = 0
    while i < len(lines):
        if not _MAIN_HDR.match(lines[i]):
            i += 1
            continue
        # 섹션 시작: main header(i) → separator(i+1) → 레벨 서브헤더(i+2)
        n_sections += 1
        sub = _cells(lines[i + 2]) if i + 2 < len(lines) else []
        levels = [_clean_level(c) for c in sub] + ["원장"]   # 데이터 col2..6 매핑
        # '(연/경)' 협의가 라벨에 붙은 열 표시
        consult_col = {k for k, c in enumerate(sub) if "연/경" in c}
        구분 = 업무top = 업무sub = ""
        j = i + 3
        while j < len(lines):
            ln = lines[j]
            if not ln.strip().startswith("|"):
                break
            if _MAIN_HDR.match(ln):
                break
            cs = _cells(ln)
            if len(cs) < 3 or set("".join(cs)) <= set("-| "):   # 구분선/빈행
                j += 1
                continue
            if cs[0]:
                구분 = cs[0]
            dut = cs[1]
            if _TOP.match(dut):
                업무top, 업무sub = dut, ""
            elif _SUB.match(dut):
                업무sub = dut
            # ○ 위치 → 전결권자
            marks = [k for k in range(2, min(len(cs), 7)) if _MARK.search(cs[k])]
            if marks:
                col = marks[-1]                        # 가장 오른쪽(상위) 전결권자
                lvl_idx = col - 2
                권자 = levels[lvl_idx] if 0 <= lvl_idx < len(levels) else "?"
                cell = cs[col]
                협의 = ""
                m = re.search(r"[○●◯]\s*[:：]?\s*(연/경|연|경)", cell)
                if m:
                    협의 = m.group(1)
                elif lvl_idx in consult_col:
                    협의 = "연/경"
                is_leaf = bool(_LEAF.match(dut))
                leaf_txt = re.sub(_LEAF, "", dut).strip() if is_leaf else ""
                # leaf가 직급이면 대상, 아니면 조건(금액구간 등) → 업무 경로 끝에 붙여 검색·표시 가능하게
                대상 = leaf_txt if (is_leaf and _ROLE.match(leaf_txt)) else ""
                cond = leaf_txt if (is_leaf and not 대상) else ""
                업무 = " > ".join(x for x in [업무top, 업무sub, cond] if x) or (dut if not is_leaf else "")
                rules.append({
                    "구분": 구분, "업무": 업무 or dut, "대상": 대상,
                    "전결권자": 권자, "협의": 협의, "원장": 권자 == "원장",
                    "원문행": re.sub(r"\s+", " ", ln.strip()),
                })
            j += 1
        i = j

    meta = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "규정": _REG, "섹션수": n_sections, "규칙수": len(rules),
        "전결권자분포": _dist(rules),
    }
    return {"meta": meta, "rules": rules}


def _dist(rules):
    d = {}
    for r in rules:
        d[r["전결권자"]] = d.get(r["전결권자"], 0) + 1
    return dict(sorted(d.items(), key=lambda x: -x[1]))


def main():
    ap = argparse.ArgumentParser(description="위임전결 별표 파싱(Track B 결재선)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--out", default=str(Path(__file__).parent / "index" / "approval.json"))
    args = ap.parse_args()
    data = parse(args.vault)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    m = data["meta"]
    print(f"✅ {args.out}")
    print(f"   섹션 {m.get('섹션수')} · 규칙 {m.get('규칙수')} · 전결권자 분포 {m.get('전결권자분포')}")


if __name__ == "__main__":
    main()
