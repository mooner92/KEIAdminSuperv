#!/usr/bin/env python3
"""test_amend_api.py — 개정 반영 API 회귀 (specs/15 T03). LLM/Chroma 불필요.

⛔ 임시 DB·임시 볼트·임시 업로드 디렉터리만 쓴다(실데이터 미접촉).

못박는 계약:
  ① **관리자만** — 일반 사용자는 규정 본문을 못 건드린다(403)
  ② **클라이언트 항목을 신뢰하지 않는다** — 보낸 값은 선택자일 뿐, 판정은 서버 재계산본.
     이게 없으면 반영가능=True와 임의 문구를 위조해 규정에 써넣을 수 있다.
  ③ **경로 이탈 차단** — ../로 볼트 밖 파일을 쓰지 못한다
  ④ 적용 응답은 **재계산본을 함께** 준다(화면이 항상 현재 문서를 본다)
  ⑤ **PENDING이 비어도**(API 재기동) uid로 변환본을 찾아 이어서 작업할 수 있다
  ⑥ 로그에 거부도 남는다 — 왜 안 됐는지가 고칠 단서다
실행: cd tools && .venv/bin/python test_amend_api.py
"""
import os
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="kei_amend_api_"))
VAULT = TMP / "vault"
REL = "20_규정원문/9000_합성/합성규정.md"
(VAULT / "20_규정원문/9000_합성").mkdir(parents=True)
(VAULT / REL).write_text("""---
type: regulation
규정번호: "1999"
규정명: "합성규정"
개정일: 2026-01-01
검수상태: 검수완료
---

# 합성규정

제1조(목적) 합성 테스트를 목적으로 한다.

4. 실·팀장은 합성부서의 실장, 합성센터의 실장, 기획·행정부서의 팀장임

5. 합성센터장의 위임은 실장 체계를 준용함
""", encoding="utf-8")

os.environ["APP_DB"] = str(TMP / "app.db")
os.environ["APP_SECRET_FILE"] = str(TMP / ".secret")
os.environ["APP_ADMINS"] = "boss"
os.environ["VAULT_DIR"] = str(VAULT)
os.environ["KEI_UPLOAD_DIR"] = str(TMP / "uploads")
(TMP / "uploads").mkdir()

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fastapi import FastAPI                       # noqa: E402
from fastapi.testclient import TestClient         # noqa: E402
from sqlmodel import Session, select              # noqa: E402

import app_api                                     # noqa: E402
import corpus_replace as CR                        # noqa: E402
import test_corpus_amend as T                      # noqa: E402 — 합성 대비표 픽스처 재사용

CR.LOG_PATH = TMP / "log.jsonl"                    # ⛔ 실로그 미접촉
app = FastAPI()
app.include_router(app_api.router)
app_api.init_db()

UID = "20260804-120000-abc123"
(TMP / "uploads" / f"{UID}.converted.md").write_text(T.AMEND, encoding="utf-8")
# ⑤ PENDING을 일부러 비워 둔다 — API 재기동 상황을 그대로 재현한다.
app_api.PENDING.clear()

fails = []


def ok(c, label, extra=""):
    print(("  ok  " if c else "  ❌  ") + label + (f" — {extra}" if extra and not c else ""))
    if not c:
        fails.append(label)


def client_for(uname, pw="pass1234"):
    c = TestClient(app)
    with Session(app_api.engine) as s:
        if not s.exec(select(app_api.User).where(app_api.User.username == uname)).first():
            s.add(app_api.User(username=uname, password_hash=app_api.hash_pw(pw), verified=True))
            s.commit()
    r = c.post("/app/auth/login", json={"username": uname, "password": pw})
    assert r.status_code == 200, (uname, r.text)
    return c


boss, joe = client_for("boss"), client_for("joe")

# ① 관리자만
ok(joe.get(f"/app/corpus/uploads/{UID}/amend").status_code == 403,
   "① 비관리자는 개정 반영 미리보기 불가")
ok(joe.post(f"/app/corpus/uploads/{UID}/amend/apply",
            json={"rel_path": REL, "개정줄": "x"}).status_code == 403,
   "① 비관리자는 반영 불가")

# ⑤ PENDING이 비어 있어도 uid로 변환본을 찾는다
r = boss.get(f"/app/corpus/uploads/{UID}/amend")
ok(r.status_code == 200, "⑤ PENDING이 비어도 변환본을 찾는다", r.text[:200])
v = r.json()
ok(v["판별"]["kind"] == "개정안" and not v["교체가능"], "판별=개정안 · 교체 거부")
ok(str(v.get("대상", "")).endswith("합성규정.md"), "대상 문서 자동 매칭", str(v.get("대상")))
ok(v["개정안"]["시행일"] == "2026-08-03", "시행일 해독", str(v["개정안"]["시행일"]))

props = v["제안"]
tbl = props[0]["변경"]
ok(bool(tbl) and not any(x["반영가능"] for x in tbl), "표 행은 전부 잠김")
target = next((x for r_ in props for x in r_["변경"]
               if x["반영가능"] and x["모드"] == "replace"), None)
ok(target is not None, "반영 가능한 replace 항목 존재")

# ③ 경로 이탈 차단
ok(boss.post(f"/app/corpus/uploads/{UID}/amend/apply",
             json={"rel_path": "../../etc/passwd.md", "개정줄": "x"}).status_code == 400,
   "③ 볼트 밖 경로 차단")

# ② 위조 무력화 — 반영가능·볼트줄을 위조해 보내도 서버 판정이 이긴다
forged = boss.post(f"/app/corpus/uploads/{UID}/amend/apply",
                   json={"rel_path": REL, "개정줄": props[0]["변경"][0]["개정줄"],
                         "현행줄": props[0]["변경"][0]["현행줄"], "반영가능": True, "볼트줄": 13})
ok("악의적으로" not in (VAULT / REL).read_text(encoding="utf-8"),
   "② 위조 필드가 볼트에 쓰이지 않는다")
ok(forged.json()["결과"]["ok"] is False, "② 표 행은 서버 판정으로 거부", forged.text[:160])

# ④ 실제 반영 + 재계산본 동봉
SEL = {"rel_path": REL, "개정줄": target["개정줄"], "현행줄": target["현행줄"]}
r2 = boss.post(f"/app/corpus/uploads/{UID}/amend/apply", json=SEL).json()
ok(r2["결과"]["ok"] and not r2["결과"].get("already"), "④ 반영 성공", str(r2["결과"])[:200])
ok("제안" in r2, "④ 응답에 재계산본 동봉")
after = (VAULT / REL).read_text(encoding="utf-8")
# ⛔ 전사이므로 대비표 글자 그대로 들어간다(가운뎃점 이형 포함) — 그 부분은 비교에서 뺀다.
ok(target["개정줄"] in after, "본문이 개정 문구로 바뀜(대비표 글자 그대로)", target["개정줄"][:60])
ok("검수상태: 미검수" in after and "개정일: 2026-08-03" in after, "미검수 복귀 · 개정일 갱신")

# 멱등
r3 = boss.post(f"/app/corpus/uploads/{UID}/amend/apply", json=SEL).json()
ok(r3["결과"].get("already") is True, "두 번 눌러도 안전(already)", str(r3["결과"])[:160])

# ⑥ 로그
lg = boss.get("/app/corpus/amend/log").json()["log"]
ok(any(x["event"] == "amend_apply" for x in lg), "⑥ 반영 로그 기록")
ok(any(x["event"] == "amend_blocked" for x in lg), "⑥ 거부도 로그에 남는다")
ok(joe.get("/app/corpus/amend/log").status_code == 403, "① 로그도 관리자 전용")

print(f"\n{'❌ ' + str(len(fails)) + '건 실패' if fails else '✅ 전부 통과'} — 개정 반영 API")
sys.exit(1 if fails else 0)
