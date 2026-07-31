#!/usr/bin/env python3
"""test_auth_hardening.py — 인증 하드닝(보안 스캔 F9/F17/F18) 회귀.

FastAPI TestClient로 임시 DB 위에 실제 앱을 띄워 요청을 보낸다(코드 낭독 아님).
  cd tools && .venv/bin/python test_auth_hardening.py

지키는 계약:
  F18  기존 미인증 계정의 비밀번호를 미인증 요청자가 덮어쓸 수 없다
  F17  관리자가 이미 있으면 APP_ADMINS 주소로 가입해도 즉시 관리자가 되지 않는다
       (단, 관리자가 하나도 없을 때의 부트스트랩은 그대로 동작해야 한다 — 데드락 방지)
  F9   로그인 레이트리밋은 아이디 대소문자를 바꿔 우회할 수 없다
"""
import importlib
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_tmpdbs: list[str] = []
_app_api = None


def _fresh_app(admins: str = ""):
    """임시 SQLite로 갈아끼운 앱 인스턴스를 돌려준다.

    ⚠ app_api를 재임포트하지 않는다 — SQLModel 테이블이 중복 정의돼 터진다.
       대신 모듈을 한 번만 적재하고 매 테스트마다 engine만 새 임시 DB로 교체한다.
       APP_ADMINS는 _is_admin_name이 호출 시점에 env를 읽으므로 환경변수만 바꾸면 된다.
    """
    global _app_api
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlmodel import SQLModel, create_engine

    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    _tmpdbs.append(tmp.name)
    os.environ["APP_ADMINS"] = admins
    os.environ["APP_REG_RL_MAX"] = "1000"  # 가입 레이트리밋은 이 테스트의 관심사가 아니다
    os.environ.setdefault("APP_SECRET", "test-secret-for-auth-hardening")

    if _app_api is None:
        os.environ["APP_DB"] = tmp.name
        _app_api = importlib.import_module("app_api")

    _app_api.engine = create_engine(f"sqlite:///{tmp.name}",
                                    connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(_app_api.engine)
    if hasattr(_app_api, "_RL"):
        _app_api._RL.clear()

    # 승인제로 고정 — 코드 발송 경로를 타면 SMTP가 없어 503이 난다.
    # 이 테스트의 관심사는 가입 '승인 경로'가 아니라 계정 탈취·권한상승이다.
    _app_api.effective_flags = lambda: {"signup_approval": True, "signup_open": False}

    app = FastAPI()
    app.include_router(_app_api.router)   # router가 이미 prefix="/app"을 갖는다
    return _app_api, TestClient(app)


def _register(c, email, pw="password123"):
    return c.post("/app/auth/register", json={"username": email, "password": pw})


def t_f18_비밀번호_탈취_불가():
    from sqlmodel import Session, select
    app_api, c = _fresh_app()
    victim = "victim@kei.re.kr"

    r1 = _register(c, victim, "victim-original-pw")
    assert r1.status_code == 200, f"최초 가입 실패: {r1.status_code} {r1.text}"

    r2 = _register(c, victim, "attacker-chosen-pw")  # 공격자의 재가입
    assert r2.status_code == 409, f"재가입이 거부되지 않음: {r2.status_code} {r2.text}"

    with Session(app_api.engine) as s:
        u = s.exec(select(app_api.User).where(app_api.User.username == victim)).first()
        assert app_api.check_pw("victim-original-pw", u.password_hash), "원래 비밀번호가 무효화됨"
        assert not app_api.check_pw("attacker-chosen-pw", u.password_hash), \
            "🚨 공격자가 고른 비밀번호로 계정이 넘어감"


def t_f17_관리자_존재시_선점_불가():
    from sqlmodel import Session, select
    admin, second = "boss@kei.re.kr", "second@kei.re.kr"
    app_api, c = _fresh_app(admins=f"{admin},{second}")

    r = _register(c, admin, "admin-pw-12345")
    assert r.status_code == 200 and r.json().get("bootstrap") is True, \
        f"첫 관리자 부트스트랩이 동작하지 않음: {r.status_code} {r.text}"

    r2 = _register(c, second, "landgrab-pw-123")
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert not body.get("bootstrap"), f"🚨 관리자 선점 성공: {body}"
    assert not body.get("is_admin"), f"🚨 즉시 관리자 권한 획득: {body}"
    with Session(app_api.engine) as s:
        u = s.exec(select(app_api.User).where(app_api.User.username == second)).first()
        assert not u.verified, "🚨 메일함 소유 증명 없이 계정이 활성화됨"

    # ⛔ 여기까지만 검사하면 안 된다 — 2차 스캔 F1(docs/65 §2)이 정확히 이 지점을 통과했다.
    #   register를 막아도 login이 APP_ADMINS 이름에 verified 검사를 면제하면,
    #   '가입 → 로그인' 두 단계로 관리자 쿠키가 그대로 발급된다.
    #   테스트가 '막았다고 주장하는 것'과 '실제로 시도하는 것'이 다르면 그건 거짓 안심이다.
    r3 = c.post("/app/auth/login", json={"username": second, "password": "landgrab-pw-123"})  # gitleaks:allow — 합성 픽스처
    assert r3.status_code == 403, (
        f"🚨 미인증 선점 계정으로 로그인 성공: {r3.status_code} {r3.text}")
    assert "kei_session" not in r3.cookies, "🚨 미인증 계정에 세션 쿠키 발급됨"


def t_f17_관리자_부재시_부트스트랩_보존():
    """데드락 방지라는 본래 목적을 깨지 않았는지 — 이게 깨지면 아무도 승인 못 한다."""
    app_api, c = _fresh_app(admins="only@kei.re.kr")
    r = _register(c, "only@kei.re.kr", "admin-pw-12345")
    assert r.status_code == 200 and r.json().get("bootstrap") is True, \
        f"관리자 부재 상황의 부트스트랩이 막힘: {r.status_code} {r.text}"


def t_f9_레이트리밋_대소문자_우회_불가():
    app_api, c = _fresh_app()
    target = "target@kei.re.kr"
    _register(c, target, "correct-horse-1")

    variants = [target, target.upper(), "Target@Kei.Re.Kr",
                "TARGET@kei.re.kr", "tArGeT@KEI.RE.KR"]
    for i in range(40):
        r = c.post("/app/auth/login",
                   json={"username": variants[i % len(variants)], "password": f"wrong-{i}"})
        if r.status_code == 429:
            return  # 레이트리밋 발동 — 통과
    raise AssertionError("🚨 대소문자를 바꿔 40회 시도했는데 레이트리밋이 걸리지 않음")


TESTS = [
    ("F18 미인증 계정 비밀번호 탈취 불가", t_f18_비밀번호_탈취_불가),
    ("F17 관리자 존재 시 명단 주소 선점 불가", t_f17_관리자_존재시_선점_불가),
    ("F17 관리자 부재 시 부트스트랩 보존", t_f17_관리자_부재시_부트스트랩_보존),
    ("F9  레이트리밋 대소문자 우회 불가", t_f9_레이트리밋_대소문자_우회_불가),
]


def main() -> int:
    bad = 0
    for name, fn in TESTS:
        try:
            fn()
            print(f"  ✅ {name}")
        except AssertionError as e:
            bad += 1
            print(f"  ❌ {name}\n      {e}")
        except Exception as e:  # 설정 오류도 실패로 본다(조용한 스킵 금지)
            bad += 1
            print(f"  ❌ {name} — 예외: {type(e).__name__}: {e}")
    for p in _tmpdbs:
        try:
            os.unlink(p)
        except OSError:
            pass
    print(f"\n{'🎉 전 케이스 통과' if not bad else f'⚠ {bad}건 실패'} ({len(TESTS)}건)")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
