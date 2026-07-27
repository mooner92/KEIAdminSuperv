#!/usr/bin/env python3
"""daily_common.py — 일일 자가평가(docs/58) 공용: 설정·LLM·Chroma·정규화·질문은행 IO.

문항 수(2026-07-22 확정): 총 60 = 신규 40 + 회귀 20.
  근거 — 신규 40/일이면 코퍼스(5,578청크) 1순환 ≈ 4.6개월(30이면 6.2개월), 60문항 소요
  ≈ 70분(06:00→07:10, 업무 전 종료). 70문항+는 90분 초과 위험. env로 조정 가능.
"""
import hashlib
import json
import os
import pathlib
import re
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

# ── 설정(env 오버라이드 가능) ──────────────────────────────────────────────
TOTAL = int(os.environ.get("DAILY_EVAL_TOTAL", "60"))
NEW_N = int(os.environ.get("DAILY_EVAL_NEW", "40"))
REG_N = max(0, TOTAL - NEW_N)
API = os.environ.get("DAILY_EVAL_API", "http://127.0.0.1:9001")  # dev 기본 — prod 등록은 승격 절차
LLM_BASE = os.environ.get("VLLM_BASE", "http://127.0.0.1:11436/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M")
CHROMA_DIR = os.environ.get("CHROMA_DIR", str(ROOT / "tools" / "chroma"))
COLLECTION = os.environ.get("RAG_COLLECTION", "kei_regs")

BANK = HERE / "question_bank.jsonl"
DAILY_DIR = HERE / "daily"
FAQ_DIR = HERE / "faq_candidates"

# 유형 쿼터(신규분) — 값형 40% · 절차 30% · 조건 20% · 거부 10% (docs/58 §1.1)
TYPE_QUOTA = {"값형": 0.4, "절차형": 0.3, "조건형": 0.2, "거부형": 0.1}
# 섹션(청크 type) 쿼터 — 규정 40 · 가이드 25 · 시스템 25 · 용어 10 (거부형 제외 분에 적용)
SECTION_QUOTA = {"regulation": 0.40, "guide": 0.25, "system": 0.25, "term": 0.10}
# 출제 후보 최소 길이 — **섹션마다 다르다**(2026-07-26 실측 결함).
# 일괄 200자였을 때 용어 청크는 240개 중 14개(6%)만 후보에 들어, 용어 쿼터 10%가 실제로는
# 2.5%로 떨어지고 같은 용어 몇 개가 돌았다. 용어 노트는 '한 개념 = 한 노트'라 원래 짧다.
# ⚠ 낮춘다고 품질이 떨어지지는 않는다 — 골든 문장 실존 게이트가 뒤를 받친다(모호하면 폐기).
MIN_CHUNK = {"regulation": 200, "guide": 200, "system": 200, "term": 80}
# 복합 시나리오 비중(specs/07 A) — 신규 문항 중. 단일을 남기는 이유는 코퍼스 전체를 도는
# **청크 커버리지 순환**이 복합만으로는 달성되지 않기 때문(여정 13종은 코퍼스의 일부만 덮는다).
SCEN_RATIO = float(os.environ.get("DAILY_EVAL_SCEN", "0.25"))

# 주제 키워드 사전(약점 지도 태깅·다중 허용) — APPROVAL_KW·여정 13종 관례 재사용
TOPIC_KW = {
    "출장": ["출장", "여비", "일비", "숙박비", "항공", "마일리지"],
    "휴가·복무": ["휴가", "연차", "병가", "휴직", "복직", "유연근무", "재택", "초과근무", "연장근로", "육아"],
    "기안·결재": ["기안", "결재", "상신", "전결", "품의", "위임"],
    "계약·구매": ["계약", "구매", "입찰", "수의", "물품", "검수", "발주"],
    "인사": ["채용", "임용", "승진", "전보", "평정", "징계", "포상", "겸직", "퇴직"],
    "보수·수당": ["보수", "수당", "급여", "성과급", "퇴직금"],
    "회계·예산": ["예산", "회계", "결산", "지출", "정산", "법인카드", "자금"],
    "보안·정보": ["보안", "개인정보", "정보공개", "비밀", "전산"],
    "연구관리": ["연구과제", "연구비", "과제", "성과물", "논문", "연구윤리", "위탁연구", "연구연수"],
    "교육": ["교육", "연수", "훈련", "학위"],
    "복리후생": ["경조", "상조", "콘도", "휴양", "동호회", "건강검진"],
}

# 거부형 시드(코퍼스 밖 주제) — 실측 거부 확인된 것 포함(주차·구내식당). 은행 중복으로 재사용 차단
REFUSAL_SEEDS = [
    "사내 주차장 배정", "구내식당 외부인 이용", "통근버스 노선", "사내 어린이집 입소",
    "체력단련실(헬스장) 이용", "사내 카페 운영시간", "흡연구역 위치", "탕비실 비품",
    "사옥 냉난방 온도", "엘리베이터 점검 일정", "직원 기숙사 배정", "반려동물 동반 출근",
    "옥상 정원 이용", "전기차 충전소 이용", "택배 보관",
    "사내 이발소", "은행 지점 입점", "회의실 음식물 반입",
    # 2026-07-26 교체분 — audit_refusal_seeds.py로 '코퍼스 무언급' 확인한 것만 추가.
    # ⛔ 제외: "탕비실 비품"(물품 지침 제15조가 수리·보수를 규율) ·
    #         "우편물 발송 대행"(문서관리규정 제32조가 인편·우편 발송을 규율)
    "사내 편의점 할인", "무인 택배함 이용", "명상실 예약", "사내 세탁 서비스",
]


# ── 출제 자족성 게이트(2026-07-26 실측 결함) ───────────────────────────────────────
# 질문이 **지시어로 시작하면** 지시 대상이 없다 — 맥락 밖에서 답할 수 없는 문항.
# 실측(2026-07-26): PMS 화면 필드명("초청기관 지급의 출장비")에서 "유사한 출장비가 지급되나요?"가
# 생성돼 정상 답변이 오답으로 집계됐다.
#
# ⚠ 함께 시도했다가 **철회**한 게이트: "골든은 서술어로 끝나는 문장이어야 한다".
#   이 코퍼스의 가이드·시스템 문서는 **개조식**이라("미준수시 1일 3점씩 감점", "연 15일의 유급휴가
#   부여") 정상 골든의 53%(96/180)가 걸렸다. 명사구 라벨과 개조식 서술은 형태로 구분되지 않는다.
_DEICTIC = re.compile(r"^(이|그|저|해당|동|위|앞|본|유사한|같은|이러한|그러한|다음의)\s")


def is_self_contained(question: str) -> bool:
    """질문이 홀로 성립하는가 — 지시 대상 없는 지시어 시작 배제."""
    return not _DEICTIC.match((question or "").strip())


def llm(messages, temperature=0.0, max_tokens=300) -> str:
    body = json.dumps({"model": LLM_MODEL, "messages": messages, "temperature": temperature,
                       "max_tokens": max_tokens, "reasoning_effort": "none"}).encode()
    req = urllib.request.Request(f"{LLM_BASE}/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["choices"][0]["message"]["content"]


def llm_json(messages, temperature=0.0, max_tokens=300) -> dict:
    c = llm(messages, temperature, max_tokens)
    m = re.search(r"\{.*\}", c, re.S)
    try:
        return json.loads(m.group(0)) if m else {}
    except Exception:  # noqa: BLE001
        return {}


def rag_answer(question: str, history: list | None = None) -> dict:
    """실서비스 동등 답변(/v1, 리랭커 등 서비스 구성 그대로). {content, x_sources}.
    history = 이전 턴 [(질문, 답변), …] — 복합 시나리오의 후속 턴 평가용(specs/07 A).
    멀티턴은 서비스와 같은 경로(rag_core.condense_query)를 타야 회귀가 의미를 가진다."""
    msgs = []
    for hq, ha in (history or []):
        msgs += [{"role": "user", "content": hq}, {"role": "assistant", "content": ha}]
    msgs.append({"role": "user", "content": question})
    body = json.dumps({"model": "kei-admin-rag", "messages": msgs}).encode()
    req = urllib.request.Request(f"{API}/v1/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        d = json.load(r)
    return {"content": d["choices"][0]["message"]["content"], "x_sources": d.get("x_sources", [])}


def chroma_col():
    import chromadb
    return chromadb.PersistentClient(path=CHROMA_DIR).get_collection(COLLECTION)


# ── 정규화·중복(임베딩 없이: 해시 + 문자 2-그램 자카드 — P1 단순화, docs/58 §1.2) ──
def norm_q(s: str) -> str:
    return re.sub(r"[\s\.\?!,·'\"()\[\]]+", "", (s or "")).lower()


def bigrams(s: str) -> set:
    n = norm_q(s)
    return {n[i:i + 2] for i in range(len(n) - 1)} if len(n) > 1 else {n}


def jaccard(a: set, b: set) -> float:
    return len(a & b) / max(1, len(a | b))


def qhash(s: str) -> str:
    return hashlib.md5(norm_q(s).encode()).hexdigest()[:12]


def topics_of(text: str) -> list:
    t = text or ""
    return [k for k, kws in TOPIC_KW.items() if any(w in t for w in kws)]


# ── 질문은행 IO ─────────────────────────────────────────────────────────────
def load_bank() -> list:
    if not BANK.exists():
        return []
    out = []
    for ln in BANK.read_text(encoding="utf-8").splitlines():
        if ln.strip():
            try:
                out.append(json.loads(ln))
            except Exception:  # noqa: BLE001
                pass
    return out


def save_bank(rows: list) -> None:
    BANK.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
