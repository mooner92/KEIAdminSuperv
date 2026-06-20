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
import secrets
import time
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
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


def init_db():
    SQLModel.metadata.create_all(engine)


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


# ───────────────────────── 스키마 ─────────────────────────
class AuthIn(BaseModel):
    username: str
    password: str


class MsgIn(BaseModel):
    content: str


class RenameIn(BaseModel):
    title: str


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
        uid, un = (u.id, u.username) if u else (None, None)
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
    return {"id": user.id, "username": user.username}


# ───────────────────────── chat 엔드포인트 ─────────────────────────
def _ses(cs: ChatSession) -> dict:
    return {"id": cs.id, "title": cs.title, "created_at": cs.created_at, "updated_at": cs.updated_at}


def _msg(m: Message) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "sources": json.loads(m.sources_json) if m.sources_json else [],
        "created_at": m.created_at,
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
        return {"session": _ses(cs), "messages": [_msg(m) for m in msgs]}


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
