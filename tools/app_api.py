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
import sys
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
    username: str = Field(index=True, unique=True)  # 가입 정책(docs/29 §3) 이후 = 이메일(@kei.re.kr)
    password_hash: str
    created_at: float = Field(default_factory=time.time)
    # 이메일 인증 여부. 정책 이전 가입 계정은 마이그레이션에서 1로 백필(잠금 방지),
    # 신규 가입은 0으로 시작 → 코드 인증 후 1 (미인증 로그인 불가).
    verified: bool = Field(default=False)


class VerifyCode(SQLModel, table=True):
    """가입 이메일 인증 코드(6자리). 이메일당 최신 1건만 유효(재발송 시 교체).
    코드 원문은 저장하지 않고 해시만(SECRET 기반 HMAC) — DB 유출 시에도 코드 노출 없음."""
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True)
    code_hash: str
    expires_at: float
    attempts: int = 0            # 검증 실패 횟수(5회 초과 시 코드 무효 — 무차별 대입 방지)
    last_sent_at: float = 0.0    # 재발송 쿨다운(60초) 기준
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
    # demo_banner(예시용)는 changelog 배너로 대체·제거(docs/32 — flag debt 정리, 2026-07-14)
    "changelog": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "새로워진 점(docs/32) — 상단 배너(최신 업데이트 한 줄, 닫기 지속·새 노트 재노출) + "
                       "/changelog 페이지 + 푸터 링크. 노트 원문은 볼트 90_관리/_changelog(비공개).",
        "owner": "platform",
        "expires": "2026-12-31",
    },
    "graph_expand_regs": {
        "default": False,  # ⛔ off로 배포 — top-k 희석 위험이라 평가로 이득 입증 후 on(하이브리드·다양성과 동일 규율)
        "description": "검색 시 회수 조문이 준용/참조하는 다른 규정 조문을 근거에 자동 첨부(규정↔규정 1홉 확장). "
                       "'이 지침이 저 규정과 상충?'류에 유효. 백엔드 검색 동작 — 토글 시 ~20초 내 반영. eval 후 on 판단.",
        "owner": "rag",
        "expires": "",  # 실험 플래그 — eval 후 상시적용 또는 제거
    },
    "source_type_badges": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "채팅 근거 패널에 출처 성격 배지 표시 — 📜 규정(공식 원문·진실원천) vs 📘 가이드(우리가 정리한 참고 문서), "
                       "🔗 자동첨부(top-5 검색이 아닌 그래프 확장으로 딸려온 근거: 별표·준용·후속단계·기안) 포함. "
                       "사용자가 '공식 규정'과 '참고 가이드'를 혼동하지 않게 시각 구분. 프론트 전용(재임베딩 불필요).",
        "owner": "platform",
        "expires": "2026-08-15",  # 검증 후 상시적용(플래그 제거) 또는 폐기
    },
    "content_search": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "규정 둘러보기 검색에 범위 선택(제목·규정번호·분류·내용) 추가 + 원문 내용 전문검색. "
                       "내용검색 켤 때만 search-index.json을 lazy-load(browse 번들 불변). 기본 범위=제목+내용.",
        "owner": "platform",
        "expires": "2026-08-31",  # 검증 후 상시적용(플래그 제거) 또는 폐기
    },
    "graph_expand_actions": {
        "default": False,  # ⛔ off로 배포 — 평가로 이득 입증 후 on(graph_expand_regs와 동일 규율)
        "description": "행위 흐름 1홉 확장 — 신청 화면(국내출장신청 등)이 근거로 회수되면 의무적 후속 단계"
                       "(정산·결과보고) 화면 안내를 근거에 자동 첨부하고 답변이 후속 단계를 안내. "
                       "페어는 문서 근거(ERP 상세가이드 부록·PMS 화면쌍)로 확정된 것만. 백엔드 검색 — 토글 ~20초 반영.",
        "owner": "rag",
        "expires": "",  # 실험 플래그 — eval 후 상시적용 또는 제거
    },
    "article_integrity": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "조문 정제·무결성(Track A) UI — 채팅 근거 카드에 조문 효력 배지(⚠삭제됨/최근개정일) + "
                       "문서 드로어에 '준용·참조 조문' 칩·'원문 정의어' 패널. 프론트 표시 전용(백엔드 삭제-강등은 "
                       "RAG_ARTICLE_STATUS로 상시 on). 인덱스 tools/index/*.json(01i·01j·01k) 소비, 재임베딩 불필요.",
        "owner": "platform",
        "expires": "2026-09-30",  # 검증 후 상시적용(플래그 제거) 또는 폐기
    },
    "graph_impact": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "조문 참조 그래프 분석(Track C) UI — 문서 드로어에 '개정 파급(이 규정을 준용/참조하는 규정, "
                       "역방향 전이폐포)'·'함께 보는 조문(공동인용)' 패널. graph_analytics.json(01l, clause_xref 파생) 소비. "
                       "프론트 표시 전용·재임베딩 불필요. 고립 노드 진단은 빌드 리포트.",
        "owner": "platform",
        "expires": "2026-09-30",
    },
    "deadline_calc": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "기한 역산 계산기(Track B) — 문서 드로어에 '이 규정의 기한' 패널. 규정 원문의 상대기한"
                       "(‹기준› 로부터 N일 이내 등, deadlines.json/01m)을 목록화하고, 기준일 입력 시 마감일을 "
                       "순수 산술로 계산·.ics 내보내기. ⛔ 오프셋은 원문 그대로·계산만 자동(추측 없음), 원문 문장 병기.",
        "owner": "platform",
        "expires": "2026-10-15",
    },
    "corpus_admin": {
        "default": False,  # release 플래그 — 관리자 전용 기능이지만 노출도 플래그로(v1.1 P1)
        "description": "코퍼스 관리 P1(docs/20) — /admin에 볼트 문서 목록(청크수·검수상태)·색인 제외 토글·"
                       "재색인 필요 배지. 제외는 soft(exclude.json, 파일 불변·02가 skip), 재색인 실행은 P2에서 버튼화.",
        "owner": "platform",
        "expires": "2026-12-15",
    },
    "table_restore": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "표 복원 검수(docs/24) — /admin '표 복원' 탭에 01p 복원 제안(손상 표 7문서) 열람·대비·"
                       "[반영] 버튼. 반영=사람의 명시적 승인(자동 반영 없음), 헤더 일치+손상 판정 블록만 결정적 교체+백업.",
        "owner": "platform",
        "expires": "2026-12-31",
    },
    "journey_map": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "업무 한 장(docs/25) — /journey 스윔레인 여정 뷰 + GNB. korea100 벤치마킹: 레인(행위자)×단계 "
                       "노드에 ERP 화면·기한·전결·근거 조문. 데이터=볼트 90_관리/_journeys(수작업 큐레이션·미검수 시작).",
        "owner": "platform",
        "expires": "2026-12-31",
    },
    "followup_suggest": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "답변 후속 질문 제안(docs/26) — 무LLM·결정적(여정 점프·ACTION_FLOWS 후속단계·기한). "
                       "답변 하단 칩 최대 3개, 결재선 카드와 중복 금지.",
        "owner": "platform",
        "expires": "2026-12-31",
    },
    "select_ask": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "원문 선택 질문(docs/26) — 문서 드로어에서 구절 드래그 → '이거 물어보기' 팝오버 → "
                       "입력창 프리필(자동 전송 없음).",
        "owner": "platform",
        "expires": "2026-12-31",
    },
    "user_directory": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "관리자 사용자 목록 탭(docs/29 §4) — 이메일·가입일·마지막 활동·채팅 수·인증 여부만. "
                       "🔒 타인 채팅 본문을 읽는 기능은 계속 없음(P2.5 원칙).",
        "owner": "platform",
        "expires": "2026-12-31",
    },
    "trending_keywords": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "채팅 첫 화면 '요즘 많이 찾는 키워드' 칩(docs/29 §1) — 무LLM 사전(여정·용어집) 매칭 "
                       "집계, k-익명(서로 다른 사용자 K명 이상)만 노출, 클릭 시 입력 프리필.",
        "owner": "platform",
        "expires": "2026-12-31",
    },
    "help_hub": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "도움말 허브(docs/31) — 앵커 목차 + '잘 묻는 법' + FAQ 아코디언(기본 접힘) + "
                       "푸터 FAQ 링크. off면 현행 도움말 그대로. ⛔ FAQ에 규정 값(금액·기한) 금지.",
        "owner": "platform",
        "expires": "2026-12-31",
    },
    "explore_upgrades": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "탐색 마감(v1 스펙 ⑬⑭/S7) — ⓐ둘러보기 드로어 URL 딥링크(?doc=슬러그, 뒤로가기 연동) "
                       "ⓑ드로어 내부 탐색 '← 뒤로' 스택 + 전체화면 전환 시 조문 앵커 유지 ⓒ드로어 조문 목차(TOC) 점프 바 "
                       "ⓓ(⑭) 그래프 노드 검색·결재선→별표 원문 링크. 프론트 전용.",
        "owner": "platform",
        "expires": "2026-11-30",
    },
    "answer_actions": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "답변 액션(v1 스펙 ⑫/S6) — ⓐ📋 복사(본문+출처 목록+기준일 자동 부착) ⓑ답변에 실제 "
                       "인용된 [규정명 제N조] → 근거 드로어로 점프하는 앵커 칩 ⓒ금액·수치 답변의 결정적 대조: "
                       "답변 수치가 근거 스니펫 문구에 존재하는지 집계 표시(fail-safe 주의 신호, 검증 아님·무LLM). 프론트 전용.",
        "owner": "platform",
        "expires": "2026-11-15",
    },
    "source_card_v2": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "근거 패널 신뢰 재설계(v1 스펙 ⑧·⑨/S3·S4) — ⓐ배지 3단 위계: 제목줄=출처성격+안전신호"
                       "(⚠삭제·일부반영·✓검수완료)만, 보조(개정일·신설·🔗자동첨부)는 하단 메타줄 ⓑ미검수 표시 정책: "
                       "카드마다 반복 대신 패널 헤더 집계(값 불변) ⓒ⭐핵심근거는 거부 답변에서 억제 ⓓ거부 답변 시 "
                       "'참고 검색 결과'로 리프레임 + 대안 안내 블록. 프론트 전용.",
        "owner": "platform",
        "expires": "2026-10-31",
    },
    "approval_finder": {
        "default": False,  # release 플래그 — off로 배포, dev 검증 후 on
        "description": "결재선 판정기(Track B) — ① 독립 페이지 /approval + 상단 메뉴 '결재선'(둘러보기와 동일 UX: "
                       "직급·구분·전결권자 체크박스 필터+검색범위 태그+페이지네이션) ② 채팅 근거 패널 '결재선을 알아볼까요?' "
                       "제안 카드 → 우측 드로어(업무 키워드 프리셋·퀵칩·0건 직급해제 힌트). 위임전결 별표(○-매트릭스, "
                       "approval.json/01n) 공식 전결기준. ⛔ 실무 결재선은 부서마다 다를 수 있어 '부서 확인' 면책 노출. "
                       "프론트 표시 전용·재임베딩 불필요.",
        "owner": "platform",
        "expires": "2026-10-15",
    },
}


class CorpusAudit(SQLModel, table=True):
    """코퍼스 관리 감사(v1.1 P1): 제외/복귀 이력. ⛔ 검수상태와 무관 — 색인 포함 여부만."""
    id: Optional[int] = Field(default=None, primary_key=True)
    slug: str = Field(index=True)
    action: str  # exclude | include
    actor: str = ""
    at: float = Field(default_factory=time.time)


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


def flag_expiry_status(expires: str, today: str) -> str:
    """플래그 만료 규율(v1 스펙 ⑦/#46): '' → 'ok'(장수) / 만료 지남 → 'overdue' / 14일 이내 → 'soon' / 그 외 'ok'."""
    if not expires:
        return "ok"
    if expires < today:
        return "overdue"
    from datetime import date
    y1, m1, d1 = map(int, today.split("-"))
    y2, m2, d2 = map(int, expires.split("-"))
    return "soon" if (date(y2, m2, d2) - date(y1, m1, d1)).days <= 14 else "ok"


def init_db():
    SQLModel.metadata.create_all(engine)
    _migrate_user_verified()
    ensure_flags()
    if not {x.strip() for x in os.environ.get("APP_ADMINS", "").split(",") if x.strip()}:
        print("⚠ APP_ADMINS 미설정 — 기능 플래그 관리자 기능 비활성(아무도 토글 불가). 운영자 아이디를 APP_ADMINS에 설정하세요.")
    # 플래그 만료 규율(v1 스펙 ⑦): 만료 지난/임박 release 플래그를 기동 시 경고 — flag debt 방치 방지
    today = time.strftime("%Y-%m-%d")
    for k, meta in FLAG_REGISTRY.items():
        st = flag_expiry_status((meta or {}).get("expires", ""), today)
        if st == "overdue":
            print(f"⛔ 플래그 만료 초과: {k} (만료 {meta['expires']}) — 상시적용(코드 제거) 또는 폐기를 결정하세요 (docs/13 §D)")
        elif st == "soon":
            print(f"⚠ 플래그 만료 임박: {k} (만료 {meta['expires']})")


def _migrate_user_verified():
    """기존 user 테이블에 verified 컬럼 추가(create_all은 기존 테이블을 안 바꿈).
    정책(docs/29 §3) 이전 가입 계정은 verified=1 백필 — 기존 사용자를 잠그지 않는다."""
    import sqlalchemy
    with engine.connect() as conn:
        cols = {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(user)").fetchall()}
        if "verified" not in cols:
            conn.exec_driver_sql("ALTER TABLE user ADD COLUMN verified INTEGER NOT NULL DEFAULT 0")
            conn.exec_driver_sql("UPDATE user SET verified = 1")  # 기존 계정 백필
            conn.commit()
            print("DB 마이그레이션: user.verified 추가(기존 계정은 인증됨으로 백필)")


# ───────────────────────── 인증 ─────────────────────────
# v1 ⑮(#51): 로그인 레이트리밋 — 무차별 대입 방어(인메모리, 프로세스 단일이라 충분)
_LOGIN_FAILS: dict = {}  # key(user|ip) → [timestamps]
_RL_MAX, _RL_WINDOW = 8, 300.0

def _rl_check(key: str) -> bool:
    now = time.time()
    fails = [t for t in _LOGIN_FAILS.get(key, []) if now - t < _RL_WINDOW]
    _LOGIN_FAILS[key] = fails
    return len(fails) < _RL_MAX

def _rl_fail(key: str):
    _LOGIN_FAILS.setdefault(key, []).append(time.time())


# ── 가입 정책(docs/29 §3): @kei.re.kr 이메일만 + 6자리 코드 인증 + ID=이메일 ──
# fail-closed: 도메인 allowlist 기본값은 kei.re.kr — env 미설정이어도 외부 메일은 못 들어온다.
SIGNUP_DOMAINS = {d.strip().lower() for d in
                  os.environ.get("APP_SIGNUP_DOMAINS", "kei.re.kr").split(",") if d.strip()}
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$")
CODE_TTL, CODE_MAX_ATTEMPTS, RESEND_COOLDOWN = 600.0, 5, 60.0  # 10분 · 5회 · 60초


def valid_signup_email(email: str) -> bool:
    m = EMAIL_RE.match(email.strip().lower())
    return bool(m) and m.group(1) in SIGNUP_DOMAINS


def _code_hash(email: str, code: str) -> str:
    import hashlib
    import hmac as _hmac
    return _hmac.new(SECRET.encode() if isinstance(SECRET, str) else SECRET,
                     f"{email.lower()}|{code}".encode(), hashlib.sha256).hexdigest()


def _send_verify_email(email: str, code: str) -> None:
    """인증 코드 발송. 사내 SMTP 릴레이(SMTP_HOST) 필요 — 미설정 시 예외(fail-closed).
    개발·E2E는 APP_DEV_ECHO_CODE=1로 발송 없이 코드를 응답에 동봉(⛔ 운영 금지)."""
    host = os.environ.get("SMTP_HOST", "")
    if not host:
        raise RuntimeError("SMTP 미설정")
    import smtplib
    from email.mime.text import MIMEText
    port = int(os.environ.get("SMTP_PORT", "25"))
    sender = os.environ.get("SMTP_FROM", "kei-admin-llm@kei.re.kr")
    msg = MIMEText(f"KEI 행정 LLM 가입 인증 코드: {code}\n\n10분 안에 입력해 주세요. "
                   f"본인이 요청하지 않았다면 이 메일을 무시하세요.", _charset="utf-8")
    msg["Subject"] = "[KEI 행정 LLM] 가입 인증 코드"
    msg["From"], msg["To"] = sender, email
    with smtplib.SMTP(host, port, timeout=10) as smtp:
        if os.environ.get("SMTP_STARTTLS", "") == "1":
            smtp.starttls()
        user, pw = os.environ.get("SMTP_USER", ""), os.environ.get("SMTP_PASS", "")
        if user:
            smtp.login(user, pw)
        smtp.sendmail(sender, [email], msg.as_string())


def _issue_code(s: Session, email: str) -> dict:
    """코드 생성·발송(이메일당 최신 1건, 쿨다운 60초). 반환: 응답 dict(발송 결과 포함)."""
    email = email.strip().lower()
    now = time.time()
    prev = s.exec(select(VerifyCode).where(VerifyCode.email == email)).first()
    if prev and now - prev.last_sent_at < RESEND_COOLDOWN:
        raise HTTPException(429, f"인증 메일은 {int(RESEND_COOLDOWN)}초에 한 번만 보낼 수 있습니다.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    if prev:
        s.delete(prev)
    s.add(VerifyCode(email=email, code_hash=_code_hash(email, code),
                     expires_at=now + CODE_TTL, last_sent_at=now))
    s.commit()
    out = {"pending": True, "email": email}
    echo = os.environ.get("APP_DEV_ECHO_CODE", "") == "1"  # ⛔ dev/E2E 전용 — 운영에 설정 금지
    if echo:
        out["dev_code"] = code
    # SMTP가 설정돼 있으면 echo 여부와 무관하게 실제 발송 시도(dev에서도 실메일 검증 가능).
    # 발송 실패 시: echo 모드면 코드로 계속(개발 편의), 아니면 fail-closed(가입을 열어두지 않음).
    if os.environ.get("SMTP_HOST", ""):
        try:
            _send_verify_email(email, code)
            out["sent"] = True
        except Exception as e:  # noqa: BLE001
            if not echo:
                raise HTTPException(503, "인증 메일을 보낼 수 없습니다. 관리자에게 문의하세요(SMTP 설정).") from e
            out["sent"] = False
    elif not echo:
        raise HTTPException(503, "인증 메일을 보낼 수 없습니다. 관리자에게 문의하세요(SMTP 설정).")
    return out


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
class VerifyIn(BaseModel):
    username: str   # = 이메일
    code: str


@router.post("/auth/register")
def register(body: AuthIn):
    """가입 1단계(docs/29 §3): ID=이메일(@kei.re.kr만) + 인증 코드 발송.
    쿠키는 여기서 발급하지 않는다 — /auth/verify 성공 시에만 로그인된다."""
    email = body.username.strip().lower()
    if not valid_signup_email(email):
        raise HTTPException(400, "KEI 이메일(@kei.re.kr)로만 가입할 수 있습니다.")
    if len(body.password) < 4:
        raise HTTPException(400, "비밀번호는 4자 이상이어야 합니다.")
    with Session(engine) as s:
        exists = s.exec(select(User).where(User.username == email)).first()
        if exists and exists.verified:
            raise HTTPException(409, "이미 가입된 이메일입니다. 로그인해 주세요.")
        if exists:  # 미인증 재가입: 비밀번호 갱신 후 코드 재발송
            exists.password_hash = hash_pw(body.password)
            s.add(exists)
        else:
            s.add(User(username=email, password_hash=hash_pw(body.password), verified=False))
        return _issue_code(s, email)


@router.post("/auth/verify")
def verify_email(body: VerifyIn, response: Response):
    """가입 2단계: 6자리 코드 확인 → 계정 활성 + 로그인 쿠키 발급."""
    email = body.username.strip().lower()
    code = body.code.strip()
    with Session(engine) as s:
        u = s.exec(select(User).where(User.username == email)).first()
        vc = s.exec(select(VerifyCode).where(VerifyCode.email == email)).first()
        if not u or u.verified:
            raise HTTPException(400, "인증 대기 중인 계정이 아닙니다.")
        if not vc or time.time() > vc.expires_at or vc.attempts >= CODE_MAX_ATTEMPTS:
            raise HTTPException(410, "인증 코드가 만료되었습니다. 재발송해 주세요.")
        if _code_hash(email, code) != vc.code_hash:
            vc.attempts += 1
            s.add(vc)
            s.commit()
            left = CODE_MAX_ATTEMPTS - vc.attempts
            raise HTTPException(401, f"인증 코드가 올바르지 않습니다. (남은 시도 {max(left, 0)}회)")
        u.verified = True
        s.add(u)
        s.delete(vc)
        s.commit()
        uid, un = u.id, u.username
    set_cookie(response, make_token(uid))
    return {"id": uid, "username": un}


@router.post("/auth/resend")
def resend_code(body: AuthIn):
    """인증 코드 재발송(쿨다운 60초). 비밀번호 확인으로 본인 요청만 허용."""
    email = body.username.strip().lower()
    with Session(engine) as s:
        u = s.exec(select(User).where(User.username == email)).first()
        if not u or u.verified or not check_pw(body.password, u.password_hash):
            raise HTTPException(400, "재발송 대상이 아닙니다.")
        return _issue_code(s, email)


@router.post("/auth/login")
def login(body: AuthIn, request: Request, response: Response):
    # v1 ⑮(#51): 사용자+IP 기준 실패 8회/5분 초과 시 429(무차별 대입 방어)
    rl_key = f"{body.username.strip()}|{request.client.host if request.client else '?'}"
    if not _rl_check(rl_key):
        raise HTTPException(429, "로그인 시도가 너무 많습니다. 5분 후 다시 시도해 주세요.")
    with Session(engine) as s:
        u = s.exec(select(User).where(User.username == body.username.strip().lower())).first()
        if not u:  # 레거시 계정(정책 이전, 대소문자 그대로)도 조회
            u = s.exec(select(User).where(User.username == body.username.strip())).first()
        ok = bool(u) and check_pw(body.password, u.password_hash)
        if ok and not u.verified:  # 미인증 계정(docs/29 §3) — 코드 인증 전 로그인 불가
            raise HTTPException(403, "이메일 인증이 필요합니다. 가입 화면에서 인증을 완료해 주세요.")
        uid, un = (u.id, u.username) if ok else (None, None)  # 성공 시에만 uid 설정(None 토큰 발급 방지)
    if not ok:
        _rl_fail(rl_key)
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


# ───────────────────── 코퍼스 관리(P1: 목록·제외) — docs/20 ─────────────────────
EXCLUDE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index", "exclude.json")
_corpus_cache = {"t": 0.0, "chunks": {}}


def _load_excluded() -> set:
    try:
        with open(EXCLUDE_PATH, encoding="utf-8") as f:
            return set(json.load(f).get("excluded", []))
    except Exception:
        return set()


def _save_excluded(ex: set):
    os.makedirs(os.path.dirname(EXCLUDE_PATH), exist_ok=True)
    with open(EXCLUDE_PATH, "w", encoding="utf-8") as f:
        json.dump({"excluded": sorted(ex)}, f, ensure_ascii=False, indent=1)


def _chunks_by_slug() -> dict:
    """chroma 색인의 path(stem)별 청크 수 — 60s 캐시(전량 metadata 스캔)."""
    now = time.time()
    if now - _corpus_cache["t"] < 60 and _corpus_cache["chunks"]:
        return _corpus_cache["chunks"]
    try:
        _, col, _ = rag_core.backend()
        got = col.get(include=["metadatas"])
        cnt: dict = {}
        for m in got["metadatas"]:
            stem = os.path.splitext(os.path.basename(m.get("path") or ""))[0]
            cnt[stem] = cnt.get(stem, 0) + 1
        _corpus_cache.update(t=now, chunks=cnt)
    except Exception:
        pass
    return _corpus_cache["chunks"]


@router.get("/corpus")
def corpus_list(admin: User = Depends(current_admin)):
    """관리자: 볼트 문서 목록 + 색인 상태(제외·청크수·재색인 필요)."""
    vault = os.environ.get("VAULT_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "KEI-행정가이드"))
    ex = _load_excluded()
    chunks = _chunks_by_slug()
    docs = []
    from pathlib import Path as _P
    vault_p = _P(vault)
    for md in sorted(vault_p.rglob("*.md")):
        if "_templates" in md.parts or md.parts[-2].startswith("90_"):
            continue
        head = md.read_text(encoding="utf-8", errors="ignore")[:800]
        def _fm(k):
            m = re.search(rf"^{k}:\s*\"?([^\"\n]+)", head, re.M)
            return (m.group(1).strip() if m else "")
        if not _fm("type"):   # type 프론트매터 없는 파일(폴더 README 등)은 02도 색인하지 않음 — 목록 제외
            continue
        slug = md.stem
        n = chunks.get(slug, 0)
        excluded = slug in ex
        rel = md.relative_to(vault_p).parts  # 예: (10_업무가이드, 0000_미분류, 파일.md)
        docs.append({
            "slug": slug,
            "title": _fm("규정명") or _fm("제목") or _fm("용어") or slug,
            "구분": rel[0] if len(rel) >= 2 else "",     # 상위 폴더(업무가이드/규정원문/용어집/시스템)
            "section": md.parts[-2] if len(md.parts) >= 2 else "",
            "검수상태": _fm("검수상태") or "미검수",
            "chunks": n,
            "excluded": excluded,
            "needs_reindex": (excluded and n > 0) or (not excluded and n == 0),
        })
    summary = {
        "total": len(docs),
        "excluded": sum(1 for d in docs if d["excluded"]),
        "indexed_chunks": sum(d["chunks"] for d in docs),
        "needs_reindex": sum(1 for d in docs if d["needs_reindex"]),
    }
    return {"docs": docs, "summary": summary}


class ExcludeIn(BaseModel):
    slug: str
    excluded: bool


@router.post("/corpus/exclude")
def corpus_exclude(body: ExcludeIn, admin: User = Depends(current_admin)):
    """관리자: 문서 색인 제외/복귀 토글(soft — 파일 불변, 02가 skip). 재색인은 P1에선 CLI."""
    ex = _load_excluded()
    if body.excluded:
        ex.add(body.slug)
    else:
        ex.discard(body.slug)
    _save_excluded(ex)
    with Session(engine) as s:
        s.add(CorpusAudit(slug=body.slug, action="exclude" if body.excluded else "include", actor=admin.username))
        s.commit()
    _corpus_cache["t"] = 0  # 다음 조회에서 needs_reindex 재계산
    return {"slug": body.slug, "excluded": body.excluded}


# ── P2: 재색인 실행(백업→02→무재시작 reload) + 롤백(스냅샷 스왑) — docs/20 ──
import shutil
import subprocess
import threading

REINDEX = {"running": False, "ok": None, "log": [], "started": 0.0, "backup": ""}
_BAK_KEEP = 2


def _chroma_dir() -> str:
    return os.path.abspath(rag_core.CHROMA_DIR)


def _list_backups():
    base = os.path.dirname(_chroma_dir())
    name = os.path.basename(_chroma_dir())
    out = sorted(d for d in os.listdir(base) if d.startswith(name + ".bak-"))
    return [os.path.join(base, d) for d in out]


def _reindex_worker(vault: str):
    cd = _chroma_dir()
    try:
        # 1) 스냅샷 백업(롤백용) + 로테이션
        ts = time.strftime("%Y%m%d-%H%M%S")
        bak = f"{cd}.bak-{ts}"
        REINDEX["log"].append(f"백업 생성: {os.path.basename(bak)}")
        shutil.copytree(cd, bak)
        REINDEX["backup"] = bak
        for old in _list_backups()[:-_BAK_KEEP]:
            shutil.rmtree(old, ignore_errors=True)
        # 2) 02 실행(exclude.json 자동 반영)
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "02_chunk_and_embed.py")
        cmd = [sys.executable, script, "--vault", vault, "--db", cd]
        REINDEX["log"].append("재색인 시작(수 분 소요, GPU)…")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                cwd=os.path.dirname(script))
        for line in proc.stdout:
            line = line.strip()
            if line and "it/s" not in line and "%|" not in line:   # tqdm 진행바 제외
                REINDEX["log"] = REINDEX["log"][-40:] + [line]
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"02 종료코드 {rc}")
        # 3) 무재시작 적용
        rag_core.reload()
        _corpus_cache["t"] = 0
        REINDEX["ok"] = True
        REINDEX["log"].append("✅ 완료 — 새 색인 적용됨(무재시작)")
    except Exception as e:  # noqa: BLE001
        REINDEX["ok"] = False
        REINDEX["log"].append(f"⛔ 실패: {type(e).__name__}: {e} — 필요 시 롤백하세요")
    finally:
        REINDEX["running"] = False


@router.post("/corpus/reindex")
def corpus_reindex(admin: User = Depends(current_admin)):
    """관리자: 재색인 실행(동시 1개). 백업→02(exclude 반영)→reload. 진행은 GET /corpus/reindex."""
    if REINDEX["running"]:
        raise HTTPException(409, "이미 재색인이 진행 중입니다.")
    vault = os.environ.get("VAULT_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "KEI-행정가이드"))
    REINDEX.update(running=True, ok=None, log=[], started=time.time(), backup="")
    threading.Thread(target=_reindex_worker, args=(vault,), daemon=True).start()
    with Session(engine) as s:
        s.add(CorpusAudit(slug="(전체)", action="reindex", actor=admin.username)); s.commit()
    return {"started": True}


@router.get("/corpus/reindex")
def corpus_reindex_status(admin: User = Depends(current_admin)):
    return {"running": REINDEX["running"], "ok": REINDEX["ok"], "started": REINDEX["started"],
            "log": REINDEX["log"][-8:],
            "backups": [os.path.basename(b) for b in _list_backups()]}


class RollbackIn(BaseModel):
    backup: str  # basename (chroma.bak-…)


@router.post("/corpus/rollback")
def corpus_rollback(body: RollbackIn, admin: User = Depends(current_admin)):
    """관리자: 스냅샷 스왑 롤백(수 초·재임베딩 없음) — 현재 색인은 .pre-rollback로 보존."""
    if REINDEX["running"]:
        raise HTTPException(409, "재색인 진행 중에는 롤백할 수 없습니다.")
    cd = _chroma_dir()
    base = os.path.dirname(cd)
    bak = os.path.join(base, os.path.basename(body.backup))
    if not (os.path.basename(bak).startswith(os.path.basename(cd) + ".bak-") and os.path.isdir(bak)):
        raise HTTPException(404, "해당 백업이 없습니다.")
    keep = f"{cd}.pre-rollback-{time.strftime('%Y%m%d-%H%M%S')}"
    os.rename(cd, keep)
    shutil.copytree(bak, cd)
    rag_core.reload()
    _corpus_cache["t"] = 0
    with Session(engine) as s:
        s.add(CorpusAudit(slug=os.path.basename(bak), action="rollback", actor=admin.username)); s.commit()
    # pre-rollback 보존본도 로테이션 대상(백업 2세대 규칙과 별개로 1개만 유지)
    pres = sorted(d for d in os.listdir(base) if d.startswith(os.path.basename(cd) + ".pre-rollback-"))
    for old in pres[:-1]:
        shutil.rmtree(os.path.join(base, old), ignore_errors=True)
    return {"rolled_back_to": os.path.basename(bak)}


# ── 표 복원 검수 (지렛대 ①, docs/24 §1) ─────────────────────────────────────
# 01p가 스테이징한 복원 제안(JSON)을 관리자 화면에서 열람하고, 사람의 명시적 클릭으로만
# 볼트에 반영한다(자동 반영 없음). 교체는 결정적: 헤더 일치 + 손상 판정 블록만.
RESTORE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index", "table_restore")


def _vault_dir() -> str:
    return os.environ.get("VAULT_DIR", os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "KEI-행정가이드"))


def _restore_proposals() -> list:
    out = []
    if not os.path.isdir(RESTORE_DIR):
        return out
    for fn in sorted(os.listdir(RESTORE_DIR)):
        if fn.endswith(".json"):
            try:
                out.append(json.loads(open(os.path.join(RESTORE_DIR, fn), encoding="utf-8").read()))
            except Exception:  # noqa: BLE001 — 손상 제안 파일은 건너뜀
                pass
    return out


def _norm_cells(cells: list) -> list:
    return ["".join((c or "").split()) for c in cells]


def _md_table_blocks(lines: list):
    """md 라인들에서 연속 '|' 표 블록의 (시작, 끝(미포함)) 범위를 찾는다."""
    blocks, i = [], 0
    while i < len(lines):
        if "|" in lines[i] and lines[i].lstrip().startswith("|"):
            j = i
            while j < len(lines) and "|" in lines[j] and lines[j].lstrip().startswith("|"):
                j += 1
            blocks.append((i, j))
            i = j
        else:
            i += 1
    return blocks


def _render_table_lines(rows: list) -> list:
    out = []
    for ri, row in enumerate(rows):
        out.append("| " + " | ".join((c or "").replace("\n", "<br>") for c in row) + " |")
        if ri == 0:
            out.append("|" + " --- |" * len(row))
    return out


def _apply_restore(prop: dict, dry: bool) -> dict:
    """제안 표를 볼트에 결정적으로 교체. 조건: 헤더 일치(공백 무시) + 기존 블록이 손상 판정.
    매칭 없으면 아무것도 바꾸지 않는다(평탄화 표 등은 '수동 반영 필요')."""
    vault = _vault_dir()
    replaced, backups = [], []
    for rel in prop.get("vault_paths", []):
        fp = os.path.join(vault, rel)
        if not os.path.isfile(fp):
            continue
        text = open(fp, encoding="utf-8").read()
        lines = text.splitlines()
        changed = False
        for t in prop.get("tables", []):
            rows = t.get("rows") or []
            if not rows:
                continue
            want = _norm_cells([c for c in rows[0] if (c or "").strip()])
            for (a, b) in _md_table_blocks(lines):
                head_cells = [c.strip() for c in lines[a].strip().strip("|").split("|")]
                have = _norm_cells([c for c in head_cells if c.strip()])
                if not want or have != want:
                    continue
                block_text = "\n".join(lines[a:b])
                if not rag_core._table_broken(block_text):
                    continue  # 이미 정상(또는 반영됨) — 건드리지 않음
                if not dry:
                    lines[a:b] = _render_table_lines(rows)
                replaced.append({"file": rel, "표": t.get("label", ""), "행": len(rows)})
                changed = True
                break  # 이 표는 반영됨 — 다음 제안 표로
        if changed and not dry:
            bdir = os.path.join(RESTORE_DIR, "backup")
            os.makedirs(bdir, exist_ok=True)
            bak = os.path.join(bdir, rel.replace(os.sep, "__") + f".orig-{time.strftime('%Y%m%d-%H%M%S')}")
            with open(bak, "w", encoding="utf-8") as f:
                f.write(text)
            backups.append(os.path.basename(bak))
            with open(fp, "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + ("\n" if text.endswith("\n") else ""))
    manual = [t.get("label", "") for t in prop.get("tables", []) if t.get("verdict")]
    return {"matched": len(replaced), "replaced": replaced, "backups": backups,
            "manual_needed": manual}


@router.get("/corpus/table-restore")
def table_restore_list(admin: User = Depends(current_admin)):
    """관리자: 표 복원 제안 목록 + 볼트 매칭 가능성(dry-run) + 반영 이력."""
    with Session(engine) as s:
        applied = {}
        for a in s.exec(select(CorpusAudit).where(CorpusAudit.action == "table_restore")).all():
            applied[a.slug] = max(applied.get(a.slug, 0), a.at)
    docs = []
    for prop in _restore_proposals():
        dry = _apply_restore(prop, dry=True)
        docs.append({
            "name": prop["name"], "source": os.path.basename(prop.get("source", "")),
            "사유": prop.get("사유", []), "표본": prop.get("표본", [])[:3],
            "tables": prop.get("tables", []),
            "matchable": dry["matched"], "manual_needed": dry["manual_needed"],
            "applied_at": applied.get(prop["name"]),
        })
    return {"docs": docs}


class RestoreApplyIn(BaseModel):
    name: str


@router.post("/corpus/table-restore/apply")
def table_restore_apply(body: RestoreApplyIn, admin: User = Depends(current_admin)):
    """관리자: 복원 제안을 볼트에 반영(사람의 명시적 승인 행위). ⛔검수상태는 불변 — 사람이 별도 갱신."""
    if REINDEX["running"]:
        raise HTTPException(409, "재색인 진행 중에는 반영할 수 없습니다.")
    prop = next((p for p in _restore_proposals() if p["name"] == body.name), None)
    if not prop:
        raise HTTPException(404, "해당 복원 제안이 없습니다.")
    res = _apply_restore(prop, dry=False)
    if res["matched"] == 0:
        raise HTTPException(409, "자동 반영 가능한 표가 없습니다(평탄화·원본 병합 구조는 수동 반영).")
    _corpus_cache["t"] = 0  # 목록 재계산(needs_reindex 반영)
    with Session(engine) as s:
        s.add(CorpusAudit(slug=body.name, action="table_restore", actor=admin.username))
        s.commit()
    return res


# ── P3: 업로드 → 변환 미리보기 → 승인 편입 (docs/20) ─────────────────────────
from fastapi import File, Form, UploadFile

UPLOAD_DIR = os.path.expanduser(os.environ.get("KEI_UPLOAD_DIR", "~/kei-uploads"))
UPLOAD_MAX = 30 * 1024 * 1024  # 30MB
UPLOAD_EXTS = {".md", ".hwp", ".hwpx", ".pdf"}
PENDING: dict = {}  # id → {name, ext, status, preview_path, warn, at}


def _c01c():
    """01c 변환기(extract_hwp/extract_pdf) 지연 로드 — 숫자 파일명이라 importlib 사용."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "c01c", os.path.join(os.path.dirname(os.path.abspath(__file__)), "01c_guides_to_md.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _convert_upload(path: str, ext: str):
    """업로드 파일 → (md 본문, 경고). ⛔ 자동 편입 금지 — 미리보기 후 사람이 승인(절대 규칙)."""
    from pathlib import Path as _P
    if ext == ".md":
        return _P(path).read_text(encoding="utf-8", errors="ignore"), ""
    c = _c01c()
    if ext in (".hwp", ".hwpx"):
        body, st = c.extract_hwp(_P(path), timeout=90)
        return (body, "" if st == "ok" else f"변환 상태: {st} — 표/서식 깨짐 가능, 미리보기 확인 필수")
    body, st = c.extract_pdf(_P(path))
    warn = "" if st == "ok" else ("스캔 이미지 PDF로 보임 — 텍스트 추출 불가(OCR 필요)" if st == "image-pdf" else f"변환 오류: {body[:120]}")
    return body, warn


def _slugify(name: str, vault: str) -> str:
    base = re.sub(r"[\\/:*?\"<>|#\[\]]+", " ", name).strip().replace("  ", " ")[:60] or "업로드문서"
    slug, i = base, 2
    from pathlib import Path as _P
    existing = {p.stem for p in _P(vault).rglob("*.md")}
    while slug in existing:
        slug = f"{base}-{i}"; i += 1
    return slug


@router.post("/corpus/upload")
async def corpus_upload(file: UploadFile = File(...), admin: User = Depends(current_admin)):
    """관리자: 파일 업로드(staging, repo 밖) → 변환 → 미리보기 반환. 편입은 별도 승인."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in UPLOAD_EXTS:
        raise HTTPException(400, f"지원 형식: {', '.join(sorted(UPLOAD_EXTS))}")
    data = await file.read()
    if len(data) > UPLOAD_MAX:
        raise HTTPException(413, "파일이 너무 큽니다(30MB 제한).")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    uid = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
    raw = os.path.join(UPLOAD_DIR, uid + ext)
    with open(raw, "wb") as f:
        f.write(data)
    try:
        md, warn = _convert_upload(raw, ext)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"변환 실패: {type(e).__name__}: {e}")
    conv = os.path.join(UPLOAD_DIR, uid + ".converted.md")
    with open(conv, "w", encoding="utf-8") as f:
        f.write(md)
    PENDING[uid] = {"name": file.filename, "ext": ext, "raw": raw, "conv": conv, "warn": warn, "at": time.time()}
    with Session(engine) as s:
        s.add(CorpusAudit(slug=file.filename or uid, action="upload", actor=admin.username)); s.commit()
    return {"id": uid, "name": file.filename, "warn": warn, "preview": md[:4000], "chars": len(md)}


@router.get("/corpus/uploads")
def corpus_uploads(admin: User = Depends(current_admin)):
    return {"uploads": [{"id": k, "name": v["name"], "warn": v["warn"], "at": v["at"]} for k, v in sorted(PENDING.items())]}


class ApproveIn(BaseModel):
    doc_type: str = "guide"   # guide | regulation
    title: str = ""
    분류: str = "0000_미분류"


@router.post("/corpus/uploads/{uid}/approve")
def corpus_upload_approve(uid: str, body: ApproveIn, admin: User = Depends(current_admin)):
    """관리자 승인 → 볼트 편입(검수상태: 미검수). 재색인은 P2 버튼으로."""
    it = PENDING.get(uid)
    if not it:
        raise HTTPException(404, "대기 중 업로드가 없습니다.")
    if body.doc_type not in ("guide", "regulation"):
        raise HTTPException(400, "doc_type은 guide|regulation")
    vault = os.environ.get("VAULT_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "KEI-행정가이드"))
    title = (body.title or os.path.splitext(it["name"] or "업로드문서")[0]).strip()
    slug = _slugify(title, vault)
    md = open(it["conv"], encoding="utf-8").read()
    today = time.strftime("%Y-%m-%d")
    if body.doc_type == "guide":
        fm = (f"---\ntype: guide\n제목: \"{title}\"\n분류: \"{body.분류}\"\n대상: \"\"\n관련규정: []\n"
              f"관련서식: []\n최종검토일: {today}\n검토자: \"{admin.username}(업로드)\"\n태그: [업로드]\n검수상태: 미검수\n---\n\n")
        sub = "10_업무가이드/0000_미분류"
    else:
        fm = (f"---\ntype: regulation\n규정번호: \"\"\n규정명: \"{title}\"\n분류: \"{body.분류}\"\n"
              f"개정일: {today}\n원본파일: \"{it['name']}\"\n태그: [업로드]\n검수상태: 미검수\n---\n\n")
        sub = "20_규정원문/0000_미분류"
    dest_dir = os.path.join(vault, sub)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, slug + ".md")
    with open(dest, "w", encoding="utf-8") as f:
        f.write(fm + f"# {title}\n\n> [!warning] 업로드 자동 변환 — 미리보기 승인본. 표/서식 확인 후 `검수상태: 검수완료`로.\n\n" + md)
    PENDING.pop(uid, None)
    _corpus_cache["t"] = 0
    with Session(engine) as s:
        s.add(CorpusAudit(slug=slug, action="approve", actor=admin.username)); s.commit()
    return {"slug": slug, "path": os.path.join(sub, slug + ".md"), "needs_reindex": True}


@router.post("/corpus/uploads/{uid}/reject")
def corpus_upload_reject(uid: str, admin: User = Depends(current_admin)):
    it = PENDING.pop(uid, None)
    if not it:
        raise HTTPException(404, "대기 중 업로드가 없습니다.")
    for k in ("raw", "conv"):
        try: os.remove(it[k])
        except OSError: pass
    with Session(engine) as s:
        s.add(CorpusAudit(slug=it["name"] or uid, action="reject", actor=admin.username)); s.commit()
    return {"rejected": uid}


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


# ── 인기 검색 키워드(docs/29 §1) — ⛔ 무LLM·결정적: 사전(여정 트리거+용어집) 매칭 집계 ──
# 🔒 k-익명: 서로 다른 사용자 K_ANON명 이상이 쓴 키워드만 노출(질문 본문은 절대 노출 안 함).
_TREND: dict = {"lex": None, "cache": {}}  # cache: days → (t, data)
_TREND_TTL = 300.0
_TREND_STOP = {"연구원", "규정", "기관", "업무", "관리", "제도", "기준", "신청서", "위원회",
               "신청", "확인", "방법", "처리", "문서", "자료"}  # 일반어 — 실측 노이즈("신청" 최다) 제외


def _trend_lexicon() -> list:
    """키워드 사전 = 여정 트리거 + 용어집(defterms) 용어명. 최장 우선 정렬(부분 문자열 중복 방지)."""
    if _TREND["lex"] is None:
        kws = set()
        try:
            for t in rag_core._ensure_journey_triggers():
                kws.update(k for k in t.get("kws", []) if len(k) >= 2)
        except Exception:  # noqa: BLE001
            pass
        try:
            dp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index", "defterms.json")
            terms = json.loads(open(dp, encoding="utf-8").read()).get("terms", {})
            kws.update(k for k in terms if 2 <= len(k) <= 12)
        except Exception:  # noqa: BLE001
            pass
        _TREND["lex"] = sorted((k for k in kws if k not in _TREND_STOP), key=len, reverse=True)
    return _TREND["lex"]


@router.get("/trending")
def trending(user: User = Depends(current_user), days: int = 7):
    """기간(일/주/월) 인기 검색 키워드 TOP 10. 로그인 사용자 누구나 —
    노출은 k-익명 집계뿐이라 개인 채팅이 드러나지 않는다. 5분 캐시."""
    days = max(1, min(days, 90))
    now = time.time()
    hit = _TREND["cache"].get(days)
    if hit and now - hit[0] < _TREND_TTL:
        return hit[1]
    since = now - days * 86400
    lex = _trend_lexicon()
    with Session(engine) as s:
        sess_user = {cs.id: cs.user_id for cs in s.exec(select(ChatSession)).all()}
        msgs = s.exec(select(Message).where(Message.role == "user",
                                            Message.created_at >= since)).all()
    users_by_kw: dict = {}
    count_by_kw: Counter = Counter()
    for m in msgs:
        uid = sess_user.get(m.session_id)
        if uid is None:
            continue
        text = m.content or ""
        matched: list = []
        for k in lex:  # 최장 우선 — '연차휴가'가 잡히면 그 부분의 '휴가'는 세지 않는다
            if k in text and not any(k in mk for mk in matched):
                matched.append(k)
        for k in matched:
            users_by_kw.setdefault(k, set()).add(uid)
            count_by_kw[k] += 1
    rows = [{"k": k, "n": n} for k, n in count_by_kw.most_common(50)
            if len(users_by_kw.get(k, ())) >= K_ANON][:10]
    out = {"days": days, "min_users": K_ANON, "keywords": rows}
    _TREND["cache"][days] = (now, out)
    return out


@router.get("/users")
def list_users(admin: User = Depends(current_admin)):
    """관리자: 사용자 목록(docs/29 §4) — '누구인지'까지만.
    🔒 개인정보 경계: 이메일(=ID)·가입일·마지막 활동·채팅 수·인증/관리자 여부만 반환.
    타인 채팅 '본문'을 읽는 엔드포인트는 계속 존재하지 않는다(P2.5 원칙 ⓐ 불변)."""
    with Session(engine) as s:
        users = s.exec(select(User)).all()
        sess = s.exec(select(ChatSession)).all()
        by_user: dict = {}
        for cs in sess:
            d = by_user.setdefault(cs.user_id, {"chats": 0, "last": 0.0})
            d["chats"] += 1
            d["last"] = max(d["last"], cs.updated_at or 0.0)
    out = []
    for u in sorted(users, key=lambda x: -(x.created_at or 0)):
        a = by_user.get(u.id, {"chats": 0, "last": 0.0})
        out.append({
            "id": u.id, "username": u.username, "created_at": u.created_at,
            "verified": bool(u.verified), "is_admin": is_admin(u),
            "chats": a["chats"], "last_active": a["last"] or None,
        })
    return {"n": len(out), "users": out}


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


# 절단 마커(v1 스펙 B4) — 저장 텍스트와 클라이언트 '다시 시도' 감지가 공유하는 문자열
STREAM_TRUNCATED_MARK = "응답이 중간에 끊겼습니다"


def finalize_stream_text(acc_text: str, err) -> str:
    """스트림 종료 시 저장할 최종 텍스트 확정(v1 스펙 B4) — 3분기:
    · 정상: 그대로 저장
    · 오류 + 부분 응답: **절단 마커 부착** — 반 잘린 답이 '완성된 답'으로 영구 저장되는 것을 방지(절대 규칙1)
    · 오류 + 빈 응답: 연결 실패 안내(근거는 함께 저장됨을 고지 — 뷰포트 무관 표현)
    """
    if not err:
        return acc_text or "⚠️ 응답이 생성되지 않았습니다. 다시 시도해 주세요."
    if acc_text:
        return acc_text + f"\n\n⚠️ ({STREAM_TRUNCATED_MARK} — 아래 '다시 시도'로 재요청하세요 · {err})"
    return f"⚠️ 생성 모델에 연결하지 못했습니다. 회수된 근거 조문은 답변과 함께 저장돼 있습니다. ({err})"


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
            note = rag_core.post_answer_notes(q, ans, context, sources)  # P0-1 수치 + P0-4 귀속(docs/22)
            if note:
                ans = ans.rstrip() + "\n\n" + note
        except Exception as e:
            ans = ("⚠️ 생성 모델에 연결하지 못했습니다. 회수된 근거 조문은 답변과 함께 저장돼 있습니다.\n"
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
            sugg = rag_core.suggest_followups(q, sources)  # docs/26 — 무LLM 후속 제안(휘발성)
            return {"user": _msg(um), "assistant": _msg(am), "session": _ses(cs), "suggestions": sugg}

    # 스트리밍(SSE): meta(근거+user) → delta(토큰…) → [error] → done(저장된 assistant+session)
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
        full = finalize_stream_text("".join(acc), err)
        # P0-1 수치 게이트(docs/22): 스트림은 이미 방출된 토큰을 회수할 수 없으므로 사후 경고를 델타로 부착
        try:
            note = rag_core.post_answer_notes(q, full, context, sources)
        except Exception:  # noqa: BLE001 — 게이트 오류가 답변을 막지 않게
            note = ""
        if note:
            yield _sse({"type": "delta", "t": "\n\n" + note})
            full = full.rstrip() + "\n\n" + note
        if err:
            # 클라이언트가 절단/실패를 표시하고 '다시 시도'를 제공할 수 있게 명시 이벤트(v1 스펙 B4)
            yield _sse({"type": "error", "err": err, "partial": bool(acc)})
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
            try:
                sugg = rag_core.suggest_followups(q, sources)  # docs/26 — 무LLM 후속 제안(휘발성)
            except Exception:  # noqa: BLE001
                sugg = []
            yield _sse({"type": "done", "assistant": _msg(am), "session": _ses(cs) if cs else None,
                        "suggestions": sugg})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# 모듈 로드 시 테이블 보장(idempotent)
init_db()
