# KEI 행정 가이드 · 행정 LLM

> 행정 초보(신입·전입자)가 "이 업무 어떻게 처리하지?"를 **사내 규정 근거로** 빠르게 해결하도록 돕는 온프레미스 지식베이스 + 로컬 LLM.
>
> 단일 진실원천(Source of Truth)인 마크다운 볼트 하나를, 사람이 탐색하는 **[뇌] 그래프·문서**와 신입이 물어보는 **[LLM] RAG 채팅**으로 동시에 서빙합니다. 두 화면 모두 한 개의 **Next.js 14 + TDS 앱(`web/`)**에 통합되어 있습니다 — LLM은 별도 Open WebUI가 아니라 우리 RAG API를 호출하는 앱 내 채팅 화면입니다. LLM에는 **로그인·회원가입, 채팅기록 영속화, 멀티턴 기억, 답변(메시지)별 근거 저장, 응답 스트리밍(SSE)**이 들어 있고, **검색 품질**은 리랭커(P1.4)·멀티턴 쿼리 재작성(P1.5)으로, **신뢰**는 답변 피드백(👍/👎, P2.1)·금액 신뢰 강화(P2.2)·운영자 대시보드(P2.5)로 보강했습니다. 답변 생성은 **Ollama**(Qwen2.5-14B-Instruct Q4_K_M, OpenAI 호환), 검색 임베딩은 **KURE-v1**로 모두 사내 GPU(Quadro RTX 6000 24GB×2)에서 돌고, 화면은 Cloudflare Zero Trust 뒤(사내 전용)에 둡니다.

| 항목 | 상태 |
| --- | --- |
| 상태 | 🟢 파이프라인 + LLM 가동 — 변환·임베딩·검색 검증 완료, RAG API(Ollama)로 한국어 답변 생성 검증 완료. 검색(리랭커·쿼리 재작성)·신뢰(피드백·금액 강화·대시보드) 보강 |
| 코퍼스 | **271 문서**(규정집 111 · 연구행정 가이드 64 · 용어집 84 · ERP 시스템 12) · 약 **4,400 청크** 임베딩(KURE-v1, 긴 조문 하위분할 반영) · 관계 그래프 271 노드·275 연결 |
| 배포 | 🔒 사내 전용 (인터넷 공개 금지) · 현행 dev(`feat/0620`) 3100/9000 · 레거시 `v1.0.0` 3101/9001(`.legacy-v1/`, 완전 격리) |
| 모델 | 🖥️ 온프레미스 GPU (Quadro RTX 6000 24GB×2, 총 48GB) · 답변 Ollama(Qwen2.5-14B-Instruct Q4_K_M) |
| 조직 | KEI · 한국환경연구원 (Korea Environment Institute) |
| 레포 | github.com/mooner92/KEIAdminSuperv |

---

## 누구를 위한 것

- **주 사용자 — 행정 초보(신입·전입자):** 출장 정산, 비품 구매, 휴가·복무 같은 행정 업무를 처음 맡았을 때 "어느 규정의 무슨 조항을 봐야 하나?"를 채팅으로 물어보고, **출처가 붙은 답변**을 받습니다. 로그인하면 **이전 대화가 그대로 남고**(채팅기록), 같은 대화 안에서 **앞선 답변을 이어 물을 수 있으며**(멀티턴), 지난 답변을 클릭하면 **그때 사용한 근거**를 다시 볼 수 있습니다.
- **탐색이 필요한 담당자:** 규정들이 어떻게 연결되는지 그래프로 둘러보고, 전문검색으로 원문을 직접 확인합니다.
- **이 시스템을 만드는 개발자/운영자:** 이 README에서 출발해 `docs/`의 설계·계획 문서로 들어갑니다.

> [!note]
> LLM이 주는 답은 **출발점**입니다. 답변 끝에는 항상 사용한 출처(`[규정명 제N조]`)와 "최종 판단은 원문과 담당 부서 확인 바랍니다."가 붙습니다.

---

## 핵심 개념 — 하나의 볼트, 두 개의 화면

단일 진실원천은 레포 안의 마크다운 볼트 `KEI-행정가이드/` 하나뿐입니다. 같은 마크다운을 두 화면이 각자의 방식으로 "먹습니다".

볼트는 **핵심 2-layer**(가치층 `10_업무가이드/` ↔ 진실원천 `20_규정원문/`)에 **보조 폴더**(`30_용어집/`·`40_시스템/`(ERP)·`90_관리/`)가 더해진 구조입니다. 화면의 '구분' 섹션은 **규정집 · 연구행정 가이드 · 용어집 · ERP 시스템** 4개(각각 파랑·초록·주황·보라)이며, 진실원천 2-layer 위에 용어/시스템이 보조로 얹힌 같은 볼트입니다(정본 표현은 [CLAUDE.md](CLAUDE.md)의 "2-layer").

```mermaid
flowchart TD
    Vault["📁 KEI-행정가이드/<br/>(마크다운 볼트 = 단일 진실원천)"]

    Vault --> App["Next.js 14 + TDS 앱 (web/)<br/>한 앱, 두 화면"]

    App --> Brain["[뇌] /browse·/graph·/d/[slug]<br/>관계 그래프 + 필터·검색 + 문서 드로어<br/>사람이 탐색"]
    App --> Assistant["[LLM] / (Assistant)<br/>로그인 → 멀티턴 RAG 채팅<br/>대화목록 + 메시지별 근거 패널<br/>행정 초보가 사용"]

    Brain --> Static["web/out/ 정적 산출물<br/>(+ out/docdata/*.json)"]
    Assistant --> Proxy["server.js /api/rag/* (무상태) ·<br/>/api/app/* (로그인·채팅기록) 프록시<br/>→ 127.0.0.1:9000"]
    Proxy --> RAG["tools/04_rag_api.py (진입점)<br/>rag_core(Chroma 검색 → Ollama 생성 → 출처 강제)<br/>+ app_api(인증·채팅 /app, SQLite app.db)"]

    Static --> Serve["server.js(0.0.0.0:3100) 또는 nginx 127.0.0.1"]
    Serve --> ZT["🔒 Cloudflare Zero Trust / 사내망 (사내 전용)"]
    RAG --> ZT
```

핵심: **그래프와 채팅은 같은 마크다운을 먹는 두 화면**입니다. 채팅은 그림(그래프)이 아니라 **텍스트 + 임베딩 검색**으로 답합니다.

---

## 빠른 시작 (Quickstart)

> [!warning] 전제 조건
> - **HWP 원본** 규정 파일(`.hwp` / `.hwpx`)이 한 폴더에 모여 있어야 합니다.
> - **GPU 서버**(Quadro RTX 6000 24GB×2, 예: `data05lx` / Ubuntu)에서 임베딩·LLM을 구동합니다.
> - **Ollama**(OpenAI 호환, `http://127.0.0.1:11434/v1`, 모델 `hf.co/bartowski/Qwen2.5-14B-Instruct-GGUF:Q4_K_M` ~9GB)가 이미 떠 있어야 03/04 단계가 동작합니다. (vLLM은 대안 서빙으로 남겨둡니다.)
> - 웹앱(`web/`, Next.js 14 + TDS) 빌드·실행에는 **Node v22+**가 필요합니다. ⚠️ **반드시 nvm Node 22**로 빌드하세요 — 기본 node18에서는 `out/docdata/*.json` emit이 조용히 실패해 문서 드로어가 깨집니다("문서를 불러오지 못했습니다").

### 1) 파이프라인 (tools/)

```bash
git clone https://github.com/mooner92/KEIAdminSuperv.git
cd KEIAdminSuperv
git config core.hooksPath .githooks   # 내부 콘텐츠 커밋 차단 훅 활성화 (1회)

python -m venv tools/.venv && source tools/.venv/bin/activate
pip install -r tools/requirements.txt
# torch는 드라이버에 맞는 CUDA 빌드로 (드라이버가 CUDA 12.x면 cu124 휠):
pip install torch --index-url https://download.pytorch.org/whl/cu124

# 01) 규정 HWP/HWPX → 20_규정원문/ (깨진 파일은 --timeout 으로 격리)
python tools/01_hwp_to_md.py --src rule_files --vault KEI-행정가이드
# 01c) 가이드 HWP/HWPX/PDF/PPTX → 10_업무가이드/   ·   01d) ERP → 40_시스템/   ·   01f) 용어집 → 30_용어집/
python tools/01c_guides_to_md.py --src research_rule_files --vault KEI-행정가이드
python tools/01d_erp_to_md.py --src KEI_ERP_entire_features.md --vault KEI-행정가이드
python tools/01f_terms_to_md.py --src KEI_admin_terms.md --vault KEI-행정가이드
# 01e/01g) 교차링크(ERP·용어↔규정)   ·   01b) 규정 상호참조 → [[ ]] (그래프 엣지)
python tools/01e_erp_crosslink.py --vault KEI-행정가이드
python tools/01g_terms_crosslink.py --vault KEI-행정가이드
python tools/01b_autolink.py --vault KEI-행정가이드

# 02) 청킹(규정 제N조 / 가이드·ERP·용어 헤딩) + KURE-v1 임베딩 + Chroma 적재 (GPU 권장)
python tools/02_chunk_and_embed.py --vault KEI-행정가이드 --db tools/chroma

# 03) 검색만 점검 (LLM 불필요) → 정확한 규정·제N조 회수 확인
python tools/03_rag_query.py --db tools/chroma --q "출장 여비는 어떻게 정산하나요?" --retrieve-only
# 03) 전체 RAG (Ollama 필요)
python tools/03_rag_query.py --db tools/chroma --q "법인카드로 주말에 비품 사도 되나요?"

# 04) OpenAI 호환 RAG API + 로그인·채팅기록 API (웹앱 LLM 백엔드) — 운영은 PM2로 상시 가동
#     127.0.0.1:9000(로컬 전용, LAN 비노출). env(Ollama 연결)는 tools/ecosystem.config.js 참조
#     기동 시 SQLite(tools/app.db) 자동 init, JWT 서명키(tools/.app_secret 0600)는 없으면 자동 생성
pm2 start tools/ecosystem.config.js          # 프로세스 kei-rag-api 기동
# (수동 실행이 필요하면) cd tools && uvicorn 04_rag_api:app --host 127.0.0.1 --port 9000
```

> [!note] 실측 (2026-06-21)
> 코퍼스 **271 문서**(규정 111 · 가이드 64 · 용어 84 · ERP 12) → **약 4,400 청크** 임베딩(긴 조문 하위분할(P2.3) 반영, 재색인 후 4,418). 검색 정확(예: "출장 여비 정산" → 여비규정 해당 조 · "재직증명서 어느 메뉴" → ERP 인사관리 제증명서신청 `gen_3015M`). **답변 생성**은 Ollama(Qwen2.5-14B-Instruct Q4_K_M)로 한국어까지 검증. 변환 실패 2건(타임아웃 1·이미지PDF 1)은 LibreOffice/OCR 폴백 대상. 파이프라인 상세는 [docs/04-pipeline.md](docs/04-pipeline.md).

### 2) 웹앱 — [뇌]와 [LLM]을 한 앱으로 (web/)

이전 방식(Quartz)을 대체하는 현재 웹앱은 레포의 `web/`(Next.js 14 + Toss Design System)입니다. [뇌](그래프·문서)와 [LLM](RAG 채팅)가 같은 앱·같은 TDS 디자인 안에 통합되어 있습니다. 볼트는 빌드타임에 read-only로 읽습니다(`VAULT_DIR`, 기본값은 레포 루트).

페이지·컴포넌트:

- **`/` = LLM(Assistant):** **로그인 게이트** 화면입니다(`Assistant.tsx`가 `/auth/me`를 확인 → `Login.tsx`(로그인·회원가입) 또는 `ChatApp.tsx`를 렌더, 정적 export 유지·게이트는 클라이언트 렌더). 로그인하면 `ChatApp`은 **좌측 대화목록 사이드바**(새 대화·선택·삭제), **중앙 멀티턴 채팅**, 우측 **'메시지별' 근거 패널**, Notion형 **문서 드로어**로 구성됩니다. 지난 답변을 클릭하면 그때 저장된 근거를 우측에 다시 표시하고, 근거 카드를 클릭하면 드로어가 해당 조(제N조 앵커)로 펼쳐집니다. 같은 오리진 `/api/app/*`(로그인·채팅기록)와 `/api/rag/chat`(무상태)을 plain fetch(React hooks, React Query 미도입)로 호출합니다. 답변은 **SSE 스트리밍**(`POST /app/chats/{id}/messages?stream=1` → `meta`→`delta`…→`done`)으로 토큰을 순차 표시하며, 답변마다 **👍/👎 피드백**(+사유)을 남길 수 있습니다(P2.1). 금액·한도가 포함된 답변은 "원문에서 수치 확인" 경고 + 근거 스니펫 수치 강조(`<mark>`) + 근거별 검수상태 배지로 신뢰를 보강합니다(P2.2).
- **`/browse` = 둘러보기(Explorer):** 좌측 체크박스 **필터**(구분=규정집/가이드/용어집, 분류, 검수상태) + 검색 + 결과 목록. 행을 클릭하면 페이지 이동 없이 우측 Notion형 드로어로 본문이 열립니다. 패싯 카운트(다른 필터 반영) 제공.
- **`/graph` = 관계 그래프:** 기존 react-force-graph-2d.
- **`/d/[slug]` = 전체화면 문서:** 드로어의 '전체화면' 폴백(기존 SSG 페이지 유지).
- **DocDrawer:** 우측 슬라이드인. `out/docdata/<slug>.json`을 지연 로드합니다(빌드 산출물). 빌드 시 `web/scripts/emit-docdata.mts`가 `lib/vault.ts`를 그대로 재사용(`node --experimental-strip-types`)해 문서별 JSON을 만들어, 드로어와 `/d/[slug]` 페이지가 동일한 본문·링크를 보장합니다.

```bash
# Node v22+ 필요
cd web
npm install
VAULT_DIR=/path/to/KEI-행정가이드 npm run dev    # 로컬 미리보기 http://127.0.0.1:3100
VAULT_DIR=/path/to/KEI-행정가이드 npm run build  # → web/out/ 정적 산출물(next export) + out/docdata/*.json
# 운영(택1):
#  - server.js(의존성0 Node 정적서버, out/ 서빙 + trailingSlash 라우팅 + /api/rag/*·/api/app/* → 127.0.0.1:9000 프록시, 0.0.0.0:3100)
#  - 또는 web/out/ 을 nginx 127.0.0.1 로 서빙 → Cloudflare Zero Trust 뒤(사내 전용)
```

> [!note] 실측 (2026-06-21)
> `next build` 성공 — 정적 export(**문서 271** = 규정집 111 · 연구행정 가이드 64 · 용어집 84 · ERP 시스템 12) + `out/docdata/*.json`. 한글 mojibake 0, 위키링크 내부 네비 + 제N조 앵커 동작, 관계 그래프 **271 노드 · 275 연결**(4색 섹션 · ERP↔규정 · 용어↔ERP 교차링크), **다크모드/테마**(라이트·다크·시스템). `/` 첫 first-load JS 약 **440KB**(TDS + react-markdown, 경량화는 로드맵 항목). 임베딩 청크 약 **4,400**(긴 조문 하위분할(P2.3) 반영). ⚠️ 빌드는 반드시 **nvm Node 22**로 — 기본 node18은 `out/docdata/*.json` emit이 조용히 실패해 드로어가 깨집니다("문서를 불러오지 못했습니다"). 디자인 원칙·토큰·컴포넌트 규약은 [docs/design-system.md](docs/design-system.md).

### 3) 서빙 — PM2로 상시 가동

LLM은 별도 앱이 아니라 위 웹앱 `/` 화면입니다. 운영은 PM2가 두 프로세스를 관리합니다.

```bash
# kei-guide  : web/server.js — out/ 정적 서빙 + /api/rag/*·/api/app/* → 127.0.0.1:9000 리버스 프록시 (0.0.0.0:3100)
# kei-rag-api: tools/04_rag_api.py(uvicorn) — Chroma 검색 + Ollama 생성 + 인증·채팅기록(SQLite app.db) (127.0.0.1:9000, 로컬 전용)
pm2 start tools/ecosystem.config.js                   # 현행 dev(3100/9000)
# 레거시 운영 v1.0.0(3101/9001, .legacy-v1/)을 나란히 굴리려면:
pm2 start deploy/ecosystem.legacy-v1.config.js        # kei-guide-legacy · kei-rag-api-legacy
pm2 save                                # 현재 프로세스 목록 저장
# 부팅 자동시작은 'pm2 startup'(systemd) 별도 1회 필요 (아직 미설정일 수 있음)
# 백업 대상: tools/app.db(사용자·채팅·근거·피드백·플래그) + tools/.app_secret(JWT 키). pm2 restart 해도 디스크 영속 → 사용자/기록 유지

# 사내망 접근 허용 (ufw active). RAG API(9000)는 열지 않습니다.
sudo ufw allow 3100/tcp                  # 또는 192.168.1.0/24 한정 허용
```

같은 오리진 프록시(`/api/rag/*`·`/api/app/*`, 쿠키·set-cookie와 쿼리 보존)라 **CORS가 불필요**하고, RAG API(9000)는 LAN에 직접 노출되지 않습니다. 로그인 세션은 **httpOnly 쿠키**(samesite=lax, 내부망 HTTP라 secure=False — Cloudflare ZT/HTTPS 도입 시 secure=True 권장)에 담깁니다. 운영 정석은 여전히 nginx 127.0.0.1 + Cloudflare Zero Trust이며, `server.js`/PM2는 사내망 직접 서빙 또는 nginx 백엔드로 쓸 수 있습니다.

> [!note] 선택적 Open WebUI 폴백
> Open WebUI는 기본 채택하지 않습니다(브랜딩 보호 라이선스 이슈). 필요 시 같은 RAG API를 쓰는 **관리자용 폴백**으로만 둘 수 있으며, 설정 > 연결 > OpenAI API 에 Base URL `http://<서버 실제 IP>:9000/v1` · API Key `EMPTY` · Model ID `kei-admin-rag`를 등록합니다(연결 URL에 `localhost`/`host.docker.internal` 대신 실제 IP 사용). 배포 절차 전체는 [deploy/README.md](deploy/README.md).

---

## 레포 구조

```text
KEIAdminSuperv/
├── KEI-행정가이드/            # 🔒 내부 전용 볼트 — git 비추적(.gitignore)·Syncthing 동기화. 공개 구조 예시는 vault-example/
│   ├── 10_업무가이드/          #   가치층 — 연구행정 가이드(HWP/PDF/PPTX 변환 + 사람 작성)
│   ├── 20_규정원문/            #   진실원천(HWP 변환, 의역 금지, 규정번호 1000~7999)
│   ├── 30_용어집/              #   개념 1개 = 노트 1개 (행정/시스템 용어)
│   ├── 40_시스템/              #   ERP 메뉴·기능(모듈별 노트, 섹션 '시스템'·보라)
│   └── 90_관리/                #   템플릿·개정이력·Dataview 인덱스 (_templates는 청킹 제외)
├── tools/                     # 🛠️ 파이프라인
│   ├── 01_hwp_to_md.py        #   규정 변환: HWP/HWPX → 20_규정원문/
│   ├── 01b_autolink.py        #   규정 상호참조 → [[ ]] (그래프 엣지)
│   ├── 01c_guides_to_md.py    #   가이드 변환: HWP/HWPX/PDF(PyMuPDF)/PPTX → 10_업무가이드/
│   ├── 01d_erp_to_md.py       #   ERP 기능분석 → 40_시스템/ 모듈별 노트(type:system)
│   ├── 01e_erp_crosslink.py   #   ERP 모듈↔관련 규정 교차링크
│   ├── 01f_terms_to_md.py     #   용어집 → 30_용어집/ 용어별 노트(type:term)
│   ├── 01g_terms_crosslink.py #   용어↔ERP 모듈/규정 교차링크
│   ├── 02_chunk_and_embed.py  #   청킹(규정 제N조 / 가이드·ERP·용어 헤딩) + KURE-v1 임베딩 + Chroma
│   ├── 03_rag_query.py        #   CLI 질의
│   ├── rag_core.py            #   검색·생성 공용 코어: backend()·retrieve()(리랭커 P1.4·쿼리 재작성 P1.5·ERP 라벨 P2.4)·answer()/answer_stream()(SSE)·면책 강제
│   ├── bm25_index.py          #   하이브리드(BM25+RRF) opt-in 인프라(평가상 이득 없어 기본 off)
│   ├── app_api.py             #   SQLModel 모델 + bcrypt/PyJWT 인증 + 채팅·피드백(P2.1)·플래그·통계(P2.5) 라우터(prefix=/app) + init_db()
│   ├── 04_rag_api.py          #   진입점(FastAPI): OpenAI 호환 /v1 + app_api(/app) include + init_db()
│   ├── review_queue.py        #   검수 우선순위 큐(읽기전용, P1.2) — --feedback 으로 👎 신호 가산
│   ├── review_tool.py         #   검수 도구(검수 '완료'는 사람만 — 자동 확정 금지)
│   ├── feedback_export.py     #   app.db Feedback → .feedback_signals.json(gitignore) → review_queue 우선순위
│   ├── reembed_note.py        #   노트 1건 재임베딩(검수 반영용)
│   ├── test_feedback.py · test_stats.py · test_rag_core.py  #   백엔드 테스트(FastAPI TestClient+임시DB, LLM 불필요)
│   ├── ecosystem.config.js    #   PM2 설정(kei-guide·kei-rag-api, env로 Ollama 연결)
│   ├── requirements.txt
│   ├── app.db                 #   🔒 SQLite 사용자·채팅·근거·피드백·플래그 (gitignore)
│   ├── .app_secret            #   🔒 JWT 서명키 0600, 없으면 자동 생성 (gitignore)
│   ├── .feedback_signals.json #   🔒 피드백 신호(규정 스니펫 포함) (gitignore)
│   └── chroma/                #   벡터DB (gitignore)
├── web/                       # 🧠 [뇌]+[LLM] Next.js 14 + TDS 앱 (Pages Router·SSG, output:export)
│   ├── lib/vault.ts           #   볼트를 빌드타임 read-only로 읽음(VAULT_DIR, 기본 레포 루트)
│   ├── lib/api.ts             #   LLM API 타입 클라이언트(plain fetch)
│   ├── components/Login.tsx   #   로그인·회원가입 화면
│   ├── components/ChatApp.tsx #   대화목록 사이드바 + 멀티턴(SSE 스트리밍) 채팅 + 👍/👎 피드백 + 금액 경고·수치 강조 + 메시지별 근거 패널 + 문서 드로어
│   ├── lib/flags.tsx          #   기능 플래그 런타임 fetch(useFlag, 안전기본값+localStorage캐시)
│   ├── lib/site.ts            #   단일 출처 CORPUS_AS_OF(규정집 기준일, footer 표기)
│   ├── pages/admin.tsx        #   운영자 대시보드(P2.5)·기능 플래그 토글(관리자 전용)
│   ├── scripts/emit-docdata.mts #  빌드 시 lib/vault.ts 재사용해 out/docdata/<slug>.json 생성
│   ├── server.js              #   의존성0 Node 정적서버: out/ 서빙 + /api/rag/*·/api/app/* → :9000 프록시(0.0.0.0:3100)
│   ├── styles/globals.css     #   KEI 시맨틱 토큰(CSS 변수, 라이트/다크 분기) — KEI 메인 컬러는 이 한 블록만 교체
│   ├── verify-*.mjs           #   Playwright 실렌더 검증(스크린샷+픽셀)
│   └── (node_modules·.next·out·out/docdata/*.json 은 .gitignore)
├── eval/                      # 📊 평가 하베스트: run.sh·run_eval.py(Hit/Recall/MRR, --rerank/--rewrite/--hybrid/--judge), golden.jsonl(gitignore)
├── deploy/                    # 🚀 배포
│   ├── setup_ubuntu_hwp.sh    #   HWP 변환 환경(LibreOffice + H2Orestart) 셋업
│   ├── ecosystem.legacy-v1.config.js  #   레거시 v1.0.0 PM2(kei-*-legacy, 3101/9001 → .legacy-v1/)
│   ├── docker-compose.yml     #   Open WebUI (선택적 관리자 폴백)
│   └── README.md
├── .legacy-v1/                # 🧊 동결된 운영 v1.0.0 사본(완전 격리, 3101/9001, gitignore)
├── vault-example/             # 🧪 공개용 합성 볼트 예시(실데이터 0) — 구조 시연
├── docs/                      # 📚 설계·계획 문서 (+ adr/)
├── SECURITY.md                # 🔒 데이터 분류·위협모델·통제
├── README.md                  # ← 지금 이 문서
├── CLAUDE.md                  # 작업 규칙·절대 규칙
├── WORKPLAN.md                # 작업 계획·진행 상황
└── .gitignore
```

위 볼트는 **핵심 2-layer**(`10_업무가이드/` ↔ `20_규정원문/`)에 **보조 3폴더**(`30_용어집/`·`40_시스템/`·`90_관리/`)를 더한 구조입니다. 화면의 '구분' 섹션은 **규정집·연구행정 가이드·용어집·ERP 시스템** 4개입니다.

> [!tip]
> 콘텐츠는 한국어이고 **한글 파일명**을 씁니다. git이 한글 경로를 깨뜨리지 않도록 `git config core.quotepath false`를 적용하세요.

---

## 파이프라인 한눈에

```mermaid
flowchart LR
    HWP["HWP/HWPX 규정"] --> S01["01 → 20_규정원문/"]
    GD["HWP/PDF/PPTX 가이드"] --> S1C["01c → 10_업무가이드/"]
    ERP["ERP 기능분석 md"] --> S1D["01d → 40_시스템/"]
    TRM["용어집 md"] --> S1F["01f → 30_용어집/"]
    S01 --> XL["01b/01e/01g<br/>교차링크(위키링크)<br/>→ 그래프 엣지"]
    S1C --> XL
    S1D --> XL
    S1F --> XL
    XL --> S02["02 청킹(규정 제N조 / 가이드·ERP·용어 헤딩)<br/>+ KURE-v1 임베딩"]
    S02 --> Chroma[("Chroma kei_regs<br/>hnsw:space=cosine · 약 4,400청크")]
    Chroma --> S04["04_rag_api.py(진입점)<br/>rag_core 검색·생성 + app_api 인증·채팅(/app)<br/>OpenAI 호환 /v1 :9000"]
    S04 --> Ollama["Ollama 127.0.0.1:11434/v1<br/>Qwen2.5-14B-Instruct Q4_K_M"]
    S04 --> DB[("SQLite tools/app.db<br/>user·chatsession·message<br/>(근거 = message.sources_json)")]
    S04 --> Chat["웹앱 / (Assistant)<br/>멀티턴·스트리밍·메시지별 근거·문서 드로어"]
```

- **01 변환:** `hwp-hwpx-parser`로 본문 추출, 표는 `extract_text`가 본문에 인라인 마크다운으로 삽입(제N조 청킹과 정합). 가이드는 PDF(PyMuPDF)·PPTX(python-pptx)도 처리(`01c`), 스캔 이미지 PDF는 `image-pdf` 플레이스홀더. 표/별표가 깨지면 LibreOffice + H2Orestart로 PDF를 만들고 그 페이지를 VLM(`Qwen2.5-VL`)에 넘겨 **표만** 재추출.
- **02 청킹:** 규정은 **조문 1개 = 청크 1개**(`제N조`), 가이드·ERP·용어는 **헤딩(####/##) 단위**(없으면 문단 패킹). 고정 길이 청킹 금지. **별표/별지는 1급 청크로 분리**(P1.3, 조=`별표 N`, `refs`=인용 조문, 토글 `CHUNK_BYEOLPYO`). **긴 청크는 하위청킹**(P2.3, `max_seq_len` 초과 시 항(①②)→호→문단→줄 순으로 분할, 조 라벨·메타 유지, 표는 분할 안 함, 토글 `CHUNK_SUBSPLIT`).
- **교차링크(01b/01e/01g):** 규정 상호참조 + ERP 모듈↔규정 + 용어↔ERP/규정을 `[[ ]]`로 연결 → 관계 그래프의 엣지(271 노드·275 연결, 4색 섹션).
- **03/04 질의:** 검색(Chroma `kei_regs`, KURE-v1, 밀집 top-20) → **리랭커**(P1.4, `BAAI/bge-reranker-v2-m3` cross-encoder, 온프레미스 GPU) 재점수 → top-5 → `[규정명 제N조]` 블록으로 근거 컨텍스트 구성 → Ollama가 답하고 출처를 강제 표기. 후속 질문은 **멀티턴 쿼리 재작성**(P1.5, `condense_query`)으로 독립 검색어로 바꿔 검색합니다(검색어만 바꾸고 답변·근거는 불변). 시스템(ERP) 근거에는 `(ERP 시스템)` 라벨을 붙여 메뉴·경로를 답변에 안내합니다(P2.4, 근거에 있을 때만). 응답에는 구조화 출처 `x_sources`(규정명/조/분류/type/snippet/distance)와 하위호환 `x_retrieved`(태그 문자열)가 포함됩니다. 면책 문구는 `_ensure_disclaimer`로 100% 보장(스트리밍 `answer_stream`도 동일).
- **멀티턴:** 세션의 이전 메시지를 LLM에 재생(replay)해 맥락을 잇되, **사실 근거는 매 턴 새로 검색한 `[근거]`에서만** 가져옵니다(가드레일 유지). OpenAI 호환 `/v1` 엔드포인트도 마지막 user 메시지로 검색하고 그 앞을 맥락으로 전달합니다.
- **채팅 API(`/app`, server.js가 `/api/app/*` → `/app/*` 프록시):** 인증 `POST /app/auth/register`·`login`·`logout`·`GET /app/auth/me`, 대화 `GET·POST /app/chats`·`GET·PATCH·DELETE /app/chats/{id}`, 메시지 `POST /app/chats/{id}/messages`(`?stream=1`이면 SSE: `meta`→`delta`…→`done`; 검색+멀티턴 생성 → user/assistant 메시지 저장, assistant에 근거 `sources` 첨부, 첫 질문으로 대화 제목 자동 설정), 피드백 `POST·DELETE /app/messages/{id}/feedback`, 관리자 `GET /app/feedback`·`GET /app/stats`·플래그 토글.

---

## 검수 · 피드백 · 운영 대시보드 (품질 → 신뢰 → 자기개선)

같은 코퍼스·같은 API 위에 "측정 가능한 정확함"과 "사람 검수 루프"를 얹은 트랙입니다. 상세는 [docs/12-품질강화.md](docs/12-품질강화.md)·[docs/14-feedback-loop.md](docs/14-feedback-loop.md).

- **검수 큐(P1.2):** `review_queue.py`(읽기전용)가 미검수 노트를 우선순위 점수(유형·별표·미분류·피인용 + 👎 피드백)로 정렬, `review_tool.py`로 검수합니다. ⛔ 검수 '완료'는 **사람만** — 자동 확정 금지.
- **답변 피드백(P2.1):** 채팅 답변에 **👍/👎(+사유)**. `Feedback` 테이블(사용자·메시지당 1건 upsert/toggle, 소유 격리). `feedback_export.py` → `tools/.feedback_signals.json`(gitignore) → `review_queue.py --feedback`가 자주 틀린 규정을 검수 큐 상단으로. ⛔ 검수상태 자동 변경 없음.
- **금액 신뢰 강화(P2.2):** 금액/한도 답변에 경고 + 근거 스니펫 수치 강조(`<mark>`) + 근거별 검수상태 배지. 모두 `docdata`로 처리(재임베딩 불필요). footer의 **📑 규정집 기준일**은 단일 출처 `web/lib/site.ts` `CORPUS_AS_OF`.
- **운영자 대시보드(P2.5):** `/admin`에 활동·**거부율**(`REFUSAL_RE` 감지)·👍/👎·인기 질문·콘텐츠 갭. `GET /app/stats`(관리자 전용). 거부/👎/인기 질문이 검수 큐·콘텐츠 로드맵으로 환류되는 **자기개선 루프**.
- **🔒 개인정보(P2.5):** 서버사이드 RAG라 진짜 E2E 암호화는 불가(LLM이 평문 필요). 대신 ⓐ 관리자도 **타인 채팅을 읽는 엔드포인트가 없고**(`get_chat` 소유자 검증), ⓑ `/stats`·`/feedback`은 질문·답변 **본문을 반환하지 않으며**(규정 메타·집계만), ⓒ 인기 질문/갭은 **서로 다른 사용자 K명 이상**(`STATS_MIN_USERS` 기본 3)인 **k-익명 집계**만 노출합니다.
- **기능 플래그(P, [docs/13](docs/13-feature-flags.md)):** 코드 레지스트리 `FLAG_REGISTRY` + SQLite `Flag`/`FlagAudit`. 공개 `GET /app/flags`(비민감 불리언만), 관리자 토글/감사(`current_admin`, `APP_ADMINS` **fail-closed** — 미설정 시 아무도 관리자 아님). 프론트는 정적 export라 빌드에 안 박고 `lib/flags.tsx` `useFlag`로 런타임 fetch, `/admin`에서 즉시 토글.

> [!note] 평가·테스트
> 평가 하베스트 [eval/](eval/README.md)(`run.sh`·`run_eval.py` — Hit/Recall/MRR strict=규정명+조 / relaxed=규정명, `--rerank`/`--rewrite`/`--hybrid`, `--judge`로 LLM-judge 충실도·거부율). 리랭커 적용 후 strict Hit@1 0.600→0.829·@5 1.000, 면책 보장 0.806→1.000(실패 시 안전 강등). 백엔드 테스트는 [tools/test_feedback.py](tools/test_feedback.py)·[tools/test_stats.py](tools/test_stats.py)(FastAPI TestClient+임시DB, LLM 불필요). 골든셋 `eval/golden.jsonl`은 gitignore.

---

## 운영 버전 — 현행 dev · 레거시 v1.0.0

포트를 새로 열거나 통째로 동결하지 않고, 다음 버전을 안정 운영과 **나란히** 굴립니다(상세 [deploy/README.md](deploy/README.md)).

| 트랙 | 프론트 | RAG API | 위치 | PM2 |
| --- | --- | --- | --- | --- |
| **현행 dev** (`feat/0620`) | `3100` | `9000` | 레포 본체 | `kei-guide` · `kei-rag-api` |
| **레거시 운영** `v1.0.0` | `3101` | `9001` | `.legacy-v1/`(동결 사본, gitignore) | `kei-guide-legacy` · `kei-rag-api-legacy` |

레거시는 자체 `app.db`·`.app_secret`·`chroma`·`out`을 가진 **완전 격리** 사본으로, 현행 작업이 운영 사용자/기록에 영향을 주지 않습니다. 레거시 기동은 `pm2 start deploy/ecosystem.legacy-v1.config.js`.

---

## 문서 지도

설계·계획 문서는 모두 `docs/`에 있습니다. 시작은 [docs/README.md](docs/README.md)(인덱스).

| # | 제목 | 한 줄 요약 | 링크 |
| --- | --- | --- | --- |
| 01 | 개요 | 프로젝트 배경·목표·범위 | [01-overview.md](docs/01-overview.md) |
| 02 | 아키텍처 | 하나의 볼트, 두 개의 화면 | [02-architecture.md](docs/02-architecture.md) |
| 03 | 콘텐츠 모델 | 볼트 구조(핵심 2-layer + 보조 3폴더, 4개 섹션)·프론트매터 스키마 | [03-content-model.md](docs/03-content-model.md) |
| 04 | 파이프라인 | 변환·청킹·임베딩 흐름 | [04-pipeline.md](docs/04-pipeline.md) |
| 05 | RAG 설계 | 검색·근거 주입·가드레일 | [05-rag-design.md](docs/05-rag-design.md) |
| 06 | 배포 | Next.js+TDS 웹앱(web/out/)·server.js/PM2·nginx | [06-deployment.md](docs/06-deployment.md) |
| 07 | 보안·거버넌스 | Zero Trust·검수·권한 | [07-security-governance.md](docs/07-security-governance.md) |
| 08 | 로드맵 | 단계별 계획·우선순위 | [08-roadmap.md](docs/08-roadmap.md) |
| 09 | 기여 가이드 | 협업·커밋·검수 절차 | [09-contributing.md](docs/09-contributing.md) |
| 10 | 운영 | 재빌드·갱신·장애 대응 | [10-operations.md](docs/10-operations.md) |
| 11 | 용어집 | 프로젝트 용어 정의 | [11-glossary.md](docs/11-glossary.md) |
| 12 | 품질 강화 | 평가·검수·별표·리랭커·쿼리 재작성·하위청킹(P1.1~P2.3) | [12-품질강화.md](docs/12-품질강화.md) |
| 13 | 기능 플래그 | 한 코드베이스에서 기능 토글(설계 + 운영 매뉴얼) | [13-feature-flags.md](docs/13-feature-flags.md) |
| 14 | 피드백 루프 | 👍/👎 신호 → 검수 큐 환류(P2.1) | [14-feedback-loop.md](docs/14-feedback-loop.md) |
| — | 디자인 시스템 | [뇌] 화면(web/) 디자인 원칙·TDS 토큰·컴포넌트 규약 | [design-system.md](docs/design-system.md) |

**아키텍처 결정 기록(ADR):** [docs/adr/README.md](docs/adr/README.md) — 임베딩 모델, 조문 단위 청킹, 통제형 RAG API, 그래프 사이트(이전 Quartz → 현재 Next.js+TDS), 온프레미스 Zero Trust 등 주요 결정의 근거.

> [!tip] 독자별 추천 경로
> - **신입·행정 담당자:** 01 → 03 → 11
> - **개발자:** 02 → 04 → 05 → ADR
> - **운영자:** 06 → 07 → 10

---

## 기술 스택

| 영역 | 선택 | 비고 |
| --- | --- | --- |
| 변환 | `hwp-hwpx-parser` | `.hwp`/`.hwpx` 모두. 표 깨지면 LibreOffice + H2Orestart + `Qwen2.5-VL` |
| 임베딩 | `nlpai-lab/KURE-v1` | 대안 `BAAI/bge-m3`. 양자화 안 함, `normalize_embeddings=True` |
| 벡터DB | Chroma `PersistentClient` | collection `kei_regs`, 메타 `hnsw:space=cosine` |
| LLM 서빙 | **Ollama** (OpenAI 호환) | **현재 가동** `http://127.0.0.1:11434/v1`, 모델 `hf.co/bartowski/Qwen2.5-14B-Instruct-GGUF:Q4_K_M`(~9GB). 2×RTX 6000은 **공유·변동적**이라 모델·리랭커 배치 전 `nvidia-smi`로 여유를 확인하세요(CLAUDE.md의 고정 GPU 줄은 신뢰하지 말 것). 14B fp16(약 28GB)은 단일 24GB 초과 → 양자화(Q4) 또는 2장 텐서병렬 필요. **대안 서빙: vLLM**(`--tensor-parallel-size 2` 등) |
| 한국어 LLM 대안 | EXAONE / Kanana | 코더·VL 모델 아님 |
| RAG API | FastAPI + uvicorn | `04_rag_api.py`(진입점), `MODEL_ID=kei-admin-rag`, 포트 9000(127.0.0.1 로컬 전용). 백엔드 3분리: `rag_core.py`(검색·생성 공용 코어) + `app_api.py`(인증·채팅 라우터 `/app`) + `04_rag_api.py`(`/v1` + `/app` include). 한 PM2 프로세스 `kei-rag-api`, 설정 `tools/ecosystem.config.js` |
| 인증·채팅기록 | bcrypt + PyJWT(HS256) + SQLModel + SQLite | httpOnly 쿠키(samesite=lax, 내부망 HTTP라 secure=False). DB `tools/app.db` 테이블 `User`·`ChatSession`·`Message`(근거는 `message.sources_json`)·`Feedback`·`Flag`·`FlagAudit`, 서명키 `tools/.app_secret`(0600, 자동 생성). passlib 미사용(bcrypt 5 호환), fastapi-users 미사용. 둘 다 gitignore·백업 대상 |
| 리랭커 | `BAAI/bge-reranker-v2-m3` (cross-encoder) | P1.4, 온프레미스 GPU(주로 cuda:1). 밀집 top-20 → 재점수 → top-5. `RAG_RERANK`, 실패 시 밀집 강등. 하이브리드(BM25+RRF, `bm25_index.py`)는 평가상 이득 없어 기본 off(opt-in) |
| 정적 서빙 | `web/server.js` (의존성0 Node) | out/ 서빙 + trailingSlash 라우팅 + `/api/rag/*`(무상태)·`/api/app/*`(로그인·채팅, 쿠키 전달) → 127.0.0.1:9000 리버스 프록시, 0.0.0.0:3100. PM2 `kei-guide` |
| LLM UI | 웹앱 `/` (앱 통합) | 로그인 게이트 → 멀티턴 RAG 채팅 + 대화목록 사이드바 + 메시지별 근거 패널 + 문서 드로어(같은 TDS). Open WebUI(Docker)는 선택적 관리자 폴백 |
| 웹앱([뇌]+[LLM]) | Next.js 14 + TDS (Node v22+) | `web/`, Pages Router·SSG(`output:export`), React 18 고정. `@toss/tds-mobile` v2.5.0 + `TDSMobileAITProvider`, CSS 변수 토큰 + CSS Modules, 콘텐츠는 react-markdown + remark-gfm. LLM은 plain fetch + React hooks(React Query 미도입) — `lib/api.ts`·`Login.tsx`·`ChatApp.tsx`·`Assistant.tsx`(인증 게이트). 페이지 `/`·`/browse`·`/graph`·`/d/[slug]`, DocDrawer + `out/docdata/*.json`. 관계 그래프 react-force-graph-2d. `web/out/` 산출 → server.js 또는 nginx 127.0.0.1 |
| 청킹 보조 | `kss`(선택) | 한국어 문장 분리 |
| 런타임 | Python venv `tools/.venv` | deps `tools/requirements.txt`(추가: `sqlmodel>=0.0.22`, `pyjwt>=2.9.0`, `bcrypt>=4.0`) |

---

## ⛔ 절대 규칙 (요약)

전체 규칙과 근거는 [CLAUDE.md](CLAUDE.md)에 있습니다. 본문·예시 어디서도 약화시키지 마세요.

1. **규정 내용을 지어내지 않는다.** 금액·한도·기한·조건을 추측해 쓰지 않는다. 원문이 없으면 `「TODO: 원문 확인」` placeholder를 둔다.
2. **원문층(`20_규정원문/`)은 의역 금지.** HWP 원문을 그대로 옮긴다.
3. **모든 가이드/답변에 출처를 단다.** 가이드는 `[[규정명#제N조]]` 위키링크, RAG 답변은 끝에 `[규정명 제N조]` + 면책 문구.
4. **RAG 가드레일을 약화시키지 않는다.** 근거에 없는 내용(특히 금액·한도·기한)은 "규정에서 확인되지 않습니다"라고 답한다.
5. **내부 규정 — 어떤 화면도 인터넷 공개 금지.** 공개를 권하는 서술을 하지 않는다.

---

## 보안 / 내부 전용

> [!warning]
> KEI 내부 규정입니다. **[뇌]·[LLM]이 통합된 Next.js+TDS 웹앱을 인터넷 공개 금지.**

- 웹앱은 **Cloudflare Zero Trust Access** 정책 뒤(또는 사내망 한정)에 둡니다.
- 같은 오리진 프록시(`server.js /api/rag/*`·`/api/app/*`)라 CORS가 불필요하고, RAG API(9000)는 LAN에 직접 노출되지 않습니다(127.0.0.1 전용). 방화벽은 `ufw allow 3100/tcp`만 열고 9000은 닫습니다.
- LLM 로그인은 **bcrypt 비밀번호 해시 + PyJWT(HS256) httpOnly 쿠키**(samesite=lax, 내부망 HTTP라 secure=False — Cloudflare ZT/HTTPS 도입 시 secure=True 권장). ZT 식별자(`Cf-Access-Authenticated-User-Email`)는 향후 옵션(LAN 직접접속 dev는 비밀번호 로그인 유지). 미인증 요청은 401.
- **`tools/app.db`(사용자·채팅·근거·피드백·플래그)·`tools/.app_secret`(JWT 서명키)·`tools/.feedback_signals.json`(피드백 신호)은 커밋 금지**(모두 .gitignore). app.db·.app_secret은 운영 백업 대상이며, 디스크에 영속되어 `pm2 restart` 후에도 사용자/기록이 유지됩니다.
- **🔒 개인정보(P2.5):** 서버사이드 RAG라 진짜 E2E 암호화는 불가하지만, ⓐ 관리자도 **타인 채팅을 읽는 엔드포인트가 없고**(`get_chat` 소유자 검증), ⓑ `/app/stats`·`/app/feedback`은 질문·답변 **본문을 반환하지 않으며**(규정 메타·집계만), ⓒ 인기 질문/콘텐츠 갭은 **서로 다른 사용자 K명 이상**(`STATS_MIN_USERS` 기본 3)인 **k-익명 집계**만 노출합니다. 관리자 권한은 **fail-closed**(`APP_ADMINS` 미설정 시 아무도 관리자 아님).
- **CORS 주의:** `allow_credentials=True`를 와일드카드 오리진과 함께 켜지 마세요. 쿠키 인증은 same-origin(`server.js` 프록시)으로만 동작합니다.
- 모델·임베딩·벡터DB가 전부 **온프레미스(Quadro RTX 6000 24GB×2)**라 데이터는 망 밖으로 나가지 않습니다. 답변은 사내 GPU의 Ollama로 생성합니다.

자세한 정책은 [07-security-governance.md](docs/07-security-governance.md) 및 [ADR 0005](docs/adr/0005-on-prem-zero-trust.md).

> [!todo] 확인 필요: Cloudflare 팀/도메인명, 서버 호스트명·IP, GPU 수량 등 운영 환경의 구체 값은 미정. 배포 전 확정해 [06-deployment.md](docs/06-deployment.md)에 반영.

---

## 상태 & 로드맵

- 프로젝트 시작: **2026-06-18**
- 현재 단계: **파이프라인 + LLM 가동** — P1 변환·P2 임베딩·P3 검색/API 검증 완료, 답변 생성은 **Ollama(Qwen2.5-14B-Instruct Q4_K_M)**로 한국어까지 검증 완료. [뇌] 화면을 Quartz → **Next.js 14 + TDS(`web/`)** 로 이관 완료 — 목록(TDS SearchField·SegmentedControl 검색/섹션탭, 가독성 행)·문서(메타 칩·본문·백링크·제N조 앵커 점프)·관계 그래프(react-force-graph-2d, 노드 클릭→문서 이동, 코드 스플릿) 동작. **LLM(`/`)에 로그인·회원가입 + 채팅기록 영속화 + 멀티턴 기억 + 답변(메시지)별 근거 저장 추가** — 좌측 대화목록·중앙 멀티턴 채팅·우측 메시지별 근거 패널·문서 드로어, `/browse` 필터·드로어 통합. 백엔드 3분리(`rag_core`/`app_api`/`04_rag_api`, 한 프로세스 `kei-rag-api`) + bcrypt/PyJWT 쿠키 인증 + SQLite(`app.db`)·서명키(`.app_secret`). `server.js` `/api/rag/*`·`/api/app/*` 프록시 + PM2(kei-guide·kei-rag-api) 상시 가동. **검증 완료: register→login→멀티턴(이전 답변 참조)→기록 영속→메시지별 근거→미인증 401, 프록시 경유까지 통과.** 이후 **응답 스트리밍(SSE: meta→delta→done)** · **다크모드/테마(라이트·다크·시스템, FOUC 방지)** · **모델 프리로드(keep-alive 상주 → 첫 질문 콜드스타트 제거)** 추가. 코퍼스를 4개 섹션으로 확장 — **연구행정 가이드 64(HWP/PDF/PPTX 변환), 용어집 84(용어 1개=노트 1개), ERP 시스템 12(별도 보라 섹션, 화면ID·기능)** + **ERP↔규정 · 용어↔ERP 교차링크**로 그래프 강화(**271 문서 · 275 연결**). 이어서 **품질·신뢰 트랙**: 검수 우선순위 큐(P1.2)·별표 1급 청크(P1.3)·**리랭커(P1.4, strict Hit@1 0.600→0.829)**·멀티턴 쿼리 재작성(P1.5)·답변 피드백 루프(P2.1)·금액 신뢰 강화(P2.2)·긴 조문 하위청킹(P2.3, 재색인 약 **4,400 청크**)·ERP 메뉴 연결(P2.4)·**운영자 대시보드 + 개인정보 보호(P2.5, 본문 비노출·k-익명)**. 운영은 **현행 dev(3100/9000)와 레거시 v1.0.0(3101/9001, `.legacy-v1/` 완전 격리)**을 나란히 가동. 테스트는 **Playwright 실렌더 검증**(스크린샷+픽셀)·백엔드 테스트(`test_feedback`/`test_stats`)·평가 하베스트(`eval/`)를 표준 절차로 채택. 다음: **검수(전부 미검수 — 규정 미분류 번호 배정, 가이드/용어/ERP 초안 확정)** · 외부 접속 안정화(Cloudflare 엣지 설정 — Rocket Loader 등) · KEI 메인 컬러 토큰 교체(미정) · `/` first-load ~440KB 번들 경량화 · pm2 startup(부팅 자동시작) · 일부 변환 실패 파일 LibreOffice 폴백(타임아웃 1·이미지PDF 1)

```mermaid
gantt
    title 로드맵 (개략 · 구체 일정 미정)
    dateFormat YYYY-MM-DD
    section 콘텐츠
    볼트 구조·템플릿 정비             :done, a1, 2026-06-18, 1d
    규정 원문 변환(111)               :done, a2, after a1, 1d
    가이드·용어집·ERP 추가(64·84·12)  :done, a3, after a2, 1d
    교차링크(ERP↔규정·용어↔ERP)       :done, a4, after a3, 1d
    검수·미분류 규정번호 배정         :active, a5, after a4, 21d
    section 시스템
    파이프라인 01~02(검색까지)        :done, b1, after a1, 1d
    Ollama 생성 연결·검증             :done, b2, after b1, 1d
    웹앱 [뇌]+[LLM](Next.js+TDS)      :done, b3, after b1, 1d
    인증·채팅기록·멀티턴·스트리밍     :done, b4, after b3, 1d
    다크모드/테마·모델 프리로드       :done, b5, after b4, 1d
    section 품질·신뢰
    검수큐·별표·리랭커·쿼리재작성(P1) :done, q1, after b5, 1d
    피드백·금액강화·하위청킹·ERP(P2)  :done, q2, after q1, 1d
    대시보드·개인정보 보호(P2.5)      :done, q3, after q2, 1d
    section 운영
    현행/레거시 PM2·Cloudflare ZT     :active, c1, after b3, 14d
    외부접속 안정화·부팅 자동시작     :         c2, after c1, 7d
```

> [!note]
> 위 간트는 순서를 보여주는 개략도입니다. 구체 날짜·인원은 미정 — 진행 상황은 [WORKPLAN.md](WORKPLAN.md), 단계별 계획은 [08-roadmap.md](docs/08-roadmap.md)에서 관리합니다.

---

## 내부 전용 고지

본 저장소와 모든 산출물은 **KEI(한국환경연구원) 내부 전용**입니다. 별도 오픈소스 라이선스를 부여하지 않으며, 조직 외부로의 배포·공개·재사용을 금합니다. 협업은 권한이 부여된 계정에 한합니다.

---

## 관련 문서

**문서 인덱스:** [docs/README.md](docs/README.md) · **작업 규칙:** [CLAUDE.md](CLAUDE.md) · **작업 계획:** [WORKPLAN.md](WORKPLAN.md)

| 이전 | 다음 |
| --- | --- |
| — (최상위 진입 문서) | [docs/01-overview.md →](docs/01-overview.md) |

---

최종 수정: 2026-06-21 (품질·신뢰 트랙(P1.2~P2.5: 검수큐·리랭커·쿼리재작성·피드백·금액강화·하위청킹·ERP연결·대시보드·개인정보)·운영 버전(현행 dev / 레거시 v1.0.0)·Node22 빌드 주의 반영, 문서 현행화)
