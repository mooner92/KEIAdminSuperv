#!/usr/bin/env python3
"""test_trust_ops.py — 신뢰 운영 트랙(docs/34 ②) 유닛. 임시 DB·임시 볼트 — 실데이터 무접촉.

보장:
  ⓐ 🔒 본문 미반환: 응답 JSON 어디에도 질문·답변 본문·메시지 id가 없다
  ⓑ 레이더 = 금액 포함 + 미검수 근거일 때만; 검수완료로 승격하면 레이더에서 빠진다(현재 상태 조인)
  ⓒ 매트릭스 = 인용수 집계 + '다인용×미검수' 상단 정렬 + 👎 연동
  ⓓ 👎 사유 결정적 버킷(금액/기한/출처/낡음/누락/기타)
  ⓔ 관리자 전용(403)
"""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="kei-trust-")
os.environ["APP_DB"] = os.path.join(TMP, "test.db")
os.environ["APP_SECRET_FILE"] = os.path.join(TMP, ".secret")
os.environ["APP_ADMINS"] = "admin@kei.re.kr"
os.environ["VAULT_DIR"] = os.path.join(TMP, "vault")

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app_api  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session  # noqa: E402

# 임시 볼트: 미검수 1건 + 검수완료 1건
vd = Path(TMP) / "vault" / "20_규정원문" / "3000_인사"
vd.mkdir(parents=True)
(vd / "9998_테스트규정.md").write_text(
    "---\ntype: regulation\n규정명: \"테스트규정\"\n검수상태: 미검수\n---\n제1조", encoding="utf-8")
(vd / "9999_확정규정.md").write_text(
    "---\ntype: regulation\n규정명: \"확정규정\"\n검수상태: 검수완료\n---\n제1조", encoding="utf-8")

app = FastAPI()
app.include_router(app_api.router)
app_api.init_db()

with Session(app_api.engine) as s:
    s.add(app_api.User(username="admin@kei.re.kr", password_hash=app_api.hash_pw("pw1234"), verified=True))
    s.add(app_api.User(username="u1@kei.re.kr", password_hash=app_api.hash_pw("pw1234"), verified=True))
    s.commit()
    cs = app_api.ChatSession(user_id=2)
    s.add(cs); s.commit(); s.refresh(cs)

    def msg(content, srcs, mid_holder):
        m = app_api.Message(session_id=cs.id, role="assistant", content=content,
                            sources_json=json.dumps(srcs, ensure_ascii=False))
        s.add(m); s.commit(); s.refresh(m)
        mid_holder.append(m.id)
        return m

    ids = []
    # ① 금액 + 미검수 근거 → 레이더 대상
    msg("경조금은 500,000원입니다. 비밀질문내용흔적", [{"규정명": "테스트규정", "조": "제1조", "slug": "9998_테스트규정"}], ids)
    # ② 금액 + 검수완료 근거만 → 레이더 제외
    msg("수당은 30만 원입니다.", [{"규정명": "확정규정", "조": "제1조", "slug": "9999_확정규정"}], ids)
    # ③ 금액 없음 + 미검수 → 레이더 제외(매트릭스 인용수에는 포함)
    msg("절차는 신청서 제출입니다.", [{"규정명": "테스트규정", "조": "제2조", "slug": "9998_테스트규정"}], ids)
    # 👎 피드백(사유 버킷)
    s.add(app_api.Feedback(message_id=ids[0], session_id=cs.id, user_id=2, rating="down",
                           reason="금액이 옛날 기준 같아요"))
    s.commit()
    CS_ID = cs.id  # 세션 밖 사용을 위한 캡처(detached 방지)

c = TestClient(app)
n = 0
def ok(name, cond, detail=""):
    global n
    assert cond, f"FAIL {name} {detail}"
    n += 1
    print("PASS", name)

r = TestClient(app)
r.post("/app/auth/login", json={"username": "u1@kei.re.kr", "password": "pw1234"})
ok("ⓔ 일반 사용자 403", r.get("/app/trust").status_code == 403)

c.post("/app/auth/login", json={"username": "admin@kei.re.kr", "password": "pw1234"})
res = c.get("/app/trust?days=30")
body = res.json()
raw = res.text
ok("응답 200", res.status_code == 200)
ok("ⓐ 본문 미반환", "비밀질문내용흔적" not in raw and "500,000원입니다" not in raw and "절차는" not in raw)
ok("ⓐ 메시지 id 미반환", '"id"' not in raw)
ok("ⓑ 레이더 1건(금액+미검수)", len(body["radar"]) == 1 and body["radar"][0]["n_unreviewed"] == 1, raw[:200])
ok("ⓑ 검수완료 근거는 레이더 제외", all(x["규정명"] != "확정규정" for r0 in body["radar"] for x in r0["근거"]))
mx = {m["규정명"]: m for m in body["matrix"]}
ok("ⓒ 매트릭스 인용수", mx["테스트규정"]["인용수"] == 2 and mx["확정규정"]["인용수"] == 1, str(mx))
ok("ⓒ 미검수·다인용 상단", body["matrix"][0]["규정명"] == "테스트규정")
ok("ⓒ 👎 연동", mx["테스트규정"]["down"] == 1)
ok("ⓓ 사유 버킷=금액", body["feedback_types"][0]["유형"] == "금액", str(body["feedback_types"]))

# 적대 리뷰 확정 케이스들(2026-07-14)
with Session(app_api.engine) as s:
    # 손상 sources_json(유효 JSON이지만 dict) — 화면 전체 500 방지
    s.add(app_api.Message(session_id=CS_ID, role="assistant", content="30만 원",
                          sources_json='{"규정명":"x"}'))
    # 다조(多條) 인용 1답변 — 인용수는 규정당 1
    s.add(app_api.Message(session_id=CS_ID, role="assistant", content="절차 안내",
                          sources_json=json.dumps([
                              {"규정명": "확정규정", "조": "제1조", "slug": "9999_확정규정"},
                              {"규정명": "확정규정", "조": "제2조", "slug": "9999_확정규정"},
                              {"규정명": "확정규정", "조": "제3조", "slug": "9999_확정규정"}], ensure_ascii=False)))
    # 콤마 없는 금액 + 미검수 — 확장 정규식이 잡아야 함
    s.add(app_api.Message(session_id=CS_ID, role="assistant", content="식비는 20000원입니다.",
                          sources_json=json.dumps([{"규정명": "테스트규정", "조": "제3조",
                                                    "slug": "9998_테스트규정"}], ensure_ascii=False)))
    s.commit()
r2 = c.get("/app/trust?days=30")
ok("손상 JSON에도 200(전체 사수)", r2.status_code == 200)
b2 = r2.json()
mx2 = {m["규정명"]: m for m in b2["matrix"]}
ok("다조 인용 dedup(확정규정 인용수 2)", mx2["확정규정"]["인용수"] == 2, str(mx2.get("확정규정")))
ok("확장 금액(20000원) 레이더 포착", len(b2["radar"]) == 2, str(len(b2["radar"])))
ok("🔒 레이더 at 시간 절사", all(r0["at"] % 3600 == 0 for r0 in b2["radar"]))

# ⓑ 검수 승격 시 레이더에서 자동 제외(현재 상태 조인)
(vd / "9998_테스트규정.md").write_text(
    "---\ntype: regulation\n규정명: \"테스트규정\"\n검수상태: 검수완료\n---\n제1조", encoding="utf-8")
app_api._REVIEW_CACHE["t"] = 0  # 캐시 무효화
body2 = c.get("/app/trust?days=30").json()
ok("ⓑ 검수 승격 → 레이더 0건", len(body2["radar"]) == 0)
ok("ⓑ 매트릭스 품질 갱신", {m["규정명"]: m["검수상태"] for m in body2["matrix"]}["테스트규정"] == "검수완료")

print(f"\n✅ {n}개 테스트 통과 — 신뢰 운영 트랙(본문 미반환·검수 조인·버킷)")
