#!/usr/bin/env python3
"""test_stats.py — 운영 대시보드 집계(GET /app/stats) + k-익명성 검증 (LLM/Chroma 불필요).

핵심: 관리자도 개인 채팅을 볼 수 없다 →
  - 인기질문/콘텐츠 갭은 서로 다른 사용자 K명 이상이 물은 것만 노출(미만은 숨김)
  - 응답에 질문/답변 '원문' 본문이 통째로 실리지 않는다(집계 q는 K명 이상 공통 질문만)
실행:  cd tools && .venv/bin/python test_stats.py
"""
import os
import sys
import tempfile

TMP = tempfile.mkdtemp(prefix="kei_stats_test_")
os.environ["APP_DB"] = os.path.join(TMP, "app.db")
os.environ["APP_SECRET_FILE"] = os.path.join(TMP, ".secret")
os.environ["APP_ADMINS"] = "boss"
os.environ["STATS_MIN_USERS"] = "2"  # 테스트 편의상 K=2(서로 다른 2명 이상이면 노출)

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


def seed(client, turns):
    """turns: [(role, content, refusal?)]. 한 세션에 메시지 심기."""
    cid = client.post("/app/chats").json()["id"]
    with Session(app_api.engine) as s:
        for role, content in turns:
            s.add(app_api.Message(session_id=cid, role=role, content=content))
        s.commit()


COMMON = "공통 질문 이건 무엇인가요?"
PRIVATE = "개인적이고 민감한 나만의 질문입니다"
COMMON_GAP = "공통 거부 유발 질문"
PRIVATE_GAP = "민감한 개인 거부 질문"
REFUSAL = "해당 내용은 규정에서 확인되지 않습니다."

alice = client_for("alice")
bob = client_for("bob")
boss = client_for("boss")

# 공통질문: alice + bob (서로 다른 2명) / 개인질문: alice만 (1명)
seed(alice, [("user", COMMON), ("assistant", "답"), ("user", PRIVATE), ("assistant", "답")])
seed(bob, [("user", COMMON), ("assistant", "답")])
# 공통 거부: alice + bob / 개인 거부: alice만
seed(alice, [("user", COMMON_GAP), ("assistant", REFUSAL), ("user", PRIVATE_GAP), ("assistant", REFUSAL)])
seed(bob, [("user", COMMON_GAP), ("assistant", REFUSAL)])

# 1) 비관리자 403
ok(alice.get("/app/stats").status_code == 403, "1) 비관리자 /stats 403")

st = boss.get("/app/stats").json()
ok(st.get("k_anon") == 2, f"2) k_anon=2 노출 ({st.get('k_anon')})")

tq = {r["q"]: r["n"] for r in st["top_questions"]}
ok(COMMON in tq and tq[COMMON] == 2, f"3) 공통질문(2명) 노출 n=2 ({tq.get(COMMON)})")
ok(PRIVATE not in tq, "4) 🔒 개인질문(1명) 숨김 — k-익명")

gp = {r["q"]: r["n"] for r in st["gaps"]}
ok(COMMON_GAP in gp and gp[COMMON_GAP] == 2, f"5) 공통 거부질문(2명) 노출 ({gp.get(COMMON_GAP)})")
ok(PRIVATE_GAP not in gp, "6) 🔒 개인 거부질문(1명) 숨김 — k-익명")

# 7) 응답 어디에도 개인(1명) 질문 원문이 새지 않는다
blob = str(st)
ok(PRIVATE not in blob and PRIVATE_GAP not in blob, "7) 🔒 응답에 개인 질문 원문 전혀 없음")

# 8) 집계 수치는 정상(거부율 등)
ok(st["refusals"] == 3 and st["answers"] == 6, f"8) 집계 수치 정상(거부 {st['refusals']}/답변 {st['answers']})")

print()
if fails:
    print("❌ 실패:", " / ".join(fails))
    sys.exit(1)
print("✅ 운영 대시보드 집계 + k-익명성 전 항목 통과")
