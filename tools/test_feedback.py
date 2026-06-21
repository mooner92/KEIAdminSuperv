#!/usr/bin/env python3
"""test_feedback.py — 답변 피드백(👍/👎) 엔드포인트 + 검수신호 내보내기 검증 (LLM/Chroma 불필요).

임시 DB로 라우터를 직접 두드린다(FastAPI TestClient). rag_core(검색·생성)는 건드리지 않으므로
Ollama/Chroma 없이도 돈다. 메시지는 DB에 직접 심는다.

실행:  cd tools && .venv/bin/python test_feedback.py   (성공 시 종료코드 0)
"""
import json
import os
import sys
import tempfile

TMP = tempfile.mkdtemp(prefix="kei_fb_test_")
os.environ["APP_DB"] = os.path.join(TMP, "app.db")
os.environ["APP_SECRET_FILE"] = os.path.join(TMP, ".secret")
os.environ["APP_ADMINS"] = "boss"  # admin = 'boss'

from fastapi import FastAPI                       # noqa: E402
from fastapi.testclient import TestClient         # noqa: E402
from sqlmodel import Session                      # noqa: E402

import app_api                                     # noqa: E402  (import 시 임시 DB로 init_db)
import feedback_export                             # noqa: E402

app = FastAPI()
app.include_router(app_api.router)

fails = []


def ok(cond, label):
    print(("✅" if cond else "❌") + " " + label)
    if not cond:
        fails.append(label)


def client_for(uname, pw="pass1234"):
    """등록(있으면 로그인)된 쿠키를 가진 클라이언트."""
    c = TestClient(app)
    r = c.post("/app/auth/register", json={"username": uname, "password": pw})
    if r.status_code == 409:
        r = c.post("/app/auth/login", json={"username": uname, "password": pw})
    assert r.status_code == 200, (uname, r.status_code, r.text)
    return c


def seed_messages(cid):
    """user 질문 1 + assistant 답변 1(근거 포함)을 DB에 직접 심고 (user_mid, ai_mid) 반환."""
    with Session(app_api.engine) as s:
        um = app_api.Message(session_id=cid, role="user", content="부모 사망 시 경조사비 얼마?")
        s.add(um)
        s.commit()
        s.refresh(um)
        srcs = [{"규정명": "복무규정", "조": "제5조", "분류": "3000_인사",
                 "tag": "복무규정 제5조", "snippet": "경조사비…", "distance": 0.1}]
        am = app_api.Message(session_id=cid, role="assistant", content="경조사비는 …입니다.",
                             sources_json=json.dumps(srcs, ensure_ascii=False))
        s.add(am)
        s.commit()
        s.refresh(am)
        return um.id, am.id


u1 = client_for("alice")
u2 = client_for("mallory")
boss = client_for("boss")

cid = u1.post("/app/chats").json()["id"]
user_mid, ai_mid = seed_messages(cid)

# 1) 👍 등록
r = u1.post(f"/app/messages/{ai_mid}/feedback", json={"rating": "up"})
ok(r.status_code == 200 and r.json()["feedback"] == "up", "1) 👍 등록 200")

# 2) 조회 시 feedback 상태 포함
msgs = u1.get(f"/app/chats/{cid}").json()["messages"]
am = next(m for m in msgs if m["id"] == ai_mid)
ok(am["feedback"] == "up", "2) GET /chats 에 feedback='up' 포함")

# 3) 👎 + 사유로 갱신(upsert)
r = u1.post(f"/app/messages/{ai_mid}/feedback", json={"rating": "down", "reason": "금액이 옛날 값"})
ok(r.status_code == 200 and r.json()["feedback"] == "down", "3) 👎 갱신(upsert) 200")
am = next(m for m in u1.get(f"/app/chats/{cid}").json()["messages"] if m["id"] == ai_mid)
ok(am["feedback"] == "down" and am["feedback_reason"] == "금액이 옛날 값", "3b) 사유 영속")

# 4) 잘못된 rating → 400
r = u1.post(f"/app/messages/{ai_mid}/feedback", json={"rating": "meh"})
ok(r.status_code == 400, "4) 잘못된 rating 400")

# 5) user 역할 메시지엔 피드백 불가 → 400
r = u1.post(f"/app/messages/{user_mid}/feedback", json={"rating": "up"})
ok(r.status_code == 400, "5) user 메시지 피드백 400")

# 6) 없는 메시지 → 404
r = u1.post("/app/messages/999999/feedback", json={"rating": "up"})
ok(r.status_code == 404, "6) 없는 메시지 404")

# 7) 남의 메시지 → 404(소유 가드)
r = u2.post(f"/app/messages/{ai_mid}/feedback", json={"rating": "up"})
ok(r.status_code == 404, "7) 타인 메시지 피드백 404(소유 가드)")

# 8) 관리자 집계: down 1건, 근거 규정 포함 + 개인정보(질문·답변 본문) 미노출
fl = boss.get("/app/feedback?rating=down").json()
ok(len(fl) == 1 and fl[0]["rating"] == "down", "8) 관리자 /feedback?rating=down 1건")
ok(fl[0]["sources"][0]["규정명"] == "복무규정", "8b) 근거 규정 포함")
ok("question" not in fl[0] and "answer" not in fl[0], "8c) 개인정보: 질문·답변 본문 미노출")

# 9) 비관리자는 /feedback 금지 → 403
r = u1.get("/app/feedback")
ok(r.status_code == 403, "9) 비관리자 /feedback 403")

# 10) 철회(DELETE) → null
r = u1.delete(f"/app/messages/{ai_mid}/feedback")
ok(r.status_code == 200 and r.json()["feedback"] is None, "10) 피드백 철회 200/null")
am = next(m for m in u1.get(f"/app/chats/{cid}").json()["messages"] if m["id"] == ai_mid)
ok(am["feedback"] is None, "10b) 철회 후 GET feedback=null")

# 11) feedback_export: 👎 다시 달고 신호 집계 확인
u1.post(f"/app/messages/{ai_mid}/feedback", json={"rating": "down", "reason": "표가 깨짐"})
sig = feedback_export.build(os.environ["APP_DB"])
ok(sig["totals"]["down"] == 1, "11) export totals.down == 1")
ok(sig["by_regulation"].get("복무규정", {}).get("down") == 1, "11b) export by_regulation['복무규정'].down == 1")
ok("제5조" in sig["by_regulation"].get("복무규정", {}).get("조", []), "11c) export 에 조 기록")

print()
if fails:
    print("❌ 실패:", " / ".join(fails))
    sys.exit(1)
print("✅ 피드백 백엔드 전 항목 통과")
