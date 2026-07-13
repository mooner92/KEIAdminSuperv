#!/usr/bin/env python3
"""test_signup_policy.py — 가입 정책(docs/29 §3·§4) 유닛. 임시 DB — 실DB 무접촉.

보장:
  ⓐ @kei.re.kr 외 도메인·형식 오류 가입 거부(fail-closed)
  ⓑ 가입 → 코드 인증 전 로그인 403 / 잘못된 코드 5회 후 코드 무효(410)
  ⓒ 올바른 코드 인증 → 로그인 성공(쿠키), ID=이메일(소문자 정규화)
  ⓓ 재발송 쿨다운 60초(429) · 미인증 재가입은 코드 재발송
  ⓔ 레거시 계정(verified 백필)은 인증 없이 로그인 유지
  ⓕ /app/users는 관리자 전용 + 채팅 본문 미반환(메타만)

실행: cd tools && .venv/bin/python test_signup_policy.py  (APP_DEV_ECHO_CODE로 SMTP 불필요)
"""
import os
import sys
import tempfile
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="kei-signup-")
os.environ["APP_DB"] = os.path.join(TMP, "test.db")
os.environ["APP_SECRET_FILE"] = os.path.join(TMP, ".secret")
os.environ["APP_DEV_ECHO_CODE"] = "1"          # 발송 없이 코드 회신(테스트 전용)
os.environ["APP_ADMINS"] = "admin@kei.re.kr"   # ⓕ 관리자 판별
os.environ.setdefault("APP_SIGNUP_DOMAINS", "kei.re.kr")

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app_api  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

app = FastAPI()
app.include_router(app_api.router)
app_api.init_db()
c = TestClient(app)

n = 0
def ok(name, cond, detail=""):
    global n
    assert cond, f"FAIL {name} {detail}"
    n += 1
    print("PASS", name)

# ⓐ 도메인·형식 거부
r = c.post("/app/auth/register", json={"username": "hacker@gmail.com", "password": "pw1234"})
ok("외부 도메인 거부", r.status_code == 400, r.text)
r = c.post("/app/auth/register", json={"username": "not-an-email", "password": "pw1234"})
ok("형식 오류 거부", r.status_code == 400)
r = c.post("/app/auth/register", json={"username": "kei.re.kr@evil.com", "password": "pw1234"})
ok("도메인 위장 거부", r.status_code == 400)

# ⓑ 가입 → 미인증 로그인 403
r = c.post("/app/auth/register", json={"username": "Hong.Gildong@KEI.re.kr", "password": "pw1234"})
ok("정상 가입(대소문자 정규화)", r.status_code == 200 and r.json()["email"] == "hong.gildong@kei.re.kr", r.text)
code = r.json()["dev_code"]
ok("dev 코드 동봉(6자리)", len(code) == 6 and code.isdigit())
r = c.post("/app/auth/login", json={"username": "hong.gildong@kei.re.kr", "password": "pw1234"})
ok("미인증 로그인 차단", r.status_code == 403, r.text)

# ⓑ 잘못된 코드 5회 → 코드 무효
for i in range(5):
    r = c.post("/app/auth/verify", json={"username": "hong.gildong@kei.re.kr", "code": "000000" if code != "000000" else "111111"})
    ok(f"오답 코드 거부 {i+1}/5", r.status_code == 401)
r = c.post("/app/auth/verify", json={"username": "hong.gildong@kei.re.kr", "code": code})
ok("시도 초과 후 정답도 무효(410)", r.status_code == 410, r.text)

# ⓓ 재발송 쿨다운(직전 발송 60초 이내 → 429)
r = c.post("/app/auth/resend", json={"username": "hong.gildong@kei.re.kr", "password": "pw1234"})
ok("재발송 쿨다운 429", r.status_code == 429, r.text)
# 쿨다운 우회(테스트): last_sent_at을 과거로
with Session(app_api.engine) as s:
    vc = s.exec(select(app_api.VerifyCode)).first()
    vc.last_sent_at = 0.0
    s.add(vc); s.commit()
r = c.post("/app/auth/resend", json={"username": "hong.gildong@kei.re.kr", "password": "pw1234"})
ok("쿨다운 경과 후 재발송", r.status_code == 200, r.text)
code2 = r.json()["dev_code"]

# ⓒ 정답 인증 → 로그인
r = c.post("/app/auth/verify", json={"username": "hong.gildong@kei.re.kr", "code": code2})
ok("코드 인증 성공+쿠키", r.status_code == 200 and "kei_session" in r.cookies, r.text)
r = c.post("/app/auth/login", json={"username": "Hong.Gildong@kei.re.kr", "password": "pw1234"})
ok("인증 후 로그인(대소문자 무관)", r.status_code == 200 and r.json()["username"] == "hong.gildong@kei.re.kr")
r = c.post("/app/auth/register", json={"username": "hong.gildong@kei.re.kr", "password": "pw9999"})
ok("기가입 이메일 재가입 거부", r.status_code == 409)

# ⓔ 레거시 계정(verified 백필 가정 — 직접 생성으로 재현)
with Session(app_api.engine) as s:
    s.add(app_api.User(username="admintest", password_hash=app_api.hash_pw("admtest123"), verified=True))
    s.add(app_api.User(username="admin@kei.re.kr", password_hash=app_api.hash_pw("adminpw"), verified=True))
    s.commit()
r = c.post("/app/auth/login", json={"username": "admintest", "password": "admtest123"})
ok("레거시 계정 로그인 유지", r.status_code == 200)

# ⓕ /app/users — 일반 사용자 403, 관리자는 메타만
c2 = TestClient(app)
c2.post("/app/auth/login", json={"username": "hong.gildong@kei.re.kr", "password": "pw1234"})
r = c2.get("/app/users")
ok("일반 사용자 목록 접근 403", r.status_code == 403)
ca = TestClient(app)
ca.post("/app/auth/login", json={"username": "admin@kei.re.kr", "password": "adminpw"})
r = ca.get("/app/users")
body = r.json()
ok("관리자 목록 조회", r.status_code == 200 and body["n"] >= 3, r.text[:200])
row = next(u for u in body["users"] if u["username"] == "hong.gildong@kei.re.kr")
ok("목록 필드=메타만", set(row.keys()) == {"id", "username", "created_at", "verified", "is_admin", "chats", "last_active"})
ok("본문 키 부재", "content" not in str(body) and "message" not in str(body).lower())

print(f"\n✅ {n}개 테스트 통과 — 가입 정책(@kei.re.kr·이메일 인증·ID=메일) + 사용자 목록")
