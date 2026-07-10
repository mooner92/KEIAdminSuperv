#!/usr/bin/env python3
"""hwp_tables.py — HWP/HWPX 표의 '셀 내 문단 경계'를 보존하는 패치 (지렛대 ①, docs/23 §1).

문제(실측): hwp-hwpx-parser는 셀 안의 여러 문단을 구분자 없이(.hwpx는 "", .hwp는 " ") 이어붙여
'본인/자녀'와 '5/1'이 "본인자녀"·"51"로 병합된다 — 부모상 경조금 300만 오답(docs/22 §0 #3)의 근원.
원본에는 구조가 온전하므로(hwpx=OWPML XML의 <hp:p> 문단, hwp=레코드 단위 문단) 문단 경계를
`<br>`로 보존하면 결정적(무환각) 복원이 된다. VLM 불필요.

사용:
    from hwp_tables import install_paragraph_preserving_tables
    install_paragraph_preserving_tables()   # 이후의 read()/get_tables()/extract_text() 모두 적용

⚠ hwp-hwpx-parser==1.0.0 내부 API에 의존(몽키패치). 파서 업그레이드 시 아래 self-test로 재검증:
    .venv/bin/python tools/hwp_tables.py <파일.hwpx|.hwp>
"""
from __future__ import annotations

CELL_BR = "<br>"           # 마크다운 표 셀 내 줄바꿈 표준 표기(웹 렌더·LLM 모두 해석 가능)
_SENT = "␟"           # hwp5 경로용 내부 문단 경계 센티널(최종 출력에 남지 않음)

_installed = False


def install_paragraph_preserving_tables() -> None:
    """파서의 셀 텍스트 추출을 문단 보존 방식으로 교체(멱등)."""
    global _installed
    if _installed:
        return
    from hwp_hwpx_parser import hwp5 as _h5
    from hwp_hwpx_parser import hwpx as _hx

    # ── HWPX: <hp:tc> 안의 <hp:p> 문단별로 수집해 <br> 조인 ──────────────
    def _cell_text_direct(self, tc_elem):
        paras = []
        for p in tc_elem.iter():
            if self._local_name(p.tag) != "p":
                continue
            texts = []
            self._collect_cell_text_with_notes(p, texts)
            t = "".join(texts).strip()
            if t:
                paras.append(t)
        if paras:
            return CELL_BR.join(paras)
        # 문단이 없으면(중첩표 등) 원 방식 폴백
        texts = []
        self._collect_cell_text_with_notes(tc_elem, texts)
        return "".join(texts).strip()

    _hx.HWPXReader._extract_cell_text_direct = _cell_text_direct

    # ── HWP5: 문단 디코더에 센티널을 붙이고, 셀 조인 후 센티널을 <br>로 치환 ──
    orig_decode = _h5.HWP5Reader._decode_cell_paragraph_with_markers
    orig_cell = _h5.HWP5Reader._extract_cell_text

    def _decode_with_sentinel(self, record_data, records, options):
        return orig_decode(self, record_data, records, options) + _SENT

    def _cell_text(self, records, start_idx, options):
        raw = orig_cell(self, records, start_idx, options)
        # 원 조인은 " " — 센티널 기준으로 문단을 복원하고 잔여 센티널 제거
        parts = [p.strip() for p in raw.split(_SENT)]
        parts = [p for p in parts if p]
        return CELL_BR.join(parts)

    _h5.HWP5Reader._decode_cell_paragraph_with_markers = _decode_with_sentinel
    _h5.HWP5Reader._extract_cell_text = _cell_text
    _installed = True


if __name__ == "__main__":
    import sys

    import hwp_hwpx_parser as h

    install_paragraph_preserving_tables()
    path = sys.argv[1]
    r = h.read(path)
    for i, t in enumerate(r.tables):
        print(f"\n=== 표 {i}: {t.row_count}행 × {t.col_count}열")
        print(t.to_markdown()[:600])
