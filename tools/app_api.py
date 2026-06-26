#!/usr/bin/env python3
"""app_api.py — LLM 앱: 로그인 + 채팅기록 영속화 + 멀티턴 + 메시지별 근거.

설계(조사 확정): bcrypt(직접) + PyJWT(httpOnly 쿠키) + SQLModel/SQLite.
- passlib 미사용(bcrypt 5 호환 이슈), fastapi-users 미사용(과함, 2026 유지보수 모드).
- DB: tools/app.db (SQLite). gitignore됨(사용자·채팅 데이터 + 규정 스니펫 포함).
- 라우터 prefix=/app. 04_rag_api.py가 include_router로 마운트(한 프로세스, RAG 코어 공유).
- 프론트는 server.js가 /api/app/* → /app/* 로 같은 오리진 프록시(쿠키 포함). RAG API는 127.0.0.1 전용.

가드레일: RAG 답변은 rag_core(근거 밖 금지·출처·면책)를 그대로 사용. 멀티턴이어도 사실 근거는 매 턴 [근거]에서만.
"""
import datetime
import json
import os
import re
import secrets
import time
from collections import Counter
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import event
from sqlmodel import Field, Session, SQLModel, create_engine, select

import rag_core

DB_PATH = os.environ.get("APP_DB", os.path.join(os.path.dirname(__file__), "app.db"))
SECRET_PATH = os.environ.get("APP_SECRET_FILE", os.path.join(os.path.dirname(__file__), ".app_secret"))
COOKIE = "kei_session"
TOKEN_DAYS = 14


def _load_secret() -> str:
    """JWT 서명키. 재시작에도 세션 유지되도록 파일에 보관(없으면 생성). gitignore됨."""
    if os.path.exists(SECRET_PATH):
        with open(SECRET_PATH) as f:
            s = f.read().strip()
        if s:
            return s
    s = secrets.token_urlsafe(48)
    with open(SECRET_PATH, "w") as f:
        f.write(s)
    os.chmod(SECRET_PATH, 0o600)
    return s


SECRET = _load_secret()
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _rec):
    """WAL + busy_timeout: 동시 쓰기('database is locked' 500) 완화. 채팅·플래그 쓰기 공용 견고화."""
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.close()


# ───────────────────────── 모델 ─────────────────────────
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    created_at: float = Field(default_factory=time.time)


class ChatSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    title: str = "새 대화"
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class Message(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(index=True)
    role: str  # user | assistant
    content: str
    sources_json: str = ""  # assistant 메시지의 근거(JSON 문자열)
    created_at: float = Field(default_factory=time.time)


class Feedback(SQLModel, table=True):
    """답변 피드백(👍/👎 + 사유). 사용자당·메시지당 1건(코드 레벨 upsert).
    ⛔ 가드레일: 이 신호는 '무엇부터 다시 검수할지' 우선순위에만 쓰인다 —
       검수상태(미검수→검수완료)를 자동으로 바꾸지 않는다(사람만). feedback_export.py가 소비."""
    id: Optional[int] = Field(default=None, primary_key=True)
    message_id: int = Field(index=True)
    session_id: int = Field(index=True)
    user_id: int = Field(index=True)
    rating: str  # up | down
    reason: str = ""
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


# ───────────────────────── 기능 플래그 ─────────────────────────
# 메타데이터(기본값·설명·소유자·만료)는 '코드 레지스트리'에, 현재 값은 DB(Flag)에 둔다.
# → 프론트가 알 수 있는 플래그 목록·안전 기본값은 코드가 단일 출처. DB는 런타임 오버라이드.
# ⛔ 클라이언트로 내려가는 값이므로 민감정보(금액·한도·내부로직) 금지. 다 쓴 플래그는 만료일 맞춰 제거(flag debt).
FLAG_REGISTRY: dict = {
    "demo_banner": {
        "default": False,
        "description": "전 화면 상단에 '미리보기' 배너 표시 (기능 플래그 예시·검증용)",
        "owner": "platform",
        "expires": "",  # 예시(장수). 실제 release 플래그는 실제 만료일(YYYY-MM-DD)을 적어 정리 강제
    },
    "cite_highlight": {
        "default": False,  # release 플래그 — off로 배포, 파일럿 검증 후 on, 안정되면 플래그 제거
        "description": "근거 조문 클릭 시 문서 드로어에서 인용 조문(별표 포함) 블록 형광 강조 + 근거 패널 '핵심 근거' 표시 (#1 피드백)",
        "owner": "platform",
        "expires": "2026-07-20",  # ⛔ 이 날짜까지 검증→상시적용(플래그 제거) 또는 폐기. flag debt 정리
    },
    "graph_split": {
        "default": False,  # release 플래그
        "description": "관계 그래프에서 노드 클릭 시 페이지 이동 대신 옆에 문서 패널을 열어 그래프와 동시에 보기(분할 뷰)",
        "owner": "platform",
        "expires": "2026-07-24",
    },
}


class Flag(SQLModel, table=True):
    key: str = Field(primary_key=True)
    enabled: bool = False
    updated_by: str = ""
    updated_at: float = Field(default_factory=time.time)


class FlagAudit(SQLModel, table=True):  # 누가 언제 무엇을 토글했는지(감사 — 행정/감사 영역 필수)
    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(index=True)
    enabled: bool
    actor: str
    at: float = Field(default_factory=time.time)


def ensure_flags():
    """레지스트리에 정의된 플래그가 DB에 없으면 기본값으로 생성(idempotent).
    필수키 누락 등 잘못된 항목은 건너뛰고 경고만(한 플래그 실수가 API 전체 기동을 막지 않도록 — fail-safe)."""
    with Session(engine) as s:
        existing = {f.key for f in s.exec(select(Flag)).all()}
        for k, meta in FLAG_REGISTRY.items():
            if not isinstance(meta, dict):
                print(f"⚠ FLAG_REGISTRY['{k}'] 형식 오류 — 건너뜀")
                continue
            if k not in existing:
                s.add(Flag(key=k, enabled=bool(meta.get("default", False)), updated_by="(default)"))
        s.commit()


def effective_flags() -> dict:
    """레지스트리 기준 현재 유효값 {key: bool}. DB값 우선, 없으면 기본값(누락 시 안전한 False)."""
    with Session(engine) as s:
        db = {f.key: f.enabled for f in s.exec(select(Flag)).all()}
    return {k: bool(db.get(k, (meta or {}).get("default", False))) for k, meta in FLAG_REGISTRY.items()}


def init_db():
    SQLModel.metadata.create_all(engine)
    ensure_flags()
    if not {x.strip() for x in os.environ.get("APP_ADMINS", "").split(",") if x.strip()}:
        print("⚠ APP_ADMINS 미설정 — 기능 플래그 관리자 기능 비활성(아무도 토글 불가). 운영자 아이디를 APP_ADMINS에 설정하세요.")


# ───────────────────────── 인증 ─────────────────────────
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def check_pw(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8")[:72], h.encode("utf-8"))
    except Exception:
        return False


def make_token(uid: int) -> str:
    exp = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=TOKEN_DAYS)
    return jwt.encode({"uid": uid, "exp": exp}, SECRET, algorithm="HS256")


def set_cookie(resp: Response, token: str):
    # 내부망 HTTP이므로 secure=False. (Cloudflare ZT/HTTPS 도입 시 secure=True 권장)
    resp.set_cookie(COOKIE, token, max_age=TOKEN_DAYS * 86400,
                    httponly=True, samesite="lax", path="/")


def current_user(request: Request) -> User:
    tok = request.cookies.get(COOKIE)
    if not tok:
        raise HTTPException(401, "로그인이 필요합니다.")
    try:
        uid = jwt.decode(tok, SECRET, algorithms=["HS256"])["uid"]
    except Exception:
        raise HTTPException(401, "세션이 만료되었습니다. 다시 로그인하세요.")
    with Session(engine) as s:
        u = s.get(User, uid)
    if not u:
        raise HTTPException(401, "사용자를 찾을 수 없습니다.")
    return u


def is_admin(u: User) -> bool:
    """관리자 판별: APP_ADMINS(쉼표 구분 아이디)에 포함되면 관리자.
    ⚠ fail-closed: APP_ADMINS 미설정이면 '아무도 관리자 아님'(공개 register로 인한 권한상승 방지).
    부트스트랩은 안 쓴다 — 운영자가 APP_ADMINS를 명시해야 관리자 기능이 켜진다."""
    names = {x.strip() for x in os.environ.get("APP_ADMINS", "").split(",") if x.strip()}
    return bool(names) and u.username in names


def current_admin(user: User = Depends(current_user)) -> User:
    if not is_admin(user):
        raise HTTPException(403, "관리자 권한이 필요합니다.")
    return user


# ───────────────────────── 스키마 ─────────────────────────
class AuthIn(BaseModel):
    username: str
    password: str


class MsgIn(BaseModel):
    content: str


class RenameIn(BaseModel):
    title: str


class FeedbackIn(BaseModel):
    rating: str            # up | down
    reason: str = ""       # 선택(👎일 때 무엇이 부족했는지)


router = APIRouter(prefix="/app")


# ───────────────────────── auth 엔드포인트 ─────────────────────────
@router.post("/auth/register")
def register(body: AuthIn, response: Response):
    uname = body.username.strip()
    if len(uname) < 2 or len(body.password) < 4:
        raise HTTPException(400, "아이디는 2자, 비밀번호는 4자 이상이어야 합니다.")
    with Session(engine) as s:
        if s.exec(select(User).where(User.username == uname)).first():
            raise HTTPException(409, "이미 존재하는 아이디입니다.")
        u = User(username=uname, password_hash=hash_pw(body.password))
        s.add(u)
        s.commit()
        s.refresh(u)
        uid, un = u.id, u.username
    set_cookie(response, make_token(uid))
    return {"id": uid, "username": un}


@router.post("/auth/login")
def login(body: AuthIn, response: Response):
    with Session(engine) as s:
        u = s.exec(select(User).where(User.username == body.username.strip())).first()
        ok = bool(u) and check_pw(body.password, u.password_hash)
        uid, un = (u.id, u.username) if ok else (None, None)  # 성공 시에만 uid 설정(None 토큰 발급 방지)
    if not ok:
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")
    set_cookie(response, make_token(uid))
    return {"id": uid, "username": un}


@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/auth/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "username": user.username, "is_admin": is_admin(user)}


# ───────────────────────── 기능 플래그 엔드포인트 ─────────────────────────
class FlagIn(BaseModel):
    enabled: bool


@router.get("/flags")
def get_flags():
    """현재 유효 플래그 {key: bool}. 인증 불요(둘러보기/그래프도 사용) — UI 토글일 뿐 비민감."""
    return effective_flags()


@router.get("/flags/manage")
def manage_flags(admin: User = Depends(current_admin)):
    """관리자 페이지용: 메타데이터 포함 전체 목록."""
    eff = effective_flags()
    with Session(engine) as s:
        rows = {f.key: f for f in s.exec(select(Flag)).all()}
    flags = []
    for k, meta in FLAG_REGISTRY.items():
        r = rows.get(k)
        flags.append({
            "key": k, "enabled": eff[k], "description": (meta or {}).get("description", ""),
            "owner": (meta or {}).get("owner", ""), "expires": (meta or {}).get("expires", ""),
            "updated_by": r.updated_by if r else "", "updated_at": r.updated_at if r else None,
        })
    return {"flags": flags, "admin": admin.username}


@router.post("/flags/{key}")
def set_flag(key: str, body: FlagIn, admin: User = Depends(current_admin)):
    if key not in FLAG_REGISTRY:
        raise HTTPException(404, "알 수 없는 플래그입니다.")
    now = time.time()  # updated_at과 audit.at을 동일 시각으로
    with Session(engine) as s:
        f = s.exec(select(Flag).where(Flag.key == key)).first() or Flag(key=key)
        f.enabled = body.enabled
        f.updated_by = admin.username
        f.updated_at = now
        s.add(f)
        s.add(FlagAudit(key=key, enabled=body.enabled, actor=admin.username, at=now))
        s.commit()
        s.refresh(f)
    return {"key": key, "enabled": f.enabled, "updated_by": f.updated_by, "updated_at": f.updated_at}


@router.get("/flags/audit")
def flag_audit(admin: User = Depends(current_admin), limit: int = 50):
    with Session(engine) as s:
        rows = s.exec(select(FlagAudit).order_by(FlagAudit.at.desc()).limit(limit)).all()
    return [{"key": r.key, "enabled": r.enabled, "actor": r.actor, "at": r.at} for r in rows]


# ───────────────────────── chat 엔드포인트 ─────────────────────────
def _ses(cs: ChatSession) -> dict:
    return {"id": cs.id, "title": cs.title, "created_at": cs.created_at, "updated_at": cs.updated_at}


def _msg(m: Message, fb: Optional[dict] = None) -> dict:
    """fb: {message_id: {"rating","reason"}} — 이 사용자의 피드백 상태(없으면 None)."""
    f = (fb or {}).get(m.id)
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "sources": json.loads(m.sources_json) if m.sources_json else [],
        "created_at": m.created_at,
        "feedback": f["rating"] if f else None,
        "feedback_reason": (f.get("reason") if f else "") or "",
    }


def _owned(s: Session, cid: int, user: User) -> ChatSession:
    cs = s.get(ChatSession, cid)
    if not cs or cs.user_id != user.id:
        raise HTTPException(404, "대화를 찾을 수 없습니다.")
    return cs


@router.get("/chats")
def list_chats(user: User = Depends(current_user)):
    with Session(engine) as s:
        rows = s.exec(
            select(ChatSession).where(ChatSession.user_id == user.id)
            .order_by(ChatSession.updated_at.desc())
        ).all()
        return [_ses(c) for c in rows]


@router.post("/chats")
def create_chat(user: User = Depends(current_user)):
    with Session(engine) as s:
        cs = ChatSession(user_id=user.id)
        s.add(cs)
        s.commit()
        s.refresh(cs)
        return _ses(cs)


@router.get("/chats/{cid}")
def get_chat(cid: int, user: User = Depends(current_user)):
    with Session(engine) as s:
        cs = _owned(s, cid, user)
        msgs = s.exec(
            select(Message).where(Message.session_id == cid)
            .order_by(Message.created_at, Message.id)
        ).all()
        fb = {
            f.message_id: {"rating": f.rating, "reason": f.reason}
            for f in s.exec(
                select(Feedback).where(Feedback.session_id == cid)
                .where(Feedback.user_id == user.id)
            ).all()
        }
        return {"session": _ses(cs), "messages": [_msg(m, fb) for m in msgs]}


@router.patch("/chats/{cid}")
def rename_chat(cid: int, body: RenameIn, user: User = Depends(current_user)):
    with Session(engine) as s:
        cs = _owned(s, cid, user)
        cs.title = (body.title.strip()[:80]) or cs.title
        s.add(cs)
        s.commit()
        s.refresh(cs)
        return _ses(cs)


@router.delete("/chats/{cid}")
def delete_chat(cid: int, user: User = Depends(current_user)):
    with Session(engine) as s:
        cs = _owned(s, cid, user)
        for m in s.exec(select(Message).where(Message.session_id == cid)).all():
            s.delete(m)
        s.delete(cs)
        s.commit()
    return {"ok": True}


# ───────────────────────── 답변 피드백(👍/👎) ─────────────────────────
def _owned_assistant_msg(s: Session, mid: int, user: User) -> Message:
    """피드백 대상 메시지: 존재 + 본인 소유 세션 + assistant 역할이어야 한다."""
    m = s.get(Message, mid)
    if not m:
        raise HTTPException(404, "메시지를 찾을 수 없습니다.")
    cs = s.get(ChatSession, m.session_id)
    if not cs or cs.user_id != user.id:
        raise HTTPException(404, "메시지를 찾을 수 없습니다.")
    if m.role != "assistant":
        raise HTTPException(400, "답변 메시지에만 피드백할 수 있습니다.")
    return m


@router.post("/messages/{mid}/feedback")
def set_feedback(mid: int, body: FeedbackIn, user: User = Depends(current_user)):
    """답변에 👍/👎(+사유) 남기기. 같은 메시지에 다시 보내면 갱신(upsert)."""
    rating = (body.rating or "").strip().lower()
    if rating not in ("up", "down"):
        raise HTTPException(400, "rating은 'up' 또는 'down'이어야 합니다.")
    reason = (body.reason or "").strip()[:500]
    now = time.time()
    with Session(engine) as s:
        m = _owned_assistant_msg(s, mid, user)
        f = s.exec(
            select(Feedback).where(Feedback.message_id == mid).where(Feedback.user_id == user.id)
        ).first()
        if f:
            f.rating, f.reason, f.updated_at = rating, reason, now
        else:
            f = Feedback(message_id=mid, session_id=m.session_id, user_id=user.id,
                         rating=rating, reason=reason, created_at=now, updated_at=now)
        s.add(f)
        s.commit()
    return {"message_id": mid, "feedback": rating, "feedback_reason": reason}


@router.delete("/messages/{mid}/feedback")
def clear_feedback(mid: int, user: User = Depends(current_user)):
    """피드백 철회(같은 버튼 다시 누름)."""
    with Session(engine) as s:
        _owned_assistant_msg(s, mid, user)  # 소유 확인(없는/남의 메시지 404)
        f = s.exec(
            select(Feedback).where(Feedback.message_id == mid).where(Feedback.user_id == user.id)
        ).first()
        if f:
            s.delete(f)
            s.commit()
    return {"message_id": mid, "feedback": None}


@router.get("/feedback")
def list_feedback(admin: User = Depends(current_admin), rating: str = "", limit: int = 200):
    """관리자: 피드백 신호 목록. ⛔ 개인정보: 질문·답변 '원문'은 반환하지 않는다 — 관리자는
    어떤 규정이 어떤 평가를 받았는지(👍/👎)와 사용자가 남긴 피드백 사유만 본다(채팅 본문 비노출).
    rating='down'이면 부정만. 규정 단위 집계는 feedback_export.py(검수 큐 연동)도 참고."""
    rating = (rating or "").strip().lower()
    limit = max(1, min(limit, 1000))
    with Session(engine) as s:
        stmt = select(Feedback)
        if rating in ("up", "down"):
            stmt = stmt.where(Feedback.rating == rating)
        rows = s.exec(stmt.order_by(Feedback.updated_at.desc()).limit(limit)).all()
        out = []
        for f in rows:
            m = s.get(Message, f.message_id)
            srcs = json.loads(m.sources_json) if (m and m.sources_json) else []
            out.append({
                "id": f.id, "rating": f.rating, "reason": f.reason, "at": f.updated_at,
                # 질문/답변 본문은 의도적으로 제외(개인 채팅 보호). 규정 메타만.
                "sources": [{"규정명": x.get("규정명", ""), "조": x.get("조", "")} for x in srcs],
            })
    return out


# ───────────────────────── 운영 대시보드(관리자) ─────────────────────────
# 거부(가드레일 발동) 답변 감지 — rag_core SYSTEM의 "규정에서 확인되지 않습니다" 계열.
REFUSAL_RE = re.compile(r"확인되지\s*않|확인할\s*수\s*없|규정에서\s*확인")
# k-익명성: 질문 텍스트는 서로 다른 사용자 K명 이상이 물었을 때만 노출(개인 채팅 보호).
# 서버사이드 RAG라 진짜 E2E 암호화는 불가(LLM이 평문을 읽어야 함) → 관리자에겐 '집계'만 보인다.
K_ANON = max(2, int(os.environ.get("STATS_MIN_USERS", "3")))


def _norm_q(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").strip())[:120]


@router.get("/stats")
def stats(admin: User = Depends(current_admin), days: int = 30):
    """운영 대시보드: 활동 요약·거부율·피드백 + **k-익명** 인기질문·콘텐츠 갭. 관리자 전용.
    ⛔ 개인정보: 질문·답변 '원문'은 절대 노출하지 않는다. 인기질문/갭은 서로 다른 사용자 K명
    이상이 물은 것만 보이고(1~2명의 고유·민감 질문은 숨김), 누가 물었는지도 알 수 없다."""
    days = max(1, min(days, 365))
    since = time.time() - days * 86400
    with Session(engine) as s:
        n_users = len(s.exec(select(User)).all())
        chats = s.exec(select(ChatSession)).all()
        msgs = s.exec(select(Message)).all()
        fbs = s.exec(select(Feedback)).all()

    sess_user = {c.id: c.user_id for c in chats}  # 세션→사용자(질문을 사용자에 매핑, k-익명 집계용)
    recent = [m for m in msgs if m.created_at >= since]
    user_msgs = [m for m in recent if m.role == "user" and (m.content or "").strip()]
    ai_msgs = [m for m in recent if m.role == "assistant"]
    refusals = [m for m in ai_msgs if REFUSAL_RE.search(m.content or "")]

    # 세션별 시간순 정렬 → 거부 답변의 직전 사용자 질문(콘텐츠 갭) 추적
    by_session: dict = {}
    for m in msgs:
        by_session.setdefault(m.session_id, []).append(m)
    for v in by_session.values():
        v.sort(key=lambda x: (x.created_at, x.id or 0))

    def prev_q(m: Message) -> str:
        seq = by_session.get(m.session_id, [])
        idx = next((i for i, x in enumerate(seq) if x.id == m.id), None)
        if idx is None:
            return ""
        for j in range(idx - 1, -1, -1):
            if seq[j].role == "user":
                return seq[j].content
        return ""

    def k_anon(pairs):
        """[(정규화질문, session_id)] → 서로 다른 사용자 K명 이상이 물은 질문만 {q, n=사용자수}."""
        users: dict = {}
        for q, sid in pairs:
            if not q:
                continue
            users.setdefault(q, set()).add(sess_user.get(sid))
        rows = [{"q": q, "n": len(u - {None})} for q, u in users.items()]
        rows = [r for r in rows if r["n"] >= K_ANON]
        rows.sort(key=lambda r: -r["n"])
        return rows

    top_questions = k_anon([(_norm_q(m.content), m.session_id) for m in user_msgs])[:10]
    gaps = k_anon([(_norm_q(prev_q(m)), m.session_id) for m in refusals])[:15]
    fb_recent = [f for f in fbs if f.updated_at >= since]
    n_ai = len(ai_msgs)
    return {
        "days": days, "k_anon": K_ANON,
        "users": n_users, "chats": len(chats),
        "questions": len(user_msgs), "answers": n_ai,
        "refusals": len(refusals),
        "refusal_rate": round(len(refusals) / n_ai, 3) if n_ai else 0.0,
        "feedback": {
            "up": sum(1 for f in fb_recent if f.rating == "up"),
            "down": sum(1 for f in fb_recent if f.rating == "down"),
        },
        "top_questions": top_questions,  # {q, n=사용자수} — K명 이상만
        "gaps": gaps,                    # 거부된 질문도 K명 이상만(보강 우선순위)
    }


def _sse(obj: dict) -> str:
    return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"


@router.post("/chats/{cid}/messages")
def post_message(cid: int, body: MsgIn, stream: bool = False, user: User = Depends(current_user)):
    q = body.content.strip()
    if not q:
        raise HTTPException(400, "질문이 비어 있습니다.")
    # 1) 소유 확인 + 이전 대화(멀티턴 맥락) 로드
    with Session(engine) as s:
        _owned(s, cid, user)
        prior = s.exec(
            select(Message).where(Message.session_id == cid)
            .order_by(Message.created_at, Message.id)
        ).all()
        history = [{"role": m.role, "content": m.content} for m in prior]
    # 2) 검색: 후속 질문을 직전 맥락으로 재작성한 독립 검색어로 회수(멀티턴 정확도↑). 답변은 원 질문 q로.
    q_search = rag_core.condense_query(q, history)
    context, sources = rag_core.retrieve(q_search)

    # 비스트리밍(하위호환): 한 번에 생성 후 저장
    if not stream:
        try:
            ans = rag_core.answer(q, context, history)
        except Exception as e:
            ans = ("⚠️ 생성 모델에 연결하지 못했습니다. 회수된 근거 조문은 우측에 표시됩니다.\n"
                   f"(관리자 확인: {rag_core.VLLM_BASE} / {rag_core.LLM_MODEL} · {type(e).__name__})")
        with Session(engine) as s:
            cs = _owned(s, cid, user)
            um = Message(session_id=cid, role="user", content=q)
            am = Message(session_id=cid, role="assistant", content=ans,
                         sources_json=json.dumps(sources, ensure_ascii=False))
            s.add(um)
            s.add(am)
            if cs.title == "새 대화":
                cs.title = q[:40]
            cs.updated_at = time.time()
            s.add(cs)
            s.commit()
            s.refresh(um)
            s.refresh(am)
            s.refresh(cs)
            return {"user": _msg(um), "assistant": _msg(am), "session": _ses(cs)}

    # 스트리밍(SSE): meta(근거+user) → delta(토큰…) → done(저장된 assistant+session)
    def gen():
        # user 메시지 먼저 저장(스트림이 끊겨도 질문은 보존)
        with Session(engine) as s:
            um = Message(session_id=cid, role="user", content=q)
            s.add(um)
            s.commit()
            s.refresh(um)
            user_dict = _msg(um)
        yield _sse({"type": "meta", "sources": sources, "user": user_dict})
        # 토큰 스트리밍
        acc, err = [], None
        try:
            for tok in rag_core.answer_stream(q, context, history):
                acc.append(tok)
                yield _sse({"type": "delta", "t": tok})
        except Exception as e:
            err = type(e).__name__
        full = "".join(acc)
        if not full:
            full = ("⚠️ 생성 모델에 연결하지 못했습니다. 회수된 근거 조문은 우측에 표시됩니다."
                    + (f" ({err})" if err else ""))
        # assistant 메시지 저장 + 제목/시각 갱신
        with Session(engine) as s:
            cs = s.get(ChatSession, cid)
            am = Message(session_id=cid, role="assistant", content=full,
                         sources_json=json.dumps(sources, ensure_ascii=False))
            s.add(am)
            if cs and cs.title == "새 대화":
                cs.title = q[:40]
            if cs:
                cs.updated_at = time.time()
                s.add(cs)
            s.commit()
            s.refresh(am)
            if cs:
                s.refresh(cs)
            yield _sse({"type": "done", "assistant": _msg(am), "session": _ses(cs) if cs else None})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# 모듈 로드 시 테이블 보장(idempotent)
init_db()
