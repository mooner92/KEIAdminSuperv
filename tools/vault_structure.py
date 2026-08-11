#!/usr/bin/env python3
"""vault_structure.py — 볼트 분류 구조의 **단일 정본** (specs/14 A).

배경: 같은 분류 표가 두 곳에 있었다 — `20_규정원문/README.md`(사람이 읽는 표)와
`01_hwp_to_md.py` 상수. 둘이 갈라지면 "문서가 엉뚱한 폴더로 간다"가 조용히 생긴다.
이제 **md 표가 정본**이고 코드는 그것을 읽는다. 새 폴더가 필요하면 표에 한 줄 추가하면 된다.

⛔ 폴백은 유지한다 — README를 못 읽어도(파일 손상·경로 변경) 배치가 멈추면 안 된다.
   폴백이 쓰였는지는 `folders()`의 두 번째 반환값으로 알 수 있다(로그에 남긴다).
"""
from __future__ import annotations

import re
from pathlib import Path

# 폴백(= 2026-08-04 시점 README 표와 동일). ⚠ 여기가 아니라 README를 고칠 것.
FALLBACK = {"1": "1000_기관", "2": "2000_감사·규정", "3": "3000_인사", "4": "4000_보수·여비",
            "5": "5000_연구·정보", "6": "6000_총무·보안·회계", "7": "6000_총무·보안·회계"}
UNCLASSIFIED = "0000_미분류"
GUIDE_ROOT = "10_업무가이드"
REG_ROOT = "20_규정원문"

# | `1000_기관/` | 1 | 기관·정관·이사회 |   ← 폴더 셀에서 이름, 두 번째 셀에서 첫 자리(들)
_ROW = re.compile(r"^\|\s*`?([0-9]{4}_[^`|/]+)/?`?\s*\|\s*([0-9,\s]+)\s*\|", re.MULTILINE)


def folders(vault: str | Path) -> tuple[dict, str]:
    """({첫자리: 폴더명}, 출처). 출처 = 'README' | 'fallback' — 어느 쪽이 쓰였는지 기록용."""
    readme = Path(vault) / REG_ROOT / "README.md"
    try:
        rows = _ROW.findall(readme.read_text(encoding="utf-8"))
        out: dict = {}
        for name, digits in rows:
            for d in re.findall(r"[0-9]", digits):
                out[d] = name.strip()
        if out:
            return out, "README"
    except Exception:  # noqa: BLE001 — 표를 못 읽는 것이 배치를 멈추게 하면 안 된다
        pass
    return dict(FALLBACK), "fallback"


def reg_no_of(name: str, body: str = "") -> str:
    """규정번호 4자리 — ① 파일명 맨 앞 4자리 ② 본문 머리 'NNNN-한글'(01_hwp_to_md와 같은 규칙)."""
    m = re.match(r"\s*([1-7][0-9]{3})", name or "")
    if m:
        return m.group(1)
    m = re.search(r"\b([1-7][0-9]{3})\s*[-–—]\s*[가-힣]", (body or "")[:400])
    return m.group(1) if m else ""


def place(vault: str | Path, doc_type: str, name: str, body: str = "") -> tuple[str, str, str]:
    """편입 경로 결정 → (하위경로, 규정번호, 사유).
    ⚠ 업로드 승인이 무조건 0000_미분류로 넣던 것(specs/14 §0)을 대체하는 함수다.
    사유 문자열은 그대로 로그·화면에 나간다 — 왜 그 폴더인지 사람이 알 수 있어야 한다."""
    if doc_type != "regulation":
        return f"{GUIDE_ROOT}/{UNCLASSIFIED}", "", "가이드는 규정번호 체계가 없어 미분류(사람이 이동)"
    no = reg_no_of(name, body)
    if not no:
        return f"{REG_ROOT}/{UNCLASSIFIED}", "", "규정번호를 찾지 못함(파일명 4자리·본문 머리 모두 없음)"
    table, src = folders(vault)
    folder = table.get(no[0])
    if not folder:
        return f"{REG_ROOT}/{UNCLASSIFIED}", no, f"규정번호 {no}의 첫 자리가 구조 표에 없음({src})"
    return f"{REG_ROOT}/{folder}", no, f"규정번호 {no} → {folder} ({src} 표 기준)"


if __name__ == "__main__":  # 점검용: 현재 구조 표 출력
    import sys
    v = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).resolve().parent.parent / "KEI-행정가이드")
    t, src = folders(v)
    print(f"구조 출처: {src}")
    for k in sorted(t):
        print(f"  {k}xxx → {t[k]}")
