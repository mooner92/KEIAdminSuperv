#!/usr/bin/env python3
"""verify_trust_gates.py — P0 신뢰 게이트 종합 라이브 E2E (docs/22 §5 수용기준).

페르소나 라운드 실측 오답 5건을 dev API(9001)에 재연해 게이트 작동을 판정한다.
LLM 표현은 변동하므로 판정은 결정적 산출물(마커·앵커·경고문) + 오답 부재 중심.

  #1 무근거 수치(근무일수) → 단정 없음 또는 ⚠️ 수치 경고
  #3 깨진 표(부모상 경조금) → 표깨짐 마커 + 단정 회피/유보 문구, '300만' 무단정
  #4 자격 역추론(1년 미만 퇴직금) → scope_anchor(제1~2조) 첨부 + '받을 수 있다' 단정 없음
  #5 시스템 귀속(문서수발) → 그룹웨어 귀속, ERP 오귀속 없음
  대조군: 숙박비 상한(정상 값 3종) → 무경고 정답 / 경조휴가(표 셀 값) → 무경고

실행: python3 tools/verify_trust_gates.py  (kei-rag-api-dev 9001 + 테스트 계정)
"""
import http.cookiejar
import json
import os
import re
import sys
import urllib.request

BASE = os.environ.get("APP_TEST_BASE", "http://127.0.0.1:9001/app")
USER = os.environ.get("APP_TEST_USER", "admintest")
PASS = os.environ.get("APP_TEST_PASS", "admtest123")
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(op.open(req, timeout=600).read())


def ask(cid, q):
    a = post(f"/chats/{cid}/messages", {"content": q})["assistant"]
    return a["content"], a.get("sources", [])


def main():
    post("/auth/login", {"username": USER, "password": PASS})
    ok = 0

    # 시나리오 간 맥락 오염 방지 — 케이스마다 새 챗
    def fresh():
        return post("/chats", {})["id"]

    # #1 무근거 수치: 연간 근무일수(코퍼스에 없음)
    body, _ = ask(fresh(), "연간 근무일수가 총 며칠이야?")
    first = body.splitlines()[0]
    # 리뷰 반영: 본문 전체에서 2~3자리 일수/주수 단정 검사(첫 줄 한정·3자리 한정은 느슨)
    asserted = re.search(r"근무[일주]수는?[^\n]{0,20}?\d{2,3}\s*(일|주)", body) and "확인되지 않" not in body
    warned = "수치 확인 필요" in body
    assert (not asserted) or warned, f"#1 무근거 근무일수 단정: {first}"
    ok += 1
    print(f"  ✅ #1 무근거 수치 — 단정 없음{' + ⚠️경고' if warned else ''}")

    # #3 경조금 표: docs/28 과업 B에서 표를 행 분리 복원(사용자 승인 반영, 2026-07-13).
    # 복원 전 불변식은 "표깨짐 마커 + 유보 동반"이었으나, 복원 후 불변식은
    # "마커 없음 + 정답(부모상 50만원) + 300만 원(본인 사망) 오결합 없음"이다.
    body, srcs = ask(fresh(), "부모상 당하면 경조금 얼마 받아?")
    first = body.splitlines()[0]
    marked = any(s.get("표깨짐") for s in srcs)
    assert not marked, f"#3 복원된 표에 표깨짐 마커 잔존: {[s.get('규정명') for s in srcs]}"
    assert re.search(r"50\s*만\s*원|500,000", body), f"#3 부모상 경조금 정답(50만원) 없음: {first}"
    assert not re.search(r"3,000,000\s*원?\s*(?:입니다|이다|을 받)", first), f"#3 본인 사망 값 오결합: {first}"
    ok += 1
    print("  ✅ #3 복원 표 — 마커 없음 + 부모상 50만원 정답 + 오결합 없음")

    # #4 자격 역추론: 1년 미만 퇴직금(제2조: 1년 이상 적용)
    body, srcs = ask(fresh(), "저 계약직인데 계약기간이 1년이 안 돼요. 퇴직금 받을 수 있나요?")
    first = body.splitlines()[0]
    anchored = any(s.get("scope_anchor") and "퇴직금규정" in (s.get("규정명") or "") for s in srcs)
    false_pos = ("받을 수 있" in first) and ("없" not in first) and ("확인되지 않" not in first)
    assert anchored, f"#4 퇴직금규정 적용범위 미앵커: {[s.get('규정명') for s in srcs]}"
    assert not false_pos, f"#4 거짓 긍정 재발: {first}"
    ok += 1
    print("  ✅ #4 자격 역추론 — 적용범위 앵커 + 거짓 긍정 없음")

    # #5 시스템 귀속: 공문 시행·접수(그룹웨어 문서수발) — 페르소나 실측 질문 그대로.
    # ⚠ 알려진 한계(P1 후보): '문서수발' 단독 질의는 밀집 검색이 그룹웨어 노트를 회수하지 못함(검색 갭).
    body, srcs = ask(fresh(), "공문 시행이랑 접수는 어느 시스템 어디 메뉴에서 해?")
    corrected = "시스템 확인" in body  # P0-4 백스톱이 오귀속을 교정한 경우도 합격
    assert ("그룹웨어" in body) or corrected, f"#5 그룹웨어 미언급: {body.splitlines()[0][:90]}"
    # 리뷰 반영: 교정 노트가 붙었어도 '올바른 소속(그룹웨어)'이 본문 또는 노트에 반드시 있어야 함
    if corrected:
        assert "그룹웨어" in body, "#5 교정 노트에 정답 시스템 부재"
    else:
        assert not re.search(r"ERP[^\n]{0,12}문서수발", body), "#5 ERP 오귀속 미교정"
    ok += 1
    print(f"  ✅ #5 시스템 귀속 — 그룹웨어 정답{' (백스톱 교정)' if corrected else ''}")

    # 대조군 A: 숙박비 상한(별표2 정상 값) — 무경고 + 값 제시
    body, _ = ask(fresh(), "국내 출장 숙박비 상한이 얼마야?")
    assert "수치 확인 필요" not in body, f"대조군A 과차단: {body[-200:]}"
    assert re.search(r"(10만|100,000)", body), "대조군A 값 미제시"
    ok += 1
    print("  ✅ 대조군A 숙박비 — 정상 값 무경고")

    # 대조군 B: 부연구위원 일비(별표1→2 결합, 과거 로그 11회 실패 질문) — 핵심 값(25,000원)은
    # 경고 대상이 아니어야 함. (모델이 덧붙인 '예시 값'이 근거에 없어 경고되는 건 참양성 — 허용)
    body, _ = ask(fresh(), "부연구위원 일비는 얼마야?")
    assert re.search(r"(25,000|2만\s*5천)", body), f"대조군B 값 미제시: {body.splitlines()[0][:90]}"
    warn_line = next((l for l in body.splitlines() if "수치 확인 필요" in l), "")
    assert "25,000원" not in warn_line, f"대조군B 핵심 값 과차단: {warn_line[:160]}"
    ok += 1
    print(f"  ✅ 대조군B 일비 — 핵심 값 무경고{' (부가 예시 값 경고=참양성)' if warn_line else ''}")

    print(f"\n✅ {ok}/6 판정 통과 — P0 신뢰 게이트 (docs/22 §5)")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"\n❌ 실패: {e}")
        sys.exit(1)
