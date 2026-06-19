# KEI 행정 가이드 · 행정 비서

> 행정 초보(신입·전입자)가 "이 업무 어떻게 처리하지?"를 **사내 규정 근거로** 빠르게 해결하도록 돕는 온프레미스 지식베이스 + 로컬 LLM 비서.
>
> 단일 진실원천(Source of Truth)인 마크다운 볼트 하나를, 사람이 탐색하는 **[뇌] 그래프·문서**와 신입이 물어보는 **[비서] RAG 채팅**으로 동시에 서빙합니다. 두 화면 모두 한 개의 **Next.js 14 + TDS 앱(`web/`)**에 통합되어 있습니다 — 비서는 별도 Open WebUI가 아니라 우리 RAG API를 호출하는 앱 내 채팅 화면입니다. 답변 생성은 **Ollama**(Qwen2.5-14B-Instruct Q4_K_M, OpenAI 호환), 검색 임베딩은 **KURE-v1**로 모두 사내 GPU(Quadro RTX 6000 24GB×2)에서 돌고, 화면은 Cloudflare Zero Trust 뒤(사내 전용)에 둡니다.

| 항목 | 상태 |
| --- | --- |
| 상태 | 🟢 파이프라인 + 비서 가동 — 변환·임베딩·검색 검증 완료, RAG API(Ollama)로 한국어 답변 생성 검증 완료 |
| 코퍼스 | 규정 원문 **111개** 변환 · **3,044** 조문·머리말 청크 임베딩(KURE-v1) |
| 배포 | 🔒 사내 전용 (인터넷 공개 금지) |
| 모델 | 🖥️ 온프레미스 GPU (Quadro RTX 6000 24GB×2, 총 48GB) · 답변 Ollama(Qwen2.5-14B-Instruct Q4_K_M) |
| 조직 | KEI · 한국환경연구원 (Korea Environment Institute) |
| 레포 | github.com/mooner92/KEIAdminSuperv |

---

## 누구를 위한 것

- **주 사용자 — 행정 초보(신입·전입자):** 출장 정산, 비품 구매, 휴가·복무 같은 행정 업무를 처음 맡았을 때 "어느 규정의 무슨 조항을 봐야 하나?"를 채팅으로 물어보고, **출처가 붙은 답변**을 받습니다.
- **탐색이 필요한 담당자:** 규정들이 어떻게 연결되는지 그래프로 둘러보고, 전문검색으로 원문을 직접 확인합니다.
- **이 시스템을 만드는 개발자/운영자:** 이 README에서 출발해 `docs/`의 설계·계획 문서로 들어갑니다.

> [!note]
> 비서가 주는 답은 **출발점**입니다. 답변 끝에는 항상 사용한 출처(`[규정명 제N조]`)와 "최종 판단은 원문과 담당 부서 확인 바랍니다."가 붙습니다.

---

## 핵심 개념 — 하나의 볼트, 두 개의 화면

단일 진실원천은 레포 안의 마크다운 볼트 `KEI-행정가이드/` 하나뿐입니다. 같은 마크다운을 두 화면이 각자의 방식으로 "먹습니다".

볼트는 **핵심 2-layer**(가치층 `10_업무가이드/` ↔ 진실원천 `20_규정원문/`)에 **보조 2폴더**(`30_용어집/`·`90_관리/`)가 더해진 구조입니다. 즉 폴더가 4개라고 해서 별개의 4계층이 아니라, 같은 볼트를 "4폴더 = 핵심 2-layer + 보조 2폴더"로 보는 같은 구조입니다(정본 표현은 [CLAUDE.md](CLAUDE.md)의 "2-layer").

```mermaid
flowchart TD
    Vault["📁 KEI-행정가이드/<br/>(마크다운 볼트 = 단일 진실원천)"]

    Vault --> App["Next.js 14 + TDS 앱 (web/)<br/>한 앱, 두 화면"]

    App --> Brain["[뇌] /browse·/graph·/d/[slug]<br/>관계 그래프 + 필터·검색 + 문서 드로어<br/>사람이 탐색"]
    App --> Assistant["[비서] / (Assistant)<br/>RAG 채팅 + 근거 조문 패널<br/>행정 초보가 사용"]

    Brain --> Static["web/out/ 정적 산출물<br/>(+ out/docdata/*.json)"]
    Assistant --> Proxy["server.js /api/rag/* 프록시<br/>→ 127.0.0.1:9000"]
    Proxy --> RAG["tools/04_rag_api.py<br/>Chroma 검색 → Ollama 생성 → 출처 강제"]

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
> - 웹앱(`web/`, Next.js 14 + TDS) 빌드·실행에는 **Node v22+**가 필요합니다.

### 1) 파이프라인 (tools/)

```bash
git clone https://github.com/mooner92/KEIAdminSuperv.git
cd KEIAdminSuperv
git config core.hooksPath .githooks   # 내부 콘텐츠 커밋 차단 훅 활성화 (1회)

python -m venv tools/.venv && source tools/.venv/bin/activate
pip install -r tools/requirements.txt
# torch는 드라이버에 맞는 CUDA 빌드로 (드라이버가 CUDA 12.x면 cu124 휠):
pip install torch --index-url https://download.pytorch.org/whl/cu124

# 01) HWP/HWPX → 마크다운 (볼트 20_규정원문/ 아래로). 깨진 파일은 --timeout 으로 격리
python tools/01_hwp_to_md.py --src rule_files --vault KEI-행정가이드

# 02) 제N조 청킹 + KURE-v1 임베딩 + Chroma 적재 (GPU 권장)
python tools/02_chunk_and_embed.py --vault KEI-행정가이드 --db tools/chroma

# 03) 검색만 점검 (LLM 불필요) → 정확한 규정·제N조 회수 확인
python tools/03_rag_query.py --db tools/chroma --q "출장 여비는 어떻게 정산하나요?" --retrieve-only
# 03) 전체 RAG (Ollama 필요)
python tools/03_rag_query.py --db tools/chroma --q "법인카드로 주말에 비품 사도 되나요?"

# 04) OpenAI 호환 RAG API (웹앱 비서 백엔드) — 운영은 PM2로 상시 가동
#     127.0.0.1:9000(로컬 전용, LAN 비노출). env(Ollama 연결)는 tools/ecosystem.config.js 참조
pm2 start tools/ecosystem.config.js          # 프로세스 kei-rag-api 기동
# (수동 실행이 필요하면) cd tools && uvicorn 04_rag_api:app --host 127.0.0.1 --port 9000
```

> [!note] 실측 (2026-06-19)
> 규정 원문 **111개** 변환(+1개는 파서 무한루프로 `--timeout` 격리 → LibreOffice fallback 대상), **3,044 청크** 임베딩, 검색 정확(예: "출장 여비 정산" → 여비규정 제9조). **답변 생성**은 Ollama(Qwen2.5-14B-Instruct Q4_K_M)로 한국어 답변까지 검증 완료. 파이프라인 상세는 [docs/04-pipeline.md](docs/04-pipeline.md).

### 2) 웹앱 — [뇌]와 [비서]를 한 앱으로 (web/)

이전 방식(Quartz)을 대체하는 현재 웹앱은 레포의 `web/`(Next.js 14 + Toss Design System)입니다. [뇌](그래프·문서)와 [비서](RAG 채팅)가 같은 앱·같은 TDS 디자인 안에 통합되어 있습니다. 볼트는 빌드타임에 read-only로 읽습니다(`VAULT_DIR`, 기본값은 레포 루트).

페이지·컴포넌트:

- **`/` = 비서(Assistant):** RAG 채팅 + 우측 **근거 조문 패널**(응답의 `x_sources`를 카드로 표시). 근거 카드를 클릭하면 Notion형 **문서 드로어**가 해당 조(제N조 앵커)로 펼쳐집니다. 같은 오리진 `/api/rag/chat`를 클라이언트에서 fetch(정적 export에서도 동작). 비스트리밍 v1.
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
#  - server.js(의존성0 Node 정적서버, out/ 서빙 + trailingSlash 라우팅 + /api/rag/* → 127.0.0.1:9000 프록시, 0.0.0.0:3100)
#  - 또는 web/out/ 을 nginx 127.0.0.1 로 서빙 → Cloudflare Zero Trust 뒤(사내 전용)
```

> [!note] 실측 (2026-06-19)
> `next build` 성공 — 정적 **115페이지**(목록·관계 그래프·문서 111) + `out/docdata/*.json`. 한글 mojibake 0, 위키링크 내부 네비 + 제N조 앵커 동작, 관계 그래프 **111 노드·82 연결**, TDS 컬러 적용. `/` 첫 first-load JS 약 **433KB**(TDS + react-markdown, 경량화는 로드맵 항목). 디자인 원칙·토큰·컴포넌트 규약은 [docs/design-system.md](docs/design-system.md).

### 3) 서빙 — PM2로 상시 가동

비서는 별도 앱이 아니라 위 웹앱 `/` 화면입니다. 운영은 PM2가 두 프로세스를 관리합니다.

```bash
# kei-guide  : web/server.js — out/ 정적 서빙 + /api/rag/* → 127.0.0.1:9000 리버스 프록시 (0.0.0.0:3100)
# kei-rag-api: tools/04_rag_api.py(uvicorn) — Chroma 검색 + Ollama 생성 (127.0.0.1:9000, 로컬 전용)
pm2 start tools/ecosystem.config.js
pm2 save                                # 현재 프로세스 목록 저장
# 부팅 자동시작은 'pm2 startup'(systemd) 별도 1회 필요 (아직 미설정일 수 있음)

# 사내망 접근 허용 (ufw active). RAG API(9000)는 열지 않습니다.
sudo ufw allow 3100/tcp                  # 또는 192.168.1.0/24 한정 허용
```

같은 오리진 프록시라 **CORS가 불필요**하고, RAG API(9000)는 LAN에 직접 노출되지 않습니다. 운영 정석은 여전히 nginx 127.0.0.1 + Cloudflare Zero Trust이며, `server.js`/PM2는 사내망 직접 서빙 또는 nginx 백엔드로 쓸 수 있습니다.

> [!note] 선택적 Open WebUI 폴백
> Open WebUI는 기본 채택하지 않습니다(브랜딩 보호 라이선스 이슈). 필요 시 같은 RAG API를 쓰는 **관리자용 폴백**으로만 둘 수 있으며, 설정 > 연결 > OpenAI API 에 Base URL `http://<서버 실제 IP>:9000/v1` · API Key `EMPTY` · Model ID `kei-admin-rag`를 등록합니다(연결 URL에 `localhost`/`host.docker.internal` 대신 실제 IP 사용). 배포 절차 전체는 [deploy/README.md](deploy/README.md).

---

## 레포 구조

```text
KEIAdminSuperv/
├── KEI-행정가이드/            # 🔒 내부 전용 볼트 — git 비추적(.gitignore)·Syncthing 동기화. 공개 구조 예시는 vault-example/
│   ├── 10_업무가이드/          #   가치층(사람 작성, 항상 [[규정명#제N조]] 원문링크)
│   ├── 20_규정원문/            #   진실원천(HWP 변환, 의역 금지, 규정번호 1000~7999)
│   ├── 30_용어집/              #   개념 1개 = 노트 1개
│   └── 90_관리/                #   템플릿·개정이력·Dataview 인덱스 (_templates는 청킹 제외)
├── tools/                     # 🛠️ 파이프라인
│   ├── 01_hwp_to_md.py        #   변환: HWP → 마크다운
│   ├── 02_chunk_and_embed.py  #   청킹(제N조) + 임베딩 + Chroma 적재
│   ├── 03_rag_query.py        #   CLI 질의
│   ├── 04_rag_api.py          #   OpenAI 호환 RAG API (FastAPI) — Chroma 검색 → Ollama 생성
│   ├── ecosystem.config.js    #   PM2 설정(kei-guide·kei-rag-api, env로 Ollama 연결)
│   ├── requirements.txt
│   └── chroma/                #   벡터DB (gitignore)
├── web/                       # 🧠 [뇌]+[비서] Next.js 14 + TDS 앱 (Pages Router·SSG, output:export)
│   ├── lib/vault.ts           #   볼트를 빌드타임 read-only로 읽음(VAULT_DIR, 기본 레포 루트)
│   ├── scripts/emit-docdata.mts #  빌드 시 lib/vault.ts 재사용해 out/docdata/<slug>.json 생성
│   ├── server.js              #   의존성0 Node 정적서버: out/ 서빙 + /api/rag/* → :9000 프록시(0.0.0.0:3100)
│   ├── styles/globals.css     #   KEI 시맨틱 토큰(CSS 변수) — KEI 메인 컬러는 이 한 블록만 교체
│   └── (node_modules·.next·out·out/docdata/*.json 은 .gitignore)
├── deploy/                    # 🚀 배포
│   ├── setup_ubuntu_hwp.sh    #   HWP 변환 환경(LibreOffice + H2Orestart) 셋업
│   ├── docker-compose.yml     #   Open WebUI (선택적 관리자 폴백)
│   └── README.md
├── vault-example/             # 🧪 공개용 합성 볼트 예시(실데이터 0) — 구조 시연
├── docs/                      # 📚 설계·계획 문서 (+ adr/)
├── SECURITY.md                # 🔒 데이터 분류·위협모델·통제
├── README.md                  # ← 지금 이 문서
├── CLAUDE.md                  # 작업 규칙·절대 규칙
├── WORKPLAN.md                # 작업 계획·진행 상황
└── .gitignore
```

위 볼트의 네 폴더는 **핵심 2-layer**(`10_업무가이드/` ↔ `20_규정원문/`)에 **보조 2폴더**(`30_용어집/`·`90_관리/`)를 더한 같은 구조입니다 — "4폴더"와 "2-layer"는 동일한 볼트를 가리키는 다른 호칭입니다.

> [!tip]
> 콘텐츠는 한국어이고 **한글 파일명**을 씁니다. git이 한글 경로를 깨뜨리지 않도록 `git config core.quotepath false`를 적용하세요.

---

## 파이프라인 한눈에

```mermaid
flowchart LR
    HWP["HWP / HWPX 원본"] --> S01["01_hwp_to_md.py<br/>변환 → 20_규정원문/*.md"]
    S01 --> S02["02_chunk_and_embed.py<br/>제N조 청킹 + KURE-v1 임베딩"]
    S02 --> Chroma[("Chroma<br/>collection: kei_regs<br/>hnsw:space=cosine")]
    Chroma --> S03["03_rag_query.py<br/>CLI 질의"]
    Chroma --> S04["04_rag_api.py<br/>OpenAI 호환 RAG API :9000"]
    S04 --> Ollama["Ollama 127.0.0.1:11434/v1<br/>Qwen2.5-14B-Instruct Q4_K_M"]
    S04 --> Chat["웹앱 / (Assistant) 채팅<br/>via server.js /api/rag/*"]
```

- **01 변환:** `hwp-hwpx-parser`로 본문 추출, 표는 본문 끝 `## (부록) 표`로 처리. 표/별표가 깨지면 LibreOffice + H2Orestart로 PDF를 만들고 그 페이지를 VLM(`Qwen2.5-VL`)에 넘겨 **표만** 마크다운으로 재추출.
- **02 청킹:** **조문 1개 = 청크 1개**(`제N조` 단위). 고정 길이 청킹 금지. 가이드/용어는 노트 전체 1청크.
- **03/04 질의:** 검색(Chroma `kei_regs`, KURE-v1) → `[규정명 제N조]` 블록으로 근거 컨텍스트 구성 → Ollama가 답하고 출처를 강제 표기. 응답에는 구조화 출처 `x_sources`(규정명/조/분류/snippet/distance)와 하위호환 `x_retrieved`(태그 문자열)가 포함됩니다.

---

## 문서 지도

설계·계획 문서는 모두 `docs/`에 있습니다. 시작은 [docs/README.md](docs/README.md)(인덱스).

| # | 제목 | 한 줄 요약 | 링크 |
| --- | --- | --- | --- |
| 01 | 개요 | 프로젝트 배경·목표·범위 | [01-overview.md](docs/01-overview.md) |
| 02 | 아키텍처 | 하나의 볼트, 두 개의 화면 | [02-architecture.md](docs/02-architecture.md) |
| 03 | 콘텐츠 모델 | 볼트 구조(핵심 2-layer + 보조 2폴더)·프론트매터 스키마 | [03-content-model.md](docs/03-content-model.md) |
| 04 | 파이프라인 | 변환·청킹·임베딩 흐름 | [04-pipeline.md](docs/04-pipeline.md) |
| 05 | RAG 설계 | 검색·근거 주입·가드레일 | [05-rag-design.md](docs/05-rag-design.md) |
| 06 | 배포 | Next.js+TDS 웹앱(web/out/)·server.js/PM2·nginx | [06-deployment.md](docs/06-deployment.md) |
| 07 | 보안·거버넌스 | Zero Trust·검수·권한 | [07-security-governance.md](docs/07-security-governance.md) |
| 08 | 로드맵 | 단계별 계획·우선순위 | [08-roadmap.md](docs/08-roadmap.md) |
| 09 | 기여 가이드 | 협업·커밋·검수 절차 | [09-contributing.md](docs/09-contributing.md) |
| 10 | 운영 | 재빌드·갱신·장애 대응 | [10-operations.md](docs/10-operations.md) |
| 11 | 용어집 | 프로젝트 용어 정의 | [11-glossary.md](docs/11-glossary.md) |
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
| LLM 서빙 | **Ollama** (OpenAI 호환) | **현재 가동** `http://127.0.0.1:11434/v1`, 모델 `hf.co/bartowski/Qwen2.5-14B-Instruct-GGUF:Q4_K_M`(~9GB). GPU1에 Ollama(~18GB), GPU0는 비어 있음. 14B fp16(약 28GB)은 RTX 6000 단일 24GB 초과 → 양자화(Q4) 또는 2장 텐서병렬 필요. **대안 서빙: vLLM**(`--tensor-parallel-size 2` 등) |
| 한국어 LLM 대안 | EXAONE / Kanana | 코더·VL 모델 아님 |
| RAG API | FastAPI + uvicorn | `04_rag_api.py`, `MODEL_ID=kei-admin-rag`, 포트 9000(127.0.0.1 로컬 전용). PM2 `kei-rag-api`, 설정 `tools/ecosystem.config.js` |
| 정적 서빙 | `web/server.js` (의존성0 Node) | out/ 서빙 + trailingSlash 라우팅 + `/api/rag/*` → 127.0.0.1:9000 리버스 프록시, 0.0.0.0:3100. PM2 `kei-guide` |
| 비서 UI | 웹앱 `/` (앱 통합) | RAG 채팅 + 근거 조문 패널 + 문서 드로어(같은 TDS). Open WebUI(Docker)는 선택적 관리자 폴백 |
| 웹앱([뇌]+[비서]) | Next.js 14 + TDS (Node v22+) | `web/`, Pages Router·SSG(`output:export`), React 18 고정. `@toss/tds-mobile` v2.5.0 + `TDSMobileAITProvider`, CSS 변수 토큰 + CSS Modules, 콘텐츠는 react-markdown + remark-gfm. 페이지 `/`·`/browse`·`/graph`·`/d/[slug]`, DocDrawer + `out/docdata/*.json`. 관계 그래프 react-force-graph-2d. `web/out/` 산출 → server.js 또는 nginx 127.0.0.1 |
| 청킹 보조 | `kss`(선택) | 한국어 문장 분리 |
| 런타임 | Python venv `tools/.venv` | deps `tools/requirements.txt` |

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
> KEI 내부 규정입니다. **[뇌]·[비서]가 통합된 Next.js+TDS 웹앱을 인터넷 공개 금지.**

- 웹앱은 **Cloudflare Zero Trust Access** 정책 뒤(또는 사내망 한정)에 둡니다.
- 같은 오리진 프록시(`server.js /api/rag/*`)라 CORS가 불필요하고, RAG API(9000)는 LAN에 직접 노출되지 않습니다(127.0.0.1 전용). 방화벽은 `ufw allow 3100/tcp`만 열고 9000은 닫습니다.
- 모델·임베딩·벡터DB가 전부 **온프레미스(Quadro RTX 6000 24GB×2)**라 데이터는 망 밖으로 나가지 않습니다. 답변은 사내 GPU의 Ollama로 생성합니다.

자세한 정책은 [07-security-governance.md](docs/07-security-governance.md) 및 [ADR 0005](docs/adr/0005-on-prem-zero-trust.md).

> [!todo] 확인 필요: Cloudflare 팀/도메인명, 서버 호스트명·IP, GPU 수량 등 운영 환경의 구체 값은 미정. 배포 전 확정해 [06-deployment.md](docs/06-deployment.md)에 반영.

---

## 상태 & 로드맵

- 프로젝트 시작: **2026-06-18**
- 현재 단계: **파이프라인 + 비서 가동** — P1 변환·P2 임베딩·P3 검색/API 검증 완료, 답변 생성은 **Ollama(Qwen2.5-14B-Instruct Q4_K_M)**로 한국어까지 검증 완료. [뇌] 화면을 Quartz → **Next.js 14 + TDS(`web/`)** 로 이관 완료 — 목록(TDS SearchField·SegmentedControl 검색/섹션탭, 가독성 행)·문서(메타 칩·본문·백링크·제N조 앵커 점프)·관계 그래프(react-force-graph-2d, 노드 클릭→문서 이동, 코드 스플릿) 동작. **비서(`/`) RAG 채팅 + 근거 조문 패널 + 문서 드로어, `/browse` 필터·드로어 통합**, `server.js` 프록시 + PM2(kei-guide·kei-rag-api) 상시 가동. 위키링크 `[[ ]]` 내부 라우트 연결 + 이름 변이(공백·가운뎃점 ·`.`·및) 정규화(01b) 흡수. `next build` 정적 115페이지·그래프 111 노드·82 연결·한글 mojibake 0. 다음: 검수 · 미분류 37개 규정번호 배정 · 스트리밍(향후 assistant-ui 후보) · KEI 메인 컬러 토큰 교체(미정) · `/` first-load ~433KB(TDS) 경량화 · pm2 startup(부팅 자동시작) · 배포(P4)

```mermaid
gantt
    title 로드맵 (개략 · 구체 일정 미정)
    dateFormat YYYY-MM-DD
    section 콘텐츠
    볼트 구조·템플릿 정비        :done, a1, 2026-06-18, 1d
    HWP 원문 변환(111개)         :done, a2, after a1, 1d
    검수·미분류 규정번호 배정    :active, a3, after a2, 21d
    section 시스템
    파이프라인 01~04(검색까지)   :done, b1, after a1, 1d
    Ollama 생성 연결·검증        :done, b2, after b1, 1d
    웹앱 [뇌]+[비서] 통합         :done, b3, after b1, 1d
    Next.js+TDS 웹앱 배포         :active, b4, after b2, 14d
    section 운영
    Zero Trust·권한·감사         :         c1, after b3, 14d
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

최종 수정: 2026-06-19
