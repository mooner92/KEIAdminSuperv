# 배포 — 하나의 볼트, 두 개의 웹 화면

```
        볼트 (마크다운 = 단일 진실원천 · git 아님 → Syncthing 동기화, 내부 전용)
        ├──────────────► [뇌]  Quartz 정적 사이트  : 노드/링크 그래프 + 전문검색
        └──────────────► [비서] Open WebUI + vLLM   : 질문에 출처 달아 답변
   둘 다 data05lx(우분투)에서 서빙 · 둘 다 Cloudflare Zero Trust 뒤 (사내 전용)
```

> 참고: [뇌] 화면은 **Quartz에서 Next.js 14 + Toss Design System(`web/`)으로 교체**되었고,
> [비서]는 **vLLM 대신 Ollama(Qwen2.5-14B-Instruct)** 로 서빙한다. 아래 Quartz/vLLM 절은 초기 설계 기록이며,
> 실제 현행 실행은 PM2 + `web/server.js`(정적 export 서빙 + `/api/*` 리버스 프록시)다.

## 운영: 현행(개발) + 레거시 v1.0.0 — 두 포트 동시 운영

같은 서버에서 두 버전을 PM2로 나란히 띄운다. **완전 격리**(코드·벡터DB·채팅DB·세션키까지 분리)라 서로 영향이 없다.

| 버전 | 프론트 | RAG API | 소스 | PM2 프로세스 |
|---|---|---|---|---|
| **현행(개발)** `feat/<날짜>` | `3100` | `9000` | `web/` · `tools/` (작업 중인 트리) | `kei-guide` · `kei-rag-api` |
| **레거시 운영** `v1.0.0` | `3101` | `9001` | `/.legacy-v1/` (동결 사본, gitignore) | `kei-guide-legacy` · `kei-rag-api-legacy` |

둘 다 같은 Ollama(`127.0.0.1:11434`)를 공유한다 — 모델 가중치는 Ollama가 1벌만 GPU에 상주시키므로 GPU 추가 부담 없음(임베딩 KURE-v1만 프로세스별 1벌).

```bash
# 현행
pm2 start tools/ecosystem.config.js      # kei-rag-api  (9000)
pm2 start web/ecosystem.config.js        # kei-guide    (3100)
# 레거시 v1.0.0 (동결 사본 .legacy-v1/ 가 있어야 함 — 아래 '동결' 참조)
pm2 start deploy/ecosystem.legacy-v1.config.js   # kei-*-legacy (3101/9001)
pm2 save                                 # 프로세스 목록 영속화
```

### 레거시 v1.0.0 동결(재현 절차)

`v1.0.0` 태그(= `main` 36dc3fc) 시점을 통째로 `/.legacy-v1/`에 굽는다. 동결 사본은 런타임 산출물
(out/docdata 규정 원문 · chroma · app.db · 세션키 포함)이라 **`.gitignore` 처리**되고, 설정 파일
(`deploy/ecosystem.legacy-v1.config.js`)만 레포에 추적된다.

```bash
git checkout v1.0.0                 # 동결할 시점
cd web && VAULT_DIR=../KEI-행정가이드 npm run build && cd ..   # out/ 재생성(필요 시)
rm -rf .legacy-v1 && mkdir .legacy-v1
cp -r web/out .legacy-v1/out            # 동결 프론트(정적 빌드)
cp web/server.js .legacy-v1/            # 정적 서버
cp tools/rag_core.py tools/app_api.py tools/04_rag_api.py .legacy-v1/   # 동결 백엔드
cp -r tools/chroma .legacy-v1/chroma    # 동결 벡터DB
cp tools/app.db tools/.app_secret .legacy-v1/   # 동결 채팅DB·세션키
pm2 start deploy/ecosystem.legacy-v1.config.js && pm2 save
```

검증: `curl 127.0.0.1:9001/health` → `{"status":"ok"...}`, `curl -o/dev/null -w '%{http_code}' 127.0.0.1:3101/` → `200`,
그리고 `web/verify-legacy.mjs`(Playwright 실제 렌더 — 라이트/다크/그래프 픽셀 판정).

## 볼트 동기화 = Syncthing (비공개, git 아님)

볼트(`KEI-행정가이드/`)는 KEI 내부 규정이라 **공개 git 레포에 두지 않는다**(루트 [SECURITY.md](../SECURITY.md)). 대신 **Syncthing**으로 서버↔내 PC만 P2P로 동기화한다.

```bash
# 서버(data05lx)에서 — 관리 GUI는 로컬(127.0.0.1)만, 인터넷 노출 금지
docker compose -f deploy/syncthing-compose.yml up -d
```

> ⛔ GUI(8384)는 `127.0.0.1`에만 바인딩한다. 외부에서 볼 땐 SSH 터널로만: `ssh -L 8384:127.0.0.1:8384 <서버>` → 브라우저 `http://127.0.0.1:8384`. 기기 페어링(디바이스 ID 교환)은 **사람이 GUI에서 직접** 한다(자동/임의 페어링 금지).

### 내 PC에서 볼트 받기
1. Syncthing 설치 (<https://syncthing.net> — Windows/Mac/Linux).
2. 서버 GUI ↔ 내 PC GUI에서 **디바이스 ID를 서로 Add Device** 하여 페어링.
3. 서버가 공유한 **폴더(볼트)** 수신을 수락 → 내 PC 로컬 경로 지정.
4. 동기화 완료 후 **옵시디언에서 그 폴더(`KEI-행정가이드/`)를 보관소(Vault)로 열기** → 노드/링크 그래프·전문검색 사용.

규정 개정 → 서버 볼트 갱신 → Syncthing이 PC로 전파 → 옵시디언 확인·재임베딩.

## [뇌] 그래프 웹페이지 = Quartz
```bash
# Node v22+ 필요
git clone https://github.com/jackyzha0/quartz.git && cd quartz
npm i && npx quartz create        # 콘텐츠 폴더 지정
# 볼트를 content로 심볼릭 링크(옵시디언에서 편집 → 사이트 자동 반영)
ln -s /path/to/KEI-행정가이드 content
npx quartz build --serve          # 로컬 미리보기 :8080
npx quartz build                  # → public/ 정적 산출물
# public/ 을 nginx로 서빙하고 기존 Cloudflare Tunnel에 라우트 추가
```
한국어(CJK) 검색·그래프·백링크 기본 지원. 규정 개정 → 볼트 갱신 → 재빌드.

## [비서] 채팅 = Open WebUI (+ 기존 vLLM)
```bash
docker compose up -d        # open-webui + (선택)임베딩
```
모델 연결 두 갈래:
- **간편:** Open WebUI 내장 RAG. 볼트 마크다운을 'Knowledge'로 올리고, 임베딩 엔진을 KURE/BGE-M3로 지정. 청킹/출처 통제는 약함.
- **권장(감사용):** `tools/04_rag_api.py`(제N조 청킹 + [규정명 제N조] 출처 강제)를 OpenAI 호환 모델로 등록 → Open WebUI는 UI만, 정확성은 우리 RAG가.

> ⚠️ Open WebUI 연결 URL에 `localhost`/`host.docker.internal` 말고 **실제 IP**를 쓰세요(흔한 Docker 네트워크 함정).

## 보안 (중요)
KEI 내부 규정입니다. **두 화면 모두 인터넷 공개 금지.** 기존 Cloudflare Zero Trust Access 정책 뒤에 두고,
Open WebUI 자체 인증(RBAC/SSO)으로 한 겹 더. 모델·임베딩 전부 온프레미스라 데이터는 망 밖으로 안 나갑니다.
