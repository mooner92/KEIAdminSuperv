#!/usr/bin/env python3
"""01m_deadlines.py — 규정 원문 상대기한 추출 (Track B: 기한 역산 타임라인).

원문을 **읽기 전용**으로 훑어 "[기준이벤트] 로부터/후 [N일/개월] 이내에 [의무]하여야 한다"류
상대기한을 구조화한다(원문 불변·재임베딩 불필요). 오프셋·방향은 정규식으로 정확히,
기준(anchor)·의무는 best-effort로 뽑고 **원문 문장**을 함께 저장해 사람이 검수 가능하게 한다.

  · type=마감  — '…부터 N일 이내에 제출/정산/보고' → 기준일 입력 시 마감일 = 기준일 ± N(결정적 계산)
  · type=기간한도 — 'N개월 이내로 한다'(기간 상한) → 기준일 입력 시 만료일 = 시작 + N

산출: tools/index/deadlines.json = {meta, deadlines:{규정명:[{조,의무,anchor,n,unit,dir,type,원문}]}}
용도: 웹 문서 드로어 '기한' 패널 — 기준일 입력 → 마감일 계산 + .ics(⛔ 오프셋은 원문 그대로,
      날짜 계산은 순수 산술, 기준일은 사용자 입력 → 추측 없음, 절대 규칙1 준수).

실행: python tools/01m_deadlines.py --vault KEI-행정가이드
"""
import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import vault_parse as vp

# 핵심: 숫자+단위+방향 (연·월·일·주). 방향으로 ±결정.
_CORE = re.compile(r"(\d+)\s*(일|주|개월|개월간|월|년|년간)\s*(이내|안에|이전|전까지|까지|전)")
# 기준(anchor) 종결 토큰 — 이 어미로 끝나는 앞 구절을 '기준 이벤트'로 본다.
_ANCHOR = re.compile(r"(로부터|부터|받은\s*날|종료\s*후|완료\s*후|종료후|완료후|접수한\s*날|접수일|"
                     r"개최일|익일|다음\s*날|지급일|신청일|임용일|계약일|통보|통고|승인을?\s*받은\s*날|후)")
# 의무 동사(마감의 대상 행위)
_DUTY = re.compile(r"(제출|통보|통지|정산|신고|납부|보고|완료|작성|처리|반납|시정|이의신청|연장|회신|퇴직|포기|신청)")
# 기준(anchor) 앞 잡음 절단 — 항마커·개행·주어조사(는/은/면)·연결어미
_ANCHOR_CUT = re.compile(r"[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕)）\n]|(?:는|은|면|하며|하고|하되|에는|에게)\s")


def _norm_dir(d: str) -> str:
    return "전" if d in ("이전", "전까지", "전") else "이내"


def _norm_unit(u: str) -> str:
    return {"개월간": "개월", "년간": "년"}.get(u, u)


def _anchor_of(window: str) -> str:
    """오프셋 앞 구절에서 기준 이벤트 명사구 추출(마지막 anchor 토큰까지, 앞 잡음 절단). 없으면 ''."""
    ms = list(_ANCHOR.finditer(window))
    if not ms:
        return ""
    frag = window[max(0, ms[-1].end() - 20): ms[-1].end()]   # anchor 토큰까지 짧은 명사구
    frag = _ANCHOR_CUT.split(frag)[-1]                        # 항마커·주어조사 뒤부터
    return re.sub(r"^[\s\d.)·,]+", "", frag).strip(" ,·")     # 앞 리스트마커·숫자 제거


def extract(vault: str):
    deadlines = {}
    n_total = n_dead = n_dur = 0
    unit_ct = Counter()
    for r in vp.iter_regulations(vault):
        rows = []
        for _label, _title, body in r["articles"]:
            for m in _CORE.finditer(body):
                n = int(m.group(1))
                unit = _norm_unit(m.group(2))
                direction = _norm_dir(m.group(3))
                after = body[m.end(): m.end() + 10]
                typ = "기간한도" if re.match(r"\s*[으로]?\s*로?\s*한다", after) else "마감"
                anchor = _anchor_of(body[max(0, m.start() - 42): m.start()])
                duty_m = _DUTY.search(body[m.end(): m.end() + 30])
                duty = duty_m.group(1) if duty_m else ""
                snippet = re.sub(r"\s+", " ", body[max(0, m.start() - 45): m.end() + 32]).strip()
                rows.append({
                    "조": _label, "의무": duty, "anchor": anchor,
                    "n": n, "unit": unit, "dir": direction, "type": typ,
                    "원문": snippet,
                })
                unit_ct[unit] += 1
                if typ == "마감":
                    n_dead += 1
                else:
                    n_dur += 1
                n_total += 1
        if rows:
            deadlines[r["규정명"]] = rows
    meta = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "규정수(기한보유)": len(deadlines), "기한총수": n_total,
        "마감기한": n_dead, "기간한도": n_dur,
        "단위분포": dict(unit_ct.most_common()),
    }
    return {"meta": meta, "deadlines": deadlines}


def main():
    ap = argparse.ArgumentParser(description="규정 상대기한 추출(Track B)")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--out", default=str(Path(__file__).parent / "index" / "deadlines.json"))
    args = ap.parse_args()
    data = extract(args.vault)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    m = data["meta"]
    print(f"✅ {args.out}")
    print(f"   규정 {m['규정수(기한보유)']} · 기한 {m['기한총수']} (마감 {m['마감기한']} · 기간한도 {m['기간한도']}) · 단위 {m['단위분포']}")


if __name__ == "__main__":
    main()
