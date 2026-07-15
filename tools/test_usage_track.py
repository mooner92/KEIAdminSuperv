#!/usr/bin/env python3
"""test_usage_track.py — 사용량 수집(docs/35 §0) 유닛. 임시 DB — 실데이터 무접촉.

보장:
  ⓐ flag off = 서버 무시(204·저장 0) / on = 저장
  ⓑ 이름 allowlist — 자유 문자열(질문 텍스트 등) 유입 차단
  ⓒ page는 허용 프리픽스만·쿼리스트링 절단·문서 상세(/d/<slug>)는 '/d'로 접힘·created_at 시간 절사
  ⓓ 스로틀(초당 5건 초과 무시)
  ⓔ /app/usage: 관리자 전용 + 집계만 + k-익명(사용자 수 마스킹·페이지뷰 억제) + days 하한 7
  ⓕ 보존기한(TRACK_RETENTION_DAYS) 지난 행은 주기 삭제
"""
import os
import sys
import tempfile
import time
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="kei-usage-")
os.environ["APP_DB"] = os.path.join(TMP, "test.db")
os.environ["APP_SECRET_FILE"] = os.path.join(TMP, ".secret")
os.environ["APP_ADMINS"] = "admin@kei.re.kr"
os.environ["VAULT_DIR"] = os.path.join(TMP, "vault")

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
    s.add(app_api.User(username="u1@kei.re.kr", password_hash=app_api.hash_pw("pw1234"), verified=True))
    s.commit()

n = 0
def ok(name, cond, detail=""):
    global n
    assert cond, f"FAIL {name} {detail}"
    n += 1
    print("PASS", name)

def count_events():
    with Session(app_api.engine) as s:
        return len(s.exec(select(app_api.UsageEvent)).all())

def last_event():
    with Session(app_api.engine) as s:
        return s.exec(select(app_api.UsageEvent).order_by(app_api.UsageEvent.id.desc())).first()

def set_flag(on: bool):
    with Session(app_api.engine) as s:
        f = s.exec(select(app_api.Flag).where(app_api.Flag.key == "usage_analytics")).first()
        f.enabled = on
        s.add(f); s.commit()

c = TestClient(app)
c.post("/app/auth/login", json={"username": "u1@kei.re.kr", "password": "pw1234"})

# ⓐ flag off(기본) — 무시
r = c.post("/app/track", json={"name": "page_view", "page": "/browse"})
ok("ⓐ off: 204 + 저장 0", r.status_code == 204 and count_events() == 0)

set_flag(True)
r = c.post("/app/track", json={"name": "page_view", "page": "/browse?doc=x"})
ok("ⓐ on: 저장 1", r.status_code == 204 and count_events() == 1)

# ⓑ allowlist 밖 — 질문 텍스트 유입 차단
c.post("/app/track", json={"name": "연차휴가 며칠?", "page": "/"})
ok("ⓑ 자유 문자열 무시", count_events() == 1)

# ⓒ page 정규화
with Session(app_api.engine) as s:
    ev = s.exec(select(app_api.UsageEvent)).first()
ok("ⓒ 쿼리스트링 절단", ev.page == "/browse", ev.page)
c.post("/app/track", json={"name": "page_view", "page": "http://evil.example/x"})
ok("ⓒ 비허용 경로는 빈 값", last_event().page == "")
c.post("/app/track", json={"name": "doc_open", "page": "/d/6000_여비규정"})
ev3 = last_event()
ok("ⓒ 문서 상세는 '/d'로 접힘(열람 이력 미저장)", ev3.page == "/d", ev3.page)
ok("ⓒ created_at 시간 절사(분·초 없음)", ev3.created_at % 3600 == 0, str(ev3.created_at))

# ⓓ 스로틀 — 같은 초에 20건 → 5건 언저리만
app_api._TRACK_LAST.clear()
before = count_events()
for _ in range(20):
    c.post("/app/track", json={"name": "chat_send"})
ok("ⓓ 초당 5건 스로틀", count_events() - before <= 5, str(count_events() - before))

# ⓔ usage — 관리자 전용·집계만·k-익명
r = c.get("/app/usage")
ok("ⓔ 일반 사용자 403", r.status_code == 403)
a = TestClient(app)
a.post("/app/auth/login", json={"username": "admin@kei.re.kr", "password": "pw1234"})
r = a.get("/app/usage?days=1")
body = r.json()
ok("ⓔ days 하한 7(하루 차분 방지)", r.status_code == 200 and body["days"] == 7)
ok("ⓔ 집계 응답", any(e["name"] == "page_view" for e in body["events"]))
ok("ⓔ user_id 미반환", "user_id" not in r.text and '"id"' not in r.text)
# 이벤트 전부 u1 1명 → K_ANON(기본 3) 미만 → users 마스킹(None)
ok("ⓔ k-익명: 사용자 수 마스킹", body["min_users"] >= 2 and all(e["users"] is None for e in body["events"]),
   str(body["events"]))
ok("ⓔ k-익명: 페이지뷰 억제(1명뿐)", body["pages"] == [], str(body["pages"]))
ok("ⓔ DAU 마스킹 + 연도 있는 키(%Y-%m-%d)",
   len(body["dau"]) >= 1 and body["dau"][0]["users"] is None and len(body["dau"][0]["day"]) == 10,
   str(body["dau"]))

# ⓕ 보존기한 — 기한 지난 행이 다음 track에서 삭제(일 1회)
with Session(app_api.engine) as s:
    s.add(app_api.UsageEvent(name="page_view", page="", user_id=1,
                             created_at=time.time() - (app_api.TRACK_RETENTION_DAYS + 10) * 86400))
    s.commit()
app_api._TRACK_PURGE["t"] = 0.0
app_api._TRACK_LAST.clear()
c.post("/app/track", json={"name": "faq_open"})
with Session(app_api.engine) as s:
    cutoff = time.time() - app_api.TRACK_RETENTION_DAYS * 86400
    stale = s.exec(select(app_api.UsageEvent).where(app_api.UsageEvent.created_at < cutoff)).all()
ok("ⓕ 보존기한 지난 행 삭제", len(stale) == 0, str(len(stale)))

print(f"\n✅ {n}개 테스트 통과 — 사용량 수집(allowlist·스로틀·k-익명·보존기한)")
