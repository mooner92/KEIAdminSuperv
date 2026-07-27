# Handoff: 호롱 v2 — Spotify 스타일 전면 리디자인

> 대상 리포: `mooner92/KEIAdminSuperv` (Next.js 14 Pages Router · CSS Modules · 외부 UI 라이브러리 0)
> 디자인 근거: 사용자 확정 프로토타입 `prototype/호롱 Spotify 리디자인.dc.html` + `uploads/DESIGN-spotify.md`(Spotify 분석)
> 기준일: 2026-07-27

## Overview

호롱(KEI 행정 가이드) 전 화면을 Spotify의 디자인 언어로 재해석한 리뉴얼.
핵심 전환 4가지:

1. **다크 기본** — 웜 차콜 3단 심도(`#0e0d0b → #171613 → #211f1b`). 라이트는 토글로 유지.
2. **상단 GNB → 좌측 사이드바** — 플로팅 2패널(내비 + 대화 라이브러리) + 메인 패널, 8px 거터.
3. **단색 앰버 액센트** — `#ffc94d`(다크) 하나만 기능적으로 사용(CTA·활성·링크). 그라데이션은 HorongMark 로고 전용으로 축소.
4. **채팅 3패널 해체** — 대화목록은 사이드바 라이브러리로 흡수, 스레드는 단일 중앙 컬럼, 근거 조문은 온디맨드 우측 패널(Spotify의 Now Playing 패널 대응).

기존 디자인 시스템 원칙 중 **P1(시맨틱 토큰만) · P2 · P5 · P6(헤어라인) · P8 · P9(공용 스킨 1벌) · P10은 그대로 유지**된다. P7은 "그라데이션 = 로고 전용"으로 강화, P3은 "여백 우선 → Spotify식 고밀도 트랙리스트"로 교체된다.

## About the Design Files

`prototype/` 안의 파일은 **HTML로 만든 디자인 레퍼런스(프로토타입)**다. 프로덕션 코드가 아니며 그대로 복사하지 않는다.
할 일은 이 프로토타입의 look & behavior를 **기존 코드베이스의 패턴(CSS Modules + 시맨틱 토큰 + 공용 컴포넌트)으로 재구현**하는 것이다.
`design/horong/` 폴더 규칙과 동일: 시안을 페이지에 붙여넣지 말고, 값(색→토큰·radius·shadow·간격)만 옮긴다. 로직·플래그·API 코드는 손대지 않는다.

프로토타입 열기: `prototype/호롱 Spotify 리디자인.dc.html`을 브라우저로 열면 실행된다(같은 폴더의 `support.js` 필요). 좌측 사이드바로 10개 화면 전환, 우상단 토글로 라이트/다크 전환.

## Fidelity

**High-fidelity.** 색·타이포·간격·라운드·그림자·호버까지 최종 스펙이다. 아래 명세와 프로토타입 요소 검사 값을 그대로 재현한다.
단, 더미 데이터(대화 내용·서식 목록·통계 수치)는 실데이터로 대체한다. ⚠ 공개 레포 규칙: 실제 규정 값(기한·금액·실명 이메일)을 시안·더미에 넣지 않는다.

## Design Tokens

**`horong-tokens-v2.css`가 드롭인 교체본이다** — `web/styles/globals.css`의 라이트 `:root` / 다크 `[data-theme="dark"]` 두 블록을 이 파일 내용으로 교체하면 P1 덕에 전 화면에 기본 반영된다. 기존 토큰명 유지 + 신규 4종(`--color-on-primary`, `--radius-panel`, `--radius-tile`, `--radius-pill`).

핵심 값 요약 (다크 / 라이트):

| 토큰 | 다크(기본) | 라이트 | 용도 |
|---|---|---|---|
| `--color-bg-subtle` | `#0e0d0b` | `#efece4` | 페이지 그라운드(패널 뒤) |
| `--color-bg` `--color-surface` | `#171613` | `#fdfcf9` | 플로팅 패널·카드 |
| `--color-field-bg` | `#211f1b` | `#f3f0e9` | 입력·2단계 카드·칩 |
| `--color-surface-hover` | `#2b2823` | `#e9e4d9` | 행/카드 호버 |
| `--color-primary` | `#ffc94d` | `#e8a20c` | 단색 앰버 — CTA·활성·토글 ON |
| `--color-on-primary` | `#191100` | `#191100` | 앰버 위 텍스트(항상 거의 검정) |
| `--color-primary-strong` | `#ffc94d` | `#b45a08` | 링크·강조 텍스트 |
| `--color-primary-weak` | `rgba(255,201,77,.14)` | `rgba(232,162,12,.14)` | 옅은 앰버 배경(숫자 배지·1위 근거·이번 달) |
| `--color-text` / `-secondary` / `-tertiary` | `#f5f3ef` / `#b8b1a6` / `#7d766c` | `#1d1b17` / `#6b665d` / `#a29b8e` | 본문/보조/흐림 |
| `--color-border` | `rgba(255,255,255,.07)` | `rgba(30,26,18,.09)` | 헤어라인(P6 유지) |
| `--shadow-card` | `rgba(0,0,0,.3) 0 8px 8px` | `rgba(60,50,30,.10) 0 8px 8px` | 카드 리프트 |
| `--shadow-pop` | `rgba(0,0,0,.5) 0 8px 24px` | `rgba(60,50,30,.18) 0 8px 24px` | 근거 패널·모달·폰 프레임 |

- **라운드**: 패널 12 · 카드 10 · 타일 8 · **버튼/입력/칩 = 999(알약)** · 아이콘 버튼/아바타 = 50%(원).
- **간격**: 기존 4배수 스케일 유지. 밀도 기준: 목록 행 최소높이 52px, 행 패딩 6px 14px, 그리드 gap 12px.
- **타이포**: Pretendard GOV self-host 유지. **크기보다 굵기로 위계** — 900(페이지 제목·브랜드) / 800(섹션·버튼·배지) / 600~700(행 제목) / 400~500(본문·보조). 페이지 제목 30px/900/자간 -1px. 마이크로 라벨(컬럼 헤더·"대화"·"상황으로 시작해 보세요")은 11~12px/800 + **letter-spacing 1.2~1.5px** — Spotify의 대문자 라벨 보이스의 한글 대응.
- **모션**: 화면 진입 `hrUp`(opacity 0→1 + translateY 12px→0, 0.35s `cubic-bezier(.2,.7,.2,1)`) · 버튼 호버 `scale(1.03~1.08)` · 카드 호버 `translateY(-2px)` + `--shadow-card` · 로딩 점 3개 `hrPulse`(opacity .25↔1, 1.2s, 딜레이 0/.2/.4s). `prefers-reduced-motion: reduce`에서 전부 정지.

### 색 사용 규칙 (Do / Don't)

- **Do**: 앰버는 기능적으로만 — 주 CTA 1개, 활성 nav, 토글 ON, 링크, 사용자 말풍선, 스코어 바. 분류색 6종(`--accent-*`)은 "콘텐츠의 색"(그래프 노드·분류 칩·커버 타일)에만.
- **Don't**: 앰버를 배경 장식으로 깔지 않기 · CTA/활성에 그라데이션 금지(로고만) · 1px 초과 진한 보더 금지 · 다크에서 옅은 그림자 금지(안 보임).

## Screens / Views

프로토타입의 `data-screen-label`과 동일한 10개 화면. 공통 셸부터.

### 0. 앱 셸 (`Layout.tsx` 대체 — 가장 큰 구조 변경)

- **페이지**: `--color-bg-subtle` 전면, `padding: 8px`, `gap: 8px`의 flex row. 뷰포트 고정(100vh), 내부 스크롤.
- **좌측 사이드바** (총폭 288px, 세로 2패널, gap 8):
  - **패널 A — 내비**: `--color-bg`, radius 12, padding 16px 12px 10px.
    - 브랜드 행: HorongMark 26px + "호롱" 19px/900/자간-0.5 + "KEI 행정 가이드" 11px `--color-text-tertiary`. 클릭 → 랜딩.
    - 주 내비 3항목(질문하기/문서 찾기/업무 도구): 높이 42px, 아이콘 21px(스트로크 1.8) + 15px 라벨. 활성 = `--color-surface-hover` 배경 + 텍스트 `--color-text`/800, 비활성 = `--color-text-secondary`/500, 호버 시 텍스트만 밝힘.
    - 헤어라인 구분 후 보조 내비 4항목(업무 캘린더/결재선 판정기/관리자/모바일): 높이 34px, 13px.
  - **패널 B — 대화 라이브러리** (flex:1, 내부 스크롤): 헤더 "대화"(12px/800/자간1.5 `--color-text-secondary`) + 우측 원형 28px "＋ 새 대화" 버튼. 대화 행: 36px 커버 타일(radius 6, 분류색 6종 순환 `색+2e` 알파 배경 + 첫 글자 800) + 제목 13.5px 말줄임 + 시각 11px. 활성 행 = `--color-surface-hover` + 제목 700. 푸터: 헤어라인 위 "문서 기준일 YYYY.MM.DD" + 계정명 11px.
- **메인 패널** (flex:1): `--color-bg`, radius 12, overflow hidden, 세로 flex.
  - **상단바** 64px: 검색 필 입력(폭 380px, `--color-field-bg`, radius 999, padding 11px 18px 11px 40px, 좌측 돋보기 아이콘, 포커스 = `0 0 0 1px --color-text-tertiary` inset 링) · 우측에 "사내 전용" 아웃라인 필 배지(11.5px/700) · 테마 토글(원형 34px, `--color-field-bg`, 호버 scale 1.06) · 아바타(원형 34px).
  - 기존 62px 유리 헤더·상단 배너·하단 푸터는 **삭제**. 공지는 추후 사이드바 하단 카드로(이번 범위 외).
- **근거 패널** (조건부 3번째 패널): 아래 화면 2 참조.
- 모바일(<768px): 사이드바 숨김 → 하단 탭바 3탭(화면 9 참조). 기존 P4 그대로.

### 1. 질문하기 — 빈 화면 (`/`)

- 중앙 정렬 단일 컬럼(max 640px): HorongMark 54px → "무엇이 궁금하세요?" 34px/900/자간-1 → 보조문 15px(굵은 "출처 조문"만 `--color-text`).
- "상황으로 시작해 보세요" 마이크로 라벨(11.5px/800/자간1.5) → 상황 칩 6개: `--color-field-bg` 알약, padding 11px 18px, 13.5px/600, 호버 = `--color-surface-hover` + translateY(-1px). **이모지 제거**(기존 🧳🌴 등 → 텍스트만). "더 보기 +7"은 대시 보더 고스트 알약.
- "요즘 많이 찾는 키워드" → 아웃라인 알약 2개, 텍스트 `--color-primary-strong`, 호버 시 보더가 앰버로.
- **컴포저**(하단 고정, max 760px): 알약 입력(radius 500, padding 16px 60px 16px 24px, `--color-field-bg`) + 우측 안쪽 원형 38px 앰버 전송 버튼(↑ 아이콘 `--color-on-primary`, 호버 scale 1.08). 아래 면책 문구 11.5px `--color-text-tertiary` 중앙.

### 2. 질문하기 — 대화 중 (+근거 패널) — ★ 최우선 화면

`components/ChatApp.tsx` 재구성. 기존 3패널(264/스레드/348 상시) → **1컬럼 + 온디맨드 패널**.

- **스레드**: 중앙 단일 컬럼 max 760px, 메시지 간 gap 26px, padding 28px 24px.
- **사용자 말풍선**: 우측 정렬, **앰버 알약**(`--color-primary` 배경 + `--color-on-primary` 텍스트, radius 999, padding 11px 20px, 14.5px/700, max-width 70%). 기존 "잎 그라데이션" 말풍선 폐기(P7).
- **답변**: 카드 없음 — 배경 위 플레인 텍스트(Spotify 콘텐츠-퍼스트). 헤더 행 = HorongMark 18px + "호롱" 13px/800 `--color-text-secondary`. 본문 15px/1.8. 번호 단계 = 24px 원(`--color-primary-weak` 배경 + `--color-primary-strong` 숫자 12.5px/800) + 텍스트. 출처 문구는 12.5px `--color-text-tertiary` 한 줄로 통합.
- **액션 행**: "근거 N개 · 조문 보기" = 앰버 아웃라인 알약(12.5px/800, 보더 `--color-primary-strong`) — **근거 패널 토글**. 열림 상태 = 앰버 채움 + `--color-on-primary`. 복사/도움됨/아쉬움 = 고스트 아웃라인 알약(👍👎 이모지 → 텍스트).
- **근거 패널**: 340px 3번째 플로팅 패널, `--shadow-pop`, 진입 애니메이션 hrUp 0.3s. 헤더 = "근거 조문" 15px/900 + 질문 요약 11.5px + 원형 닫기. 근거 카드: radius 10, `--color-field-bg`, **1위 = `--color-primary-weak` 배경 + `0 0 0 1px --color-primary-strong` inset 링**. 카드 내부: 순위 + 문서명 13.5px/800 + 신뢰도 % + 조문명 12px + 본문 2줄 클램프 12px + 하단 3px 앰버 스코어 바(width=신뢰도%). 푸터 링크 "규정 관계 그래프에서 보기 →".
- **로딩**: "규정 검색 중" + 앰버 점 3개 hrPulse. 전송 버튼은 정지(■) 아이콘으로 교체.
- 모바일: 근거 패널은 하단 시트로.

### 3. 문서 찾기 — 문서/서식 목록 (`/browse`)

`BrowseUI.module.css` 스킨 교체(P9 — 결재선·기한 사전에 동반 적용됨).

- 헤더: "문서 찾기" 30px/900 + 인라인 보조문 13.5px.
- **세그먼트 → 필 탭 3개**(문서/서식/그래프): 활성 = **`--color-text` 배경 + `--color-bg-subtle` 텍스트**(Spotify의 화이트 활성 칩), 비활성 = `--color-field-bg`/`--color-text-secondary`. padding 8px 18px, 13px/700.
- 검색 알약(max 680px) → **패싯: 좌측 체크박스 패널 폐기 → 가로 칩 행**(랩). "전체 357" 활성 칩 = 화이트 칩, 나머지 = `--color-field-bg` 칩 + 카운트(투명도 .55).
- 카운트/페이저 행: "N건 · 1–30 표시" + 페이지 크기 세그먼트(10/30/50, 활성=앰버 알약+`--color-on-primary`) + "1 / 12" + 원형 30px ‹ › 버튼.
- **트랙리스트**: 컬럼 헤더(11px/800/자간1.2, 헤어라인 하단 보더) 아래 행들. 행 = grid `36px minmax(180px,1fr) minmax(110px,190px) minmax(72px,100px) 168px`, gap 12, min-height 52px, radius 8, **호버 = `--color-field-bg` 배경**(보더 없음). 셀: # 13.5px tertiary · 서식명 14.5px/600 + 페이지수 미니 태그(10.5px, 헤어라인 보더, radius 4) · 규정 13px secondary · 번호 13px · 우측 PDF/HWP(아웃라인 알약 11px/800/자간1) + 원문(`--color-surface-hover` 채움 알약).
- 문서 탭 행: grid `36px 1fr 120px 100px 90px` — 문서명+부제(조 수·별지 수) · **분류 = 색점 7px + 분류색 텍스트 12.5px/700** · 최근 개정 · "열기" 알약.

### 4. 문서 찾기 — 그래프 (`/browse` 그래프 탭)

- 같은 헤더/필 탭. 통계는 보조문에 인라인("415 문서 · 690 연결").
- 노드 검색 알약(300px) + 범례 6종(색점 9px + 12.5px 라벨) 한 행.
- 그래프 캔버스: `--color-field-bg` radius 12 카드 + `--shadow-card`. **노드 = 분류색 6종 원**(3~9px, 허브 노드 9px), **엣지 = 소속 클러스터 색 1px, opacity .35**. 배경이 어두워 색이 발광하는 느낌이 나야 한다(기존 라이트 배경 그래프 대비 핵심 차이). 기존 force-graph 로직 유지, 색·배경만 토큰으로.

### 5. 업무 도구 허브 (`/now`)

- 인사말 "좋은 저녁이에요, {이름}님" 30px/900(시간대별) + 보조문.
- **도구 4종 = 2열 와이드 타일**(Spotify 최근 재생 그리드): `--color-field-bg`, radius 10, padding 16px 18px, 좌측 52px 커버 타일(분류색 `+2e` 알파 배경 + 글자 하나 20px/900) + 제목 16px/800 + 설명 13px + 우측 › 셰브론. 호버 = `--color-surface-hover` + translateY(-2px) + `--shadow-card`. **이모지 아이콘(✅🗺📅⏱) 전부 폐기 → 글자 타일**.
- "바로 가기" 마이크로 라벨 + **정사각 카드 5종**(150px): 상단 정사각 글자 타일(34px/900, `--shadow-card`) + 제목 14px/700 + 설명 11.5px 2줄.

### 6. 업무 캘린더 (`/calendar`)

- "매월 챙길 일 5건" = 앰버 위크 배지 + 한 줄 항목 나열 + "펼치기 ▾" — `--color-field-bg` 알약 스트립.
- **이번 달 히어로**: `--color-primary-weak` 배경 + 1px `--color-primary-strong` 보더, radius 12. "7월" 22px/900 + "이번 달" 앰버 알약 배지(11px/800) + 앰버 점 불릿 + 제목 15px/700 + 설명 13px.
- **12개월 그리드 4열**: `--color-field-bg` 카드(radius 10, min-height 118px), 월 숫자 20px/900 + "월" 11px, 항목 = · 불릿 12.5px secondary. 이번 달 카드엔 `0 0 0 1px --color-primary-strong` inset 링. 호버 리프트.
- 하단 각주 11.5px tertiary.

### 7. 결재선 판정기 (`/approval`)

- 검색 알약 + **업무 칩 13종**(카운트 포함) 랩 행 — 기존 좌측 필터 패널 폐기, 직급 필터는 검색행 우측 드롭다운 알약으로(프로토타입엔 카운트 행에 "필터: 비정규직(연구직)"으로 표기).
- 트랙리스트: grid `36px minmax(200px,1fr) minmax(170px,250px) 76px`. 행 = # · [구분 11px/700 tertiary + 업무 경로 14.5px/600 + (해당 시) "비정규직(연구직)" 앰버 아웃라인 미니 알약 10.5px] · 우측 "전결" 11px 라벨 + **전결권자 배지**: 과제책임자 = `--color-primary-weak`+`--color-primary-strong` / 원장 = `--color-text` 배경+`--color-bg-subtle` 텍스트(최고 강조) / 부서장·실팀장 = `--color-surface-hover`+secondary. 부가 배지(원장 결재/협의 연경) = 아웃라인 알약. · "원문" 고스트 알약.

### 8. 관리자 (`/admin`)

- 통계 4카드(`--color-field-bg`, radius 10): 라벨 12px/700 tertiary + 값 30px/900(정답률만 앰버) + 부가설명 12px.
- 좌 "기능 플래그" 카드: 행 = 이름 14px/700 + 설명 12px + ON/OFF 라벨(11px/800, ON=앰버) + **알약 토글 44×24**(ON=`--color-primary` 트랙+백색 노브 좌23px, OFF=`--color-surface-hover` 트랙+노브 좌3px, transition .15s). 기존 `lib/flags.tsx` 로직 그대로.
- 우 "품질 게시판 · 최근 자가평가" 카드: 날짜 + 6px 앰버 진행바(width=정답률) + % 13.5px/800 + 오답 수. 하단 헤어라인 위 미검수 안내 + 링크.

### 9. 모바일 (반응형 규칙)

- 사이드바 → **하단 탭바 3탭**(질문/규정/도구): `--color-bg` radius 18 필 컨테이너, 탭 = 아이콘 19px + 10px 라벨, 활성 = `--color-primary-strong` + /800. 기존 "유리 탭바" 폐기.
- 질문 홈 = 데스크톱 빈 화면의 1열 축소(그리팅 21px, 칩 2열 랩, 컴포저 알약 유지).
- 문서 찾기 = 검색 알약 + 칩 가로 스크롤(활성=화이트 칩) + 밀도 목록(행: 제목 12.5px/600 + 규정·번호 10.5px + PDF 미니 알약).
- 근거는 "근거 N개 보기" → 하단 시트.

### 10. 랜딩/로그인 (`/` 비로그인)

- 전면 `--color-bg-subtle`, 상단 중앙에 앰버 radial glow(`--color-primary-weak`, 720×480 타원, 화면 위로 절반 잘림).
- HorongMark 88px(앰버 drop-shadow glow) → "호롱" 64px/900/자간-2 → 보조문 17px.
- CTA "사내 계정으로 시작" = 앰버 알약(padding 15px 36px, 15px/800, 호버 scale 1.04) + "둘러보기" 아웃라인 알약. 아래 정보 알약 2개(사내 전용 · 문서 기준일).
- 신뢰 지표 3열(22px/800 + 13px tertiary) → 푸터 한 줄. 콘텐츠는 세로 스크롤 허용(작은 뷰포트에서 겹침 금지 — margin-top:auto 패턴).

## Interactions & Behavior

- **내비**: 사이드바 항목 클릭 = 라우트 이동(기존 라우트 전부 보존: `/`, `/browse`, `/now`, `/calendar`, `/approval`, `/admin`…). 화면 진입 시 콘텐츠 영역에 hrUp 애니메이션 1회.
- **근거 패널**: 답변별 "근거 N개" 버튼이 열고 닫음. 다른 답변의 버튼을 누르면 해당 답변 근거로 교체. 화면 이동 시 닫힘. (선택: `근거 패널 자동 열림` 기능 플래그와 연동.)
- **테마 토글**: 라이트↔다크 이진 전환(resolved 기준), `lib/theme.tsx` 유지하되 **system 기본값의 fallback을 dark로** 변경. FOUC 방지 인라인 스크립트 유지.
- **호버**: 행 = 배경만(`--color-field-bg`/`-surface-hover`), 버튼 = scale, 카드 = 리프트+그림자. 포커스 = `:focus-visible`에 `0 0 0 1px --color-text-tertiary` inset 링(입력) / 2px 앰버 아웃라인(버튼) — P8 유지.
- **로딩**: 채팅 = 점 3개 hrPulse + 전송 버튼 ■ 전환. 목록 = 기존 `AsyncState` 유지, 스켈레톤은 `--color-field-bg`.
- **reduced-motion**: 모든 transform·애니메이션 정지.

## State Management

기존 상태 구조 변경 없음. 새로 필요한 것만:

- `ChatApp`: `evidenceOpenFor: messageId | null` (근거 패널 토글 대상).
- 사이드바 라이브러리 = 기존 대화목록 데이터 그대로(fetch 동일), 표시 위치만 이동. 활성 대화 id 하이라이트.
- `browse`: 패싯 선택 상태를 체크박스 배열 → 칩 다중 선택으로(로직 동일, UI만).
- 테마: 기존 3단(라이트/다크/시스템) 유지, 기본 resolved만 다크.

## 구현 순서 (권장 PR 분할)

1. **PR1 — 토큰 교체**: `horong-tokens-v2.css` 반영 + 테마 기본 다크 + 전 화면 스모크 확인(`verify-*.mjs`).
2. **PR2 — 셸**: `Layout.tsx`/`Layout.module.css` → 사이드바 2패널 + 메인 패널 + 상단 검색바. 푸터·배너 제거. 모바일 탭바 교체.
3. **PR3 — ChatApp**: 3패널 해체, 말풍선·답변·근거 패널. (★ 사용자 최우선 화면)
4. **PR4 — BrowseUI 스킨**: 트랙리스트 + 칩 패싯 + 필 탭 → browse/forms/approval/deadlines 4화면 동반 전환(P9).
5. **PR5 — 허브·캘린더·관리자·랜딩** + 그래프 색 토큰화.
6. **PR6 — `docs/design-system.md` 갱신**: P3(고밀도) ·P7(로고 전용)·다크 기본 명시, 이력 추가.

## Assets

- **HorongMark**: 변경 없음 — `web/components/common/HorongMark.tsx` 그대로(다색 그라데이션 유지, `useId()` 충돌 방지 포함). 파비콘 동일.
- **아이콘**: 이모지 전면 폐기. 프로토타입은 24px viewBox 스트로크 1.8~1.9 라운드캡 인라인 SVG 8종(말풍선/돋보기/그리드/캘린더/체크/실드/폰/±) — 동일 스타일로 `components/common/icons.tsx` 신설 권장. path 데이터는 프로토타입 소스에서 추출 가능.
- **커버 타일**: 이미지 없음 — 분류색 6종 알파 배경 + 글자(콘텐츠 색 역할).
- 폰트: Pretendard GOV self-host 유지(P5). 외부 CDN 금지 — 프로토타입의 jsdelivr 링크는 프로토타입 한정.

## Files

- `prototype/호롱 Spotify 리디자인.dc.html` — 인터랙티브 프로토타입(10화면 전환·테마 토글·근거 패널·플래그 토글 동작). 값의 1차 출처.
- `prototype/support.js` — 프로토타입 런타임(참고용, 이식 대상 아님).
- `horong-tokens-v2.css` — globals.css 토큰 두 블록의 드롭인 교체본.
- 원본 리포 참조: `docs/design-system.md`(원칙 정본), `design/horong/`(v1 시안 스냅샷 — 수정 금지), `web/styles/globals.css`(토큰 정본 위치).
