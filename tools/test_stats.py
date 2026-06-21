#!/usr/bin/env python3
"""test_stats.py — 운영 대시보드 집계(GET /app/stats) 검증 (LLM/Chroma 불필요).

임시 DB에 사용자·대화·메시지(정상답변 1 + 거부답변 1)·피드백을 심고 집계가 맞는지 확인한다.
실행:  cd tools && .venv/bin/python test_stats.py
"""
import os
import sys
import tempfile

TMP = tempfile.mkdtemp(prefix="kei_stats_test_")
os.environ["APP_DB"] = os.path.join(TMP, "app.db")
os.environ["APP_SECRET_FILE"] = os.path.join(TMP, ".secret")
os.environ["APP_ADMINS"] = "boss"

from fastapi import FastAPI                       # noqa: E402
from fastapi.testclient import TestClient         # noqa: E402
from sqlmodel import Session                      # noqa: E402

import app_api                                     # noqa: E402

app = FastAPI()
app.include_router(app_api.router)
fails = []


def ok(c, label):
    print(("✅" if c else "❌") + " " + label)
    if not c:
        fails.append(label)


def client_for(uname, pw="pass1234"):
    c = TestClient(app)
    r = c.post("/app/auth/register", json={"username": uname, "password": pw})
    if r.status_code == 409:
        r = c.post("/app/auth/login", json={"username": uname, "password": pw})
    assert r.status_code == 200, (uname, r.text)
    return c


alice = client_for("alice")
boss = client_for("boss")
cid = alice.post("/app/chats").json()["id"]

# 메시지 시퀀스: 질문1→정상답변, 질문2(=거부 유발)→거부답변
with Session(app_api.engine) as s:
    seq = [
        ("user", "경조사비 얼마예요?", ""),
        ("assistant", "경조사비는 규정에 따라 지급됩니다.", '[{"규정명":"복무규정","조":"제5조"}]'),
        ("user", "반려동물 장례비도 지원되나요?", ""),
        ("assistant", "해당 내용은 규정에서 확인되지 않습니다.", "[]"),
    ]
    mids = []
    for role, content, sj in seq:
        m = app_api.Message(session_id=cid, role=role, content=content, sources_json=sj)
        s.add(m)
        s.commit()
        s.refresh(m)
        mids.append(m.id)
ai_refusal_mid = mids[3]
ai_normal_mid = mids[1]

# 정상답변에 👎(피드백 집계 확인용)
alice.post(f"/app/messages/{ai_normal_mid}/feedback", json={"rating": "down", "reason": "옛 금액"})

# 1) 비관리자 403
ok(alice.get("/app/stats").status_code == 403, "1) 비관리자 /stats 403")

# 2) 관리자 집계
st = boss.get("/app/stats").json()
ok(st["users"] >= 2, f"2) users>=2 ({st['users']})")
ok(st["chats"] >= 1, f"2b) chats>=1 ({st['chats']})")
ok(st["questions"] == 2, f"3) questions==2 ({st['questions']})")
ok(st["answers"] == 2, f"3b) answers==2 ({st['answers']})")
ok(st["refusals"] == 1, f"4) refusals==1 ({st['refusals']})")
ok(abs(st["refusal_rate"] - 0.5) < 1e-6, f"4b) refusal_rate==0.5 ({st['refusal_rate']})")
ok(st["feedback"]["down"] == 1, f"5) feedback.down==1 ({st['feedback']['down']})")
ok(len(st["top_questions"]) == 2, f"6) top_questions 2개 ({len(st['top_questions'])})")
gapqs = [g["q"] for g in st["gaps"]]
ok(any("반려동물" in q for q in gapqs), f"7) 콘텐츠 갭에 거부 질문 포함 ({gapqs})")

print()
if fails:
    print("❌ 실패:", " / ".join(fails))
    sys.exit(1)
print("✅ 운영 대시보드 집계 전 항목 통과")
