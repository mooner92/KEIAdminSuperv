# 13 · 기능 플래그(Feature Flags) — 설계 + 운영 매뉴얼

> "다음 버전마다 포트(3102…)를 새로 열거나 통째로 동결하지 않고, **한 코드베이스에서 기능을 켜고/끄며**
> 개발·운영을 가르자"는 방식. **✅ 구현 완료(Phase 0~1)**. 아래 §10이 실제 사용/운영 매뉴얼이다.
> 우리 제약: **온프레미스·사내전용·인터넷 비공개**(CLAUDE.md 절대규칙 #5), 정적 export 프론트.

## 1. 한 줄 정의 / 왜
기능 플래그 = **배포(deploy)와 출시(release)를 분리**하는 스위치. 코드는 미리 내보내되, 사용자에게 보일지는
런타임 조건문(`if (flag.x)`)으로 제어한다. → 미완성/실험 기능을 **OFF로 머지**해두고, 준비되면 **재배포 없이 토글**.
- **지금 문제**: 새 버전마다 `.legacy-v1`처럼 통째 동결 + 포트 추가(3101, 3102…)는 무겁고 안 늘어난다.
- **플래그 방식**: 같은 코드/빌드를 dev·운영에 함께 두고, **플래그 값만 환경별로 다르게**. 새 기능은 OFF로 시작 →
  dev에서 ON으로 검증 → 운영에서 ON. 문제 생기면 **즉시 OFF(kill-switch)** = 재배포 없는 롤백.
- 사용자 직감이 맞다: 이것이 **trunk-based development**의 현대적 표준(장수 버전 브랜치 대신 플래그로 점진 출시).

## 2. 유형 — 우리에게 필요한 것
| 유형 | 용도 | 수명 | 우리 사용 |
|---|---|---|---|
| **release** | 새 기능 점진 출시 | 짧음(출시 후 제거) | ✅ 주력(새 UI/기능 개발) |
| **kill-switch(ops)** | 망가지거나 부담되는 기능 즉시 차단 | 김(상주) | ✅ 운영 안전장치 |
| **permission/beta** | 관리자·베타 대상만 노출 | 김 | ✅ 관리자 전용/시범 기능 |
| experiment(A/B) | 통계적 실험 | 김 | ➖ 사내 소수 사용자라 우선순위 낮음 |

## 3. 핵심 제약 — 정적 export는 "런타임 fetch"가 정석 (가장 중요)
우리 프론트는 `output:"export"`(SSR 없음). **빌드 시 HTML/JS가 고정**되므로:
- ❌ `NEXT_PUBLIC_*`(빌드타임 env)로 토글 → **값 바꾸려면 매번 전체 재빌드**. 런타임 토글 목적엔 부적합.
- ✅ **백엔드(FastAPI)의 `/flags` 엔드포인트에서 클라이언트가 런타임에 fetch** → React state로 조건부 렌더.
  재빌드 없이 백엔드 값만 바꾸면 즉시 반영. (우리 `server.js`가 `/api/*`를 백엔드로 **same-origin 프록시**하므로 CORS 불필요.)
- ⚠️ **깜빡임(FOUC) 주의**: fetch 끝나기 전 새 UI 렌더하면 잘못된 분기가 잠깐 보임 → **안전 기본값(보통 OFF/기존 동작) 즉시 렌더 후 전환**, + `localStorage` 캐시로 첫 깜빡임 최소화.
- ⚠️ **폴백**: `/flags` 실패 시 안전 기본값으로(화면 안 멈추게). 클라이언트로 가는 플래그는 **공개로 간주**(민감 값 금지).

## 4. 관리 방식 스펙트럼 — 우리 선택
| 방식 | 토글 즉시성 | 관리자 UI | 우리 적합성 |
|---|---|---|---|
| 환경변수/설정파일(JSON) | 재배포·재시작 필요 | 없음 | 거의 안 바뀌는 플래그·환경 구분에 적합. **우리 이미 사용**(`RAG_RERANK` 등 백엔드 env) |
| **앱 DB(SQLite) + 관리자 토글 UI** | **즉시(재배포 X)** | 직접 구축 | ✅ **권장**. 외부 SaaS 없이 사내 데이터 유지, 감사로그·권한 추가 가능 |
| OSS 서비스(Unleash/Flagsmith/GrowthBook/Flipt) | 즉시 | 내장 | 별도 서비스 운영 부담 → **소규모 단일앱엔 과함**. (가장 가벼운 건 Flipt/flagd) |
| SaaS(LaunchDarkly 등) | 즉시 | 최고급 | ⛔ **금지** — 플래그 데이터 외부 송출 = 절대규칙 #5 위반 |

> **사용자 질문 답**: "관리자 페이지에서 토글로 켜고 끄는 거?" → **그게 바로 'DB+관리자 UI' 방식이고 우리 권장안**.
> "다른 방식?" → 더 단순하게는 **설정파일/env**(토글 시 재배포). 우리는 **둘을 병행**: 프론트 기능은 DB+관리자토글(라이브),
> 모델 로딩이 걸린 무거운 백엔드 파이프라인 플래그(`RAG_RERANK` 등)는 그대로 env(기동 시 결정).

## 5. 권장 아키텍처 (KEI 맞춤, 직접 구축 — 반나절~하루)
이미 있는 것 재사용: **SQLModel/SQLite + FastAPI(`/app/*`) + Next.js 관리자 + 인증(User)**. 새 인프라 0.

```
[프론트 정적]  useFlags() 훅 ──fetch──▶ GET /api/app/flags ──▶ FastAPI ──▶ SQLite(flags 테이블)
   · 안전 기본값 즉시 렌더 + localStorage 캐시(깜빡임 방지)        ▲
   · 컴포넌트: {flags.newGraphEmbed && <NewThing/>}               │ 관리자만 토글
[관리자 페이지 /admin] ──토글──▶ POST /api/app/flags/{key} ───────┘  + audit log(누가/언제)
```
- **DB**: `flag(key, enabled, description, env, updated_by, updated_at)` (+ `flag_audit` 변경 이력).
- **백엔드**: `GET /app/flags`(현재 값 JSON), `POST /app/flags/{key}`(관리자 전용 토글, 감사 기록).
  관리자 식별 = `User`에 `is_admin` 추가(또는 사용자명 allowlist).
- **프론트**: `lib/flags.tsx`(Context+훅) — 마운트 시 fetch, 안전 기본값, localStorage 캐시, 실패 시 폴백.
  사용처는 `inversion of decision`로 한곳에 모아 산재 방지.
- **오버라이드(선택)**: `?flag=on`/쿠키로 **내부 테스터가 운영에서 특정 기능만 켜보기**(사내 도구에 유용).
- **벤더 중립(선택)**: 훅을 **OpenFeature** 스타일 API로 감싸두면 나중에 Flipt 등으로 무비용 전환.

## 6. dev/prod 운영 모델의 변화
- **지금**: dev(3100/9000, feat/0620) + 운영(3101/9001, 동결 v1.0.0). 새 버전마다 동결+포트.
- **플래그 도입 후**: **같은 코드/빌드**를 양쪽에 배포, **플래그 값만 환경별로**. 새 기능은 `env=prod`에선 OFF 기본.
  - 새 기능 개발 → OFF 플래그로 감싸 머지 → dev에서 ON 검증 → 운영에서 ON.
  - 사고 시 **운영 플래그 OFF = 즉시 롤백**(MTTR 분 단위, 재배포·동결 불필요).
  - **레거시 동결(.legacy-v1)·git 태그는 유지** — 플래그가 못 막는 '심층 롤백'(아키텍처 통째 회귀)의 안전망으로만.
- 즉 포트(3102…)를 새로 안 열어도 됨. 운영 포트는 3100/3101 둘로 충분.

## 7. 거버넌스 (KEI = 행정·감사 영역이라 특히 중요)
- **감사로그·권한 필수**: 누가 언제 무엇을 켰는지 기록(`flag_audit`), 토글은 관리자만. (동적 토글의 기본 안전장치.)
- **플래그 부채(flag debt) 방지**: 생성 시 **만료일·소유자** 지정 → 100% 도달(또는 폐기) 시 **즉시 제거**(기능 PR에 정리 포함).
  명명 규칙(`temp_`/`exp_` 접두), 분기별 점검. "나중에 정리"는 금지(좀비 플래그 누적).
- 민감 값(금액·한도·내부 로직)은 플래그 JSON에 넣지 않는다(클라이언트 공개 전제).

## 8. 단계별 도입안 (제안)
- **Phase 0 (최소·반나절)**: SQLite `flag` 테이블 + `GET /app/flags` + 프론트 `useFlags()`(안전기본값·캐시·폴백).
  토글은 일단 DB 직접/스크립트로. 첫 플래그 1개로 검증(예: 새 실험 UI 한 개).
- **Phase 1 (관리자 페이지)**: `/admin` 토글 UI(관리자 전용) + `POST /app/flags/{key}` + 감사로그. ← 사용자가 그린 그림.
- **Phase 2 (운영성)**: 환경별 기본값(`env` 컬럼), `?flag=` 오버라이드, OpenFeature 래핑(선택), 만료/정리 점검 루틴.
- 평가/회귀: 플래그가 검색·답변에 영향 주면 `eval/`로 ON/OFF before/after 측정(품질 트랙과 연계).

## 9. 결론(권장)
**자체 구축 런타임 플래그(SQLite + `/flags` API + useFlags 훅 + 관리자 토글 페이지 + 감사로그)** 를 권장.
SaaS는 금지(데이터 외부), OSS 서비스(Unleash 등)는 소규모엔 과함. 우리 스택에 이미 있는 것만으로 충분하고,
정적 export 제약(런타임 fetch·안전 기본값)만 지키면 됨. 채택하면 "버전마다 포트/동결" → "플래그 토글"로 운영이 가벼워진다.

## 10. 운영 매뉴얼 (구현됨)
구현 구성: 백엔드 `tools/app_api.py`(SQLite `Flag`/`FlagAudit` + 코드 레지스트리 `FLAG_REGISTRY`),
프론트 `web/lib/flags.tsx`(`useFlag`/`useFlags`), 관리자 페이지 `web/pages/admin.tsx`(`/admin`).

### A. 새 플래그 추가 (코드 1곳 + 프론트 기본값 1곳)
1. **백엔드 레지스트리** `tools/app_api.py`의 `FLAG_REGISTRY`에 항목 추가(기본값·설명·소유자·만료):
   ```python
   "new_feature_x": {"default": False, "description": "X 기능 노출", "owner": "본인", "expires": "2026-09-30"},
   ```
   기동 시 `ensure_flags()`가 DB에 없으면 기본값으로 자동 생성. (백엔드 재시작 필요: `pm2 restart kei-rag-api`)
2. **프론트 안전 기본값** `web/lib/flags.tsx`의 `FLAG_DEFAULTS`에 같은 키 추가(기본은 안전한 쪽=보통 `false`).
   ⚠️ 두 곳 키가 어긋나면 안 됨(레지스트리=출처, 프론트=fetch 전 안전값).

### B. 코드에서 사용
- **프론트(UI 노출 토글)**:
  ```tsx
  import { useFlag } from "../lib/flags";
  const on = useFlag("new_feature_x");
  return on ? <NewThing/> : <OldThing/>;   // fetch 전엔 안전 기본값으로 렌더(깜빡임 없음)
  ```
- **백엔드(행동 토글)**: `from app_api import effective_flags; if effective_flags()["new_feature_x"]: ...`
  (단, 모델 로딩이 걸리는 무거운 파이프라인 토글 `RAG_RERANK` 등은 그대로 env로 — 기동 시 결정.)

### C. 켜고/끄기 (운영)
- `/admin` 접속(관리자만) → 토글 스위치 클릭 → **즉시 반영**(재배포 X). 변경은 **감사 이력**에 남음.
- 관리자 지정: `tools/ecosystem.config.js`의 `APP_ADMINS`(쉼표 구분 아이디). 미지정 시 첫 가입자=관리자(부트스트랩).
  ⚠️ **운영에선 APP_ADMINS를 반드시 명시**(누구나 먼저 가입해 관리자가 되는 일 방지).
- 사고 시 **해당 플래그 OFF = 즉시 롤백**(kill-switch). 재배포·동결 불필요.

### D. 정리(flag debt) — 필수 규율
- 다 쓴(100% 출시됐거나 폐기된) 플래그는 **만료일에 맞춰 제거**: `FLAG_REGISTRY`·`FLAG_DEFAULTS`에서 키 삭제 +
  그 키를 쓰던 `useFlag`/분기 제거. (DB row는 남아도 무해하나 깔끔히 지워도 됨.)
- 생성 시 **만료일·소유자**를 꼭 적는다. "나중에 정리"는 좀비 플래그를 만든다.

### E. 보안 메모 (적대적 검토 반영)
- 변경(`POST /flags/{key}`)·관리 조회(`/flags/manage`,`/flags/audit`)는 **관리자 전용**(`current_admin`, 비관리자 403 검증). 알 수 없는 key는 404로 차단(임의 DB 오염 불가).
- **관리자 게이트 fail-closed**: `APP_ADMINS` 미설정 시 **아무도 관리자 아님**(공개 register로 인한 권한상승 차단) + 기동 경고. 운영자는 `APP_ADMINS`를 반드시 명시.
- `GET /app/flags`(공개, 비인증)에는 **불리언 UI 토글만** — 클라이언트 공개 전제, **금액/한도/내부로직 금지**. 앱은 Cloudflare ZT 망 게이트 뒤.
- **CORS**: `allow_origins=["*"]`이되 `allow_credentials`는 끔 → 교차오리진 쿠키 차단(인증은 server.js same-origin 프록시로만). ⛔ 절대 `allow_credentials=True`와 와일드카드를 함께 켜지 말 것(코드 경고 주석 있음).
- **CSRF**: 세션 쿠키 `httponly+samesite=lax` + 변경은 POST/JSON 바디 + 교차오리진 쿠키 차단의 조합으로 단순 CSRF는 막힘. 내부망+ZT 가정. (더 엄격히 하려면 `X-CSRF` 더블서밋 — Phase 2.)
- DB 동시쓰기: SQLite **WAL + busy_timeout=5s** 설정으로 'database is locked' 완화(채팅·플래그 공용).

### F. 알려진 한계 (Phase 2 후보)
- **ON 플래그 1프레임 깜빡임(FOUC)**: 정적 빌드 HTML은 항상 안전 기본값(OFF)이라, 켜진 플래그는 fetch/캐시 반영 전 한 프레임 OFF로 보일 수 있음. 하이드레이션 안전과의 트레이드오프. 해소하려면 `_document` 인라인 부트로 `localStorage` 플래그를 페인트 전 적용(테마와 동일 기법).
- **레지스트리↔프론트 기본값 동기화**: 두 곳(`FLAG_REGISTRY`/`FLAG_DEFAULTS`) 수동 동기화. 어긋나면 프론트가 `console.warn`으로 경고(드리프트 조기 발견). 기본값은 항상 안전(false)로 두면 드리프트가 fail-safe. (빌드 시 키집합 비교 CI는 Phase 2.)
- **캐시 staleness**: localStorage 캐시에 TTL 없음 → 롤백(OFF) 직후 `/flags` 실패한 클라이언트는 stale ON 유지 가능. release 성격 플래그는 "실패 시 OFF 폴백"이 안전 기본값. (TTL/버전 — Phase 2.)

---
### 출처(리서치)
- Martin Fowler, *Feature Toggles* — martinfowler.com/articles/feature-toggles.html
- Unleash docs(feature flag/trunk-based/tech-debt), Octopus·LaunchDarkly·CloudBees 베스트프랙티스, trunkbaseddevelopment.com
- OpenFeature(openfeature.dev), Flipt(github.com/flipt-io/flipt), Flagsmith/GrowthBook 비교(flagshark 2026)
- Next.js `output:export` 런타임 플래그 패턴(클라이언트 fetch·FOUC·쿠키 오버라이드)

> 작성 2026-06-21 · 상태: **✅ Phase 0~1 구현·검증 완료**(런타임 플래그 + 관리자 토글 + 감사로그, end-to-end Playwright 검증).
> Phase 2(환경별 기본값·`?flag=` 오버라이드·OpenFeature 래핑)는 필요 시. 플래그 추가/정리는 §10 매뉴얼 참조.
