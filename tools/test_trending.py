#!/usr/bin/env python3
"""test_trending.py — 인기 검색 키워드(docs/29 §1) 유닛. 임시 DB — 실DB 무접촉.

보장:
  ⓐ k-익명: 서로 다른 사용자 K_ANON(기본 3)명 미만이 쓴 키워드는 절대 노출 안 됨
  ⓑ 최장 일치: '연차휴가' 질문은 '연차휴가'로 집계되고 부분 문자열 '휴가'로 이중 집계 안 됨
  ⓒ 기간 창: days 밖의 옛 질문은 집계 제외
  ⓓ 질문 본문 비노출(키워드·건수만) + 비로그인 401
"""
import os
import sys
import tempfile
import time
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="kei-trend-")
os.environ["APP_DB"] = os.path.join(TMP, "test.db")
os.environ["APP_SECRET_FILE"] = os.path.join(TMP, ".secret")
os.environ["APP_DEV_ECHO_CODE"] = "1"
os.environ["STATS_MIN_USERS"] = "3"

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app_api  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session  # noqa: E402

app = FastAPI()
app.include_router(app_api.router)
app_api.init_db()
c = TestClient(app)

# 사전은 여정·용어집 파일 의존 — 테스트는 고정 사전으로 결정적으로
app_api._TREND["lex"] = ["연차휴가", "출장비", "휴가"]

n = 0
def ok(name, cond, detail=""):
    global n
    assert cond, f"FAIL {name} {detail}"
    n += 1
    print("PASS", name)

def seed(uid, text, at=None):
    with Session(app_api.engine) as s:
        cs = app_api.ChatSession(user_id=uid)
        s.add(cs); s.commit(); s.refresh(cs)
        s.add(app_api.Message(session_id=cs.id, role="user", content=text,
                              created_at=at or time.time()))
        s.commit()

# 계정 3 + 1 생성(레거시 스타일로 직접)
with Session(app_api.engine) as s:
    for i in range(1, 5):
        s.add(app_api.User(username=f"u{i}@kei.re.kr", password_hash=app_api.hash_pw("pw1234"), verified=True))
    s.commit()

# ⓑ 최장 일치: 3명이 '연차휴가' 질문
for uid in (1, 2, 3):
    seed(uid, "연차휴가 신청은 어떻게 하나요?")
# ⓐ 2명만 '출장비' → 미노출
for uid in (1, 2):
    seed(uid, "출장비 정산 기한 알려줘")
# ⓒ 옛 질문(40일 전) — 7일 창 밖
seed(4, "연차휴가 소멸되나요?", at=time.time() - 40 * 86400)

cl = TestClient(app)
r = cl.get("/app/trending")
ok("비로그인 401", r.status_code == 401)

cl.post("/app/auth/login", json={"username": "u1@kei.re.kr", "password": "pw1234"})
r = cl.get("/app/trending?days=7")
body = r.json()
ok("응답 형태", r.status_code == 200 and body["days"] == 7 and body["min_users"] == 3, r.text[:200])
kws = {x["k"]: x["n"] for x in body["keywords"]}
ok("k-익명: 3명 키워드 노출", kws.get("연차휴가") == 3, str(kws))
ok("k-익명: 2명 키워드 미노출", "출장비" not in kws)
ok("최장 일치: '휴가' 이중 집계 없음", "휴가" not in kws)
ok("본문 비노출", "신청은 어떻게" not in r.text)

# ⓒ 90일 창이면 옛 질문 포함(u4 추가 → 연차휴가 4건)
app_api._TREND["cache"].clear()
r = cl.get("/app/trending?days=90")
kws90 = {x["k"]: x["n"] for x in r.json()["keywords"]}
ok("기간 창 확대 시 옛 질문 포함", kws90.get("연차휴가") == 4, str(kws90))

print(f"\n✅ {n}개 테스트 통과 — 인기 검색 키워드(k-익명·최장 일치·기간 창)")
