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


# ── 출제 후보 청크 게이트(2026-08-15) ────────────────────────────────────────────
# 길이만으로는 '문답 가능한 지식'을 못 가린다. 변환 파편(세로쓰기 PDF·목차 쪽번호)이나
# 적재 산출물 표에서 출제하면 기대 정답이 조문이 아니라 파편 한 줄이라 질문과 골든이
# 애초에 대응하지 않는다 — 서비스가 무엇을 하든 오답이 찍히는 **점수 오염**이다.
#
# ⛔ 임계값은 전부 **실측 리프트로 정했다**(은행 5,145 채점문항 × 코퍼스 6,192청크,
#    기저 미정답률 14.5%). 가설이 아니라 측정이 남긴 값이다:
#      · 문자파편 one>=0.40 → 미정답 22.6% (×1.56)
#      · 라벨나열 med<=6    → 미정답 22.0% (×1.51)
#      · 적재산출물 build>=0.30 → 20문항뿐이라 리프트는 ×1.03이나, 기대정답이 파일명이라
#        **문항으로서 성립하지 않는다**(질적 근거로 유지 — '기능정리 1 | 기능정리 1.md' 실측)
#    합산: 후보의 6.3%만 제외하고 제외권 미정답률 19.3% vs 잔존 14.2%(×1.36).
#
# ⚠ 세운 가설 중 **측정이 기각한 것**(되살리지 말 것 — 각각 실측 근거가 있다):
#   ✗ "표 위주 청크를 빼자"    — 파이프표 골든 문항의 미정답률 14%로 기저(15%)와 같다.
#      tbl>=0.75 단독 리프트 ×1.15. 표에서 나온 문항 136건이 **정답**이었다. 빼면 순손실.
#   ✗ "라벨 밀도로 판정하자"   — kv/bare 라벨 비율은 결함청크 18% vs 정상청크 22%로 **역전**.
#      이 코퍼스는 개조식이 정상이라 라벨 비율이 정상 청크에서 더 높다(과거 철회 게이트와 같은 함정).
#   ✗ "단문 불릿 나열을 빼자"  — 컬럼 나열 청크 리프트 ×0.74로 오히려 **평균보다 잘 맞는다**.
#   ✗ "숫자 밀도로 판정하자"   — digit>=0.15는 ×1.54로 보이지만 실체는 `<개정 2012. 6. 4.>`
#      개정일 표기다. 금액 조문을 통째로 시험에서 지울 뻔했다.
# 판정은 결정적(LLM 0회)이고 MIN_CHUNK와 같은 자리에서 돈다.
_BUILD_ARTIFACT = re.compile(r"\.md\b|기능정리\s*\d")
CHUNK_GATE = os.environ.get("DAILY_EVAL_CHUNK_GATE", "1") != "0"


def chunk_unanswerable(doc: str) -> list:
    """출제 후보로 부적격인 사유 코드 목록(빈 리스트 = 출제 가능).

    ⛔ 규정 원문은 사실상 건드리지 않는다(실측 제외율 regulation 0.1% · term 0%) —
       걸리는 것은 guide 21%·system 6%로, 전부 PDF 변환 파편과 적재 산출물 쪽이다.
    """
    lines = [l.strip() for l in (doc or "").splitlines() if l.strip()]
    if not lines:
        return ["빈청크"]
    n = len(lines)
    out = []
    # ⓐ 문자파편 — 한두 글자 줄이 절반 가까이면 세로쓰기 PDF·레이아웃 붕괴 잔해다
    #    (실측: 출판업무편람의 '출/판/물/발/간/절/차' 세로 제목띠).
    if sum(1 for l in lines if len(l) <= 2) / n >= 0.40:
        out.append("문자파편")
    # ⓑ 라벨나열 — 줄 길이 중앙값이 6자 이하면 서술이 아니라 항목 라벨만 쌓인 것
    #    (목차 쪽번호·컬럼명 나열). ⚠ 개조식 서술은 중앙값이 이보다 훨씬 길어 살아남는다.
    if sorted(len(l) for l in lines)[n // 2] <= 6:
        out.append("라벨나열")
    # ⓒ 적재산출물 — 파이프라인이 만든 파일명·'기능정리 N' 표. 지식이 아니라 빌드 로그다.
    if sum(1 for l in lines if _BUILD_ARTIFACT.search(l)) / n >= 0.30:
        out.append("적재산출물")
    return out
# 복합 시나리오 비중(specs/07 A) — 신규 문항 중. 단일을 남기는 이유는 코퍼스 전체를 도는
# **청크 커버리지 순환**이 복합만으로는 달성되지 않기 때문(여정 13종은 코퍼스의 일부만 덮는다).
SCEN_RATIO = float(os.environ.get("DAILY_EVAL_SCEN", "0.25"))
# 일상어 패러프레이즈 비중(specs/11 A4) — 청크 출제분 중 몇 할을 **일상어 짝**으로 다시 쓸지.
# 문서어 문항만으로는 질문 어휘가 늘 문서 어휘의 부분집합이라 검색이 거의 항상 이긴다
# (08-02 실측 검색실패 2/60) — 실사용 실패의 주범인 어휘 갭이 시험에 안 잡힌다.
PARA_RATIO = float(os.environ.get("DAILY_EVAL_PARA", "0.40"))

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
    "사내 주차장 배정", "구내식당 외부인 이용", "통근버스 노선",
    "체력단련실(헬스장) 이용", "사내 카페 운영시간", "흡연구역 위치",
    "엘리베이터 점검 일정", "직원 기숙사 배정", "반려동물 동반 출근",
    "옥상 정원 이용", "전기차 충전소 이용", "택배 보관",
    "사내 이발소", "은행 지점 입점", "회의실 음식물 반입",
    # 2026-07-26 교체분 — audit_refusal_seeds.py로 '코퍼스 무언급' 확인한 것만 추가.
    # ⛔ 제외: "우편물 발송 대행"(문서관리규정 제32조가 인편·우편 발송을 규율)
    "사내 편의점 할인", "무인 택배함 이용", "명상실 예약", "사내 세탁 서비스",
]
# ⛔ 시드 제거는 **절반이다** — 시드는 신규 출제만 막고, 은행에 쌓인 같은 부류 문항은
#   재시험 풀에서 매일 다시 나온다(08-15 실측: 시드 제거 다음 날 냉난방 문항 재등장,
#   재시험 코호트 71.7→65.0). **시드를 뺄 때는 golden_repair --retire로 같은 주제의
#   은행 문항도 전수 은퇴**할 것(그날 30건 은퇴로 잔존 0).
# ⛔ 시드에서 **제거**된 것 — 전 회차 실측 거부 성공률(정답/(정답+오답))이 근거. 되살리지 말 것.
#   ✗ "사옥 냉난방 온도"  18%(7/37) — 길라잡이에 "여름 28℃/겨울 18℃" 실존 = 정답이 거부가 아님.
#      개별 문항 은퇴(08-12)만으론 못 막았다: 시드가 살아 있어 **같은 부류를 새 해시로 재생산**
#      (08-13 r147 실측) — 부류 재발은 시드에서 끊는다.
#   ✗ "탕비실 비품"     31%(6/19) — 07-26에 '제외' 결정을 주석에만 쓰고 리스트에서 안 지웠던
#      코드-주석 불일치(08-14 실측 발견). 물품 지침 제15조가 수리·보수를 규율.
#   ✗ "사내 어린이집 입소" 71%(10/14) — 가족돌봄휴가 등 관련 규정 실재(08-12 실측, r414 은퇴 근거).
# ⚠ 관찰 중(코퍼스 무언급인데 성공률 중간 = 시드가 아니라 **생성 측 결함**: 부재→유추 단정):
#   명상실 56% · 전기차 65% · 사내 세탁 65% · 회의실 음식물 77%. 시드는 유지하고 생성 규칙으로
#   해결한다(docs/71 G1). 이 수치가 올라가는지가 그 개입의 성적표다.


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
    return {"content": d["choices"][0]["message"]["content"], "x_sources": d.get("x_sources", []),
            "x_gates": d.get("x_gates")}   # specs/16 W1-E 텔레메트리(없으면 None — 구서버 호환)


def chroma_col():
    import chromadb
    return chromadb.PersistentClient(path=CHROMA_DIR).get_collection(COLLECTION)


# ── 거부 원인 분류의 **단일 정본**(refusal_detect와 같은 철학, 2026-08-06) ──
# ⛔ 각자 "거부 = 검색실패"로 단정 금지. 축 채점기 5곳이 x_sources를 보지 않고 거부만으로
#    검색실패를 찍고 있었고(axes 4 + scenarios 1), 그 탓에 검색실패 56건 중 9건(16%)이
#    오분류됐다. 그중 dq-2026-07-30b-a02는 **7회차 연속** 같은 오분류로 수술대기에 올랐다.
#    실측 사례: '사적이해관계자' — 근거(제12조)는 정확히 회수됐으나 그 조문이 '수의계약 제한'
#    이라 모델이 올바르게 거부. 원인은 검색이 아니라 defterms 인덱스 오귀속이었다.
def retrieved_expected(item: dict) -> bool:
    """기대 근거(출처 규정명·조)가 실제로 회수됐는가. daily_grade.classify_cause와 같은 규칙."""
    src = item.get("출처") or {}
    reg, jo = (src.get("규정명") or "").strip(), (src.get("조") or "").strip()
    if not reg:
        srcs = item.get("출처들") or []
        return any(retrieved_expected({**item, "출처": s, "출처들": []}) for s in srcs)
    base = jo.split("의")[0]
    return any((s.get("규정명") or "").strip() == reg
               and (not jo or (s.get("조") or "").startswith(base))
               for s in (item.get("x_sources") or []))


def refusal_cause(item: dict) -> str:
    """거부 답변의 원인. 회수 실패면 '검색실패', **회수는 됐는데 거부**면 '근거부적합'.

    '근거부적합' = 근거는 붙었으나 기대 답을 담고 있지 않음 → 검색 개선이 아니라
    인덱스 귀속·골든 품질·기능 배선(예: 그래프 파급 데이터가 채팅 컨텍스트에 미첨부)을
    점검해야 하는 사안. 검색 탓으로 뭉뚱그리면 진짜 원인이 라벨 뒤에 숨는다."""
    return "검색실패" if not retrieved_expected(item) else "근거부적합"


# ── 만성(고착 부채) 판정의 **단일 정본** (2026-08-19) ──────────────────────────────
# 배경(08-18 진단): 재시험 코호트에는 성격이 다른 두 가지가 섞여 있다 —
#   ⓐ 어제까지 맞히다 오늘 틀린 것(= **회귀**, 오늘 새로 깨진 것)
#   ⓑ 몇 주째 같은 이유로 틀리는 것(= **고착 부채**, 어제와 달라진 게 없다)
# 한 숫자로 합치면 "재시험 67.4% → 61.9%"가 회귀인지 부채인지 말해주지 못한다.
# ⛔ **분해이지 조작이 아니다** — 만성 문항도 전량 계속 출제하고(백오프 없음), 합산
#    `정답률`·`코호트별` 계산식도 건드리지 않는다. 표시용 분해만 얹는다.
# ⛔ 이 규칙을 각자 복제하지 말 것(daily_grade·daily_report·eval_notice가 여기를 쓴다) —
#    거부 판정 정규식을 5곳이 복제해 T9를 재발시킨 것과 같은 함정이다(docs/62).
#
# 기준 = **직전까지 연속 미정답 K회 이상**. K=3은 실측으로 골랐다(최근 10회차 그림자 재집계,
# 과거 파일 재작성 없음 · 만성 판정은 그 회차 **시작 시점 이력**만 사용 = look-ahead 금지):
#   K=2 → 만성 트랙 정답률 20.1% · 재시험 미정답 흡수율 53%(아직 회복 중인 문항이 섞인다)
#   K=3 → 13.5% · 흡수율 41%  ← 채택. 트랙 자체가 거의 순수 부채다
#   K=4 → 12.6% · 흡수율 32%(부채를 놓친다)
#   ✗ sticky 변형(한 번 만성이면 3연속 정답까지 유지) — 만성 정답률 24.4%로 희석돼 기각.
# ⚠ 정답 1회로 즉시 해제된다(졸업 가능) — 만성은 낙인이 아니라 **현재 상태**여야 한다.
#
# ⛔ 함께 검토하고 **데이터가 기각한 것**(08-18이 다음 표적으로 남긴 안 — 되살리지 말 것):
#   ✗ "만성 문항 재출제 백오프(주 1회)로 재시험 지표를 회귀에 민감하게 만들자"
#      → 만성이 재시험에서 차지하는 비중은 최근 10회차 **12~18%로 이미 안정적**이고,
#        만성비중 ↔ 재시험 정답률 상관은 r=+0.58로 **가설과 부호가 반대**다("만성이 많이
#        뽑힌 날 점수가 낮다"가 성립하지 않는다). 재시험 등락의 실제 동인은 급성분의
#        첫 실패(회차당 1~6건) 변동이었다. 백오프는 회귀 감지만 잃고 얻는 게 없다.
CHRONIC_STREAK = int(os.environ.get("DAILY_EVAL_CHRONIC", "3"))
UNSCORED = ("폐기", "판정불가")   # 채점이 성립하지 않은 판정 — 부채·정답률 분모 밖


def graded_history(bank_entry) -> list:
    """채점이 성립한 판정만(폐기·판정불가 제외). 시험지 결함은 부채 카운트가 아니다."""
    return [h.get("판정") for h in ((bank_entry or {}).get("판정이력") or [])
            if h.get("판정") not in UNSCORED]


def chronic_of(bank_entry) -> bool:
    """만성(고착 부채)인가. ⚠ cohort_of와 같이 **오늘 이력 append 전에** 호출한다."""
    h = graded_history(bank_entry)
    if len(h) < CHRONIC_STREAK:
        return False
    streak = 0
    for v in reversed(h):
        if v == "정답":
            break
        streak += 1
    return streak >= CHRONIC_STREAK


def prev_verdict(bank_entry) -> str:
    """직전 회차의 채점 판정(없으면 ""). '오늘 새로 깨진 것'을 세는 데 쓴다."""
    h = graded_history(bank_entry)
    return h[-1] if h else ""


# ── 비율의 불확실도 — 재시험 지표를 회차 간 비교 가능하게 만드는 유일한 장치 ────────────
# ⛔ **실측으로 확립(2026-08-23 수술)**. 배경: "같은 날 b회차가 a회차보다 항상 나쁘다
#    (08-22 64.6→54.3 · 08-23 60.9→56.5)"는 구조 가설이 제기됐고, 전량 기각됐다:
#      ⓐ 같은 문항만 짝지은 McNemar — 08-22쌍 a정답b오답 7 vs a오답b정답 5(p=0.77),
#         08-23쌍 5 vs 5(p=1.00). 방향성 없음.
#      ⓑ 이력 전체의 다회차 8일 pooled — **1회차 195/291(67.0%) vs 후속회차 322/471(68.4%)**,
#         z=-0.39 p=0.70. 후속 회차가 오히려 근소 우위다(가설과 반대 부호).
#      ⓒ 가설의 전제("a의 갓 깨진 오답이 b로 유입돼 어렵다")도 반대였다 — 직전 회차가
#         첫 출제였던 '초시 재시험'은 pooled 72.6%(n=73)로 누적 재시험 59.5%(n=291)보다 **쉽다**.
#      ⓓ 구성 표준화(재시험 깊이 3층 직접표준화)로는 회차 간 분산이 줄지 않았다(4.58→4.94).
#    → 남은 설명은 하나뿐이다: **재시험 정답률의 분모는 n≈46이고 95% 구간이 ±14%p다.**
#      10%p 스윙 두 번은 정확히 잡음이 만드는 모양이다. 그래서 지표를 바꾸는 대신
#      **분모와 구간을 같이 싣는다** — 숫자는 한 자리도 변하지 않고 해석만 정직해진다.
# ⚠ Wilson 구간을 쓴다(정규근사 아님) — n<50·비율이 0/1에 가까울 때 근사가 구간을 [0,100]
#   밖으로 내보낸다(만성 트랙은 실제로 0%가 자주 나온다).
def wilson_ci(k: int, n: int, z: float = 1.96) -> tuple:
    """이항비율의 Wilson 95% 신뢰구간(%, 소수 1자리). n=0이면 (None, None)."""
    if not n:
        return (None, None)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
    return (round(100 * max(0.0, c - h), 1), round(100 * min(1.0, c + h), 1))


def within_noise(rate, ci) -> bool:
    """직전 회차 값이 이번 회차 신뢰구간 안에 있는가 = '달라졌다고 말할 수 없다'."""
    if rate is None or not ci or ci[0] is None:
        return False
    return ci[0] <= rate <= ci[1]


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
