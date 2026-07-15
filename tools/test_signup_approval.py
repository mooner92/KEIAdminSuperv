#!/usr/bin/env python3
"""test_signup_approval.py — 관리자 승인제 가입(docs/36 §10). 임시 DB — 실데이터 무접촉.

보장(flag signup_approval on):
  ⓐ register → 코드 미발송·pending_approval, 미인증 로그인 403('승인 대기')
  ⓑ 관리자 approve → verified=True → 로그인 성공
  ⓒ 관리자 reject → 대기 계정 삭제(재가입 가능), 승인된 계정은 거절 불가
  ⓓ approve/reject는 관리자 전용(403), @kei.re.kr만
  ⓔ flag off면 기존 코드 인증 흐름 유지(회귀)
"""
import os
import sys
import tempfile
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="kei-approval-")
os.environ["APP_DB"] = os.path.join(TMP, "test.db")
os.environ["APP_SECRET_FILE"] = os.path.join(TMP, ".secret")
os.environ["APP_ADMINS"] = "admin@kei.re.kr"
os.environ["VAULT_DIR"] = os.path.join(TMP, "vault")
os.environ["APP_DEV_ECHO_CODE"] = "1"  # off 회귀에서 SMTP 없이 코드 경로 검사(dev echo)

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app_api  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

app = FastAPI()
app.include_router(app_api.router)
app_api.init_db()

with Session(app_api.engine) as s:
    s.add(app_api.User(username="admin@kei.re.kr", password_hash=app_api.hash_pw("pw1234"), verified=True))
    s.commit()

n = 0
def ok(name, cond, detail=""):
    global n
    assert cond, f"FAIL {name} {detail}"
    n += 1
    print("PASS", name)

def set_flag(on: bool):
    with Session(app_api.engine) as s:
        f = s.exec(select(app_api.Flag).where(app_api.Flag.key == "signup_approval")).first()
        f.enabled = on
        s.add(f); s.commit()

def uid_of(email):
    with Session(app_api.engine) as s:
        u = s.exec(select(app_api.User).where(app_api.User.username == email)).first()
        return u.id if u else None

def has_code(email):
    with Session(app_api.engine) as s:
        return s.exec(select(app_api.VerifyCode).where(app_api.VerifyCode.email == email)).first() is not None

adm = TestClient(app)
adm.post("/app/auth/login", json={"username": "admin@kei.re.kr", "password": "pw1234"})

# ── 승인제 on ──
set_flag(True)
c = TestClient(app)
r = c.post("/app/auth/register", json={"username": "newbie@kei.re.kr", "password": "pw1234"})
ok("ⓐ register → pending_approval", r.status_code == 200 and r.json().get("pending_approval") is True, r.text)
ok("ⓐ 코드 미발송", not has_code("newbie@kei.re.kr"))
r = c.post("/app/auth/login", json={"username": "newbie@kei.re.kr", "password": "pw1234"})
ok("ⓐ 미승인 로그인 403", r.status_code == 403 and "승인" in r.text, r.text)

# ⓓ approve는 관리자 전용 — 인증된 비관리자로 진짜 403 경로 검사
with Session(app_api.engine) as s:
    s.add(app_api.User(username="member@kei.re.kr", password_hash=app_api.hash_pw("pw1234"), verified=True))
    s.commit()
member = TestClient(app)
member.post("/app/auth/login", json={"username": "member@kei.re.kr", "password": "pw1234"})
uid = uid_of("newbie@kei.re.kr")
r = member.post(f"/app/users/{uid}/approve")
ok("ⓓ 비관리자 approve 403", r.status_code == 403, r.text)

# ⓑ 관리자 승인 → 로그인 성공
r = adm.post(f"/app/users/{uid}/approve")
ok("ⓑ 관리자 approve 200", r.status_code == 200 and r.json()["verified"] is True, r.text)
r = c.post("/app/auth/login", json={"username": "newbie@kei.re.kr", "password": "pw1234"})
ok("ⓑ 승인 후 로그인 성공", r.status_code == 200 and "kei_session" in r.cookies, r.text)

# ⓒ reject — 대기 계정만
c2 = TestClient(app)
c2.post("/app/auth/register", json={"username": "spammer@kei.re.kr", "password": "pw1234"})
uid2 = uid_of("spammer@kei.re.kr")
r = adm.post(f"/app/users/{uid2}/reject")
ok("ⓒ 대기 계정 거절(삭제)", r.status_code == 200 and uid_of("spammer@kei.re.kr") is None, r.text)
# 승인된 계정은 거절 불가
r = adm.post(f"/app/users/{uid}/reject")
ok("ⓒ 승인된 계정 거절 불가(400)", r.status_code == 400, r.text)

# ⓓ 도메인 방어(레거시 비-KEI 계정을 직접 만들어 approve 시도)
with Session(app_api.engine) as s:
    s.add(app_api.User(username="ext_user", password_hash=app_api.hash_pw("pw1234"), verified=False))
    s.commit()
r = adm.post(f"/app/users/{uid_of('ext_user')}/approve")
ok("ⓓ 비-KEI 계정 approve 거부(400)", r.status_code == 400, r.text)

# ── 승인제 off (회귀) ──
set_flag(False)
c3 = TestClient(app)
r = c3.post("/app/auth/register", json={"username": "coder@kei.re.kr", "password": "pw1234"})
ok("ⓔ off: 코드 인증 흐름 유지(pending)", r.status_code == 200 and r.json().get("pending") is True and "pending_approval" not in r.json(), r.text)
ok("ⓔ off: 코드 발송됨", has_code("coder@kei.re.kr"))

print(f"\n✅ {n}개 테스트 통과 — 관리자 승인제 가입(승인·거절·도메인·관리자 전용·off 회귀)")
