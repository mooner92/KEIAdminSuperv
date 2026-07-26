# Handoff: 호롱(Horong) 디자인 리뉴얼 — KEIAdminSuperv `web/`

## Overview
KEI 행정 가이드(KRDS 블루 톤)를 **호롱** 브랜드로 리뉴얼한다.
잎이면서 물방울이면서 불꽃인 심볼, 저채도 잎(파랑→초록)·불꽃(주황→노랑) 그라데이션,
Apple식 소프트 미니멀(테두리 대신 여백·톤·부드러운 그림자, 라운드 12–24px, 알약 버튼),
그리고 IA 정리(GNB 7탭 → 3탭: 질문하기 · 규정 찾기 · 업무 도구)가 핵심이다.

## About the Design Files
`designs/` 안의 `.dc.html` 파일들은 **HTML로 만든 디자인 레퍼런스(프로토타입)**다.
프로덕션 코드로 복사하는 것이 아니라, 대상 코드베이스(**Next.js 14 Pages Router, CSS Modules,
외부 UI 라이브러리 0, 기능 플래그 시스템**)의 기존 패턴으로 **재구현**한다.
브라우저로 열어 시각 기준으로 삼고, 수치는 이 README와 파일 내 인라인 스타일에서 읽는다.

## Fidelity
**High-fidelity.** 색·타이포·간격·라운드·그림자·모션 값이 최종 스펙이다. 픽셀 단위로 재현할 것.
단, 데이터(규정명·수치·건수)는 전부 샘플이므로 실제 빌드 데이터를 그대로 쓴다.

## 시작하기 — 브랜치
```bash
cd KEIAdminSuperv
git checkout feat/krds                  # dev 트랙 기준 (prod feat/0620은 동결 유지)
git checkout -b dev/design-revolution
# 검증은 dev 포트(3101/9001) 워크트리에서. 병합 전 prod 스냅샷 규칙은 repo README 참조.
```

## 구현 순서 (권장 4단계)

### Phase 1 — 토큰 스왑 + 브랜드 (반나절, 리스크 최소)
1. `web/styles/globals.css`의 **"KEI 시맨틱 토큰" 블록만** 아래 [Design Tokens]의 라이트/다크 블록으로 교체.
   (globals.css가 원래 "이 블록만 교체하면 된다"는 설계 — 변수명 동일 유지, 전 화면 자동 전환)
2. `web/components/common/HorongMark.tsx` 신규 — 아래 [로고] 컴포넌트.
3. `web/components/Layout.tsx` 브랜드: `KEI` 사각 마크 → `<HorongMark size={27}/>` + **호롱** (17.5px/800/−0.02em).
4. `web/lib/site.ts` → `SITE_NAME = "호롱"` (타이틀·브레드크럼 전역 반영됨). 부제 "KEI 행정 가이드"는 헤더 브랜드 옆 11.5px/#a3a8a4로.
5. `public/favicon.svg` → 로고 SVG로 교체.

### Phase 2 — 셸(헤더·GNB·푸터·모바일 탭)
- 헤더: 유리 재질 `background: rgba(250,250,247,0.75); backdrop-filter: blur(20px) saturate(180%)`,
  하단은 1px 헤어라인 `var(--color-border)`. 높이 62px.
- GNB 3탭: **질문하기 `/` · 규정 찾기 `/browse/` · 업무 도구 `/now/`** (14px/600, #6f7573).
  활성 = 흰 알약 배경 + `box-shadow: 0 1px 3px rgba(20,24,20,0.08)` + 700 잉크. 호버 = `rgba(28,30,28,0.05)` 알약.
- 우측: `🔒 사내 전용` 회색 알약(11.5px, #f4f5f2) · 테마 토글(34px 원형 ghost) · 아바타(34px 원, 잎 그라데이션, 이니셜 흰 800).
- 기존 GNB의 그래프·결재선·업무 한 장·캘린더 링크 제거(각 화면은 Phase 3에서 흡수). 라우트는 유지.
- 푸터: 한 줄 — 좌 "호롱 · KEI 내부 전용 … 인터넷 공개 금지 / 규정집 기준일" · 우 도움말·소개·의견 보내기·v.빌드ID.
- `MobileTabBar`: 3탭 유지하되 라벨 질문/규정/도구, 활성색 `#c9530b`, 유리 재질 동일. 참조: `designs/06 모바일.dc.html`.

### Phase 3 — 화면
- **랜딩/로그인** (`components/Landing.tsx`, `Login.tsx`) → `designs/02 랜딩 로그인.dc.html`.
  스냅 슬라이드 제거, 단일 히어로 + 우측 420px 로그인 카드(radius 26, blur 유리, 그림자 `0 28px 64px 10%`).
  히어로 워드 "규정이 답합니다."에만 텍스트 그라데이션 `linear-gradient(100deg,#2f74b8,#2c9c62 32%,#f6a51a 70%,#ef5a11)`.
  하단 신뢰 배너: 잉크 `#1d1f1d` radius 28 패널, 인용문 뒷부분만 불꽃 그라데이션 텍스트.
- **질문하기** (`components/ChatApp.tsx`) → `designs/01 메인 3안.dc.html`의 **1a 워크벤치**(기본 채택; 1b/1c는 대안).
  3패널 유지: 대화목록 264px 카드 / 중앙 스레드(카드 없음, 그라운드 위) / 근거 348px 카드. 패널 radius 22.
  사용자 말풍선 = 잎 그라데이션, radius `22 22 6 22`. AI 답변 = 흰 카드 radius 22 + "호롱" 라벨(#c9530b/800).
  절차 스텝 = `#f7f8f5` radius 14 행 + 22px 그라데이션 번호 원. 금액 경고 = `rgba(233,161,59,0.13)` radius 12 스트립.
  근거 카드: 기본 `#f7f8f5` radius 16; 핵심(1위) = `1.5px solid rgba(242,112,29,0.45)` + 연한 그라데이션 틴트 배경.
  컴포저 = 흰 radius 20 카드, 포커스 시 `box-shadow: 0 0 0 3px rgba(249,168,37,0.35)`; 전송 = 44px 원형 불꽃 그라데이션.
  빈 화면(새 대화) = 1b 참조: 로고 히어로 + 상황 카드 3×2 그리드(흰 카드, 호버 -3px 리프트).
- **규정 찾기** (`pages/browse.tsx` + `Explorer.tsx`) → `designs/03 규정 찾기.dc.html`.
  상단에 세그먼트 컨트롤(회색 트랙 `#ecede9` 알약 + 흰 알약 썸): **문서 / 서식 / 그래프**.
  `forms.tsx`·`graph.tsx`의 본문을 탭 콘텐츠로 이전, 기존 `/forms` `/graph` 라우트는 해당 탭으로 리다이렉트(딥링크 보존).
  필터 = 좌 260px 흰 카드, 체크박스는 17px radius 6(선택 시 그라데이션 채움 ✓). 결과 행 = 카드 내 radius 14 호버 행.
  검수완료 배지 = `#2a7355` on `rgba(53,144,106,0.12)` 알약 / 미검수 = 회색 알약.
- **업무 도구** (`pages/now.tsx`) → `designs/04 업무 도구.dc.html`.
  도구 4종(결재선·업무 한 장·캘린더·기한 사전) 2×2 대형 카드(radius 22, 46px 그라데이션 아이콘 칩, 호버 -4px).
  하단 3열: 트렌딩 키워드 / 최근 개정 / 오늘의 용어(잎 그라데이션 틴트 패널). 도움말·소개·의견·새로워진 점 카드는 제거(푸터로).
  `calendar.tsx` → 4b(이번 달 그라데이션 틴트 히어로 + 12칸 흰 카드, 이번 달 칸은 `0 0 0 2px rgba(242,112,29,0.5)` 링).
  `approval.tsx` → 4c(알약 검색 + 직급 셀렉트 + 카드 행, 전결권자 = 그라데이션 틴트 알약, 원장 결재 = 잉크 알약).
- **업무 한 장·기한 사전·품질**: 별도 시안 없음 — 위 카드·알약·틴트 문법을 그대로 적용.

### Phase 4 — 다크·모바일·모션 폴리시
- 다크: `[data-theme="dark"]` 토큰 블록 적용 확인 → `designs/05 다크 모드.dc.html`과 대조.
- 모바일: `designs/06 모바일.dc.html` — 하단 유리 탭바, 채팅 근거는 "근거 N개 보기" 접이식.
- 모션(전역): 전환 `0.2s cubic-bezier(0.2,0.7,0.2,1)` · 진입 fade-up 16px(스태거 60ms) ·
  호버 리프트 −2~4px + 그림자 심화 · 배경 글로우 블롭 float 9–12s(랜딩·채팅 빈화면만) ·
  `prefers-reduced-motion: reduce`에서 리프트·플로트 정지(기존 globals.css 규칙 유지).

## Design Tokens
`designs/07 토큰 핸드오프.dc.html`에 복사용 전문이 있다. 요약:

라이트: bg `#fafaf7`(subtle)/`#ffffff`(surface) · field `#f4f5f2` · hover `#f7f8f5` ·
border `rgba(28,30,28,0.08)` / strong `0.16` · text `#1d1f1d` / `#6f7573` / `#a3a8a4` / disabled `#c9cec9` ·
primary `#e06a12` / strong(링크) `#c9530b` / weak `#fdf0e4` · success `#35906a` · warning `#e9a13b` · danger `#d65745` ·
악센트: 규정집 `#4f8dc4` 가이드 `#35906a` 용어집 `#e9a13b` 시스템 `#8d7ac9` 대외업무 `#cf6d96` 상위법령 `#7f8a94` ·
radius 10/14/20(+알약 999) · shadow-card `0 1px 2px rgba(20,24,20,.04), 0 10px 28px rgba(20,24,20,.05)`.

다크: bg `#151614`/`#191b18` · surface `#1e201d` / hover `#242622` · field `rgba(255,255,255,0.06)` ·
border `rgba(255,255,255,0.07)`/`0.14` · text `#f2f3f0`/`#a6aca7`/`#6f7571`/`#4b514c` ·
primary `#f2701d` / strong `#f5a24a` / weak `rgba(249,168,37,0.13)` · success `#5fbf93` warning `#dcb26a` danger `#ff7a68` ·
악센트(밝힘): `#7fb2dd` `#5fbf93` `#dcb26a` `#a794dd` `#e08cb0` `#9aa5ae`.

그라데이션(신규 변수, 브랜드 모먼트 전용 — 로고·히어로 워드·주 CTA·활성 1곳):
```css
--hr-grad-flame: linear-gradient(135deg, #f2701d, #f9a825 60%, #ffd54f);
--hr-grad-leaf:  linear-gradient(135deg, #3d7dc2, #2e9c66);
```

## 로고 — HorongMark.tsx
정적 물방울 실루엣 + 내부 잎맥(움직임 없음). 불은 그라데이션만으로 표현.
```tsx
export default function HorongMark({ size = 27 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="호롱">
      <defs>
        <linearGradient id="horong" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0"    stopColor="#2f74b8" />
          <stop offset="0.2" stopColor="#2c9c62" />
          <stop offset="0.33" stopColor="#5db54a" />
          <stop offset="0.48" stopColor="#ffd54f" />
          <stop offset="0.66" stopColor="#f9a825" />
          <stop offset="1"    stopColor="#e8420b" />
        </linearGradient>
      </defs>
      <path d="M32.5 4.5 C 31 12 24.5 17.5 20 23.5 C 15.5 29.5 13.5 35 14.5 41 C 16 51 23.5 57.5 32 57.5 C 40.5 57.5 48 51 49.5 41 C 50.5 35 48.5 29.5 44 23.5 C 39.5 17.5 34 12 32.5 4.5 Z"
            fill="url(#horong)" />
      <path d="M32 52 C 31.6 44 31.8 36 32.6 24 M32 46 C 29 43.5 26.5 41 24.8 38
               M32.2 40 C 35 37.5 37.2 35 38.8 31.8 M32.3 33 C 29.8 30.8 28 28.6 26.8 26"
            fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.3" />
    </svg>
  );
}
```
주의: 같은 페이지에 여러 개 렌더 시 gradient `id` 충돌 — `useId()`로 id를 유일하게 만들 것.

## Interactions & Behavior
- 기능·플래그·API 로직은 **전부 그대로**(useFlag 게이팅, SSE 스트리밍, 피드백, 드로어 등). 이번 작업은 프리젠테이션 레이어만.
- 문서 드로어: radius 24 좌측 라운드, `--shadow-pop`, 우측 슬라이드인 0.25s 동일 이징.
- 근거 각주(1c 스타일)는 선택 옵션 — 기본 채택안(1a)에서는 답변 하단 인용 칩(`#faf1e8`/`#c9530b` 알약) 유지.
- 링크 색: 본문 링크 `#c9530b`, hover `#9c3f06` (다크 `#f5a24a`/hover 밝게).

## State Management
변경 없음 — 기존 React hooks/Context 구조 유지. 테마는 기존 `lib/theme.tsx`(라이트/다크/시스템) 그대로.

## Assets
- 로고: 위 인라인 SVG(외부 에셋 없음). 파비콘도 동일 SVG.
- 폰트: 기존 self-host **Pretendard GOV** 유지(신규 폰트 없음). 모노 라벨·Archivo 사용 안 함.
- 이모지 아이콘(도구 카드 ✅🗺️📅⏱️ 등)은 현행 유지 — 그라데이션 칩 배경 위 20~22px.

## Files (designs/)
- `00 호롱 브랜드.dc.html` — 심볼 A(대표)·B(대안), 팔레트, 무드 원칙, IA 3탭
- `01 메인 3안.dc.html` — 채팅 1a 워크벤치(채택) / 1b 포커스(빈 화면 겸용) / 1c 리서치 스플릿(대안)
- `02 랜딩 로그인.dc.html` · `03 규정 찾기.dc.html`(문서/서식/그래프 탭) · `04 업무 도구.dc.html`(허브·캘린더·결재선)
- `05 다크 모드.dc.html` · `06 모바일.dc.html` · `07 토큰 핸드오프.dc.html`(복사용 CSS 전문)

## 파일 형식 안내 (Next.js에서 바로 쓰기)
- `web-ready/horong-tokens.css` — **그대로 복사**: globals.css의 시맨틱 토큰 블록 교체용 완성 CSS (라이트+다크).
- `web-ready/HorongMark.tsx` — **그대로 복사**: 로고 React 컴포넌트 (useId로 gradient id 충돌 방지 포함).
- `web-ready/HorongSpinner.tsx` — **그대로 복사**: 호롱빛 로딩 스피너(bloom/tick 2종). 필요한 keyframes는 파일 상단 주석 참조 — globals.css에 1회 추가. 데모: `plain-html/08-spinner.html`. 기존 로딩 dots·spinner를 이것으로 교체.
- `plain-html/*.html` — 표준 정적 HTML 시안. 브라우저로 바로 열림. 모든 스타일이 인라인이라 요소를 검사해 값을 그대로 읽으면 된다.
  - `data-hover` / `data-focus` 속성 = 해당 요소의 :hover / :focus 상태 스타일 스펙 (CSS로 옮겨 구현할 것).
- `designs/*.dc.html` — 디자인 툴 원본(참고용). 구현은 plain-html + web-ready + 이 README 기준으로.

⚠ 구현 원칙 재확인: HTML을 페이지에 붙여넣지 말 것. 기존 CSS Modules 구조를 유지하며 각 모듈의 값(색→토큰 변수, radius, shadow, 간격)을 시안 값으로 바꾸는 방식으로 재구현한다. 로직·플래그·API 코드는 손대지 않는다.
