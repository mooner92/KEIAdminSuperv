# CLAUDE.md — KEI 행정 가이드 / 행정 LLM

> 이 파일은 Claude Code가 매 세션 자동으로 읽는 프로젝트 컨텍스트다. 작업 전 반드시 숙지한다.
> 상세 작업 순서는 `WORKPLAN.md` 참조. 설계 문서는 `docs/` 참조.

## 프로젝트 한 줄 정의
KEI(한국환경연구원) 행정 초보(신입·전입자)가 "이 업무 어떻게 처리하지?"를 빠르게 해결하도록,
사내 규정을 근거로 답하는 **온프레미스 지식베이스 + 로컬 LLM**을 만든다.

## 아키텍처: 하나의 볼트, 두 개의 화면
- 단일 진실원천(Source of Truth) = 이 레포의 마크다운 볼트 `KEI-행정가이드/`
- **[뇌]** Next.js 14 정적 사이트(`web/`, KRDS 참고 자체 토큰 디자인 — TDS는 라이선스 무명시로 제거, docs/37) — 노드/링크 그래프 + 전문검색 + 문서 (사람이 탐색). 이전 Quartz를 대체.
- **[LLM]** Open WebUI + vLLM — 질문에 `[규정명 제N조]` 출처 달아 답변 (행정 초보가 사용)
- 모델·임베딩은 전부 사내 GPU(Quadro RTX 6000 24GB×2, 총 48GB)에서 구동. 두 화면 모두 Cloudflare Zero Trust 뒤(사내 전용).
- 핵심: 그래프와 채팅은 *같은 마크다운을 먹는 두 화면*이다. 채팅은 그림이 아니라 텍스트+임베딩 검색으로 답한다.

## ⛔ 절대 규칙 (어기면 프로젝트가 위험해진다)
1. **규정 내용을 지어내지 말 것.** 금액·한도·기한·조건을 추측해 쓰지 않는다.
   원문이 없으면 `「TODO: 원문 확인」` placeholder를 두고 사람에게 알린다.
   (행정·회계·감사 영역에서 틀린 답은 실제 사고가 된다.)
2. **원문층(`20_규정원문/`)은 의역 금지.** HWP 변환 문구를 보존하고, 표/별표 깨짐과 오타만 교정한다.
   조문(제N조) 구조를 유지한다.
3. **모든 가이드/답변에 출처.** 가이드는 `[[규정명#제N조]]`로 링크, RAG 답변은 끝에 `[규정명 제N조]` 표기 + 면책 문구 유지.
4. RAG 시스템 프롬프트의 가드레일("근거에 없으면 '규정에서 확인되지 않습니다'")을 약화시키지 않는다.
5. 내부 규정이다. 어떤 화면도 인터넷에 공개하지 않는다.

## 레포 구조
- `KEI-행정가이드/` — Obsidian 볼트(= RAG 코퍼스). 2-layer 구조:
  - `10_업무가이드/` — 업무 단위 쉬운 설명 (가치층, 사람이 작성, 항상 원문 링크)
  - `20_규정원문/` — HWP 변환 원문 (진실원천, 의역 금지, KEI 규정번호 체계 1000~7999)
  - `30_용어집/` — 개념 1개 = 노트 1개
  - `40_시스템/` — ERP 메뉴·기능(별도 섹션 '시스템', 보라). `KEI_ERP_entire_features.md`를 모듈별 노트로
  - `50_대외업무/` — 대외요구자료 반복업무(국정감사·예산·결산…) 3개년 관측 통계·업무별 가이드(docs/39). ⛔규정 아님 — RAG 근거에 '(운영 통계)' 라벨·의무 단정 금지
  - `90_관리/` — 템플릿, 개정이력, Dataview 인덱스
- `web/` — [뇌] 화면(Next.js 14, KRDS 참고 자체 토큰 디자인·Pretendard GOV self-host). 정적 export(`out/`) → `server.js`(⛔로그인 게이트 내장, docs/44 — nginx 단독 대체 금지). 볼트를 빌드타임 read-only 소비(`web/lib/vault.ts`). 이전 Quartz를 대체.
- `tools/` — 파이프라인: 01 변환 → 01b 상호참조 위키링크(그래프 엣지) → 02 청킹·임베딩 → 03 질의 / 04 OpenAI호환 RAG API
- `deploy/` — Ubuntu HWP 셋업 스크립트, docker-compose, 배포 README (Quartz 배포는 [뇌] Next.js로 대체됨)
- `docs/` — 설계·계획 문서(아키텍처, 콘텐츠 모델, 파이프라인, RAG, 배포, 보안, 로드맵, ADR)

## 기술 스택 & 규약
- Python: 가상환경 사용(`tools/.venv`), 의존성 `tools/requirements.txt`
- 변환: `hwp-hwpx-parser`(.hwp/.hwpx 모두). 표/별표 깨질 땐 LibreOffice+H2Orestart→PDF→VLM(Qwen2.5-VL)
- 연구행정 가이드(`research_rule_files/`, 내부 전용·커밋 금지)는 PDF·PPTX 혼합 → `tools/01c_guides_to_md.py`가 PyMuPDF(PDF)·python-pptx(PPTX)로 변환해 `10_업무가이드/`(type:guide)에 적재. 분류는 제목 키워드로 규정집과 같은 버킷. 스캔 이미지 PDF는 `image-pdf`로 표시 + 「TODO: 원문 확인」 플레이스홀더. 슬러그는 볼트 전체와 충돌 안 나게(규정 원문 미덮어씀).
- 청킹: 규정원문 **제N조 단위**, 가이드/ERP는 **헤딩(####/##) 단위**(02의 `chunk_guide`) (고정 길이 청킹 금지). **별표/별지는 1급 청크로 분리**(조="별표 N", `refs`=인용 조문; 토글 `CHUNK_BYEOLPYO`) — P1.3. **긴 청크 하위청킹**(P2.3): `max_seq_len`(2048) 초과 청크는 임베딩에서 뒷부분이 잘리므로 항(①②…)→호→문단→줄 순으로 분할(`subsplit_long_chunks`, 토글 `CHUNK_SUBSPLIT`). **조 라벨·메타 유지**(출처·앵커·평가 불변), 하위 인덱스만 `부분`(2/3) 메타. 별표/별지(표)는 분할 안 함(VLM 트랙). **옛값 취소선 제외**(docs/28): `~~옛값~~ 현행값<!--outdated 날짜: [[근거#조]]-->` 규약의 취소선·주석은 `strip_outdated`가 임베딩에서 제거(최신값만 검색됨) — 웹 뷰어는 취소선을 렌더해 개정 이력 표시, 볼트 파일은 삭제 아님. 재색인 시 Chroma 백업 필수. A/B 입증: 잘린 꼬리 질의 구 인덱스 미회수→신 인덱스 1위.
- 임베딩: `nlpai-lab/KURE-v1` (대안 `BAAI/bge-m3`) — 양자화하지 않음
- 검색: 밀집(KURE-v1)이 기본. **리랭커 적용**(P1.4): 밀집 top-20 → `BAAI/bge-reranker-v2-m3`(온프레미스, GPU1) 재점수 → top-5. `rag_core.retrieve(rerank=)`/`RAG_RERANK`. 평가 strict Hit@1 0.600→0.829, 실패 시 밀집 강등. 하이브리드(BM25+RRF)는 `bm25_index.py`에 opt-in이나 평가상 이득 없어 기본 off. **멀티턴 쿼리 재작성**(P1.5): 후속 질문을 직전 맥락으로 독립 검색어로 재작성(`rag_core.condense_query`/`RAG_QUERY_REWRITE`, 기본 on) — 검색어만 바꾸고 답변·근거는 불변, 실패 시 원 질문 강등. **재작성 위생 가드**(`_rewrite_ok`): 직전 답변 복사·질문 핵심어 전멸·200자 초과 출력은 원 질문으로 강등(실측 결함 — 재작성기가 직전 오답을 복사해 거짓 부정 유발, `test_rewrite_guard.py`). **개수·전수 질문 단정 방지**(P2.10, SYSTEM 규칙11): top-5 근거를 전체인 양 '총 N개' 단정 금지 — '검색된 근거 기준(전체 아님)' 한정 + 둘러보기 안내 — 프롬프트(집계 질문에만 적용 명시) + 결정적 백스톱 `_ensure_enum_note`(`verify_enum_guard.py`). **ERP·서식 연결**(P2.4): 시스템(ERP) 근거 블록에 `(ERP 시스템)` 라벨 + SYSTEM 프롬프트가 메뉴·경로를 답변에 안내(근거에 있을 때만·무환각), 출처 `type`로 UI 🖥 ERP/📄 서식 칩. 섹션 다양성(`_select_diverse`/`RAG_SECTION_DIVERSITY`)은 측정상 무이득(밀집이 이미 섹션 혼합)→기본 off·opt-in. **조문 정제·무결성**(Track A, `docs/18`): 회수 결과에 `article_status.json` 오버레이(`_overlay_article_status`)로 **삭제 조문을 근거에서 강등**(⛔절대규칙1 방어)+효력/최근개정 메타 부착(`RAG_ARTICLE_STATUS`, 재임베딩 불필요), `clause_xref.json`으로 reg 확장(준용/인용) 보강(`RAG_CLAUSE_XREF`). ⚠ **시각 그래프(`/graph`, 문서 `[[ ]]`)는 검색에 미사용** — 검색이 쓰는 그래프 신호는 별표 refs·reg_refs(clause_xref)·행위흐름 typed 인덱스뿐. **신뢰 게이트**(P0, `docs/22`): ⓐ수치 게이트 — 답변의 화폐·%·기간·날짜가 근거·질문·명시적 계산식에 없으면 ⚠️ 경고 결정적 부착(`numeric_guard_note`/`RAG_NUM_GATE`, 3경로) ⓑ표 무결성 — HWP 변환으로 무너진 표(셀 병합·평탄화)를 감지해 수치 인용 금지 라벨+허용집합 제외+⚠표확인 배지+검수큐 최우선(`_table_broken`·`01o`·`RAG_TABLE_GUARD`) ⓒ적용범위 앵커 — 인용 규정의 제1~2조 자동첨부로 자격·수급 역추론 차단(`scope_anchor`/`RAG_SCOPE_ANCHOR`) ⓓ시스템 귀속 — '(소속 시스템: X)' 라벨+백스톱(`system_attribution_note`). 전부 재임베딩 불필요·경고 부착 방식(답변 차단 없음). E2E=`tools/verify_trust_gates.py`. 품질 트랙=`docs/12-품질강화.md`, 평가 하베스트=`eval/`.
- 벡터DB: Chroma (`tools/chroma/`, gitignore됨)
- LLM 서빙(실측): **격리 Ollama v0.31.1**(OpenAI 호환, `127.0.0.1:11436/v1`, PM2 `kei-ollama-v031`, ctx 8K) — vLLM 아님. 공유 Ollama(`11434`, v0.24.0)는 qwen3.5 미지원이라 미사용.
  모델 = `Qwen3.5-9B (Q4_K_M, GGUF, unsloth)`(~5.7GB, apache-2.0). 한국어 답변 검증 완료. NVIDIA 드라이버 535라 CUDA 대신 Vulkan로 GPU 사용(550+ 시 자동 CUDA).
  - **답변 soul = SYSTEM 프롬프트(`rag_core.SYSTEM`)**: 로컬 Qwen의 성격·행동은 요청마다 주입하는 이 system 프롬프트로 지정(Modelfile 아님). 규칙: **두괄식**(첫 줄 굵은 핵심 결론) · **간결**(핵심 3~6줄, 부가정보 최소, 장황한 단계 나열 지양) · 계산식 한두 줄 · 근거밖 금지 · 출처 `[규정명 제N조]` · 면책. **LaTeX·수식 문법($, 백슬래시 명령) 금지**, 굵게는 `**굵게**`(별표에 붙여, 공백 없이).
  - **표기 후처리(`rag_core._postprocess`, 값 불변)**: qwen3.5 공백결함 정규화(`_tighten_spacing`: '제 18 조'→제18조·'2 만 원'→2만원) + LaTeX 제거(`_strip_latex`: `$…\text{원}…$`→평문) + 볼드 공백 정리(`_fix_markdown`: `** 굵게 **`→`**굵게**`). 프론트(react-markdown, KaTeX 미도입)가 raw로 노출하는 걸 막음. 사고 off=`reasoning_effort=none`(+think:false). 비스트리밍·스트리밍 공통 적용.
  - **컨텍스트 상한(`RAG_CTX_MAX_CHARS`, 기본 6500자)**: 큰 청크(출판편람 표 등)가 top-k에 몰리면 ctx 8K 초과로 Ollama 400(빈답변="생성 모델에 연결하지 못했습니다")이 난다. `_cap_blocks`가 순위 높은 근거부터 예산 안에 담고 초과분은 절단(SYSTEM·멀티턴·답변 여유 확보). 100문항 감사에서 발견·수정. **근거 목록 동기화(정직성)**: 컨텍스트에서 빠진 블록의 출처는 `x_sources`에서도 제외, 절단된 마지막 근거엔 `절단` 마커(UI '일부 반영' 배지) — 'LLM이 읽지 않은 근거가 목록에 표시'되는 불일치 차단. **근거 개수**: 기본 top-5 + 자동첨부(별표≤3 기본on · 준용/참조≤2 · 후속단계≤2+기안≤1은 플래그, prod 기본off) — UI는 `🔗 자동첨부` 배지(source_type_badges 게이트)로 구분.
  - GPU(2×Quadro RTX 6000 24GB): 공유·변동적이라 배치 전 `nvidia-smi`·`/api/ps` 확인. Q4 GGUF(~5.7GB)라 단일 24GB에 여유 상주. 검색 임베딩(KURE-v1)·리랭커는 1장으로 충분.
- LLM UI: **Next.js 앱에 통합된 채팅**(`web/` `/`)이 LLM API를 같은 오리진 `/api/*`로 호출. **로그인 + 채팅기록 영속화 + 멀티턴 기억 + 메시지별 근거 저장 + 응답 스트리밍(SSE)** 지원. Open WebUI는 같은 RAG API를 쓰는 선택적 폴백(브랜딩 라이선스 이슈로 기본 채택 아님).
- LLM 앱 영속화(조사 확정 스택): **bcrypt(직접)+PyJWT 쿠키 + SQLModel/SQLite**(`tools/app.db`, gitignore). passlib/fastapi-users 미사용. 백엔드 3분리 — `tools/rag_core.py`(검색·생성 공용: retrieve/answer) · `tools/app_api.py`(인증·채팅 라우터 `/app/*`) · `tools/04_rag_api.py`(진입점: OpenAI호환 `/v1/*` + `/app/*` 마운트 + init_db, PM2 1프로세스·모델 1회 로드). 멀티턴=세션 메시지 LLM 재생(근거는 매 턴 새 검색). 근거=assistant 메시지에 JSON 저장. **답변 피드백**=👍/👎(+사유) `Feedback` 테이블(사용자·메시지당 1건·upsert/toggle, 소유격리). `feedback_export.py`→`.feedback_signals.json`→`review_queue.py`가 자주 틀린 규정을 검수 우선순위로 끌어올림(⛔검수상태 자동변경 없음·사람만). 관리자 집계 `GET /app/feedback`(current_admin). 매뉴얼=`docs/14-feedback-loop.md`. JWT 서명키 `tools/.app_secret`(0600, gitignore). 스트리밍: `POST /app/chats/{id}/messages?stream=1` → SSE(`meta`→`delta`…→`done`), `rag_core.answer_stream`. `server.js`는 SSE용 hop-by-hop 헤더 제거 후 파이프.
- 콜드스타트 제거: 기동 시 `rag_core.warmup`(임베딩 KURE-v1 로드 + LLM `keep_alive=-1` 상주)을 데몬 스레드로 실행, 이후 `OLLAMA_PING_SECONDS`(기본 240s) 주기 keep-alive로 외부 언로드 백스톱. 모든 생성 호출도 `keep_alive=-1` 전달. GPU0가 비어 상주에 여유.
- 웹앱(`web/`, Next.js 14 — ⚠ TDS 제거·KRDS 팔레트·Pretendard GOV self-host, docs/37): 한 앱에 **LLM(`/` RAG 채팅+근거패널+문서드로어) · 둘러보기(`/browse`) · 관계 그래프(`/graph`) · 결재선(`/approval`) · 업무 한 장(`/journey` 여정 13종) · 업무 캘린더(`/calendar` 이번달 히어로+4×3 연간, docs/43) · 서식 찾기(`/forms`) · 추가 기능 허브(`/now`) · 소개(`/about` 외부공개 후보 — 서비스 링크 없음)** 통합. 정적 export(`output:export`) → `out/`. Pages Router·React 18 고정, 외부 UI 라이브러리 0(검색 입력 등 전부 자체 컴포넌트). 컬러는 KEI 시맨틱 토큰(`web/styles/globals.css`; **다크모드 = `[data-theme="dark"]` 토큰 분기, 라이트/다크/시스템 토글 `lib/theme.tsx`+`ThemeToggle`, FOUC 방지 `_document` 인라인 스크립트**; 원자 팔레트=KRDS 공식 토큰 값), 디자인 규약 `docs/design-system.md`.
  - **용어 인라인 툴팁**(docs/45, flag `term_tooltips`): 본문·답변 속 행정 용어(품의·기안…) 점선 밑줄→정의 팝오버(0클릭·무LLM). 빌드타임 `terms-tooltip.json`(30_용어집 88개)+React 렌더러 치환(스트리밍 안전). 미검수 용어 '검수 전 초안' 배지.
  - **답변 신뢰 강화(금액·한도)**: 채팅 답변에 금액/한도 토큰 있으면 "원문에서 수치 확인" 안내 + 근거 스니펫의 수치 `<mark>` 강조 + 근거별 **검수상태 배지**(`docdata`의 `검수상태` 조회, 재임베딩 불필요). ⛔생성 숫자는 검증 대상(절대 규칙1) — 사용자를 원문 표/조문으로 유도. `docs/12-품질강화.md` P2.2.
  - **규정집 기준일**: footer 구석에 "📑 규정집 기준일"(규정 원문 적재일). 단일 출처 `web/lib/site.ts`의 `CORPUS_AS_OF`(현재 2026.06.19; 규정집 재적재 시 이 값만 갱신). 규정 개정 대비 답변의 근거 시점을 사용자에게 고지.
  - **실렌더 검증(Playwright)**: `web/verify-*.mjs`(feedback·trust·flags·drawer·layout 등). ⚠️ headless에서 한글이 □로 깨지면 `~/.fonts`에 한글(Noto Sans KR·나눔고딕)+이모지(Noto Color Emoji) 폰트 설치 후 `fc-cache -f`. 테스트는 `cd web && node verify-*.mjs`로 실행(dev 3101/9001 가동·admintest 계정 필요 — 게이트 때문에 로그인 후 진입).
  - 서빙: `web/server.js`(의존성0 정적서버, `/api/rag/*`→127.0.0.1:9000 리버스 프록시) **PM2 `kei-guide`** 0.0.0.0:3100. **서버 로그인 게이트**(docs/44): server.js가 JWT(`kei_session`) 검증 — 비로그인은 랜딩 셸(`/`,`/about`)만, 콘텐츠(문서·docdata·search-index·`/api/rag/chat`) 전부 차단(fail-closed, 해제는 `REQUIRE_LOGIN=0` 비상용만). ⛔ nginx 단독 서빙 금지(게이트 소멸) — auth_request 재현 전까지 server.js 유지. 빌드: `cd web && NEXT_PUBLIC_BUILD_ID=$(git rev-parse --short HEAD) VAULT_DIR=<볼트> npm run build`(footer 버전 표기)(⚠️ **반드시 nvm Node 22** — 기본 node18은 docdata emit이 조용히 실패해 드로어 깨짐) → 드로어용 `out/docdata/*.json`까지 생성.
  - **기능 플래그**(deploy/release 분리, 포트 신설 없이 한 코드베이스 운영): 백엔드 `app_api.py`의 코드 레지스트리 `FLAG_REGISTRY` + SQLite `Flag`/`FlagAudit`, 공개 `GET /app/flags`(비민감 불리언만) + 관리자 전용 토글/감사(`current_admin`, `APP_ADMINS` **fail-closed** — 미설정 시 아무도 관리자 아님, 첫 가입자 부트스트랩 없음). 프론트는 정적 export라 빌드에 안 박고 `lib/flags.tsx`(`useFlag`, 안전기본값+localStorage캐시+폴백)로 런타임 fetch, 관리자 페이지 `/admin`에서 즉시 토글. 매뉴얼=`docs/13-feature-flags.md` §10.
  - **운영자 대시보드**(P2.5): `/admin`에 운영 대시보드(활동·**거부율**·👍/👎·인기질문·**콘텐츠 갭**) — `GET /app/stats`(관리자, app.db 집계, 거부 감지 `REFUSAL_RE`). 인기/거부/👎 질문 = 다음에 보강할 규정·가이드 우선순위(피드백 루프 P2.1과 함께 자기개선 루프 완성). **🔒 개인정보**: 서버사이드 RAG라 진짜 E2EE는 불가(LLM이 평문 필요) → 대신 ⓐ 관리자는 타인 채팅 읽는 엔드포인트 없음 ⓑ `/stats`·`/feedback`은 질문·답변 **본문 미반환**(규정 메타·집계만) ⓒ 인기질문/갭은 서로 다른 사용자 **K명 이상**(`STATS_MIN_USERS`, 기본 3) **k-익명** 집계만. 매뉴얼=`docs/12-품질강화.md` P2.5.
- 언어: 사용자 노출 콘텐츠는 한국어. 한글 파일명 사용(`git config core.quotepath false` 적용됨)

## 노트 프론트매터 (일관성 유지 — 양식은 `KEI-행정가이드/90_관리/_templates/`)
- regulation: `type, 규정번호, 규정명, 분류, 개정일, 원본파일, 태그, 검수상태(미검수|검수완료)`
- guide: `type, 제목, 분류, 대상, 관련규정[], 관련서식[], 최종검토일, 검토자, 태그`
- term: `type, 용어, 영문, 관련규정[], 태그`

## 실행 커맨드
- 변환:   `python tools/01_hwp_to_md.py --src <hwp폴더> --vault KEI-행정가이드`  (규정 원문 → 20_규정원문/)
- 가이드: `python tools/01c_guides_to_md.py --src research_rule_files --vault KEI-행정가이드`  (HWP/HWPX/PDF/PPTX → 10_업무가이드/, type:guide)
- ERP:    `python tools/01d_erp_to_md.py --src KEI_ERP_entire_features.md --vault KEI-행정가이드`  (ERP 기능분석 → 40_시스템/ 모듈별 노트 type:system(섹션 '시스템', 보라), #### 기능 단위 청킹)
- ERP링크: `python tools/01e_erp_crosslink.py --vault KEI-행정가이드`  (ERP 모듈↔관련 규정 `[[ ]]` 교차링크 → 그래프 엣지. 01d 다음, 01b 전)
- 시스템:  `python tools/01d_system_to_md.py --bundle --src <전사문서.md> --vault KEI-행정가이드`  (01d ERP 일반화 — 전사 번들(## N.=시스템: EIP·PMS·웹메일·그룹웨어·웹디스크·도서관)을 40_시스템/ 노트화: 허브 '사내 시스템 개요'+시스템별 개요·모듈 노트, PMS식 굵은 기능명→#### 승격. 단일 시스템 파일은 `--system <key>`, `--list`로 확인. 분류=시스템명(행정관리(ERP)·연구관리(PMS)·그룹웨어…)→둘러보기 필터 자동. 설계=`docs/17`)
- 심화가이드: `python tools/01d_system_to_md.py --deep-guide --src <상세도움말.md> --vault KEI-행정가이드`  (ERP 상세 도움말(G-ProOne 지침서 PDF 판독본, # 모듈>## 화면 신청법>### 상세) → 'ERP 상세가이드 · 회계(ACT)' 등 모듈 노트+개요+공통 패턴. ###→#### 승격으로 상세 팝업도 라벨 청크. **행위 흐름 typed 엣지**: `rag_core.ACTION_FLOWS`(신청→정산·결과보고, 문서 부록 근거 페어만)를 flag `graph_expand_actions`로 검색 시 자동첨부 — 별표 refs와 동형의 유일한 typed 관계 2호)
- 시스템링크: `python tools/01e_system_crosslink.py --vault KEI-행정가이드 --system all`  (01e 일반화 — 분류 기반 시스템↔규정 교차링크(그래프 엣지), 모듈별 키워드. 01d_system 다음, 01b 전. ERP 포함 일원화)
- 용어집: `python tools/01f_terms_to_md.py --src KEI_admin_terms.md --vault KEI-행정가이드`  (행정 용어집 → 30_용어집/ 용어 1개=노트 1개 type:term)
- 용어링크: `python tools/01g_terms_crosslink.py --vault KEI-행정가이드`  (용어↔ERP 모듈(카테고리)/관련 규정 `[[ ]]` 교차링크 → 그래프 엣지. 01f 다음)
- 링크:   `python tools/01b_autolink.py --vault KEI-행정가이드`  (규정 상호참조 → `[[ ]]` 그래프 엣지. 가이드도 규정명 멘션이 링크됨)
- 조문정제(Track A, 원문 재마이닝·재임베딩 불필요, 01b 다음·02 전): 공통 파서 `tools/vault_parse.py`.
  - 참조그래프: `python tools/01i_clause_xref.py --vault KEI-행정가이드`  (조문↔조문 준용·인용·별표 → `tools/index/clause_xref.json`. reg 확장 보강 + 드로어 준용칩 + Track C 기반)
  - 정의어:   `python tools/01j_defterms.py --vault KEI-행정가이드`  (규정 원문 정의 바인딩 + 교차 정의충돌 → `defterms.json`)
  - 조문효력: `python tools/01k_article_status.py --vault KEI-행정가이드`  (삭제조문·개정시계열 → `article_status.json`. rag_core 삭제 강등·효력배지)
  - 그래프분석(Track C, 01i 다음): `python tools/01l_graph_analytics.py`  (clause_xref 소비 → `graph_analytics.json`: 개정 파급(reverse 전이폐포)·함께 보는 조문(공동인용)·고립노드. 드로어 `graph_impact` 플래그)
  - 기한(Track B): `python tools/01m_deadlines.py --vault KEI-행정가이드`  (원문 상대기한 ‹기준›+N일 이내 → `deadlines.json`. 드로어 '이 규정의 기한' 패널서 기준일→마감일 순수산술 계산+.ics, `deadline_calc` 플래그. 오프셋 원문 그대로·추측 없음)
  - 결재선(Track B): `python tools/01n_approval.py --vault KEI-행정가이드`  (위임전결규정 별표 ○-매트릭스 → `approval.json` 335규칙. leaf 분류: 직급 7종만 `대상`, 금액구간 등 조건은 업무 경로 편입. UI = 독립 페이지 `/approval`+상단 메뉴 '결재선'+**채팅 연동**(결재/기안 언급 감지→"결재선 알아볼까요?" 카드→우측 드로어·업무 키워드 프리셋)+직급 localStorage 기억, `approval_finder` 플래그. 공식 전결기준+"부서 확인" 면책)
  - 상세 = `docs/18-조문정제-무결성.md`(Track A·C), 기한·결재선 = `docs/17` Track B. rag_core 토글 `RAG_ARTICLE_STATUS`(삭제강등·기본on)·`RAG_CLAUSE_XREF`(기본on). 웹 플래그 `article_integrity`(A)·`graph_impact`(C)·`deadline_calc`·`approval_finder`(B). 인덱스 갱신 후 RAG API 재기동 필요.
- 임베딩: `python tools/02_chunk_and_embed.py --vault KEI-행정가이드 --db tools/chroma`
- 질의:   `python tools/03_rag_query.py --db tools/chroma --q "..."`
- RAG API: `tools/04_rag_api.py` (FastAPI, OpenAI 호환). **PM2 `kei-rag-api`**(uvicorn, 127.0.0.1:9000)로 상시 구동, env로 Ollama 연결(`tools/ecosystem.config.js`). 응답에 `x_sources`(규정명·조·분류·snippet) 포함 → 근거 패널/문서 드로어 연결.
  - 단발 실행: `cd tools && VLLM_BASE=http://127.0.0.1:11436/v1 LLM_MODEL=hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M .venv/bin/uvicorn 04_rag_api:app --host 127.0.0.1 --port 9000`
- 표 무결성: `python tools/01o_table_integrity.py --vault KEI-행정가이드`  (손상 표 전수 스캔 → tools/index/, 검수 큐 가산 + P0-3 런타임 격리와 동일 휴리스틱)
- 표 복원:  `python tools/01p_table_restore.py`  (손상 문서 원본 재파싱 → 복원 제안 스테이징. 반영은 /admin 🔧 표 복원 탭에서 사람이)
- 수치 스토어: `python tools/01q_table_store.py --vault KEI-행정가이드`  (⛔검수완료+비손상 표만 → value_store.json, 값 질문 결정적 조회 — docs/24)
- 형식 진단: `python tools/01t_format_scan.py --vault KEI-행정가이드`  (표 밖 형식 붕괴 — 제어문자·항/호/목 인라인 병합·초장문 → format_scan.json, docs/28)
- 형식 복원: `python tools/01u_format_restore.py --vault KEI-행정가이드 --ctrl --rebreak [--dry]`  (결정적·LLM 미사용. ⛔내용 불변(정규화 동일) 통과 시에만 기록, 백업 자동)
- 검수 큐:  `python tools/review_queue.py --vault KEI-행정가이드 [--top 30]`  (미검수 우선순위. 읽기 전용·확정은 사람만. 인앱 피드백 신호 있으면 자동 반영)
- 피드백:  `python tools/feedback_export.py`  (app.db 👍/👎 → `tools/.feedback_signals.json`, 검수 큐가 소비. 매뉴얼 `docs/14-feedback-loop.md`)

## 작업 방식
- 작은 단위로 커밋. 변환·생성물은 사람이 검수하기 전 `검수상태: 미검수` 유지.
- 큰 변경 전에는 계획을 먼저 요약해 보여줄 것. 막히면 추측하지 말고 질문.
- 절대 규칙(위 ⛔)을 매 작업에서 지킨다.
