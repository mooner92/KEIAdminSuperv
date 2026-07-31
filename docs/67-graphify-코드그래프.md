# 67 — graphify 코드 그래프 (도입·안전 계약·사용법)

> 2026-07-31 도입 완료. 운영자 지시: "cbm 말고 graphify — 더 정교하고 큰 규모."
> 실험실 게시 설계 = `specs/09-실험실-랩.md`. 갱신 스크립트 = `scripts/graphify-refresh.sh`.

## 1. 무엇인가

레포 전체(코드 340파일 + 설계 문서·WORKPLAN·specs)를 tree-sitter AST와 마크다운 헤딩
구조로 파싱해 **지식 그래프**(약 4천 노드·6천 엣지·커뮤니티 342개)로 만든다.
임베딩·벡터스토어가 아니라 순회 가능한 진짜 그래프다.

이 프로젝트와 맞는 점 둘:
- **엣지마다 `EXTRACTED`(원문 명시)/`INFERRED`(도구 추론) 구분** — "근거와 추측을
  구분한다"는 우리 원칙과 같은 사고방식. 실측 98%가 EXTRACTED.
- **주석·docstring을 `rationale` 노드로 추출** — "왜"를 주석에 남기는 이 코드베이스에서
  남들보다 얻는 게 크다.

## 2. ⛔ 안전 계약 (전부 실측 검증됨)

| 계층 | 내용 |
|---|---|
| LLM 0 추출 | 코드=tree-sitter·마크다운=헤딩 파싱, 전부 로컬·결정적. 리포트에 `Token cost: 0` 명시 |
| 볼트 제외 3중 | `.gitignore`(자동 존중) + `.graphifyignore`(제외만 추가 가능) + refresh 스크립트의 **유출 검사**(볼트 경로·내용어가 graph.json에 있으면 실패) |
| 커뮤니티 이름 | LLM 필요 — **외부 API 금지**, 사내 공유 Ollama(Qwen3-14B)로만. 프로덕션 격리 Ollama는 불접촉 |
| 산출물 커밋 금지 | `graphify-out/` gitignore — 코드 구조를 공개 레포에 남기지 않는다 |
| 질의 로그 | `GRAPHIFY_QUERY_LOG_DISABLE=1`(refresh 스크립트가 설정) — 질의 원문이 캐시에 쌓이는 것 차단 |
| IDE 미설치 | `graphify install` 안 함 — PreToolUse 훅이 세션 도구 호출마다 끼어드는 구조라 보류(기존 훅과 중첩). CLI로 전부 가능 |

설치는 전용 venv(`~/.local/venvs/graphify`) — 시스템 파이썬 무접촉, 제거는 디렉터리 삭제.

## 3. 사용법 (운영자용 치트시트)

```bash
G=~/.local/venvs/graphify/bin/graphify
cd ~/kei-dev-0703            # 그래프는 dev 워크트리 기준

# ① 그래프 갱신(코드가 꽤 바뀌었을 때) — 증분·오프라인·유출검사 포함
scripts/graphify-refresh.sh            # 이름 유지
scripts/graphify-refresh.sh --label    # + 커뮤니티 이름 재생성(사내 Ollama)

# ② 보기 — 브라우저로 연다(클릭·검색·커뮤니티 필터)
#    graphify-out/graph.html

# ③ 한 심볼의 연결 전부(정의 위치·호출·피호출, 줄번호까지)
$G explain "retrieve"                  # 모호하면 후보를 보여준다 → id로 재질의
$G explain "tools_rag_core_retrieve"

# ④ 두 지점 사이 최단 경로 — "이게 저기에 왜 영향 주지?"
$G path "04_rag_api.py" "retrieve()"

# ⑤ 리포트 — 허브·커뮤니티·놀라운 연결 요약
#    graphify-out/GRAPH_REPORT.md
```

### ⚠ 함정 3개 (실측 — 전부 스크립트에 반영돼 있으니 직접 부를 때만 주의)

1. **플래그는 등호형만**: `--backend=ollama` ✓ / `--backend ollama` ✗ — 공백형은
   **조용히 무시**되고 폴백이 성공한 척한다.
2. **`OLLAMA_BASE_URL`은 verbatim** — `/v1`까지 붙일 것(안 붙이면 404).
3. **`update`엔 `--code-only`가 없다** — 명령 자체가 LLM 없는 추출 전용이다.

## 4. 언제 쓰나 (실전 레시피)

- **수정 전 영향 파악**: `explain "함수명"` — 누가 부르는지 줄번호로. grep보다 빠르고
  선언·호출을 구분해 준다.
- **리팩터링 후보 찾기**: GRAPH_REPORT.md의 커뮤니티 허브 — 연결이 비대한 노드가 분리 후보.
- **새 세션 온보딩**: graph.html에서 커뮤니티(예: 'Retrieval System')를 필터해 그 영역의
  파일·함수 지도를 먼저 본다.
- **문서↔코드 추적**: 설계 문서 헤딩이 노드라, docs의 절이 어느 코드와 이어지는지 경로
  질의가 된다.

## 5. 이력·남은 것

- 2026-07-30 codebase-memory-mcp 도입 → 07-31 graphify로 교체(철거 완료, 커밋 562431d).
  cbm의 결정적 근접클론 목록은 소진 시작 — `verify-*.mjs` check() 21본 → `verify-lib.mjs`
  (커밋 81d92f9). 잔여: 01e 크로스링크 쌍(출력 불변 검증 필요)·로그인 보일러플레이트.
- [ ] 실험실 게시(specs/09) — server.js 직서빙 + CDN 치환 + 플래그 2종. 운영자 승인 대기.
- [ ] 그래프 내 다크모드·볼트 그래프와의 관계는 specs/09 비목표로 명시됨.
