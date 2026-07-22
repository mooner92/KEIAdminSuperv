#!/usr/bin/env python3
"""01m2_deadline_labels.py — 기한 사전 표시 라벨 생성(로컬 Qwen, 검증 게이트 포함).

배경(docs/57): 01m의 anchor는 정규식이 문장 중간을 자른 파편("대 3년의…"·"을 병가 종료일로부터")
이거나 빈 값(109건)이라 기한 사전 제목으로 못 쓴다. 로컬 Qwen3.5로 각 기한의 원문 문장에서
**사건(기준점)**과 **해야 할 일**을 짧은 한국어 라벨로 뽑는다.

⛔ 절대 규칙1 가드(라벨은 '표시용'일 뿐, 규정 값은 불변):
  · 기한 값(n·unit·dir)·원문·조는 결정적 추출 그대로 — LLM이 절대 안 바꿈(별도 파일에 라벨만).
  · 프롬프트: 원문 문장에 있는 정보만, 새 숫자·금액·기한 기술 금지.
  · 검증 게이트: ⓐ 라벨 속 숫자토큰이 원문에 없으면 폐기 ⓑ 길이 컷(사건≤28자·행동≤14자)
    ⓒ JSON 파싱 실패·빈 값 → 폐기. 폐기 시 웹은 기존 anchor로 폴백.
  · 산출물은 `검수: 자동(미검수)` 표시 — 정식 검수는 후속(docs/57 §6).

출력: tools/index/deadline_labels.json
  { "<규정명>|<조>|<n><unit><dir>|<원문앞40자>": {"사건": "...", "행동": "..."} }
실행: cd tools && .venv/bin/python 01m2_deadline_labels.py [--limit N] [--force]
"""
import argparse
import json
import os
import pathlib
import re
import sys
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "index" / "deadlines.json"
OUT = HERE / "index" / "deadline_labels.json"
BASE = os.environ.get("VLLM_BASE", "http://127.0.0.1:11436/v1")
MODEL = os.environ.get("LLM_MODEL", "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M")

SYSTEM = (
    "너는 사내 규정 기한의 '표시 라벨'을 만드는 도우미다. 규정 원문 문장 하나와 추출된 기한이 주어진다.\n"
    "원문 문장에 있는 정보만 사용해 다음 JSON만 출력하라(설명 금지):\n"
    '{"사건": "<기한의 기준점(무엇이 있고 나서부터인지), 명사구, 28자 이내>", "행동": "<기한 내 해야 할 일, 명사형, 14자 이내>"}\n'
    "규칙: ① 원문에 없는 내용·숫자·기간을 절대 만들지 마라 ② 기한 숫자(예: 5일, 2년)는 라벨에 넣지 마라 "
    "③ 사건은 '~한 날/때/후' 같은 기준점을 사람이 읽게 완성하라(조사 파편 금지) ④ 확실하지 않으면 빈 문자열."
)

FEWSHOT = [
    ("원문: ② 제1항에 따른 저축 연차휴가는 최대 3년의 저축 가능기간이 종료된 후 2년 이내에 사용하지 않거나, 퇴직 시까지 미사용한 저축연차는 소멸\n기한: 2년 이내",
     '{"사건": "저축 가능기간 종료 후", "행동": "저축연차 사용"}'),
    ("원문: 빙(진단서, 질병코드가 포함된 진료비 영수증, 검진기록 등)을 병가 종료일로부터 2주 이내에 제출하여야 하며, 특별한 사유없이 기한 내 제출하지 않\n기한: 2주 이내",
     '{"사건": "병가 종료일로부터", "행동": "증빙서류 제출"}'),
    ("원문: 야 한다. ② 계약담당부서는 검사가 완료된 후 위탁기관의 청구를 받은 날부터 5일 이내에 대가를 지급하여야\n기한: 5일 이내",
     '{"사건": "위탁기관의 청구를 받은 날부터", "행동": "대가 지급"}'),
]

# 2차 패스(재판정) — 1차에서 폐기된 항목: '이 숫자+단위가 정말 기한인가'부터 분류.
# 01m이 정의문("주4일 이내 출근")·빈도한도("주 4일까지 허용")·조건("임신 15주 이내인 경우")을
# 기한으로 오추출한 건 '기한아님'으로 판정 → 웹이 표시에서 제외(원본 deadlines.json은 불변).
REASSESS = (
    "너는 규정 문장 판정가다. 원문 문장과 추출된 '숫자+단위'가 주어진다. 다음 JSON만 출력하라:\n"
    '{"판정": "<마감|기간한도|기한아님>", "사건": "<기준점, 28자 이내>", "행동": "<할 일, 14자 이내>", "대상": "<무엇의 기간인지, 18자 이내>"}\n'
    "판정 기준: ① '마감'=어떤 사건 후 기한 내 해야 할 일이 있음 ② '기간한도'=어떤 것의 지속 기간 상한"
    "(예: 근무기간은 1년 이내로 한다) ③ '기한아님'=정의·자격조건·빈도 제한 등 기한이 아닌 것"
    "(예: 주4일 이내로 출근하는 제도, 임신기간이 15주 이내인 경우).\n"
    "규칙: 원문에 없는 내용 금지, 기한 숫자를 라벨에 넣지 마라, 해당 없는 필드는 빈 문자열."
)

REASSESS_FEWSHOT = [
    ("원문: 5. “재택근무제”라 함은 연구원으로 출근하지 아니하거나 주4일 이내로 출근하면서, 출근하지 않은 날에는 자택에서\n추출: 4일 이내",
     '{"판정": "기한아님", "사건": "", "행동": "", "대상": ""}'),
    ("원문: 제21조(근무기간 및 시간) ① 재택근무자의 근무기간은 1년 이내로 한다.\n추출: 1년 이내",
     '{"판정": "기간한도", "사건": "", "행동": "", "대상": "재택근무 근무기간"}'),
    ("원문: 1. 임신기간이 15주 이내인 경우 : 유산 또는 사산한 날부터 10일까지\n추출: 15주 이내",
     '{"판정": "기한아님", "사건": "", "행동": "", "대상": ""}'),
    ("원문: ①징계처분을 받은 자는 징계통보를 받은 후 15일 이내에 [별지 제5호 서식]에 따른 재심을 청구할 수 있다\n추출: 15일 이내",
     '{"판정": "마감", "사건": "징계통보를 받은 후", "행동": "재심 청구", "대상": ""}'),
]


def reassess(원문: str, 추출: str) -> dict:
    msgs = [{"role": "system", "content": REASSESS}]
    for u, a in REASSESS_FEWSHOT:
        msgs += [{"role": "user", "content": u}, {"role": "assistant", "content": a}]
    msgs.append({"role": "user", "content": f"원문: {원문}\n추출: {추출}"})
    body = json.dumps({"model": MODEL, "messages": msgs, "temperature": 0, "max_tokens": 140,
                       "reasoning_effort": "none"}).encode()
    req = urllib.request.Request(f"{BASE}/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        c = json.load(r)["choices"][0]["message"]["content"]
    m = re.search(r"\{.*\}", c, re.S)
    return json.loads(m.group(0)) if m else {}


def ask(원문: str, 기한: str) -> dict:
    msgs = [{"role": "system", "content": SYSTEM}]
    for u, a in FEWSHOT:
        msgs += [{"role": "user", "content": u}, {"role": "assistant", "content": a}]
    msgs.append({"role": "user", "content": f"원문: {원문}\n기한: {기한}"})
    body = json.dumps({"model": MODEL, "messages": msgs, "temperature": 0, "max_tokens": 120,
                       "reasoning_effort": "none"}).encode()
    req = urllib.request.Request(f"{BASE}/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        c = json.load(r)["choices"][0]["message"]["content"]
    m = re.search(r"\{.*\}", c, re.S)
    return json.loads(m.group(0)) if m else {}


def validate(label: dict, 원문: str) -> dict | None:
    사건 = re.sub(r"\s+", " ", str(label.get("사건", ""))).strip()
    행동 = re.sub(r"\s+", " ", str(label.get("행동", ""))).strip()
    if not 사건 or len(사건) > 28 or len(행동) > 14:
        return None
    # 환각 차단: 라벨의 숫자 토큰은 원문에 실제로 있어야(새 수치 생성 금지)
    src = 원문.replace(" ", "")
    for tok in re.findall(r"\d+", 사건 + 행동):
        if tok not in src:
            return None
    return {"사건": 사건, "행동": 행동}


def key_of(reg: str, e: dict) -> str:
    return f"{reg}|{e['조']}|{e['n']}{e['unit']}{e['dir']}|{e['원문'][:40]}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="앞 N건만(시험용)")
    ap.add_argument("--force", action="store_true", help="기존 라벨도 재생성")
    ap.add_argument("--reassess", action="store_true",
                    help="2차 패스: 1차 폐기(빈 라벨) 항목만 재판정(마감|기간한도|기한아님 + 대상)")
    args = ap.parse_args()

    data = json.loads(SRC.read_text(encoding="utf-8"))
    labels: dict = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() and not args.force else {}

    items = [(reg, e) for reg, v in data["deadlines"].items() for e in v]
    if args.limit:
        items = items[: args.limit]
    done = skip = fail = 0
    for i, (reg, e) in enumerate(items):
        k = key_of(reg, e)
        기한 = f"{e['n']}{e['unit']} {'전까지' if e['dir'] == '전' else '이내'}"
        if args.reassess:
            # 폐기분(빈 dict)만 재판정 — 유효 라벨·이미 판정된 항목은 유지
            if labels.get(k):
                skip += 1
                continue
            try:
                r = reassess(e["원문"], f"{e['n']}{e['unit']} {e['dir']}")
                판정 = str(r.get("판정", "")).strip()
                if 판정 == "기한아님":
                    labels[k] = {"판정": "기한아님"}
                    done += 1
                elif 판정 in ("마감", "기간한도"):
                    lab = validate({"사건": r.get("사건", ""), "행동": r.get("행동", "")}, e["원문"]) or {}
                    대상 = re.sub(r"\s+", " ", str(r.get("대상", ""))).strip()[:18]
                    # 대상 숫자 게이트(사건·행동과 동일)
                    if any(t not in e["원문"].replace(" ", "") for t in re.findall(r"\d+", 대상)):
                        대상 = ""
                    ent = {"판정": 판정, **lab}
                    if 대상:
                        ent["대상"] = 대상
                    if lab or 대상:
                        labels[k] = ent
                        done += 1
                    else:
                        fail += 1  # 판정만 있고 쓸 라벨이 없으면 유지(폴백)
                else:
                    fail += 1
            except Exception as ex:  # noqa: BLE001
                print(f"  ⚠ [{i}] {reg} {e['조']}: {ex}", file=sys.stderr)
                fail += 1
            continue
        if k in labels and labels[k]:
            skip += 1
            continue
        try:
            lab = validate(ask(e["원문"], 기한), e["원문"])
        except Exception as ex:  # noqa: BLE001
            print(f"  ⚠ [{i}] {reg} {e['조']}: {ex}", file=sys.stderr)
            lab = None
        if lab:
            labels[k] = lab
            done += 1
        else:
            labels[k] = {}  # 폐기 기록(재실행 시 skip 안 되게 빈 값 유지·--force로 재시도)
            fail += 1
        if (done + fail) % 20 == 0:
            OUT.write_text(json.dumps(labels, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  … {i + 1}/{len(items)} (신규 {done} · 폐기 {fail} · 기존 {skip})")
    OUT.write_text(json.dumps(labels, ensure_ascii=False, indent=1), encoding="utf-8")
    ok = sum(1 for v in labels.values() if v)
    excl = sum(1 for v in labels.values() if v.get("판정") == "기한아님")
    print(f"\n라벨 {ok}/{len(labels)} 유효 · 기한아님 {excl} (이번 실행: 처리 {done} · 실패/유지 {fail} · 스킵 {skip}) → {OUT}")
    print("다음: web 재빌드(정적이라 빌드타임 반영) — 검수상태는 '자동(미검수)'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
