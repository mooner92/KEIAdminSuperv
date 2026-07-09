#!/usr/bin/env python3
"""rag_core.py — 검색·생성 공용 코어.

04_rag_api.py(OpenAI 호환 엔드포인트)와 app_api.py(상태형 채팅: 로그인/기록/멀티턴)가
이 코어를 공유한다 → 임베딩/벡터DB/LLM 클라이언트를 한 번만 로드(한 프로세스).

가드레일(절대 규칙): 근거 밖 내용 금지, 출처 [규정명 제N조], 면책 문구. 약화시키지 말 것.
"""
import json
import os
import re
import sqlite3
import threading
import time
import unicodedata

EMBED_MODEL = os.environ.get("EMBED_MODEL", "nlpai-lab/KURE-v1")   # 02/03과 동일해야 함
CHROMA_DIR = os.environ.get("CHROMA_DIR", "tools/chroma")
COLLECTION = os.environ.get("RAG_COLLECTION", "kei_regs")
VLLM_BASE = os.environ.get("VLLM_BASE", "http://localhost:8000/v1")  # 실제로는 Ollama
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-14B-Instruct")
TOPK = int(os.environ.get("RAG_TOPK", "5"))
# 하이브리드 검색(밀집 KURE-v1 + 어휘 BM25 → RRF 융합). 기본 off — 평가로 개선 입증 후 켠다.
HYBRID = os.environ.get("RAG_HYBRID", "0") not in ("0", "", "false", "False")
FUSION_POOL = int(os.environ.get("RAG_FUSION_POOL", "20"))  # 각 검색기에서 뽑는 후보 수
# RRF 가중치 [밀집, 어휘]. 강한 밀집을 약한 BM25가 끌어내리지 않게 밀집을 더 신뢰(기본 2:1).
RRF_WEIGHTS = [float(x) for x in os.environ.get("RAG_RRF_WEIGHTS", "2,1").split(",")]
# 리랭커(cross-encoder, 온프레미스). 밀집 top-pool을 (질의,청크) 재점수로 재정렬 → top-k.
RERANK = os.environ.get("RAG_RERANK", "0") not in ("0", "", "false", "False")
RERANK_MODEL = os.environ.get("RAG_RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
RERANK_POOL = int(os.environ.get("RAG_RERANK_POOL", "20"))      # 재점수 후보 수
RERANK_DEVICE = os.environ.get("RAG_RERANK_DEVICE", "cpu")      # 운영은 cuda 권장(여유 GPU)
# 멀티턴 질의 재작성: 후속 질문("몇 퍼센트야?")을 직전 맥락을 복원한 '독립 검색어'로 바꿔 검색 정확도↑.
# 검색어만 바꾸고 답변 생성은 원 질문/근거 그대로(가드레일 불변). 기본 on, 첫 턴(history 없음)은 미적용.
REWRITE = os.environ.get("RAG_QUERY_REWRITE", "1") not in ("0", "", "false", "False")
# 섹션 다양성(P2.4): 절차 질의에서 규정이 top-k를 독점해 ERP(시스템)·가이드가 밀릴까 봐 만든 좌석 보장.
# ⛔ 평가 결과 이득 없음 → 기본 off(opt-in). 밀집(KURE-v1)이 이미 규정+가이드+시스템+용어를 골고루
# 회수하므로(측정: off=on 동일) 강제 승격 불필요. 하이브리드(P1.4)와 같은 판단 — 인프라만 보존.
SECTION_DIVERSITY = os.environ.get("RAG_SECTION_DIVERSITY", "0") not in ("0", "", "false", "False")
DIVERSITY_GATE = int(os.environ.get("RAG_DIVERSITY_GATE", "8"))  # 이 순위 안에 있어야 좌석 승격(관련성 게이트)
# 그래프 1홉 확장(경량 GraphRAG): 조문 회수 시 그 조문을 인용하는 별표(표)를 자동 동반 회수한다.
# 별표 청크의 refs(=이 별표를 인용하는 조문들)를 역인덱스해, 예: 여비규정 제16조 회수 → 국내여비 별표2
# (실제 일비·숙박·식비 금액 표)를 자동 첨부. '표 회수 누락'(여비류 금액 오답)을 구조적으로 보완한다.
# ⛔ 검색 순위를 바꾸지 않고 별표만 덧붙임 → 출처 보존, LLM 불필요, 재임베딩 불필요.
GRAPH_EXPAND = os.environ.get("RAG_GRAPH_EXPAND", "1") not in ("0", "", "false", "False")
GRAPH_EXPAND_MAX = int(os.environ.get("RAG_GRAPH_EXPAND_MAX", "3"))  # 회수당 자동첨부 별표 상한
# 규정↔규정 1홉 확장: 회수 조문이 다른 규정 제N조를 준용/참조(reg_refs)하면 그 조문도 첨부.
# "이 지침이 저 규정과 상충?"류에 유효하나 top-k 희석 위험 → ⛔ 기본 off(opt-in), 평가로 이득 입증 후 켠다.
GRAPH_EXPAND_REGS_MAX = int(os.environ.get("RAG_GRAPH_EXPAND_REGS_MAX", "2"))  # 회수당 규정참조 첨부 상한
# graph_expand_regs는 관리자 페이지(/admin) feature flag로 런타임 토글한다(app_api FLAG_REGISTRY).
# 우선순위: env(RAG_GRAPH_EXPAND_REGS 명시 시 운영 강제) > SQLite flag 테이블(admin 토글) > 기본 off.
_FLAG_TTL = 20.0  # 초 — admin 토글이 이 안에 반영
_flag_cache = {"t": -1e9, "vals": {}}

# ── Track A: 조문 정제 인덱스(01i/01j/01k 산출, tools/index/*.json) ─────────────────
INDEX_DIR = os.environ.get("RAG_INDEX_DIR",
                           os.path.join(os.path.dirname(os.path.abspath(__file__)), "index"))
# 조문 효력 오버레이: 회수된 '삭제 조문'을 근거에서 강등 + 효력/최근개정 메타 부착(재임베딩 불필요).
# ⛔ 절대 규칙1 방어 — 삭제된 조문을 유효 근거처럼 인용하지 않게 한다. 기본 on.
ARTICLE_STATUS = os.environ.get("RAG_ARTICLE_STATUS", "1") not in ("0", "", "false", "False")
# clause_xref: 조문↔조문 준용·인용 그래프. reg 확장(graph_expand_regs)의 더 완전한 근거로 병합. 기본 on.
CLAUSE_XREF = os.environ.get("RAG_CLAUSE_XREF", "1") not in ("0", "", "false", "False")


def _flag(name: str, default: bool = False) -> bool:
    """app.db의 flag 테이블에서 플래그 값 읽기(20초 TTL 캐시). rag_core가 app_api를 임포트하지 않도록
    sqlite로 직접 조회(순환의존 회피). DB/행 없으면 default."""
    db = os.environ.get("APP_DB")
    if not db or not os.path.exists(db):
        return default
    now = time.monotonic()
    if now - _flag_cache["t"] > _FLAG_TTL:
        try:
            con = sqlite3.connect(db, timeout=1)
            _flag_cache["vals"] = {k: bool(v) for k, v in con.execute("SELECT key, enabled FROM flag").fetchall()}
            con.close()
        except Exception:  # noqa: BLE001 — 플래그 조회 실패는 기본값으로 강등
            pass
        _flag_cache["t"] = now
    return _flag_cache["vals"].get(name, default)


def _graph_expand_regs_on() -> bool:
    env = os.environ.get("RAG_GRAPH_EXPAND_REGS")
    if env is not None:  # env 명시 시 운영 강제(테스트/오버라이드)
        return env not in ("0", "", "false", "False")
    return _flag("graph_expand_regs", False)  # 관리자 플래그(/admin), 기본 off


# ── 행위(Action) 흐름 1홉 확장 — 신청 화면 회수 시 '의무적 후속 단계'(정산·결과보고) 화면을 자동 첨부 ──
# 유일한 typed 엣지(별표 refs와 동형): 노드=화면 안내 청크, 엣지="후속 단계" 술어.
# ⛔ 페어는 근거 문서로 확정된 것만(ERP 상세가이드 부록 '출장 업무 흐름'의 화면ID 체인, PMS 노트의 화면 쌍).
#    조건부 후속(취소·변경 등 '필요 시')은 오도 위험이라 제외 — 의무적 정산·결과보고만.
# 매칭: 청크 라벨(조 필드=화면 헤딩)에 from이 포함되면 to 라벨 청크를 첨부(둘 다 색인에 실존할 때만).
ACTION_FLOWS = [
    # (from 라벨 포함 문자열, to 라벨 포함 문자열, 관계)
    ("국내출장신청", "국내출장정산신청", "정산"),          # ERP 상세가이드 부록: gen_0020M → gen_0030M/0031P
    ("해외출장신청", "해외출장결과보고", "결과보고"),        # 부록: gen_0040M → gen_0042M
    ("해외출장결과보고", "해외출장정산", "정산"),           # 부록: gen_0042M → gen_0052M
    ("연장근로신청", "연장근로결과보고", "결과보고"),        # hrm_0340M → hrm_0350M(둘 다 상세가이드 수록)
    ("연장근로현황", "연장근로결과보고", "결과보고"),
    ("교육신청", "교육결과보고", "결과보고"),              # 상세가이드 수록 쌍
    ("회의개최승인신청", "회의결과보고", "결과보고"),        # PMS: prg_0200M → prg_0205M
    ("행사개최승인신청", "행사개최결과보고", "결과보고"),     # PMS: prg_0500M → prg_0510M
    ("외부전문가활용계획", "외부전문가활용결과보고", "결과보고"),  # PMS: prg_0410M → prg_0420M
    ("연구연수계획신청", "연구연수결과보고", "결과보고"),     # PMS: prg_0150M → prg_0170M
]
GRAPH_EXPAND_ACTIONS_MAX = int(os.environ.get("RAG_GRAPH_EXPAND_ACTIONS_MAX", "2"))  # 질의당 첨부 상한


def _graph_expand_actions_on() -> bool:
    env = os.environ.get("RAG_GRAPH_EXPAND_ACTIONS")
    if env is not None:  # env 명시 시 운영 강제(테스트/오버라이드)
        return env not in ("0", "", "false", "False")
    return _flag("graph_expand_actions", False)  # 관리자 플래그(/admin), 기본 off
# 모델 상주(콜드스타트 방지). -1 = 무한 상주(언로드 안 함). "30m" 등 Ollama keep_alive 값도 가능.
KEEP_ALIVE = os.environ.get("OLLAMA_KEEP_ALIVE", "-1")
# 컨텍스트 예산(문자) — 큰 청크(출판편람 표 등)가 top-k에 몰리면 ctx 8K 초과로 Ollama 400(빈답변)이 난다.
# 순위 높은 블록부터 담다가 예산 초과 시 마지막 블록을 절단하고 이후는 버린다(SYSTEM·멀티턴·답변 여유 확보).
# 한글 대략 1.2자/토큰 → 6500자 ≈ 5400토큰. SYSTEM(~1300)+답변 여유까지 8K 안에 든다.
CTX_MAX_CHARS = int(os.environ.get("RAG_CTX_MAX_CHARS", "6500"))


def _cap_blocks(blocks):
    """근거 블록(순위순)을 CTX_MAX_CHARS 예산 안에 담는다. 초과 블록은 절단, 이후는 제외.

    반환 (담긴 블록들, 마지막 블록이 절단됐는지). 호출부는 srcs를 len(blocks)로 동기화해
    'LLM이 읽지 않은 근거가 목록에 표시'되는 불일치를 막는다(근거 표기 정직성)."""
    out, used = [], 0
    truncated_last = False
    for b in blocks:
        if used + len(b) <= CTX_MAX_CHARS:
            out.append(b); used += len(b)
        elif CTX_MAX_CHARS - used > 500:      # 남은 예산이 의미 있으면 이 블록만 잘라 담음
            out.append(b[: CTX_MAX_CHARS - used].rstrip() + "\n…(근거가 길어 일부 생략 — 정확한 값은 원문 확인)")
            truncated_last = True
            break
        else:
            break
    return out, truncated_last

# 하이브리드 추론 모델(qwen3/3.5)은 기본적으로 사고과정을 답 앞에 먼저 생성한다.
# RAG에선 사고를 끄고 답만 받는다 — 스트리밍/후처리(두괄식·면책·출처) 안정.
# ⚠ 세대별 제어가 다르다(실측): qwen3 = 시스템 '/no_think' 지시 / qwen3.5 = 요청 파라미터 think:false
#   ('/no_think'는 qwen3.5에 무효 — thinking이 그대로 돈다). 모델명으로 자동 분기.
# 강제 토글(RAG_NO_THINK=0/1)도 지원. 미설정이면 모델명에 'qwen3' 있으면 자동 on.
_env_nt = os.environ.get("RAG_NO_THINK")
NO_THINK = ("qwen3" in LLM_MODEL.lower()) if _env_nt is None else (_env_nt not in ("0", "", "false", "False"))
QWEN35 = "qwen3.5" in LLM_MODEL.lower()  # think:false 파라미터 세대(qwen3.5-*)
_THINK_RE = re.compile(r"<think>.*?</think>\s*", re.DOTALL)

# qwen3.5-9B GGUF(Q4, Vulkan 경로)가 숫자·조문 토큰 사이에 공백을 삽입하는 표기 결함이 있어
# (A/B 실측 25건 중 22건: '제 11 조'·'2 년'·'2 분의 1'), 결정적 후처리로 표기만 정규화한다.
# 목적: 출처 인용(제\d+조)·근거 칩 매칭·가독성 보호. ⛔ 값 자체는 절대 바꾸지 않는다(공백만 제거).
_SP_JO1_RE = re.compile(r"제\s+(\d+)\s*(조|항|호|장|절|편)")   # '제 11 조' → 제11조
_SP_JO2_RE = re.compile(r"(제\d+)\s+(조|항|호|장|절|편)")       # '제5 호'·'제18 조' → 제5호
_SP_NUM_RE = re.compile(
    r"(\d[\d,\.]*)\s+(만\s*원|만|억|천|원|년|월|일|시간|분|초|개월|주|회|명|배|건|점|박|퍼센트|%|킬로미터|㎞|km|킬로그램|kg)")
_SP_BUNUI_RE = re.compile(r"(\d+)\s*분의\s*(\d+)")


def _tighten_spacing(text: str) -> str:
    t = _SP_JO1_RE.sub(r"제\1\2", text)
    t = _SP_JO2_RE.sub(r"\1\2", t)
    t = _SP_NUM_RE.sub(lambda m: m.group(1) + m.group(2).replace(" ", ""), t)  # '2 만 원'→2만원
    return _SP_BUNUI_RE.sub(r"\1분의 \2", t)


# 마크다운/수식 표기 정리 — qwen3.5가 별표 강조에 공백을 넣거나(** 굵게 **) LaTeX 수식($…\text{}…$)을
# 뱉으면 프론트(react-markdown, KaTeX 미도입)가 파싱 못 해 raw로 노출된다. 프롬프트로 억제 + 표기만 결정적 정리(값 불변).
# 볼드는 '**…**' 짝 단위로 안쪽 공백만 trim(한쪽/양쪽 공백 모두 안전). 한 줄 내로 한정(줄바꿈 넘어 과매치 방지).
_MD_BOLD_RE = re.compile(r"\*\*[ \t]*(\S(?:[^\n]*?\S)?)[ \t]*\*\*")
# qwen3.5가 굵게 안에 따옴표를 넣는 습관(**'연차휴가'**를) — CommonMark는 닫는 **가
# 구두점 뒤+글자 앞이면 강조로 인정하지 않아 원시 ** 노출. 안쪽 따옴표를 벗겨 교정.
_MD_BOLD_QUOTE_RE = re.compile(r"\*\*['\"‘’“”]([^*\n]+?)['\"‘’“”]\*\*")
_LATEX_TEXT_RE = re.compile(r"\\(?:text|mathrm|mathbf)\s*\{([^}]*)\}")  # \text{원} → 원
_LATEX_CMD = [(r"\times", "×"), (r"\div", "÷"), (r"\cdot", "·"), (r"\pm", "±"),
              (r"\leq", "≤"), (r"\geq", "≥"), (r"\%", "%"), (r"\,", " "), (r"\;", " ")]
_LATEX_DELIM_RE = re.compile(r"\${1,2}|\\[()\[\]]")               # $…$ , \( \) \[ \]
_LATEX_LEFTOVER_RE = re.compile(r"\\[a-zA-Z]+")                   # 남은 백슬래시 명령(\frac 등) 제거


def _fix_markdown(text: str) -> str:
    text = _MD_BOLD_RE.sub(r"**\1**", text)
    return _MD_BOLD_QUOTE_RE.sub(r"**\1**", text)


def _strip_latex(text: str) -> str:
    """LaTeX 수식 표기를 평문으로(값 불변). 프론트가 KaTeX를 렌더하지 않아 raw 노출되는 걸 막는다."""
    if "$" not in text and "\\" not in text:
        return text
    t = _LATEX_TEXT_RE.sub(r"\1", text)
    for k, v in _LATEX_CMD:
        t = t.replace(k, v)
    t = _LATEX_DELIM_RE.sub("", t)
    return _LATEX_LEFTOVER_RE.sub("", t)


def _strip_think(text: str) -> str:
    """qwen3 등의 <think>…</think> 사고블록을 제거(방어적). 사고 off로 대개 발생하지 않지만
    혹시 새어나와도 최종 답변엔 노출하지 않는다(스트리밍 중 미완결 블록도 방어)."""
    t = text or ""
    if "<think>" not in t:
        return t
    t = _THINK_RE.sub("", t)          # 닫힌 사고블록 제거
    if "<think>" in t:                # 열린 채 아직 안 닫힌 경우(스트리밍 중간)
        t = t.split("</think>")[-1] if "</think>" in t else t.split("<think>")[0]
    return t.lstrip()


def _postprocess(text: str) -> str:
    """사고블록 제거 + (qwen3.5) 공백결함 정규화 + LaTeX·마크다운 표기 정리 — 생성 텍스트 공통 후처리."""
    t = _strip_latex(_strip_think(text))   # LaTeX($…\text…$) → 평문 먼저(그래야 '1,000 원' 같은 공백을 아래서 정리)
    if QWEN35:
        t = _tighten_spacing(t)
    return _fix_markdown(t)  # '** 굵게 **' → '**굵게**' (짝 단위 안쪽 공백 trim)


def _keep_alive():
    try:
        return int(KEEP_ALIVE)
    except (TypeError, ValueError):
        return KEEP_ALIVE


SYSTEM = (
    "너는 KEI 행정 도우미다. 아래 [근거] 규정 조문만 사용해 답한다.\n"
    "1) [근거]에 없는 내용(금액·한도·기한 등)은 지어내지 말고 '규정에서 확인되지 않습니다'라고 한다.\n"
    "2) 반드시 두괄식. 답변 **첫 줄**에 질문에 대한 **핵심 답 한 문장**을 굵게 제시한다"
    " (금액·가부·기한 질문이면 그 값이나 가부를 첫 줄에서 바로 답한다). 근거·계산·절차는 그다음에 둔다.\n"
    "3) 간결·표기: 꼭 필요한 정보(값·조건·처리 경로)만 담고, 뻔한 재진술·중복·과도한 단계 나열을 피한다"
    " (신입이 훑어보게 핵심 3~6줄 이내, 부가설명 최소화). 숫자·계산은 일반 텍스트로 쓴다"
    "(예: 1만원 × 3일 = 3만원). ⛔ LaTeX·수식 문법(달러기호 $ 로 감싸기, 백슬래시 명령)을 쓰지 않는다."
    " 굵게 강조는 **굵게**처럼 별표에 글자를 붙여 쓰고, 별표와 글자 사이에 공백을 넣지 않는다(** 굵게 ** 금지).\n"
    "4) 답변 끝에 사용한 출처를 [규정명 제N조] 형식으로 표기하되, 가장 핵심이 된 조문을 맨 앞에 둔다.\n"
    "5) 마지막에 '최종 판단은 원문과 담당 부서 확인 바랍니다.'를 덧붙인다.\n"
    "6) 이전 대화 맥락을 참고하되, 사실 근거는 항상 이번 [근거]에서만 가져온다.\n"
    "7) [근거]에 '(… 시스템)' 항목(ERP·전자결재·대외업무·웹디스크 등)이 있으면, 그 시스템명과 메뉴·처리 경로를"
    " '처리 방법'에 함께 안내한다 (근거에 없는 시스템·경로·서식명은 지어내지 않는다)."
    " [근거]에 '후속 단계' 항목이 있으면 신청 후 이어서 해야 하는 정산·결과보고를 답변 끝에 한 줄로 반드시 안내한다"
    "(예: '출장 후 국내출장정산신청에서 정산까지 완료해야 합니다')."
    " 결재상신·결재 올리는 방법을 묻거나 신청 절차를 답할 때 [근거]에 '전자결재 기안'(기안신규·결재정보·결재선·편철·결재올림) 내용이 있으면"
    " 그 결재 흐름을 안내한다. 지출 기안은 [근거]에 일상감사 기준(일정 금액 초과 시 일상감사신청)이 있으면 그 기준을 안내한다.\n"
    "8) 이전 대화에서 다루던 대상·주제(예: 국내출장)를 사용자가 바꾸지 않았으면 끝까지 같은 대상으로 답한다."
    " [근거]가 다른 대상(예: 국외출장)만 담고 있으면, 그 대상의 내용은 근거에서 확인되지 않는다고 밝히고"
    " 임의로 대상을 바꾸지 않는다.\n"
    "9) 여비·수당처럼 별표(표)로 등급·거리·일수에 따라 정해지는 금액은 하나의 값으로 단정하지 않는다."
    " 항목(운임 실비·일비·숙박비·식비 등)과 조건(직급, 출장 일수·숙박 여부, 그리고 '근무지 내 국내 출장'인지"
    " 일반(관외) 국내 출장인지)을 구분해 설명하고, 정확한 금액은 해당 별표 원문과 담당 부서 확인을 안내한다."
    " '근무지 내 출장'(같은 시·군 또는 근거리)과 일반 국내 출장은 여비 기준이 완전히 다르니 혼동하지 않는다."
    " 예산 편성용 단가(연구사업비 가이드라인의 '×인×회' 등)를 개인 출장 실지급 여비로 제시하지 않는다.\n"
    "10) 금액·일수를 계산하면 핵심 계산식을 한두 줄로 간결히 보이고 근거 조문·별표를 붙인다"
    "(예: '일비 1만원 × 3일 + 숙박비 5만원 × 2박 = 13만원 [여비규정 별표2]'). 단계를 장황하게 늘리지 않는다."
    " ⛔ 계산에 넣는 모든 수치는 반드시 [근거]에 있는 값이어야 한다 — 추측해 채워 넣지 않는다."
    " 필요한 값이 [근거]에 없으면 그 항목은 '규정에서 확인되지 않습니다'라고 밝히고,"
    " 조건에 따라 달라지면 조건별로 나눠 설명한 뒤 원문·담당 부서 확인을 안내한다.\n"
    "11) [근거]는 질문과 가장 관련 높은 조문 일부일 뿐, 전체 규정의 집계가 아니다."
    " 사용자가 '몇 개인지'·'모든/전체 목록'·'종류 전부'처럼 **전체의 개수·전수를 물을 때만** 다음을 적용한다:"
    " ⛔ '총 N개' 표현 금지(근거에 보이는 개수는 전체가 아니다). 첫 줄은 '검색된 근거에서는 ○○ N건이"
    " 확인됩니다(전체 목록 아님)' 형태로 쓰고, [근거]에 있는 항목만 나열한 뒤 전체 목록·정확한 개수는"
    " '규정 둘러보기' 화면과 담당 부서 확인을 안내한다."
    " ⛔ 그 밖의 일반 질문(금액·일수·기한·가부·방법 등)에는 이 형식과 '검색된 근거에서는'·'전체 목록 아님'"
    " 문구를 쓰지 않는다 — 규칙 2대로 첫 줄에 바로 답한다.\n"
    "12) [근거]에 '⚠ 표 구조 손상' 표시가 있는 블록은 변환 과정에서 표의 항목-값 짝이 무너진 것이다."
    " ⛔ 그 블록의 수치(금액·일수)를 답에 쓰지 않는다 — 값 질문이면 '해당 표가 변환 중 손상되어 수치를"
    " 확정할 수 없습니다'라고 밝히고 원문 표(별표)와 담당 부서 확인을 안내한다.\n"
    "13) 자격·수급·적용 여부(누가 받을 수 있나, 나에게 적용되나)는 그 규정의 목적·적용범위 조항"
    "(주로 제1~2조, '(자동첨부)'로 함께 제공됨)을 근거로만 판단한다. ⛔ 지급 기준·계산식 조항에"
    " 계산 방법이 있다는 이유로 자격이 있다고 추론하지 않는다(예: 퇴직금 계산식이 있어도 적용범위가"
    " '1년 이상 근속자'면 1년 미만은 대상이 아니다). 적용범위 조항이 [근거]에 없으면 '적용 여부는"
    " 규정에서 확인되지 않습니다'라고 답하고 담당 부서 확인을 안내한다."
)

# 가드레일(절대 규칙 #4): 모든 답변 끝에 면책 문구. 14B가 종종 누락(평가셋 측정 ~19%)하므로
# 모델 출력에 없으면 결정적으로 덧붙여 100% 보장한다(약화 아닌 강화).
DISCLAIMER = "최종 판단은 원문과 담당 부서 확인 바랍니다."
_DISC_KEY = "최종 판단은"  # 모델이 표현을 살짝 바꿔도 중복 안 붙도록 핵심 어구로 감지


def _ensure_disclaimer(text: str) -> str:
    t = text or ""
    if _DISC_KEY in t:
        return t
    return (t.rstrip() + "\n\n" + DISCLAIMER) if t.strip() else DISCLAIMER


# ── P2.10 집계 정직성 백스톱(SYSTEM 규칙 11의 결정적 보장) ─────────────────
# top-k 근거는 전체 집계가 아니다 — 개수·전수 질문 답변에 '근거 기준(전체 아님)' 한정과
# 전체 확인 경로 안내가 없으면 결정적으로 덧붙인다(면책 문구 _ensure_disclaimer와 같은 패턴).
_ENUM_Q_RE = re.compile(
    r"몇\s*개|몇개|모든|전체\s*(목록|리스트|개수)|목록|리스트|종류|뭐가\s*있|뭐뭐|어떤\s*것들|다\s*알려|전부\s*(알려|보여|뽑|나열)"
)
_ENUM_KEYS = ("전체 목록 아님", "전체 아님", "전체가 아닐", "둘러보기")
_ENUM_NOTE = ("ℹ️ 위 개수·목록은 이번에 검색된 근거 기준이며 전체가 아닐 수 있습니다. "
              "전체 규정은 '규정 둘러보기' 화면에서 확인하세요.")


def _ensure_enum_note(question: str, text: str) -> str:
    """개수·전수 질문인데 답변에 '전체 아님' 한정·둘러보기 안내가 없으면 덧붙인다(무해한 강화)."""
    t = text or ""
    if not t.strip() or not _ENUM_Q_RE.search(question or ""):
        return t
    if any(k in t for k in _ENUM_KEYS):
        return t
    return t.rstrip() + "\n\n" + _ENUM_NOTE


# ── P0-1 수치 검증 게이트 (docs/22 §1) ──────────────────────────────────
# 실측 환각(페르소나 라운드): "연간 근무일수 총 248일 [복무규정 제11조]"(조문에 없음),
# 연말정산 "증빙 마감 1월 18일(목)"(근거 어디에도 없음). 답변의 위험 수치(화폐·%·기간·날짜)가
# 근거·질문·명시적 계산식 어디에서도 확인되지 않으면 경고를 결정적으로 부착한다(절대 규칙1의 서버측 강제).
# ⚠ 조작(fabrication) 차단기다 — 값이 근거에 '있으면' 통과하므로 오귀속은 P0-3(표손상 제외)·검색 보강의 몫.
NUM_GATE = os.environ.get("RAG_NUM_GATE", "1") == "1"

# P0-2 적용범위 앵커링(docs/22 §3): 인용 규정의 제1~2조(목적·적용범위)를 자동 동반 — 자격·수급 오추론 방지.
SCOPE_ANCHOR = os.environ.get("RAG_SCOPE_ANCHOR", "1") == "1"
SCOPE_ANCHOR_MAX_REGS = int(os.environ.get("RAG_SCOPE_ANCHOR_MAX_REGS", "2"))  # 상위 N개 규정만(ctx 예산)

TABLE_BROKEN_MARK = "⚠표손상"  # P0-3 오버레이가 블록 헤더에 붙이는 마커 — 게이트 허용집합에서 제외

_MULT = {"억": 100_000_000, "만": 10_000, "천": 1_000}
# 게이트 대상 단위(화폐·비율·기간). 회·명·건·개는 서수·개수라 오탐 많아 제외.
_AMT_RE = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(억|만|천)?\s*(원|퍼센트|%|일|박|개월|주|년|시간)")
_AMT_COMPOSITE_RE = re.compile(r"(\d+)\s*(억|만)\s*(\d+)\s*(만|천)\s*원")  # 3만5천원, 1억2천만원
_FRACTION_RE = re.compile(r"(\d+)\s*분의\s*(\d+)")  # 10분의 3 → 30%
_MD_RE = re.compile(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일")  # 1월 18일 → 날짜쌍
# 인용·식별 번호류(수치 검증 대상 아님) — 추출 전에 마스킹
_NUM_MASK_RE = re.compile(
    r"제\s*\d+\s*조(?:의\s*\d+)?|제\s*\d+\s*항|제\s*\d+\s*호|별\s*표\s*\d+|별\s*지\s*제?\s*\d+\s*호?"
    r"|\d{4}\s*[.년]\s*\d{1,2}\s*[.월]\s*\d{1,2}\s*\.?\s*일?"  # 연월일(개정 2023. 12. 29. 등)
    r"|(?:19|20)\d{2}\s*년?"                                     # 연도
    r"|[a-zA-Z]{2,4}_\d{3,5}[A-Za-z]?"                           # ERP 메뉴코드(gen_0020M)
    r"|☎\s*[\d-]+|\d{2,4}-\d{3,4}(?:-\d{4})?"                   # 내선·전화
)


def _num_values(text: str):
    """텍스트에서 (종류, 정규화값) 집합 추출. 종류: 원|%|일|박|개월|주|년|시간|날짜."""
    t = _NUM_MASK_RE.sub(" ", text or "")
    out = set()
    for m in _AMT_COMPOSITE_RE.finditer(t):  # 복합 화폐 먼저(부분 매칭 방지 위해 마스킹)
        v = int(m.group(1)) * _MULT[m.group(2)] + int(m.group(3)) * _MULT[m.group(4)]
        out.add(("원", float(v)))
    t = _AMT_COMPOSITE_RE.sub(" ", t)
    for m in _MD_RE.finditer(t):
        out.add(("날짜", (int(m.group(1)), int(m.group(2)))))
    t = _MD_RE.sub(" ", t)
    for m in _FRACTION_RE.finditer(t):
        den, num = int(m.group(1)), int(m.group(2))
        if den:
            out.add(("%", round(num / den * 100, 4)))
    for m in _AMT_RE.finditer(t):
        v = float(m.group(1).replace(",", "")) * _MULT.get(m.group(2) or "", 1)
        unit = m.group(3)
        if unit == "퍼센트":
            unit = "%"
        out.add((unit, round(v, 4)))
    return out


def _calc_line_results(text: str, allowed: set):
    """'A × B = C'/'A + B = C' 꼴 라인에서, 피연산자가 전부 검증되고 산술이 맞으면 결과 C를 허용집합에 추가.
    (SYSTEM 규칙 10 '계산식을 보여라'와 정합 — 식 없이 던진 합계는 경고 대상으로 남는다.)"""
    import math
    extra = set()
    for line in (text or "").splitlines():
        if "=" not in line or not any(op in line for op in ("×", "*", "x", "+")):
            continue
        vals = [v for v in _num_values(line) if v[0] != "날짜"]
        # 등장 순서 근사: 라인 재추출(집합은 순서 상실) — 값 리스트로 다시
        seq = []
        masked = _NUM_MASK_RE.sub(" ", line)
        for m in _AMT_RE.finditer(_MD_RE.sub(" ", masked)):
            v = float(m.group(1).replace(",", "")) * _MULT.get(m.group(2) or "", 1)
            seq.append(round(v, 4))
        if len(seq) < 3:
            continue
        *ops, result = seq
        # 피연산자 검증: 단위 무관 값 기준(일비 1만'원' × 3'일')
        allowed_vals = {v for _, v in allowed if not isinstance(v, tuple)}
        if not all(any(math.isclose(o, a, rel_tol=1e-9) for a in allowed_vals) for o in ops):
            continue
        prod = math.prod(ops)
        tot = sum(ops)
        if math.isclose(prod, result, rel_tol=1e-9) or math.isclose(tot, result, rel_tol=1e-9):
            extra.add(("원", result))
            extra.add(("일", result))  # 단위 불문 결과 허용(합산 일수 등)
            extra.update({(u, result) for u in ("%", "개월", "주", "년", "시간", "박")})
    return extra


def _verification_context(context: str) -> str:
    """허용집합에 쓸 컨텍스트 — 표손상(P0-3) 마커가 붙은 블록은 제외(깨진 표의 값은 오결합 위험)."""
    segs, skip = [], False
    for line in (context or "").splitlines():
        if line.startswith("[") and line.rstrip().endswith("]"):
            skip = TABLE_BROKEN_MARK in line
        if not skip:
            segs.append(line)
    return "\n".join(segs)


# lookahead 주의: 나열 쉼표("100,000, 광역시")는 허용하되 천단위 그룹 중간(",000")·소수점 진행은 차단
# lookahead 주의: 나열 쉼표("100,000, 광역시")는 허용하되 천단위 그룹 중간(",000")·소수점 진행은 차단
_BARE_NUM_RE = re.compile(r"(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?!\d)(?!,\d{3})(?!\.\d)")


# ── P0-3 표 무결성 격리 (docs/22 §2) ────────────────────────────────────
# HWP 변환에서 표 구조가 무너지면(셀 병합·행 붕괴) LLM이 항목-값을 오결합한다.
# 실측: 상조회규약 별표(경조금 전 항목이 한 셀에) → "부모상 300만원" 오답(실제 50만),
#       복무규정 별표1(결혼 "51"=5/1 병합, 사망 "5333"=5/3/3/3 병합).
# 손상 표가 근거로 쓰이면: 블록에 경고 라벨(TABLE_BROKEN_MARK) + 수치 인용 금지 지시 +
# P0-1 허용집합에서 그 블록의 수치 제외 + srcs '표깨짐' 마커(UI 배지) + 검수 큐 가산(01o).
TABLE_GUARD = os.environ.get("RAG_TABLE_GUARD", "1") == "1"

_MONEY_TOKEN_RE = re.compile(r"\d{1,3}(?:,\d{3})+\s*원?|\d+\s*(?:억|만|천)\s*원")
_PERSON_TOKENS = ("본인", "배우자", "자녀", "부모", "조부모", "외조부모", "형제")


def _table_broken(text: str):
    """표 붕괴 신호 감지 → 사유 문자열(정상이면 None). 경고 전용 휴리스틱 — 내용 자동 변경 없음.

    ⚠ 정밀도 우선(과탐 시 정답에 거짓 경고 → 신뢰 자해):
      - '5 1'처럼 공백 구분 병렬 값·라벨 짝이 살아있는 다중 금액 셀(여비 별표2 상한 3종)은 정상.
      - 잡는 것: ⓐ 카테고리째 붕괴된 거대 금액 셀(상조회 별표: 한 셀 금액 11개)
                ⓑ 무공백 병합 숫자(복무규정 별표1: '51'=5/1, '5333'=5/3/3/3).
    """
    for line in (text or "").splitlines():
        if "|" not in line:
            continue
        cells = [c.strip() for c in line.split("|")]
        for c in cells:
            if len(_MONEY_TOKEN_RE.findall(c)) >= 5:
                return "한 셀에 금액 다수(카테고리-금액 경계 붕괴)"
        # 병합 일수: 셀이 '무공백' 2~4자리 순수 숫자(0 없음 — '20' 같은 실수치 제외)이고 같은 행에 대상 2개 이상
        joined = "".join(cells).replace(" ", "").replace("･", "").replace("·", "")
        n_persons = sum(1 for t in _PERSON_TOKENS if t in joined)
        if n_persons >= 2 and any(re.fullmatch(r"[1-9]{2,4}", c) for c in cells):
            return "대상 다수 행의 값 병합(예: '51'=5/1)"
    # ⓒ 평탄화 표: 표가 | 없이 줄 단위로 무너진 형태 — 카테고리 라인 뭉치(≥4) 뒤에 '라벨 : 금액원'
    #    라인 뭉치(≥3). 실측: 경조사 가이드의 경조금 표(카테고리 8줄 + 금액 10줄 분리 → "부모상 300만" 오답 원천).
    lines = (text or "").splitlines()
    cat_run = 0
    for idx, raw in enumerate(lines):
        s = raw.strip()
        if s and len(s) <= 12 and re.fullmatch(r"[가-힣 ·ㆍ･]+", s):
            cat_run += 1
            continue
        if cat_run >= 4:
            window = lines[idx: idx + 10]
            if sum(1 for w in window if re.search(r":\s*[\d,]+\s*원", w)) >= 3:
                return "표 평탄화(카테고리 라인과 금액 라인이 분리 — 짝 소실)"
        cat_run = 0
    return None


def _overlay_table_integrity(srcs, blocks):
    """손상 표 블록에 경고 라벨·지시를 주입하고 srcs에 '표깨짐' 마커(blocks/srcs 정합 유지)."""
    for j in range(min(len(srcs), len(blocks))):
        head, _, body = blocks[j].partition("\n")
        if TABLE_BROKEN_MARK in head:  # ⚠ '|' 유무로 거르지 말 것 — 평탄화 표(ⓒ)는 | 없이 무너진다(실측)
            continue
        reason = _table_broken(body)
        if not reason:
            continue
        srcs[j]["표깨짐"] = True
        new_head = head[:-1] + f" {TABLE_BROKEN_MARK}]" if head.endswith("]") else f"{head} {TABLE_BROKEN_MARK}"
        blocks[j] = (f"{new_head}\n(⚠ 표 구조 손상: {reason} — 이 블록의 수치를 인용하지 말고, "
                     f"원문 표 확인을 안내할 것)\n{body}")


def _bare_table_values(text: str) -> set:
    """표 행(| 셀 |)의 '무단위 숫자'를 허용값으로 수확 — 표는 단위가 헤더에 있고 셀엔 값만 남는
    경우가 흔해(휴가 '5 1', 여비 '100,000'), 단위 필수 추출만으론 정상 인용을 과차단한다.
    표손상 블록은 _verification_context에서 이미 제외된 뒤에 호출된다."""
    out = set()
    for line in (text or "").splitlines():
        if "|" not in line:
            continue
        for m in _BARE_NUM_RE.finditer(_NUM_MASK_RE.sub(" ", line)):
            out.add(round(float(m.group(1).replace(",", "")), 4))
    return out


def numeric_guard_note(question: str, answer: str, context: str) -> str:
    """답변의 미검증 수치 경고문 반환(문제 없으면 ""). 게이트 오류는 ""로 강등 — 답변을 막지 않는다."""
    if not NUM_GATE or not (answer or "").strip():
        return ""
    try:
        vctx = _verification_context(context)
        allowed = _num_values(vctx) | _num_values(question)
        allowed |= {("무단위", v) for v in _bare_table_values(vctx)}  # 표 셀의 단위 생략 값
        allowed |= _calc_line_results(answer, allowed)
        import math
        allowed_vals = {v for _, v in allowed if not isinstance(v, tuple)}
        allowed_dates = {v for k, v in allowed if k == "날짜"}
        bad = []
        for kind, v in sorted(_num_values(answer), key=str):
            if kind == "날짜":
                ok = v in allowed_dates
            else:
                ok = any(math.isclose(v, a, rel_tol=1e-9) for a in allowed_vals if not isinstance(a, tuple))
            if not ok:
                if kind == "날짜":
                    bad.append(f"{v[0]}월 {v[1]}일")
                elif kind == "원":
                    bad.append(f"{int(v):,}원" if float(v).is_integer() else f"{v}원")
                else:
                    bad.append(f"{int(v) if float(v).is_integer() else v}{kind}")
        if not bad:
            return ""
        shown = " · ".join(list(dict.fromkeys(bad))[:5])
        return (f"⚠️ **수치 확인 필요**: 다음 값은 인용된 근거에서 확인되지 않았습니다 — {shown}. "
                "원문(조문·별표)에서 직접 확인하기 전에는 이 수치를 사용하지 마세요.")
    except Exception:  # noqa: BLE001 — 게이트 실패가 답변을 막지 않게
        return ""


CONDENSE_SYS = (
    "너는 검색어 재작성기다. [대화]를 참고해 [후속질문]을, 그 자체로 의미가 통하는 "
    "'독립 질문' 한 줄로 바꾼다.\n"
    "- 대화에서 생략된 주제·대상을 복원한다(예: '몇 퍼센트야?'는 직전 주제를 넣어 완성).\n"
    "- ⛔ 후속질문이 그 자체로 완성돼 보여도, 직전 대화의 핵심 대상·주제(특정 제도·문서·출장 종류 등)를 "
    "검색어에 반드시 포함한다. 예: 직전이 '국내출장 보고'면 후속 'ERP에서 어떻게 해?'는 "
    "'국내출장 출장복명서 ERP 작성·제출 방법'으로 재작성(임의로 '국외'로 바꾸지 않는다).\n"
    "- ⛔ 직전 '도우미' 답변의 문장을 복사·요약해 출력하지 않는다. 출력은 항상 [후속질문]을 다듬은 "
    "'질문'이어야 하며, [후속질문]에 있는 핵심 단어(대상·제도명)는 빼지 않고 유지한다.\n"
    "- 단, [후속질문]이 스스로 새로운 대상·제도를 지목하면(주제 전환) 이전 주제를 검색어에 섞지 않는다.\n"
    "- 새로운 사실·추측을 더하지 않는다. 질문 의도만 보존한다.\n"
    "- 출력은 재작성된 질문 한 줄만. 따옴표·설명·접두어 금지."
)

# ── P1.5 재작성 위생 가드 ──────────────────────────────────────────────
# 실측 결함(dev session 42, 2026-07-09): 재작성 LLM이 질문을 재작성하지 않고 직전 '답변'을
# 그대로 복사해 출력 → 사용자 질문 단어("인사 위원회, 징계 위원회")가 검색기에 미도달,
# 직전 오답("존재하지 않는다")이 검색어에 주입되는 자기강화 오류로 거짓 부정 답변 발생.
# 아래 가드는 그런 출력을 결정적으로 거르고 원 질문으로 강등한다(검색어 방어만 — 답변·가드레일 불변).
# 적대적 리뷰(3렌즈) 반영: 화이트리스트 정규화(전각 우회 차단)·NFC·casefold, 구어 의문어 stop 확충,
# 어간 2자 미만이면 조사 미제거(휴가→휴 파괴 방지), 복사 판정에 서술문/길이 조건(규정명 재사용 허용).
_RW_STRIP = re.compile(r"[^가-힣A-Za-z0-9]+")  # 한글·영숫자만 보존(블랙리스트 우회 원천 차단)

_RW_STOP = {
    # 요청·지시·설명 기능어
    "대해", "대한", "대해서", "관해", "관해서", "관련", "관련된", "내용", "정보", "설명", "질문",
    "알려줘", "알려주세요", "알려", "말해줘", "말해", "해줘", "해주세요", "부탁", "부탁해",
    # 의문사·지시어·정도 부사 (구어 후속질문 "그거 얼마 정도 드나요?"의 전 토큰이 여기서 걸러져야 함)
    "뭐야", "뭔가", "무엇", "어떻게", "어떤", "어디", "어디서", "언제", "언제야", "언제까지",
    "누구", "누가", "얼마", "얼마나", "얼마야", "얼마까지", "며칠", "몇일", "몇개", "몇가지", "몇번",
    "그건", "그거", "이거", "저거", "이건", "그날", "그때", "그곳", "여기", "여기서", "거기", "거기서",
    "바로", "정도", "조금", "많이", "자세히", "전부", "모두", "모든",
    # 담화·시제
    "그럼", "그러면", "그리고", "다시", "지금", "이제", "궁금", "궁금해", "확인",
    # 짧은 구어 동사(어미 패턴 _RW_PRED가 못 거르는 축약형)
    "있어", "있나", "있나요", "있는지", "인가요", "인가", "걸려", "걸리나", "되나", "드나",
    "받아", "받나", "주나", "쳐주나", "해야", "해도", "되요", "돼요",
}
# 서술·의문 어미로 끝나는 토큰(동사·형용사 활용형)은 명사가 아니므로 핵심어에서 제외
_RW_PRED = re.compile(
    r"(습니다|습니까|입니다|입니까|합니다|합니까|됩니다|됩니까"
    r"|나요|까요|가요|어요|아요|여요|세요|네요|지요"
    r"|는지|은지|을지|을까|는가|은가|던가|거든|잖아"
    r"|어야|아야|해야|하나|하니|하냐|되니|되냐|할까|될까)$"
)
# 서술문 종결 표지 — 재작성이 '질문'이 아니라 답변 문장 복사임을 나타내는 신호
_RW_DECL = re.compile(r"(습니다|입니다|합니다|됩니다|이다|한다|된다|있다|없다|았다|었다|는다|으며|지만|는데)$")
# 조사 제거(긴 것 우선). 형태소 분석기 없이 어미 수준 근사 — 핵심 명사 비교용이라 과제거보다 보수적으로.
_RW_JOSA = re.compile(
    r"(으로써|으로서|에서는|에게서|한테서|이라는|라는|이란|으로|에서|에게|한테|이랑|하고|처럼|만큼"
    r"|보다|부터|까지|이나|든지|라도|마저|조차|은|는|이|가|을|를|와|과|의|에|도|만|랑|나|로)$"
)


def _rw_norm(s: str) -> str:
    """NFC + 소문자 + 한글·영숫자만 — 복사 여부를 표기(마크다운·전각·대소문자·자모분해) 차이와 무관하게 비교."""
    return _RW_STRIP.sub("", unicodedata.normalize("NFC", s or "")).casefold()


def _rw_core_tokens(question: str) -> set:
    """질문의 핵심 단어(2자 이상, 조사 제거, 기능어·활용형 제외) — 재작성이 질문을 보존했는지 검사용."""
    out = set()
    q = unicodedata.normalize("NFC", question or "")
    for t in re.findall(r"[가-힣A-Za-z0-9]{2,}", q):
        if t in _RW_STOP or _RW_PRED.search(t):
            continue
        for _ in range(2):  # 겹조사(예: '위원회에서는') 대비 최대 2회 제거
            t2 = _RW_JOSA.sub("", t)
            if t2 == t or len(t2) < 2:  # 어간이 1자가 되면 조사 아님(휴가→휴, 회의→회 파괴 방지)
                break
            t = t2
        if len(t) >= 2 and t not in _RW_STOP:
            out.add(t.casefold())
    return out


def _rewrite_ok(rq: str, question: str, recent: list) -> bool:
    """재작성 결과 위생 검사. False면 원 질문으로 강등(안전 기본값 — 최악이 '맥락 복원 없음').
    ① 직전 답변 복사(부분 복사 포함) 차단 ② 원 질문 핵심어가 전부 사라진 무관 출력 차단 ③ 장문 차단.
    """
    if len(rq) > 200:  # 재작성은 '질문 한 줄' — 장문은 답변 복사·설명문 신호
        return False
    rqn = _rw_norm(rq)
    # ① 직전 '답변'과의 동일/포함 비교(assistant만 — 이전 사용자 질문과 같아지는 건 정상 재질문).
    #    hist_text가 답변을 500자로 절단해 넣으므로 복사본도 그 안에서 나온다(여유 있게 800자 비교).
    #    단, 답변은 규정명·소제목을 늘 인용하므로(절대규칙3) 짧은 '명사구' 재사용은 복사가 아니다 —
    #    30자 이상이거나 서술문으로 끝날 때만 복사로 판정(session 42 에코는 둘 다 해당).
    if len(rqn) >= 15:
        looks_decl = bool(_RW_DECL.search(rq.rstrip().rstrip(".!?…\"'」』)").rstrip()))
        if len(rqn) >= 30 or looks_decl:
            for h in recent:
                if isinstance(h, dict) and h.get("role") == "assistant" \
                        and rqn in _rw_norm((h.get("content") or "")[:800]):
                    return False
    # ② 핵심어 보존: 질문에 핵심 단어가 2개 이상인데 재작성에 하나도 없으면 드리프트.
    #    (1개 이하면 '그건 언제까지야?' 같은 지시대명사 후속질문 — 재작성이 단어를 바꾸는 게 정상이라 미적용)
    core = _rw_core_tokens(question)
    if len(core) >= 2 and not any(t in rqn for t in core):
        return False
    return True

_state: dict = {}
_lock = threading.Lock()


def backend():
    """임베딩/벡터DB/LLM 클라이언트를 첫 사용 시 한 번만 로드(스레드 안전 — 워밍업/요청 경쟁 방지)."""
    if "embed" not in _state:
        with _lock:
            if "embed" not in _state:
                import chromadb
                from openai import OpenAI
                from sentence_transformers import SentenceTransformer
                print(f"임베딩/벡터DB 로딩... ({EMBED_MODEL}, {CHROMA_DIR}/{COLLECTION})")
                _state["embed"] = SentenceTransformer(EMBED_MODEL)
                _state["col"] = chromadb.PersistentClient(path=CHROMA_DIR).get_collection(COLLECTION)
                _state["llm"] = OpenAI(base_url=VLLM_BASE, api_key="EMPTY")
    return _state["embed"], _state["col"], _state["llm"]


def reload():
    """재색인/롤백 후 무재시작 적용(v1.1 P2, docs/20): 벡터 컬렉션 핸들과 파생 인덱스 캐시를 재생성.
    임베딩·리랭커·LLM 클라이언트는 유지(재로딩 비용·GPU 점유 회피)."""
    with _lock:
        keep = {k: _state[k] for k in ("embed", "llm", "rerank") if k in _state}
        _state.clear()
        _state.update(keep)
        try:
            import chromadb
            # ⚠ chromadb는 경로별 시스템을 전역 캐시 — 디렉터리 스왑(롤백) 후에도 옛 핸들을 돌려준다.
            # 캐시를 비워 스왑된 디렉터리로 새로 연다(무재시작 롤백의 핵심).
            try:
                from chromadb.api.shared_system_client import SharedSystemClient
                SharedSystemClient._identifier_to_system.clear()
            except Exception:  # noqa: BLE001 — 버전에 따라 경로 상이(구버전 폴백)
                try:
                    chromadb.api.client.SharedSystemClient._identifier_to_system.clear()
                except Exception:
                    pass
            _state["col"] = chromadb.PersistentClient(path=CHROMA_DIR).get_collection(COLLECTION)
            print(f"rag_core.reload: 컬렉션 재오픈({_state['col'].count()} 청크) + 파생 인덱스 캐시 초기화")
        except Exception as e:  # noqa: BLE001 — 다음 backend() 호출에서 재시도
            print(f"⚠ reload 실패(다음 요청에서 재시도): {e}")


def condense_query(question: str, history=None, enabled: bool = None) -> str:
    """멀티턴 후속 질문을 직전 맥락을 복원한 '독립 검색어'로 재작성(검색 정확도↑).

    - history 없으면(첫 턴) 원 질문 그대로. enabled=None이면 환경변수 RAG_QUERY_REWRITE를 따름.
    - ⛔ 검색어만 바꾼다. 답변 생성은 원 질문/근거로 — 가드레일·사실성 불변.
    - 실패(LLM 오류 등) 시 원 질문으로 우아하게 강등.
    """
    use = REWRITE if enabled is None else enabled
    recent = [h for h in (history or [])
              if isinstance(h, dict) and h.get("role") in ("user", "assistant") and h.get("content")][-6:]
    if not use or not recent:
        return question
    try:
        _, _, llm = backend()
        hist_text = "\n".join(
            f"{'사용자' if h['role'] == 'user' else '도우미'}: {h['content'][:500]}" for h in recent)
        out = llm.chat.completions.create(
            model=LLM_MODEL, temperature=0.0, max_tokens=80,
            messages=[{"role": "system", "content": CONDENSE_SYS},
                      {"role": "user", "content": f"[대화]\n{hist_text}\n\n[후속질문]\n{question}\n\n[독립 질문]"}],
            extra_body=_gen_extra(),  # ⚠ qwen3.5 사고 off 필수 — 없으면 빈 재작성→멀티턴 맥락 유실
        )
        rq = (out.choices[0].message.content or "").strip().strip('"').strip()
        rq = rq.splitlines()[0].strip() if rq else ""
        if len(rq) < 2 or not _rewrite_ok(rq, question, recent):
            return question  # 비었거나·직전 답변 복사·질문 무관 출력이면 원 질문으로 강등
        return rq
    except Exception:  # noqa: BLE001 — 재작성 실패는 원 질문으로 강등(서비스 영향 없음)
        return question


def _ensure_bm25():
    """첫 하이브리드 사용 시 컬렉션 전체로 BM25 어휘 인덱스 구축(스레드 안전, 1회)."""
    if "bm25" not in _state:
        with _lock:
            if "bm25" not in _state:
                _, col, _ = backend()
                got = col.get(include=["documents", "metadatas"])  # 전체 청크
                ids, docs, metas = got["ids"], got["documents"], got["metadatas"]
                from bm25_index import BM25
                _state["allmap"] = {i: (d, m) for i, d, m in zip(ids, docs, metas)}
                _state["bm25"] = BM25(ids, docs)
    return _state["bm25"]


def _src(doc, m, dist):
    name = (m.get("규정명") or "").strip()
    article = (m.get("조") or "").strip()
    return {
        "규정명": name, "조": article,
        "분류": (m.get("분류") or "").strip(),
        "slug": (m.get("slug") or m.get("파일") or "").strip(),
        "type": (m.get("type") or "").strip(),   # regulation|guide|system|term → UI에서 ERP/서식 칩
        "tag": f"{name} {article}".strip(),
        "snippet": doc[:240].replace("\n", " ").strip(),
        "distance": round(float(dist), 4) if dist is not None else None,
    }


def _select_diverse(order, k, typeof, gate=None):
    """섹션 다양성 선택: 규정이 top-k를 독점하지 않게 ERP(시스템)·가이드에 좌석을 보장한다.
    - 후보 순위(order) 상위 gate 안에 해당 섹션이 있을 때만 승격(무관한 섹션 강제 노출 방지)
    - 규정은 최소 max(1,k-2)개 유지(법적 근거 보존). 좌석은 가장 낮은 순위 규정과 교체.
    원래 순위 순서는 보존(삽입으로 흐트러지지 않게 정렬)."""
    chosen = list(order[:k])
    if len(order) <= k:
        return chosen
    g = gate or DIVERSITY_GATE
    pool_gate = order[:max(k, g)]
    keep_reg = max(1, k - 2)
    for typ in ("system", "guide"):   # ERP 경로 우선, 그다음 가이드
        if any(typeof(i) == typ for i in chosen):
            continue
        avail = [i for i in pool_gate if typeof(i) == typ and i not in chosen]
        if not avail:
            continue
        # 교체 대상: chosen에서 가장 낮은 순위의 규정(단, 규정 최소 수 보존)
        n_reg = sum(1 for i in chosen if typeof(i) == "regulation")
        victim = next((i for i in reversed(chosen)
                       if typeof(i) == "regulation" and n_reg > keep_reg), None)
        if victim is None:  # 규정 더 못 빼면 reserve 아닌(term 등) 가장 낮은 순위 교체
            victim = next((i for i in reversed(chosen)
                           if typeof(i) not in ("system", "guide", "regulation")), None)
        if victim is None:
            continue
        chosen[chosen.index(victim)] = avail[0]
    chosen.sort(key=order.index)   # 원래 순위 순서 유지
    return chosen


def _reranker():
    """cross-encoder 리랭커를 첫 사용 시 1회 로드(스레드 안전)."""
    if "rerank" not in _state:
        with _lock:
            if "rerank" not in _state:
                from sentence_transformers import CrossEncoder
                print(f"리랭커 로딩... ({RERANK_MODEL}, {RERANK_DEVICE})")
                _state["rerank"] = CrossEncoder(RERANK_MODEL, max_length=512, device=RERANK_DEVICE)
    return _state["rerank"]


def _jo_key(s: str) -> str:
    """'제16조 ②' → '제16조', '제4조의2 ①' → '제4조의2'(비교용 정규화).
    ⛔ 가지번호(의N) 보존 — 제16조와 제16조의2는 서로 다른 조라 별표 오첨부·라벨 충돌 방지."""
    import re as _re
    m = _re.match(r"(제\d+조(?:의\d+)?)", (s or "").strip())
    return m.group(1) if m else (s or "").strip()


def _ensure_byeol_index():
    """별표 청크의 refs(인용 조문)를 역인덱스: (규정명, 제N조) → [별표 청크 id]. 1회 구축·캐시.
    그래프 1홉 확장(별표 자동첨부)의 골격 — 이미 색인된 refs 엣지만 사용(신규 인프라·재임베딩 불필요)."""
    if "byeol_idx" not in _state:
        with _lock:
            if "byeol_idx" not in _state:
                _, col, _ = backend()
                got = col.get(include=["metadatas", "documents"])
                idx, bmap = {}, {}
                for i, m, d in zip(got["ids"], got["metadatas"], got["documents"]):
                    if (m.get("별표") or "") != "Y" or not (m.get("refs") or "").strip():
                        continue
                    name = (m.get("규정명") or "").strip()
                    bmap[i] = (d, m)
                    for a in (m.get("refs") or "").split(","):
                        a = _jo_key(a)
                        if a:
                            idx.setdefault((name, a), []).append(i)
                _state["byeol_idx"], _state["byeol_map"] = idx, bmap
    return _state["byeol_idx"], _state["byeol_map"]


def _ensure_article_index():
    """(규정명, 제N조) → 조문 청크 id 정방향 인덱스. 규정↔규정 1홉 확장(reg_refs 대상 조회)용. 1회 캐시."""
    if "art_idx" not in _state:
        with _lock:
            if "art_idx" not in _state:
                _, col, _ = backend()
                got = col.get(include=["metadatas", "documents"])
                idx, amap = {}, {}
                for i, m, d in zip(got["ids"], got["metadatas"], got["documents"]):
                    if (m.get("type") or "") != "regulation":
                        continue
                    jo = _jo_key(m.get("조") or "")
                    if not jo.startswith("제"):
                        continue
                    amap[i] = (d, m)
                    idx.setdefault(((m.get("규정명") or "").strip(), jo), i)  # 첫 청크만(대표)
                _state["art_idx"], _state["art_map"] = idx, amap
    return _state["art_idx"], _state["art_map"]


def _load_index(name: str, default):
    """tools/index/<name> 를 1회 로드·캐시. 없으면 default(오버레이/확장 우아하게 비활성)."""
    key = f"idx::{name}"
    if key not in _state:
        with _lock:
            if key not in _state:
                data = default
                try:
                    with open(os.path.join(INDEX_DIR, name), encoding="utf-8") as f:
                        data = json.load(f)
                except Exception as e:  # noqa: BLE001 — 인덱스 부재 시 조용히 비활성
                    print(f"⚠ {name} 로드 실패(해당 기능 off): {e}")
                _state[key] = data
    return _state[key]


def _ensure_article_status():
    """01k article_status.json → {규정명#제N조: {status,삭제일,최근개정일,신설,개정횟수}}."""
    return _load_index("article_status.json", {"articles": {}}).get("articles", {})


def _ensure_clause_xref():
    """01i clause_xref.json → {edges:{src:[{target,rel,scope}]}, reverse:{target:[src]}}."""
    return _load_index("clause_xref.json", {"edges": {}, "reverse": {}})


def _overlay_article_status(srcs, blocks):
    """회수 결과에 조문 효력 메타를 얹고 삭제 조문을 top-k 뒤로 강등(blocks/srcs 정합 유지).
    삭제 조문은 컨텍스트 블록 머리에 '삭제됨' 경고를 붙여 LLM이 유효 근거로 오인하지 않게 한다."""
    st = _ensure_article_status()
    if not st:
        return
    keep, demote = [], []
    for idx, s in enumerate(srcs):
        if (s.get("type") or "") != "regulation":
            keep.append(idx); continue
        rec = st.get(f"{(s.get('규정명') or '').strip()}#{_jo_key(s.get('조') or '')}")
        if not rec:
            keep.append(idx); continue
        if rec.get("최근개정일"):
            s["최근개정"] = rec["최근개정일"]
        if rec.get("신설"):
            s["신설"] = True
        if rec.get("status") == "삭제":
            s["효력"] = "삭제"; s["삭제일"] = rec.get("삭제일", "")
            tag = f" · {rec['삭제일']}" if rec.get("삭제일") else ""
            blocks[idx] = f"⚠ [이 조문은 삭제되어 효력이 없습니다{tag}]\n{blocks[idx]}"
            demote.append(idx)
        else:
            s["효력"] = "유효"; keep.append(idx)
    if demote:                                   # 삭제 조문을 뒤로(순서 재배치)
        order = keep + demote
        srcs[:] = [srcs[i] for i in order]
        blocks[:] = [blocks[i] for i in order]


def _ensure_action_index():
    """행위 흐름 인덱스: from 패턴 → [(to 청크 id, 관계)]. 시스템 청크 라벨(조)로 1회 구축·캐시.
    to 청크가 여럿이면 라벨이 가장 짧은 것(대표 목록 화면) 1개를 대표로 쓴다."""
    if "action_idx" not in _state:
        with _lock:
            if "action_idx" not in _state:
                _, col, _ = backend()
                got = col.get(include=["metadatas", "documents"])
                sys_chunks = []  # (id, 라벨, doc, meta)
                for i, m, d in zip(got["ids"], got["metadatas"], got["documents"]):
                    if (m.get("type") or "") != "system":
                        continue
                    label = (m.get("조") or "").strip()
                    if label:
                        sys_chunks.append((i, label, d, m))
                idx, amap = {}, {}
                for frm, to, rel in ACTION_FLOWS:
                    cands = [(i, label, d, m) for i, label, d, m in sys_chunks
                             if to in label]
                    if not cands:
                        continue  # to 청크가 코퍼스에 없으면 페어 비활성(안전)
                    cands.sort(key=lambda x: len(x[1]))   # 라벨 최단 = 대표 목록 화면
                    cid, _, d, m = cands[0]
                    amap[cid] = (d, m)
                    idx.setdefault(frm, []).append((cid, rel))
                _state["action_idx"], _state["action_map"] = idx, amap
    return _state["action_idx"], _state["action_map"]


def _ensure_gian_hub():
    """전자결재 '기안' 허브 대표 청크(기안신규 사용흐름) 1회 캐시. 신청/결재 화면 회수 시 자동첨부용.
    모든 [결재상신]이 이 공통 레이어를 거치므로, 신청 절차 답변에 결재 흐름을 붙인다."""
    if "gian_hub" not in _state:
        with _lock:
            if "gian_hub" not in _state:
                _, col, _ = backend()
                got = col.get(include=["metadatas", "documents"])
                best = None
                for i, m, d in zip(got["ids"], got["metadatas"], got["documents"]):
                    if (m.get("type") or "") != "system":
                        continue
                    name = m.get("규정명") or ""
                    label = m.get("조") or ""
                    if "전자결재 기안" in name and "기안신규" in label:
                        best = (d, m); break
                    if "전자결재 기안" in name and "결재상신" in name and best is None:
                        best = (d, m)   # 폴백: 결재상신 공통 노트 첫 청크
                _state["gian_hub"] = best
    return _state["gian_hub"]


_GIAN_TRIGGER = re.compile(r"신청|상신|결재올림|보고|정산")   # 이 라벨의 시스템 화면이 회수되면 기안 첨부


def retrieve(query: str, k: int = TOPK, hybrid: bool = None, rerank: bool = None,
             section_diversity: bool = None):
    """질의 → 관련 조문 top-k 회수. (근거 컨텍스트 문자열, 구조화 출처 리스트) 반환.

    hybrid/rerank=None이면 환경변수(RAG_HYBRID/RAG_RERANK)를 따른다.
      - hybrid: 밀집(KURE-v1)+어휘(BM25)를 RRF로 융합(순위 기반).
      - rerank: 후보 top-pool을 cross-encoder로 (질의,청크) 재점수해 재정렬 → top-k.
      - section_diversity: 규정 독점 방지(ERP/가이드 좌석 보장, RAG_SECTION_DIVERSITY).
    둘 다면 융합 결과를 후보로 리랭크한다.
    """
    embed, col, _ = backend()
    use_hybrid = HYBRID if hybrid is None else hybrid
    use_rerank = RERANK if rerank is None else rerank
    use_div = SECTION_DIVERSITY if section_diversity is None else section_diversity
    pool = k
    if use_hybrid:
        pool = max(pool, FUSION_POOL)
    if use_rerank:
        pool = max(pool, RERANK_POOL)
    if use_div:  # 승격 후보가 top-k 밖에도 있으려면 pool을 gate 이상으로 확장(밀집 단독에서도 작동)
        pool = max(pool, FUSION_POOL, DIVERSITY_GATE)

    qv = embed.encode([query], normalize_embeddings=True)[0].tolist()
    r = col.query(query_embeddings=[qv], n_results=pool,
                  include=["documents", "metadatas", "distances"])
    dense_ids = r["ids"][0]
    dense = {i: (doc, m, dist) for i, doc, m, dist
             in zip(dense_ids, r["documents"][0], r["metadatas"][0], r["distances"][0])}

    def getdoc(i):
        if i in dense:
            return dense[i]
        d, m = _state["allmap"][i]
        return d, m, None

    if use_hybrid:
        bm = _ensure_bm25()
        from bm25_index import rrf
        lex_ids = [i for i, _ in bm.search(query, n=pool)]
        cand = [i for i, _ in rrf([dense_ids, lex_ids], top=pool, weights=RRF_WEIGHTS)]
    else:
        cand = dense_ids[:pool]

    rscore = {}
    if use_rerank and cand:
        try:
            scores = _reranker().predict([(query, getdoc(i)[0][:2000]) for i in cand])
            ranked = sorted(zip(cand, (float(s) for s in scores)), key=lambda x: -x[1])
            order = [i for i, _ in ranked]
            rscore = {i: s for i, s in ranked}
        except Exception as e:  # noqa: BLE001 — 리랭커 실패(예: GPU OOM)는 밀집 순서로 우아하게 강등
            print(f"⚠ 리랭커 실패 → 밀집 순서로 강등: {e}")
            order = list(cand)
    else:
        order = list(cand)

    if use_div and len(order) > k:
        chosen = _select_diverse(order, k, lambda i: (getdoc(i)[1] or {}).get("type", ""))
    else:
        chosen = order[:k]

    blocks, srcs = [], []
    for i in chosen:
        doc, m, dist = getdoc(i)
        s = _src(doc, m, dist)
        if i in rscore:
            s["rerank"] = round(rscore[i], 4)
        srcs.append(s)
        # 시스템 노트는 실제 시스템명으로 라벨(규정명 '<시스템> · <모듈>'의 접두) — ERP/전자결재/대외업무/웹디스크 등
        sys_label = ""
        if s.get("type") == "system":
            sysname = ((s.get("규정명") or "").split(" · ")[0]).strip()
            sys_label = f" ({sysname})" if sysname else " (시스템)"
        blocks.append(f"[{s['tag']}{sys_label}]\n{doc}")

    # 조문 효력 오버레이(Track A): 삭제 조문을 근거에서 강등 + 효력/최근개정 배지(절대 규칙1 방어, 재임베딩 불필요).
    if ARTICLE_STATUS and srcs:
        try:
            _overlay_article_status(srcs, blocks)
        except Exception as e:  # noqa: BLE001 — 오버레이 실패는 기본 회수로 우아하게 강등
            print(f"⚠ 조문 효력 오버레이 실패(무시): {e}")

    # 그래프 1홉 확장: 회수된 조문을 인용하는 별표(표)를 자동 동반(여비 별표2 등 금액표 회수 누락 보완).
    if GRAPH_EXPAND and chosen:
        try:
            idx, bmap = _ensure_byeol_index()
            have = set(chosen)
            added = 0
            for i in list(chosen):
                if added >= GRAPH_EXPAND_MAX:
                    break
                _, m, _ = getdoc(i)
                key = ((m.get("규정명") or "").strip(), _jo_key(m.get("조") or ""))
                if not key[1].startswith("제"):
                    continue
                for bid in idx.get(key, []):
                    if bid in have or added >= GRAPH_EXPAND_MAX:
                        continue
                    have.add(bid); added += 1
                    d2, m2 = bmap[bid]
                    s2 = _src(d2, m2, None)
                    s2["graph_expand"] = True  # UI/평가에서 '자동첨부 별표' 식별
                    srcs.append(s2)
                    blocks.append(f"[{s2['tag']} · 관련 별표(자동첨부)]\n{d2}")
        except Exception as e:  # noqa: BLE001 — 확장 실패는 기본 회수로 우아하게 강등
            print(f"⚠ 그래프 1홉 확장 실패(무시): {e}")

    # 규정↔규정 1홉 확장(관리자 플래그 graph_expand_regs로 토글): 회수 조문의 reg_refs를 첨부.
    if _graph_expand_regs_on() and chosen:
        try:
            aidx, amap = _ensure_article_index()
            have = set(chosen)
            added = 0
            for i in list(chosen):
                if added >= GRAPH_EXPAND_REGS_MAX:
                    break
                _, m, _ = getdoc(i)
                refs = [r.strip() for r in (m.get("reg_refs") or "").split(",")]
                if CLAUSE_XREF:   # clause_xref cross 엣지로 보강(청크 reg_refs보다 완전한 준용/인용)
                    ck = f"{(m.get('규정명') or '').strip()}#{_jo_key(m.get('조') or '')}"
                    for e in _ensure_clause_xref().get("edges", {}).get(ck, []):
                        if e.get("scope") == "cross" and e.get("target"):
                            refs.append(e["target"])
                for ref in refs:
                    if "#" not in ref:
                        continue
                    rname, rjo = ref.split("#", 1)
                    aid = aidx.get((rname.strip(), _jo_key(rjo)))
                    if not aid or aid in have or added >= GRAPH_EXPAND_REGS_MAX:
                        continue
                    have.add(aid); added += 1
                    d2, m2 = amap[aid]
                    s2 = _src(d2, m2, None)
                    s2["graph_expand_reg"] = True  # '준용/참조 규정 자동첨부' 식별
                    srcs.append(s2)
                    blocks.append(f"[{s2['tag']} · 준용/참조 규정(자동첨부)]\n{d2}")
        except Exception as e:  # noqa: BLE001
            print(f"⚠ 규정↔규정 확장 실패(무시): {e}")

    # 행위 흐름 1홉 확장(플래그 graph_expand_actions): 신청 화면 회수 시 의무적 후속 단계(정산·결과보고) 첨부.
    if _graph_expand_actions_on() and chosen:
        try:
            aidx, amap = _ensure_action_index()
            have = {s.get("tag") for s in srcs}
            added = 0
            for i in list(chosen):
                if added >= GRAPH_EXPAND_ACTIONS_MAX:
                    break
                _, m, _ = getdoc(i)
                label = (m.get("조") or "").strip()
                if (m.get("type") or "") != "system" or not label:
                    continue
                for frm, targets in aidx.items():
                    if frm not in label:
                        continue
                    for cid, rel in targets:
                        d2, m2 = amap[cid]
                        s2 = _src(d2, m2, None)
                        if s2["tag"] in have or (rel in label) or added >= GRAPH_EXPAND_ACTIONS_MAX:
                            continue  # 이미 회수됨 / 자기 자신(정산 화면에 정산 첨부) 방지
                        have.add(s2["tag"]); added += 1
                        s2["graph_expand_action"] = True   # '후속 단계 자동첨부' 식별(UI/평가)
                        s2["action_rel"] = rel
                        srcs.append(s2)
                        blocks.append(f"[{s2['tag']} · 후속 단계: {rel}(자동첨부)]\n{d2}")
        except Exception as e:  # noqa: BLE001 — 확장 실패는 기본 회수로 우아하게 강등
            print(f"⚠ 행위 흐름 확장 실패(무시): {e}")

        # 기안 허브 자동첨부: 신청/보고/정산 화면이 회수됐고 기안 청크가 아직 없으면 결재상신 흐름을 1개 첨부.
        try:
            already_gian = any("전자결재 기안" in (s.get("규정명") or "") for s in srcs)
            trig = any((s.get("type") == "system" and _GIAN_TRIGGER.search(s.get("조") or "")) for s in srcs)
            if not already_gian and (trig or _GIAN_TRIGGER.search(query) or "결재" in query or "기안" in query):
                hub = _ensure_gian_hub()
                if hub:
                    d2, m2 = hub
                    s2 = _src(d2, m2, None)
                    if not any(s.get("tag") == s2["tag"] for s in srcs):
                        s2["graph_expand_gian"] = True
                        srcs.append(s2)
                        blocks.append(f"[{s2['tag']} · 결재상신(기안, 자동첨부)]\n{d2}")
        except Exception as e:  # noqa: BLE001
            print(f"⚠ 기안 허브 첨부 실패(무시): {e}")

    # 적용범위 앵커링(P0-2, docs/22): 인용된 규정의 제1~2조(목적·적용범위)를 자동 동반 첨부.
    # 실측 결함: 퇴직금규정 제3·4·7조(계산식)만 회수되자 LLM이 수급 '자격'을 계산식에서 역추론해
    # "1년 미만도 지급" 오답(제2조: 1년 이상 근속자 적용). 자격·적용 판단의 근거를 항상 공급한다.
    if SCOPE_ANCHOR:
        try:
            art_idx, art_map = _ensure_article_index()
            have_tags = {s.get("tag") for s in srcs}
            seen_regs, added = [], 0
            for s in srcs:
                if s.get("type") != "regulation":
                    continue
                reg = (s.get("규정명") or "").strip()
                if not reg or reg in seen_regs:
                    continue
                seen_regs.append(reg)
                if len(seen_regs) > SCOPE_ANCHOR_MAX_REGS:
                    break
                for jo in ("제1조", "제2조"):
                    aid = art_idx.get((reg, jo))
                    if not aid:
                        continue
                    d2, m2 = art_map[aid]
                    s2 = _src(d2, m2, None)
                    if s2["tag"] in have_tags:
                        continue
                    have_tags.add(s2["tag"])
                    s2["scope_anchor"] = True  # UI 🔗 자동첨부 배지 + 평가 식별
                    srcs.append(s2)
                    blocks.append(f"[{s2['tag']} · 목적/적용범위(자동첨부)]\n{d2}")
                    added += 1
        except Exception as e:  # noqa: BLE001 — 앵커 실패는 기본 회수로 우아하게 강등
            print(f"⚠ 적용범위 앵커 실패(무시): {e}")

    # 표 무결성 격리(P0-3, docs/22): 손상 표 블록에 경고 라벨 — 수치 게이트(P0-1)와 UI 배지가 소비.
    if TABLE_GUARD:
        try:
            _overlay_table_integrity(srcs, blocks)
        except Exception as e:  # noqa: BLE001 — 격리 실패는 기본 회수로 우아하게 강등
            print(f"⚠ 표 무결성 오버레이 실패(무시): {e}")

    # ctx 8K 초과(→Ollama 400) 방지: 순위순 예산 상한 + 근거 목록 동기화(정직성) —
    # 컨텍스트에서 빠진 블록의 출처는 목록에서도 제외, 절단된 마지막 블록은 '절단' 마커.
    blocks, truncated_last = _cap_blocks(blocks)
    if len(srcs) > len(blocks):
        srcs[:] = srcs[: len(blocks)]
    if truncated_last and srcs:
        srcs[-1]["절단"] = True  # UI '일부 반영' 배지 — 뒷부분은 LLM에 전달되지 않음
    return "\n\n---\n\n".join(blocks), srcs


def _build_messages(question: str, context: str, history=None):
    """system + (선택)이전 대화 + (이번 질문+근거). 멀티턴은 history를 LLM에 재생(replay).

    history: [{"role": "user"|"assistant", "content": str}, ...] (원문 질문/답변, 근거 미포함).
    """
    # 사고 off: qwen3.5는 요청 파라미터(think:false, _gen_extra), qwen3는 시스템 '/no_think' 지시
    sys_content = SYSTEM + ("\n/no_think" if (NO_THINK and not QWEN35) else "")
    msgs = [{"role": "system", "content": sys_content}]
    for h in history or []:
        role = h.get("role")
        content = h.get("content")
        if role in ("user", "assistant") and content:
            msgs.append({"role": role, "content": content})
    msgs.append({"role": "user", "content": f"[질문]\n{question}\n\n[근거]\n{context}"})
    return msgs


def _gen_extra():
    """Ollama 확장 파라미터(extra_body). keep_alive 상주 + (qwen3.5) 사고 off.

    ⚠ 실측(v0.31.1): OpenAI 호환(/v1) 경로에서 'think:false'는 **무시**되고(사고가 reasoning
    필드로 계속 돎 → content 빈 답), 'reasoning_effort:none'이 유효하다. 네이티브(/api/chat)는
    반대로 think:false가 유효 — 두 키를 모두 보내 어느 경로/버전에서도 사고가 꺼지게 한다.
    """
    extra = {"keep_alive": _keep_alive()}
    if NO_THINK and QWEN35:
        extra["reasoning_effort"] = "none"  # OpenAI 호환(/v1) 경로용 — 실제 효력(실측)
        extra["think"] = False              # 네이티브 경로/타 버전 대비(무해)
    return extra


def answer(question: str, context: str, history=None, temperature: float = 0.1) -> str:
    """근거 주입 + (선택)이전 대화 맥락으로 답변 생성(비스트리밍)."""
    _, _, llm = backend()
    out = llm.chat.completions.create(
        model=LLM_MODEL, temperature=temperature,
        messages=_build_messages(question, context, history),
        extra_body=_gen_extra(),  # 매 요청마다 상주 재확인 + 사고 off
    )
    return _ensure_disclaimer(
        _ensure_enum_note(question, _postprocess(out.choices[0].message.content or "")))


# 스트리밍 홀드백: 공백결함 정규화('제 11 조'→'제11조')는 패턴이 완성돼야 합칠 수 있으므로,
# 꼬리 몇 글자는 다음 청크가 올 때까지 보류했다가 내보낸다(경계에서 미완성 패턴 유출 방지).
_STREAM_HOLDBACK = 12


def answer_stream(question: str, context: str, history=None, temperature: float = 0.1):
    """answer()의 스트리밍 버전 — LLM 토큰을 순차적으로 yield(제너레이터)."""
    _, _, llm = backend()
    stream = llm.chat.completions.create(
        model=LLM_MODEL, temperature=temperature,
        messages=_build_messages(question, context, history), stream=True,
        extra_body=_gen_extra(),  # 매 요청마다 상주 재확인 + 사고 off
    )
    seen = ""       # 원문(사고블록 포함) 누적
    emitted = 0     # 후처리(사고제거+공백정규화) 후 이미 내보낸 글자 수
    hold = _STREAM_HOLDBACK if QWEN35 else 0
    for chunk in stream:
        try:
            delta = chunk.choices[0].delta.content
        except (AttributeError, IndexError):
            delta = None
        if delta:
            seen += delta
            cleaned = _postprocess(seen)     # 사고블록 제거 + 공백결함 정규화
            safe = len(cleaned) - hold       # 꼬리 hold 글자는 패턴 완성 대기(홀드백)
            if safe > emitted:               # 새로 확정된 본문만 흘려보냄
                yield cleaned[emitted:safe]
                emitted = safe
    final = _postprocess(seen)
    if len(final) > emitted:                 # 홀드백 잔여분 방출
        yield final[emitted:]
    # 집계 정직성(P2.10): 개수·전수 질문인데 '전체 아님' 한정이 없으면 결정적으로 덧붙임
    if final.strip() and _ENUM_Q_RE.search(question or "") and not any(k in final for k in _ENUM_KEYS):
        yield "\n\n" + _ENUM_NOTE
    # 가드레일: 스트림 본문에 면책 문구가 없으면 마지막에 덧붙여 보장(중복 방지 감지 포함)
    if _DISC_KEY not in final:
        yield ("\n\n" + DISCLAIMER) if final.strip() else DISCLAIMER


def keepalive_once():
    """LLM을 메모리에 상주시키는 초경량 호출(1토큰). keep_alive로 언로드 타이머를 재설정."""
    _, _, llm = backend()
    llm.chat.completions.create(
        model=LLM_MODEL, temperature=0, max_tokens=1,
        messages=[{"role": "user", "content": "ping"}],
        extra_body=_gen_extra(),
    )


def warmup():
    """서버 기동 시 백그라운드로 호출 → 임베딩/벡터DB 로드 + LLM 상주(첫 질문 콜드스타트 제거)."""
    embed, _, _ = backend()
    embed.encode(["워밍업"], normalize_embeddings=True)  # 임베딩 연산 경로까지 예열
    if RERANK:  # 리랭커 켜져 있으면 미리 로드(첫 질의 콜드스타트 제거)
        try:
            _reranker().predict([("워밍업", "워밍업 청크")])
        except Exception as e:  # noqa: BLE001
            print(f"⚠ 리랭커 워밍업 실패(런타임에 밀집 강등): {e}")
    keepalive_once()
