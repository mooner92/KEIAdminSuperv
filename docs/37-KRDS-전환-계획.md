# docs/37 — TDS 제거 + KRDS 참고 디자인 전환 계획 (라이선스 대응)

> 발단(2026-07-15): 사용자가 저작권 교육 후 "Toss Design System과 현재 폰트가 무료가 아니면
> 쓰면 안 될 듯. TDS 없이 지금 느낌과 최대한 비슷하게, KRDS(krds.go.kr) 참고해서 가능한가?
> 기대와 다르면 롤백할 수 있게 계획을 세워라."

## 0. 실측 팩트 — 생각보다 훨씬 가볍다

| 항목 | 실측 | 판단 |
|---|---|---|
| **TDS 사용처** | 코드 전체에서 **단 3곳**: `SearchField`+`ColorSchemeArea`(Explorer·ApprovalExplorer의 검색 입력), `TDSMobileAITProvider`(_app.tsx) | 교체 대상이 검색 입력창 1종뿐 — 자체 구현 반나절감 |
| **TDS 라이선스** | `@toss/tds-mobile`·`-ait` package.json에 **license 필드 없음** = 기본값 all rights reserved | 사용자 판단이 맞음 — **제거가 정답** |
| **현재 폰트** | Pretendard는 **파일을 배포하지 않음** — `font-family` 선언만 있고 CDN/번들 로드 0. 사용자 PC에 있으면 쓰고 없으면 시스템 폰트 폴백 | 재배포가 없어 현행도 위반 아님. 그리고 Pretendard는 **SIL OFL 1.1(무료·상업 가능)** |
| **KRDS 공식 서체** | **Pretendard GOV**(Pretendard의 정부 변형, 역시 OFL) | 폰트는 지금 그대로가 이미 KRDS 정합 — "지금 느낌" 그대로 유지됨 |
| **색상 구조** | globals.css가 2층: 원자 팔레트(--blue500 등, TDS 값 참고) ← 시맨틱 토큰(--color-*) ← 컴포넌트. 컴포넌트는 시맨틱 토큰만 참조 | **원자층만 KRDS 값으로 스왑하면 컴포넌트 무변경** — 이 구조를 처음부터 이렇게 설계해 둔 덕 |
| **부수 의존성** | `@emotion/react`는 TDS 요구 의존 — TDS 제거 시 함께 제거 가능(MIT라 남아도 무해) | 번들도 가벼워짐 |

**결론: "TDS 없이 지금 느낌 유지" — 가능하고, 큰 공사가 아니다.**
느낌을 만드는 3요소 중 ① 폰트(Pretendard)는 그대로, ② 시맨틱 토큰·컴포넌트 CSS(우리가 작성)는
그대로, ③ 원자 색상값만 KRDS 팔레트로 바뀐다(파랑 계열 → 파랑 계열이라 체감 차이는 미세 톤).

## 1. KRDS에서 가져올 것 / 안 가져올 것

- **가져올 것**: 색상 팔레트 실값(Primary 파랑 계열 등 — ⛔ 여기 적지 않는다, 작업 시
  krds.go.kr 디자인 토큰 페이지에서 실값 확인 후 기입), 폰트(Pretendard GOV self-host),
  명도 대비·포커스 표시 등 접근성 기준. KRDS는 행안부 공공 디자인 시스템(공공누리 계열)이라
  참고·인용에 라이선스 부담 없음 — 정부출연연 사내 도구로서 톤 정합성도 가점.
- **안 가져올 것**: KRDS 컴포넌트 마크업/CSS 통째 도입(우리 컴포넌트가 이미 완성돼 있고
  KRDS는 범용 민원 UI라 앱형 화면에 안 맞음). 구조는 현행 유지 — 값만 교체.

## 2. 단계별 작업 (각 단계 = 원자 커밋 1개, 독립 revert 가능)

| 단계 | 내용 | 공수 |
|---|---|---|
| **D1. TDS 제거** | `SearchField` → 자체 `<SearchInput>`(시맨틱 토큰, 기존 룩 복제 — 현재 스크린샷 기준 픽셀 근사) · `ColorSchemeArea`/`TDSMobileAITProvider` 제거 · `@toss/*`+`@emotion/react` 의존성 삭제 | 0.5일 |
| **D2. 팔레트 KRDS 스왑** | globals.css 원자층(--blue*·--grey*·--green500…)을 KRDS 실값으로 교체(라이트/다크 각각) — 시맨틱 토큰 이하 무변경. 다크는 KRDS에 없으면 명도 매핑 규칙으로 파생(현행 다크 톤 유지) | 0.5일 |
| **D3. 폰트 정식화(선택)** | Pretendard GOV woff2 self-host(`web/public/fonts/`, OFL 파일이라 커밋 가능) + `@font-face` — 전 직원 PC 폰트 설치 여부와 무관하게 렌더 통일. OFL 라이선스 파일 동봉 | 0.5일 |
| **D4. 라이선스 표기** | `web/NOTICE.md`(폰트 OFL·오픈소스 목록) + 도움말 '만든 사람들/라이선스' 한 줄 | 0.5h |

## 3. 롤백 설계 (사용자 요구 핵심)

1. **별도 브랜치 `feat/krds`에서 작업** — dev(feat/0703)에 바로 얹지 않는다.
2. **before/after 스크린샷 갤러리**: 전환 전 dev의 대표 화면 10종(홈·채팅 답변·둘러보기·그래프·
   소개·도움말·관리자·다크 3종)을 Playwright로 고정 캡처 → 전환 후 동일 스크립트 재캡처 →
   나란히 비교 HTML(로컬 파일, 커밋 금지) 생성. **사용자가 보고 승인해야 dev에 병합.**
3. 원자 커밋(D1~D4 각 1커밋)이라 특정 단계만 `git revert` 가능 — 예: 팔레트만 되돌리고
   TDS 제거는 유지.
4. 검증 게이트: 병합 전 전체 verify 스위트(landing·now·help·flags·admin·trust 등) + 375px +
   다크 실렌더 통과. TDS 제거(D1)는 시각 영향이 검색 입력창뿐이라 해당 화면 픽셀 비교 필수.
5. 만약 병합 후 문제 발견 시: revert 커밋 시리즈로 즉시 복귀(의존성도 lock 파일과 함께
   되돌아감). 볼트·백엔드는 이 작업에서 불변이라 데이터 리스크 0.

## 4. 수용 기준

- `grep -r "@toss" web/` 0건, `npm ls @toss/tds-mobile` 미설치, 빌드·전 verify 통과
- 검색 입력(둘러보기·결재선) 실렌더가 기존과 시각 동등(스크린샷 비교, 포커스 링·클리어 버튼 동작 유지)
- 라이트/다크 전 화면에서 시맨틱 토큰 누락 0(하드코딩 hex 검출 grep)
- 폰트 렌더: Pretendard(GOV) 로드 확인(document.fonts), 미로드 폴백 정상
- CLAUDE.md·docs의 "Toss Design System" 표기 일괄 갱신(KRDS 참고 자체 토큰 시스템으로)

## 5. 순서 제안

지금 대기 중인 것들과의 관계: 이 전환은 **개명(P1 브랜딩)과 독립**이라 먼저 해도 된다.
오히려 라이선스 이슈는 시한성(교육에서 인지한 컴플라이언스)이 있으므로 **D1(TDS 제거)만이라도
우선 처리**하고, D2(팔레트)는 스크린샷 승인 흐름으로 천천히 가는 것을 추천.

## 6. 진행 기록 (2026-07-15) — D1~D4 구현 완료 (feat/krds, 병합 대기)

- **D1 TDS 제거**: `@toss/*`·`@emotion/react` 의존성 삭제, next.config emotion 설정 제거,
  자체 `SearchInput`(시맨틱 토큰·기존 룩 픽셀 근사) 교체 2곳. 검색창 before/after 시각 동등 실측.
- **D2 KRDS 팔레트**: 원자 팔레트 전량을 KRDS 공식 킷 실값으로(gray/primary/point/success/warning
  — github.com/KRDS-uiux/krds-uiux에서 반입, 지어낸 값 0). TDS-KRDS gray가 근접해 체감 미세,
  파랑은 #3182f6→#256EF4(약간 깊어짐). 다크는 KRDS 다크 토큰 미제공(실측)이라 수동 튜닝 유지
  + primary 계열만 40/30으로 정렬.
- **D3 폰트**: Pretendard GOV(KRDS 공식 서체, SIL OFL) dynamic-subset 120파일 self-host
  (외부 CDN 0, OFL.txt 동봉). document.fonts 실측 로드·적용 확인.
- **D4 표기**: web/NOTICE.md(서체 OFL·KRDS 참고·OSS 목록), 도움말 문의 섹션 라이선스 한 줄,
  CLAUDE.md·docs/design-system.md의 TDS 표기 일괄 갱신.
- **검증**: 전체 스위트 12종 통과(landing 24/24·now 21/21·help-rail 10/10·help-hub 18/18·
  explore·approval 7/7·content-search·flags·auth-nav 7/7·signup 11/11·spec-gaps 7/7·trust).
  before/after 스크린샷 14×2장 + 대표 4장 비교 이미지 생성.
- **수용 기준 체크**: `grep @toss` 0건 ✅ · 검색 입력 시각 동등 ✅ · 폰트 로드 ✅ · 표기 갱신 ✅.
- **롤백**: 원자 커밋 4개(D1~D4) — 단계별 revert 가능. **dev(feat/0703) 병합은 사용자 승인 후.**
