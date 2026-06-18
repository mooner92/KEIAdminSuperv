# 08 로드맵

> KEI 행정 가이드 / 행정 비서를 어떤 순서로, 무엇에 의존해 만들 것인가에 대한 전략 뷰입니다.
> 마일스톤(M0~M5)을 실행 계획서([WORKPLAN](../WORKPLAN.md))의 단계(P0~P5)에 매핑하고, 의존성과 산출물을 정리합니다.

이 문서는 "큰 그림"입니다. 구체적인 작업 항목·체크리스트·담당은 [WORKPLAN](../WORKPLAN.md)에서 관리하고, 여기서는 마일스톤·타임라인·의존성만 다룹니다.

> [!note]
> 전체 기준 시작일은 **2026-06-18**입니다. 아래 타임라인의 절대 날짜는 단정하지 않으며, 상대적 순서와 대략적 기간(주 단위)으로만 표기합니다. 인력·일정 확정 전까지는 모두 추정치입니다.

---

## 마일스톤 개요 (M0~M5 ↔ WORKPLAN P0~P5)

이 시스템은 **하나의 볼트, 두 개의 화면**을 향해 단계적으로 자랍니다.
([뇌] Quartz 그래프 사이트 / [비서] Open WebUI + vLLM)

| 마일스톤 | WORKPLAN 단계 | 한 줄 목표 | 핵심 산출물 | 완료 판정(Exit) | 상태 |
| --- | --- | --- | --- | --- | --- |
| **M0 — 기반 정비** | [P0](../WORKPLAN.md#p0--준비환경) | 볼트 구조·템플릿·툴 환경 확정 | 레포 스켈레톤, 프론트매터 템플릿, `tools/.venv` | 템플릿대로 노트 1건 수기 작성 가능 | ✅ 완료 |
| **M1 — 콘텐츠 변환** | [P1](../WORKPLAN.md#p1--원문-변환) | HWP → 마크다운 원문층 채우기 | `20_규정원문/` 마크다운(검수상태: 미검수) | 샘플 규정이 조문 단위로 읽힘 | ✅ 완료(111/112, 1건 fallback 대기) |
| **M2 — 색인(임베딩)** | [P2](../WORKPLAN.md#p2--청킹임베딩) | 제N조 단위 청킹 + 벡터 색인 | Chroma 컬렉션 `kei_regs` | `02`로 색인, `03`으로 질의 응답 확인 | ✅ 완료(3044 청크) |
| **M3 — 통제형 RAG API** | [P3](../WORKPLAN.md#p3--rag-질의평가) | 출처 강제·가드레일 탑재 API | `tools/04_rag_api.py` (OpenAI 호환) | `/v1/chat/completions`가 출처 포함 응답 | ✅ 검색/API 완료(생성은 vLLM 대기) |
| **M4 — 두 화면 배포** | [P4](../WORKPLAN.md#p4--배포) | [뇌]·[비서] 온프레미스 기동 | Quartz `public/` + nginx, Open WebUI(Docker) | 사내망에서 두 화면 모두 접속 | ⬜ 예정 |
| **M5 — 검수·운영 안착** | [P5](../WORKPLAN.md#p5--운영유지보수-순환) | 검수 워크플로·접근통제·운영 | 검수 완료 콘텐츠, Zero Trust 라우트, 운영 문서 | 행정 초보가 출처 달린 답을 신뢰하고 사용 | ⬜ 예정(전건 미검수) |

> [!note]
> **실측 진행(2026-06-19, 개발 머신).** M1~M3 핵심 경로가 실제 데이터로 동작합니다: HWP/HWPX **111개 변환**(1건 timeout 격리), 조문 단위 **3044 청크** 임베딩(`kei_regs`), 검색 회수가 정확합니다(예: "출장 여비 정산" → 여비규정 제9조). 답변 **생성**만 Quadro RTX 6000(24GB) 2장 서버의 vLLM 연결을 기다립니다. 관련 커밋: `6750748`(변환)·`9226c42`(임베딩)·`fa18378`(검색/API).

### 남은 일 (다음 단계)

1. **미분류 37개 규정번호 배정** — 인사규정·복무규정 등 핵심 규정 포함(M1 후속, 사람 작업).
2. **timeout 1파일 fallback** — 여비업무처리기준 파일을 LibreOffice+H2Orestart→PDF→VLM으로 표 복원.
3. **vLLM 연결·답변 생성 검증** — Quadro RTX 6000 서버 vLLM 엔드포인트 연결 후 생성 단계 검증(M3 마무리).
4. **원문 검수** — 변환 전건 `미검수` → 표본 대조 후 `검수완료` 승격(M5).
5. **업무 가이드 작성** — `10_업무가이드/`에 `[[규정명#제N조]]` 위키링크 인용으로 초안.
6. **배포(P4) / 운영(P5)** — 두 화면 기동·Zero Trust·재임베딩/백업/모니터링 루틴.

---

## 타임라인 (상대 기간)

기준일 **2026-06-18**부터의 상대 순서/기간입니다. 날짜는 추정이며 인력 확정 시 갱신합니다.

```mermaid
gantt
    title KEI 행정 가이드 / 행정 비서 — 마일스톤 타임라인 (기준일 2026-06-18, 상대 기간)
    dateFormat YYYY-MM-DD
    axisFormat W%W
    todayMarker off

    section M0 기반 정비 (P0)
    볼트 구조·템플릿 확정      :done, m0a, 2026-06-18, 1w
    tools 환경(.venv/deps)     :done, m0b, after m0a, 1w

    section M1 콘텐츠 변환 (P1)
    01 변환 스크립트 다듬기     :done, m1a, after m0b, 2w
    HWP→MD 원문층 111개(미검수) :done, m1b, after m1a, 2w
    timeout 1건 PDF→VLM fallback :active, m1c, after m1b, 1w

    section M2 색인 (P2)
    02 청킹·임베딩(KURE-v1)     :done, m2a, after m1a, 1w
    Chroma kei_regs 3044청크    :done, m2b, after m2a, 1w

    section M3 통제형 RAG API (P3)
    03 검색 회수 검증(정확)     :done, m3a, after m2b, 1w
    04 RAG API(가드레일/출처)   :done, m3b, after m3a, 2w
    vLLM 연결·답변 생성 검증    :active, m3c, after m3b, 1w

    section M4 두 화면 배포 (P4)
    Quartz build → nginx       :m4a, after m1b, 2w
    Open WebUI + RAG API 연결   :m4b, after m3c, 1w

    section M5 검수·운영 (P5)
    검수 워크플로(미검수→검수완료):m5a, after m1b, 3w
    미분류 37개 규정번호 배정    :m5c, after m1b, 1w
    Zero Trust/RBAC·운영 안착   :m5b, after m4b, 2w
```

> [!tip]
> M2(색인)는 M1 변환이 일부만 완료돼도 착수할 수 있습니다. "조금 변환 → 조금 색인 → 질의 확인"으로 짧게 반복하는 편이 한 번에 전부 변환하는 것보다 안전합니다. 검수(M5)는 콘텐츠가 생기는 즉시 병행 시작합니다.

> [!todo]
> 확인 필요: 각 마일스톤의 실제 캘린더 일정·담당 인원. 인원/구체 일정은 미정이므로 위 기간은 상대 순서 표현용 placeholder입니다(M0~M2는 실측 완료, `done` 표시).

---

## 단계 의존성 그래프

무엇이 무엇을 막는지(blocking)를 보여줍니다. 핵심 경로는 **변환 → 청킹·임베딩 → 통제형 API → 비서 화면**입니다.

```mermaid
flowchart TD
    M0["M0 기반 정비 ✅<br/>(볼트·템플릿·venv)"]

    M0 --> M1["M1 콘텐츠 변환 ✅<br/>20_규정원문 111개 (미검수)"]
    M1 --> M2["M2 색인 ✅<br/>제N조 청킹 + Chroma kei_regs (3044)"]
    M2 --> M3["M3 통제형 RAG API<br/>검색·출처 ✅ / 답변 생성은 vLLM 대기"]

    M1 --> M4b["[뇌] Quartz build → nginx"]
    M3 --> M4a["[비서] Open WebUI + vLLM 연결"]

    M4a --> M4["M4 두 화면 배포"]
    M4b --> M4
    M4 --> M5["M5 검수·운영 안착<br/>검수완료 · Zero Trust · 운영"]

    M1 -. "콘텐츠 생기는 대로 병행" .-> M5

    classDef core fill:#e8f0ff,stroke:#3366cc,stroke-width:1px;
    classDef screen fill:#eafbe7,stroke:#2e8b57,stroke-width:1px;
    classDef done fill:#eafbe7,stroke:#2e8b57,stroke-width:2px;
    class M0,M1,M2,M3 core;
    class M4a,M4b,M4 screen;
    class M0,M1,M2 done;
```

핵심 관찰:

- **[뇌] Quartz는 색인/RAG와 무관하게 진행 가능.** Quartz는 같은 마크다운 볼트를 정적 사이트로 만들 뿐이라 M1만 충분히 차면 배포할 수 있습니다.
- **[비서]는 M3(통제형 API)에 의존.** 채팅은 그림이 아니라 텍스트+임베딩 검색으로 답하므로, 색인(M2)과 출처 강제 API(M3)가 선행돼야 합니다. 현재 검색·근거주입·출처는 검증됐고, 마지막 **답변 생성**만 Quadro RTX 6000 vLLM 서버 연결을 기다립니다.
- **검수(M5)는 콘텐츠 생성과 병행.** 변환·생성물은 검수 전까지 `검수상태: 미검수`를 유지하며, 검수는 M1 이후 상시 진행합니다.

---

## 마일스톤별 산출물 상세

### M0 — 기반 정비 · [P0](../WORKPLAN.md#p0--준비환경)

볼트 구조와 작업 환경을 확정합니다. 이후 모든 단계의 토대입니다.

- 레포 스켈레톤: `KEI-행정가이드/`(`10_업무가이드` / `20_규정원문` / `30_용어집` / `90_관리`), `tools/`, `deploy/`, `docs/`.
- 프론트매터 템플릿 3종(`90_관리/_templates/`): `regulation` · `guide` · `term`.
- 파이썬 환경: `tools/.venv`, 의존성 [`tools/requirements.txt`](../tools/requirements.txt).
- 한글 파일명 정책: `git config core.quotepath false`.
- 참조: [02 아키텍처](02-architecture.md), [03 콘텐츠 모델](03-content-model.md).

> [!note]
> `_templates`는 청킹·임베딩 대상에서 제외됩니다(스크립트가 자동 제외).

### M1 — 콘텐츠 변환 · [P1](../WORKPLAN.md#p1--원문-변환)

HWP 규정 원문을 마크다운 원문층(`20_규정원문/`)으로 변환합니다.

- 산출물: 규정별 `<번호>_<제목>.md`(프론트매터 `type: regulation`, `검수상태: 미검수`, 경고 콜아웃 포함). 입력 `rule_files/` 112개(.hwp 53 + .hwpx 59) 중 **111개 변환 성공**, 1개 timeout 스킵.
- 도구: [`tools/01_hwp_to_md.py`](../tools/01_hwp_to_md.py) — `hwp-hwpx-parser 1.0.0`로 본문/표 추출(표는 인라인 마크다운으로 포함되므로 별도 부록 표를 덧붙이지 않음 — 중복 방지), `reg_num_from_name`·`parse_date`·`clean_title` 로 규정번호·개정일·제목 추출, 첫자리 기준 분류 매핑. 신규 플래그 `--dry-run` / `--limit` / `--timeout`(파일당 초).
- 규정번호: **파일명 맨 앞 4자리(현행 공식 코드)만 신뢰.** 본문에 박힌 `NNNN-` 코드는 과거/내부 코드라 현행과 충돌해 미사용(예: 복무규정 본문 3200 ↔ 파일명 3200=공로연수운영지침).
- 분류 결과(파일수): 1000_기관 3, 2000_감사·규정 5, 3000_인사 23, 4000_보수·여비 8, 5000_연구·정보 12, 6000_총무·보안·회계 23, **0000_미분류 37**. 미분류에는 번호 없는 가이드/기준/지침과 함께 인사규정·직제규정·복무규정·위임전결규정 등 핵심 규정도 포함 → 사람이 규정번호 배정 필요.
- 표/별표 깨짐 대응: LibreOffice + H2Orestart로 PDF 변환 → 해당 페이지를 VLM(`Qwen2.5-VL`)에 넘겨 표만 마크다운 재추출. 현재 1건(파서 무한루프로 timeout 격리된 여비업무처리기준 파일)이 이 fallback 대상.
- 참조: [04 파이프라인](04-pipeline.md).

> [!warning]
> 원문층(`20_규정원문/`)은 **의역 금지**입니다. 변환물은 진실원천이므로 표현을 다듬지 말고, 불확실하면 「TODO: 원문 확인」 placeholder로 남깁니다. 금액·한도·기한은 추측해 채우지 않습니다. 변환 전건은 `검수상태: 미검수`입니다.

> [!todo]
> 남은 일: **미분류 37개에 규정번호 배정**(인사규정·복무규정 등 핵심 규정 포함), **timeout 1파일 PDF→VLM fallback** 처리. 변환 자체는 실행 완료(커밋 `6750748`).

### M2 — 색인(청킹·임베딩) · [P2](../WORKPLAN.md#p2--청킹임베딩)

규정을 조문 단위로 쪼개 벡터로 색인합니다.

- 도구: [`tools/02_chunk_and_embed.py`](../tools/02_chunk_and_embed.py). 실측 **3044 청크** = 조문청크 2933 + 머리말 111(문서 111개). 첫 제N조 앞 머리말(규정명·제정/개정 이력·표)은 조=`""` 청크.
- 청킹: **제N조 단위(조문 1개 = 청크 1개)**. 고정 길이 청킹 금지. `guide`/`term`은 노트 전체 1청크. 01이 넣은 H1 제목·변환 경고 콜아웃은 임베딩 전 제거(노이즈 감소).
- 임베딩: `nlpai-lab/KURE-v1`(XLM-RoBERTa·BGE-M3 계열, 컨텍스트 8192), `normalize_embeddings=True`, 양자화 안 함. GPU `cuda:0`에서 약 32초.
- 메모리: 큰 batch + 긴 조문은 CUDA OOM 유발 → **batch 8 + max_seq_len 2048**(+`expandable_segments`)로 해결. 2048 토큰 초과 **41개는 임베딩 시 잘림** → 향후 하위청킹 과제.
- 벡터DB: Chroma `PersistentClient`, 컬렉션 `kei_regs`(3044 items, `hnsw:space=cosine`). 클린 리빌드 기본(`--no-reset`로 해제) — id=경로#순번(위치기반)이라 조문 가감 시 stale 방지를 위해 전체 재생성. `tools/chroma/`(약 44MB)는 gitignore(재생성 가능). 메타데이터 키: 규정명·규정번호·조·분류·개정일·검수상태·type·path.
- 참조: [04 파이프라인](04-pipeline.md), [ADR 0001](adr/0001-embedding-kure-v1.md), [ADR 0002](adr/0002-article-level-chunking.md).

### M3 — 통제형 RAG API · [P3](../WORKPLAN.md#p3--rag-질의평가)

출처 표기와 가드레일을 시스템이 강제하는 OpenAI 호환 API를 만듭니다.

- 도구: [`tools/03_rag_query.py`](../tools/03_rag_query.py)(CLI 검증) → [`tools/04_rag_api.py`](../tools/04_rag_api.py)(FastAPI, `MODEL_ID=kei-admin-rag`).
- **검색 회수 실측(정확)** — `03 --retrieve-only`, 거리=코사인(작을수록 유사):
  - "출장 여비는 어떻게 정산하나요?" → 여비규정 제9조(0.243)
  - "휴양시설은 누가 이용할 수 있나요?" → 휴양시설 운영요령 제3조(0.240)
  - "육아시간은 하루에 몇 시간?" → 복무규정 제19조의2(0.268)
  - "퇴직금은 어떻게 산정?" → 퇴직금규정 제4조(0.253)
  - "내부감사는 누가 어떻게?" → 내부감사규정 제17조(0.348) · "법인카드 분실하면?" → 법인카드관리및사용규칙 제3조(0.354)
- `03` 신규: `--retrieve-only`(LLM 없이 검색만), 거리 표시, 환경변수 `VLLM_BASE`/`LLM_MODEL` 오버라이드, LLM 실패 시 친절 안내.
- LLM 서빙: vLLM(OpenAI 호환, 기본 `http://localhost:8000/v1`), 모델 `Qwen/Qwen2.5-14B-Instruct` 등 일반 instruct(한국어 특화 대안 EXAONE/Kanana).
- 엔드포인트: `/health`, `/v1/models`, `/v1/chat/completions`(비스트리밍 스켈레톤, SSE는 향후). 백엔드(임베딩/Chroma/LLM)는 지연 로딩 → `/v1/models` 즉시 응답. vLLM 미연결이어도 `x_retrieved`(회수 출처)를 그레이스풀하게 반환(운영자가 원인 파악). 환경변수 `CHROMA_DIR`/`RAG_COLLECTION`/`EMBED_MODEL`/`VLLM_BASE`/`LLM_MODEL`/`RAG_MODEL_ID`/`RAG_TOPK`.
- 참조: [05 RAG 설계](05-rag-design.md), [ADR 0003](adr/0003-controlled-rag-api.md).

> [!note]
> **검색·근거주입·출처는 검증됨, 답변 생성은 vLLM 대기.** 이 서버(`data05lx`)는 Quadro RTX 6000 24GB×2(총 48GB, 단일 통합 메모리 아님)를 장착하고 있으나 아직 vLLM이 미기동이라 실제 "답변 생성" 단계는 미검증입니다. 생성 검증은 이 서버의 vLLM 엔드포인트 연결 후 진행합니다. 참고로 Qwen2.5-14B-Instruct fp16(약 28GB)은 RTX 6000 단일 24GB를 초과하므로 2장 텐서병렬(`tensor-parallel-size=2`) 또는 더 작은 instruct(7B/3B)·양자화 서빙이 필요하며, 임베딩(KURE-v1)은 1장으로 충분합니다(실측). 검색/API는 실행 완료(커밋 `fa18378`).

> [!warning]
> 가드레일은 약화 금지입니다. [근거]에 없는 내용(특히 금액·한도·기한)은 지어내지 않고 "규정에서 확인되지 않습니다"라고 답하며, 답변 끝에 `[규정명 제N조]` 출처와 "최종 판단은 원문과 담당 부서 확인 바랍니다." 면책을 반드시 붙입니다.

### M4 — 두 화면 배포 · [P4](../WORKPLAN.md#p4--배포)

[뇌]와 [비서]를 온프레미스에서 기동합니다.

- **[뇌] Quartz v5**(Node v22+): 볼트를 `content`로 심볼릭 링크 → `npx quartz build` → `public/` → nginx. 노드/링크 그래프 + 전문검색.
- **[비서] Open WebUI**(Docker, `ghcr.io/open-webui/open-webui:main`): `04_rag_api.py`를 OpenAI 호환 모델로 등록. 연결 Base URL은 `localhost`/`host.docker.internal`이 아니라 **서버 실제 IP** 사용.
- 모델·임베딩은 전부 사내 GPU(Quadro RTX 6000 24GB×2)에서 구동.
- 참조: [06 배포](06-deployment.md), [ADR 0004](adr/0004-quartz-graph-site.md), [`deploy/README.md`](../deploy/README.md), [`deploy/docker-compose.yml`](../deploy/docker-compose.yml).

> [!todo]
> 확인 필요: 서버 호스트명/IP(예시 `data05lx` 외 확정값), GPU 수량(Quadro RTX 6000 24GB×2 외), Cloudflare 팀/도메인명.

### M5 — 검수·운영 안착 · [P5](../WORKPLAN.md#p5--운영유지보수-순환)

콘텐츠 신뢰성과 접근 통제, 운영 절차를 갖춥니다.

- 검수 워크플로: `검수상태: 미검수` → 사람이 원문 대조 후 `검수완료`로 승격. 가이드는 항상 `[[규정명#제N조]]` 위키링크로 원문 근거 표시. 현재 변환 **전건 미검수**라 검수는 아직 시작 전이며, 미검수 콘텐츠를 비서 답변 근거로 노출하지 않습니다.
- 미분류 37개 **규정번호 배정**(P1 산출의 후속 인적 작업): 핵심 규정(인사규정·직제규정·복무규정·위임전결규정·직원평가규칙·유연근무제운영규칙 등)이 0000_미분류에 남아 있어 사람이 현행 코드를 배정해야 분류·검색 메타가 정확해집니다.
- 접근 통제: 두 화면 모두 Cloudflare Zero Trust Access 뒤 + Open WebUI RBAC/SSO. 온프레미스라 데이터는 망 밖으로 나가지 않음.
- 운영: 색인 재빌드 주기, 변환 검수 큐, 백업 등.
- 참조: [07 보안·거버넌스](07-security-governance.md), [10 운영](10-operations.md), [09 기여 가이드](09-contributing.md), [ADR 0005](adr/0005-on-prem-zero-trust.md).

> [!warning]
> 내부 규정 자료입니다. [뇌]·[비서] 어떤 화면도 인터넷에 공개하지 않습니다. 두 화면 모두 사내 전용으로만 노출합니다.

---

## 향후 확장 백로그 (아이디어)

아래는 핵심 마일스톤 완료 이후를 위한 **아이디어 목록**입니다. 일정·확정 범위가 아니며, 우선순위는 미정입니다.

| 아이디어 | 무엇을 위한 것인가 | 비고 |
| --- | --- | --- |
| **리랭커(reranker)** | 회수 상위 조문을 한 번 더 정렬해 정확도 향상 | 벡터 검색 → 교차 인코더 재정렬. 모델 선정 미정 |
| **평가 자동화** | 출처 일치·할루시네이션 회귀를 CI에서 측정 | 질문/정답 셋 구축 필요. 가드레일 준수 자동 검사 |
| **알림(notification)** | 규정 개정 시 관련 가이드 검토 환기 | 개정일 변경 감지 → 담당자 알림. 채널 미정 |
| **다국어** | 한국어 외 사용자 대응(예: 영문 질의) | 사용자 노출 콘텐츠 기본은 한국어 유지 원칙 |
| **SSE 스트리밍** | 비서 응답 체감 속도 개선 | `04_rag_api.py`의 `/v1/chat/completions` 스트리밍 구현 |
| **Dataview 인덱스 강화** | `90_관리`의 자동 인덱스/대시보드 확장 | 검수 진척·미검수 큐 가시화 |
| **하이브리드 검색** | 키워드(BM25) + 벡터 결합 | 조문 번호·고유명사 회수율 보강 |

> [!note]
> 이 백로그 항목은 핵심 경로(M0~M5)를 막지 않습니다. M5 안착 후 가치/비용을 보고 선별 도입합니다.

---

## 관련 문서

- 문서 인덱스: [docs/README.md](README.md)
- 실행 계획서: [../WORKPLAN.md](../WORKPLAN.md) · 저장소 개요: [../README.md](../README.md) · 작업 규약: [../CLAUDE.md](../CLAUDE.md)
- 이전: [07 보안·거버넌스](07-security-governance.md)
- 다음: [09 기여 가이드](09-contributing.md)

---

최종 수정: 2026-06-19
