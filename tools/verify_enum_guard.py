#!/usr/bin/env python3
"""verify_enum_guard.py — 라이브 E2E: 멀티턴 재작성 가드 + 개수·전수 질문 단정 방지.

session 42 실측 결함 시나리오를 dev API(9001)에 그대로 재연해 판정한다:
  ① 개수 질문 첫 줄에 '검색된 근거 기준' 한정 문구가 있고, '총 N개 규정/존재' 단정이 없다(독립 검사).
  ② 답변이 전체 확인 경로(규정 둘러보기·담당 부서)를 안내한다.
  ③ 주제 전환 턴("인사 위원회, 징계 위원회…")에서 인사규정이 회수되고 거짓 부정이 없다(본문 전체 검사).
  ④ 대조군(비집계 단건 질문)에 집계용 한정 문구가 오발동하지 않는다.

실행: python3 tools/verify_enum_guard.py  (kei-rag-api-dev 9001 + 테스트 계정 필요)
계정은 APP_TEST_USER/APP_TEST_PASS 환경변수로 주입(기본: dev 전용 admintest).
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

# '총 N개가 규정/존재/운영되어 있다'류 무한정 단정(한정 여부와 무관하게 금지 — SYSTEM 규칙 11)
BARE_TOTAL_RE = re.compile(r"총?\s*\d+\s*개(의)?[\s가-힣]{0,12}(규정되|존재합|존재하|운영되)")
QUALIFIERS = ("검색된 근거", "근거에서", "전체 목록 아님", "전체 아님")


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(op.open(req, timeout=600).read())


def main():
    post("/auth/login", {"username": USER, "password": PASS})
    cid = post("/chats", {})["id"]
    print(f"E2E chat #{cid}")
    checks = 0

    # ①② 개수·전수 질문 — 한정 문구 + 단정 금지 + 전체 확인 안내
    for q in ["위원회 몇개있어?", "모든 위원회 목록을 뽑아줘"]:
        a = post(f"/chats/{cid}/messages", {"content": q})["assistant"]
        body, first = a["content"], a["content"].split("\n")[0]
        print(f"\nQ: {q}\n  첫 줄: {first[:120]}")
        assert any(k in first for k in QUALIFIERS), f"한정 문구 없음: {first}"
        assert not BARE_TOTAL_RE.search(first), f"무한정 총계 단정: {first}"  # 한정과 독립 검사
        assert ("둘러보기" in body) or ("담당 부서" in body), "전체 확인 경로 안내 없음"
        checks += 3
        print("  ✅ 한정 표기 + 단정 없음 + 전체 확인 안내")

    # ③ 주제 전환 턴 — 재작성 가드(직전 답변 복사 차단) 후 인사규정 회수
    post(f"/chats/{cid}/messages", {"content": "서류평가 위원회가 뭐야?"})  # 오염 유발 턴(원 시나리오 유지)
    a = post(f"/chats/{cid}/messages", {"content": "인사 위원회, 징계 위원회에 대해 알려줘"})["assistant"]
    srcs = [f"{s.get('규정명', '?')} {s.get('조', '')}" for s in a.get("sources", [])]
    print(f"\nQ: 인사 위원회, 징계 위원회에 대해 알려줘\n  근거: {'; '.join(srcs[:5])}")
    print(f"  첫 줄: {a['content'].split(chr(10))[0][:120]}")
    assert any("인사규정" in s for s in srcs), f"인사규정 미회수: {srcs}"
    # 본문 전체에서 대상-부정 결합만 금지("근거에서 확인되지 않습니다"류 정당한 유보와 구분)
    fn = re.search(r"(인사|징계)\s*위원회[^\n]{0,30}존재하지 않", a["content"])
    assert not fn, f"거짓 부정 잔존: {fn.group()}"
    checks += 2
    print("  ✅ 인사규정 회수 + 거짓 부정 없음 (session 42 결함 수정)")

    # ④ 대조군: 비집계 단건 질문에 집계 전용 문구('전체 목록 아님'·둘러보기 백스톱)가 오발동하지 않는다.
    #    ('검색된 근거에서는' 접두는 정직한 헤지라 허용 — 금지 대상은 집계 형식의 전이)
    a = post(f"/chats/{cid}/messages", {"content": "경조사 휴가는 며칠이야?"})["assistant"]
    first = a["content"].split("\n")[0]
    print(f"\nQ: 경조사 휴가는 며칠이야? (대조군)\n  첫 줄: {first[:120]}")
    assert "전체 목록 아님" not in a["content"] and "ℹ️ 위 개수·목록" not in a["content"], \
        f"집계 한정 오발동: {first}"
    assert re.search(r"\d", a["content"]), "일수(숫자) 미제시 — 단건 두괄식 답 훼손 의심"
    checks += 2
    print("  ✅ 단건 질문에 집계 문구 오발동 없음 + 값 제시 유지")

    print(f"\n✅ {checks}개 판정 통과 — 재작성 가드 + 집계 단정 방지")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"\n❌ 실패: {e}")
        sys.exit(1)
