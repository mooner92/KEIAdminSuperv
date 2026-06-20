# CLAUDE.md — KEI 행정 가이드 / 행정 LLM

> 이 파일은 Claude Code가 매 세션 자동으로 읽는 프로젝트 컨텍스트다. 작업 전 반드시 숙지한다.
> 상세 작업 순서는 `WORKPLAN.md` 참조. 설계 문서는 `docs/` 참조.

## 프로젝트 한 줄 정의
KEI(한국환경연구원) 행정 초보(신입·전입자)가 "이 업무 어떻게 처리하지?"를 빠르게 해결하도록,
사내 규정을 근거로 답하는 **온프레미스 지식베이스 + 로컬 LLM**을 만든다.

## 아키텍처: 하나의 볼트, 두 개의 화면
- 단일 진실원천(Source of Truth) = 이 레포의 마크다운 볼트 `KEI-행정가이드/`
- **[뇌]** Next.js 14 + Toss Design System 정적 사이트(`web/`) — 노드/링크 그래프 + 전문검색 + 문서 (사람이 탐색). 이전 Quartz를 대체.
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
  - `90_관리/` — 템플릿, 개정이력, Dataview 인덱스
- `web/` — [뇌] 화면(Next.js 14 + Toss Design System 앱). 정적 export(`out/`) → nginx. 볼트를 빌드타임 read-only 소비(`web/lib/vault.ts`). 이전 Quartz를 대체.
- `tools/` — 파이프라인: 01 변환 → 01b 상호참조 위키링크(그래프 엣지) → 02 청킹·임베딩 → 03 질의 / 04 OpenAI호환 RAG API
- `deploy/` — Ubuntu HWP 셋업 스크립트, docker-compose, 배포 README (Quartz 배포는 [뇌] Next.js+TDS로 대체됨)
- `docs/` — 설계·계획 문서(아키텍처, 콘텐츠 모델, 파이프라인, RAG, 배포, 보안, 로드맵, ADR)

## 기술 스택 & 규약
- Python: 가상환경 사용(`tools/.venv`), 의존성 `tools/requirements.txt`
- 변환: `hwp-hwpx-parser`(.hwp/.hwpx 모두). 표/별표 깨질 땐 LibreOffice+H2Orestart→PDF→VLM(Qwen2.5-VL)
- 연구행정 가이드(`research_rule_files/`, 내부 전용·커밋 금지)는 PDF·PPTX 혼합 → `tools/01c_guides_to_md.py`가 PyMuPDF(PDF)·python-pptx(PPTX)로 변환해 `10_업무가이드/`(type:guide)에 적재. 분류는 제목 키워드로 규정집과 같은 버킷. 스캔 이미지 PDF는 `image-pdf`로 표시 + 「TODO: 원문 확인」 플레이스홀더. 슬러그는 볼트 전체와 충돌 안 나게(규정 원문 미덮어씀).
- 청킹: 규정원문 **제N조 단위**, 가이드/ERP는 **헤딩(####/##) 단위**(02의 `chunk_guide`) (고정 길이 청킹 금지). **별표/별지는 1급 청크로 분리**(조="별표 N", `refs`=인용 조문; 토글 `CHUNK_BYEOLPYO`) — P1.3.
- 임베딩: `nlpai-lab/KURE-v1` (대안 `BAAI/bge-m3`) — 양자화하지 않음
- 검색: 밀집(KURE-v1)이 기본. **리랭커 적용**(P1.4): 밀집 top-20 → `BAAI/bge-reranker-v2-m3`(온프레미스, GPU1) 재점수 → top-5. `rag_core.retrieve(rerank=)`/`RAG_RERANK`. 평가 strict Hit@1 0.600→0.829, 실패 시 밀집 강등. 하이브리드(BM25+RRF)는 `bm25_index.py`에 opt-in이나 평가상 이득 없어 기본 off. **멀티턴 쿼리 재작성**(P1.5): 후속 질문을 직전 맥락으로 독립 검색어로 재작성(`rag_core.condense_query`/`RAG_QUERY_REWRITE`, 기본 on) — 검색어만 바꾸고 답변·근거는 불변, 실패 시 원 질문 강등. 품질 트랙=`docs/12-품질강화.md`, 평가 하베스트=`eval/`.
- 벡터DB: Chroma (`tools/chroma/`, gitignore됨)
- LLM 서빙(실측): **Ollama**(OpenAI 호환, `127.0.0.1:11434/v1`) — vLLM이 아니라 Ollama가 돌고 있다.
  모델 = `Qwen2.5-14B-Instruct (Q4_K_M, GGUF)`(일반 instruct, ~9GB). 한국어 답변 검증 완료.
  - GPU 현황(2×Quadro RTX 6000 24GB): **GPU0 비어있음**(전용 인스턴스 여지), GPU1에 Ollama(~18GB, 임베딩 bge-m3 포함). fp16 14B(~28GB)는 단일 24GB 초과 → 양자화(Q4) 또는 2장 텐서병렬 필요. 검색 임베딩(KURE-v1)은 1장으로 충분.
- LLM UI: **Next.js+TDS 앱에 통합된 채팅**(`web/` `/`)이 LLM API를 같은 오리진 `/api/*`로 호출. **로그인 + 채팅기록 영속화 + 멀티턴 기억 + 메시지별 근거 저장 + 응답 스트리밍(SSE)** 지원. Open WebUI는 같은 RAG API를 쓰는 선택적 폴백(브랜딩 라이선스 이슈로 기본 채택 아님).
- LLM 앱 영속화(조사 확정 스택): **bcrypt(직접)+PyJWT 쿠키 + SQLModel/SQLite**(`tools/app.db`, gitignore). passlib/fastapi-users 미사용. 백엔드 3분리 — `tools/rag_core.py`(검색·생성 공용: retrieve/answer) · `tools/app_api.py`(인증·채팅 라우터 `/app/*`) · `tools/04_rag_api.py`(진입점: OpenAI호환 `/v1/*` + `/app/*` 마운트 + init_db, PM2 1프로세스·모델 1회 로드). 멀티턴=세션 메시지 LLM 재생(근거는 매 턴 새 검색). 근거=assistant 메시지에 JSON 저장. JWT 서명키 `tools/.app_secret`(0600, gitignore). 스트리밍: `POST /app/chats/{id}/messages?stream=1` → SSE(`meta`→`delta`…→`done`), `rag_core.answer_stream`. `server.js`는 SSE용 hop-by-hop 헤더 제거 후 파이프.
- 콜드스타트 제거: 기동 시 `rag_core.warmup`(임베딩 KURE-v1 로드 + LLM `keep_alive=-1` 상주)을 데몬 스레드로 실행, 이후 `OLLAMA_PING_SECONDS`(기본 240s) 주기 keep-alive로 외부 언로드 백스톱. 모든 생성 호출도 `keep_alive=-1` 전달. GPU0가 비어 상주에 여유.
- 웹앱(`web/`, Next.js 14 + Toss Design System): 한 앱에 **LLM(`/` RAG 채팅+근거패널+문서드로어) · 둘러보기(`/browse` 좌측 체크박스 필터) · 관계 그래프(`/graph`)** 통합. 정적 export(`output:export`) → `out/`. Pages Router·React 18 고정, `@toss/tds-mobile` v2.5.0. 컬러는 KEI 시맨틱 토큰(`web/styles/globals.css`; **다크모드 = `[data-theme="dark"]` 토큰 분기, 라이트/다크/시스템 토글 `lib/theme.tsx`+`ThemeToggle`, FOUC 방지 `_document` 인라인 스크립트, TDS는 `ColorSchemeArea`**), 디자인 규약 `docs/design-system.md`.
  - 서빙: `web/server.js`(의존성0 정적서버, `/api/rag/*`→127.0.0.1:9000 리버스 프록시) **PM2 `kei-guide`** 0.0.0.0:3100. 운영은 nginx 127.0.0.1 + Cloudflare ZT로 대체 가능. 빌드: `cd web && VAULT_DIR=<볼트> npm run build`(⚠️ **반드시 nvm Node 22** — 기본 node18은 docdata emit이 조용히 실패해 드로어 깨짐) → 드로어용 `out/docdata/*.json`까지 생성.
  - **기능 플래그**(deploy/release 분리, 포트 신설 없이 한 코드베이스 운영): 백엔드 `app_api.py`의 코드 레지스트리 `FLAG_REGISTRY` + SQLite `Flag`/`FlagAudit`, 공개 `GET /app/flags`(비민감 불리언만) + 관리자 전용 토글/감사(`current_admin`, `APP_ADMINS` 또는 첫 가입자). 프론트는 정적 export라 빌드에 안 박고 `lib/flags.tsx`(`useFlag`, 안전기본값+localStorage캐시+폴백)로 런타임 fetch, 관리자 페이지 `/admin`에서 즉시 토글. 매뉴얼=`docs/13-feature-flags.md` §10.
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
- 용어집: `python tools/01f_terms_to_md.py --src KEI_admin_terms.md --vault KEI-행정가이드`  (행정 용어집 → 30_용어집/ 용어 1개=노트 1개 type:term)
- 용어링크: `python tools/01g_terms_crosslink.py --vault KEI-행정가이드`  (용어↔ERP 모듈(카테고리)/관련 규정 `[[ ]]` 교차링크 → 그래프 엣지. 01f 다음)
- 링크:   `python tools/01b_autolink.py --vault KEI-행정가이드`  (규정 상호참조 → `[[ ]]` 그래프 엣지. 가이드도 규정명 멘션이 링크됨)
- 임베딩: `python tools/02_chunk_and_embed.py --vault KEI-행정가이드 --db tools/chroma`
- 질의:   `python tools/03_rag_query.py --db tools/chroma --q "..."`
- RAG API: `tools/04_rag_api.py` (FastAPI, OpenAI 호환). **PM2 `kei-rag-api`**(uvicorn, 127.0.0.1:9000)로 상시 구동, env로 Ollama 연결(`tools/ecosystem.config.js`). 응답에 `x_sources`(규정명·조·분류·snippet) 포함 → 근거 패널/문서 드로어 연결.
  - 단발 실행: `cd tools && VLLM_BASE=http://127.0.0.1:11434/v1 LLM_MODEL=hf.co/bartowski/Qwen2.5-14B-Instruct-GGUF:Q4_K_M .venv/bin/uvicorn 04_rag_api:app --host 127.0.0.1 --port 9000`

## 작업 방식
- 작은 단위로 커밋. 변환·생성물은 사람이 검수하기 전 `검수상태: 미검수` 유지.
- 큰 변경 전에는 계획을 먼저 요약해 보여줄 것. 막히면 추측하지 말고 질문.
- 절대 규칙(위 ⛔)을 매 작업에서 지킨다.
