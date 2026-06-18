# 배포 — 하나의 볼트, 두 개의 웹 화면

```
        git 볼트 (마크다운 = 단일 진실원천)
        ├──────────────► [뇌]  Quartz 정적 사이트  : 노드/링크 그래프 + 전문검색
        └──────────────► [비서] Open WebUI + vLLM   : 질문에 출처 달아 답변
   둘 다 data05lx(우분투)에서 서빙 · 둘 다 Cloudflare Zero Trust 뒤 (사내 전용)
```

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
