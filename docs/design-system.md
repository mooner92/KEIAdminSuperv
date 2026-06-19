# KEI 행정 가이드 — 디자인 시스템 (Design System)

> 사내 웹 서비스의 UI를 **일관되게** 만들고 유지하기 위한 원칙·토큰·컴포넌트 규약.
> 기반: **Toss Design System(TDS) 파운데이션** + **Next.js**. 코드: [`../web/`](../web/).

---

## 0. 기술 스택 (확정)
- **Next.js 14 (Pages Router)** + TypeScript. 전사 방침: 원내 서비스는 Next.js로 개발.
- **정적 export**(`output: "export"`) → `nginx 127.0.0.1` → Cloudflare Zero Trust(사내 전용). 서버 런타임 불필요.
- **Toss Design System**: `@toss/tds-mobile` · `@toss/tds-mobile-ait`(Provider) + `@emotion/react`. React 18 고정(TDS peer).
- 스타일: **CSS 변수 토큰 + CSS Modules**(SSG 안전). 콘텐츠 렌더는 `react-markdown` + `remark-gfm`.
  - Pages Router를 택한 이유: TDS(emotion 기반)와 SSG에 마찰이 적다. App Router는 emotion 레지스트리 셋업 후 향후 검토.

---

## 1. 디자인 원칙
1. **가독성 우선.** 밀집 표(legacy)를 버리고 여백·계층·타이포로 "읽기 쉬움"을 만든다. 한 행 = 한 문서, 메타데이터는 보조.
2. **TDS 파운데이션 위에.** 색·타이포·간격은 TDS 토큰을 원자로 쓰고, 그 위에 **KEI 시맨틱 토큰**을 얹는다.
3. **시맨틱 토큰만 본다.** 컴포넌트는 `--blue500` 같은 원자색을 직접 쓰지 않고 `--color-primary` 같은 **의미 토큰**만 참조한다. → 브랜드 컬러 교체가 한 곳에서 끝난다.
4. **데스크톱 우선 반응형.** 주 사용 환경은 데스크톱(밀집 정보). TDS는 모바일 DS이므로 **토큰·필요한 컴포넌트만** 차용하고 레이아웃은 데스크톱에 맞춘다. 모바일은 1열로 우아하게 무너진다.
5. **내부 전용.** 외부 폰트/애널리틱스/CDN 의존을 피한다(시스템 한글 폰트 폴백, `noindex`). 데이터는 망 밖으로 안 나간다.
6. **콘텐츠와 코드 분리.** 볼트(규정 마크다운)는 `web/` 밖에 있고 빌드타임 read-only로만 소비한다. UI 코드만 레포에 둔다.

---

## 2. 컬러 토큰
원자 팔레트(TDS) → KEI 시맨틱 토큰. 정의: [`../web/styles/globals.css`](../web/styles/globals.css).

| 시맨틱 토큰 | 현재 매핑(TDS) | 용도 |
|---|---|---|
| `--color-primary` | `blue500` `#3182f6` | 주요 액션·링크·선택 |
| `--color-text` / `-secondary` / `-tertiary` | `grey900/600/500` | 본문 / 보조 / 흐림 |
| `--color-bg` / `-bg-subtle` | `#fff` / `grey50` | 페이지 / 옅은 배경 |
| `--color-surface` | `#fff` | 카드·리스트 표면 |
| `--color-border` / `-strong` | `grey200/300` | 구분선 |
| `--color-success/warning/danger` | `green500/orange500/red500` | 상태(검수완료/미검수/경고) |
| `--accent-규정집/가이드/용어집` | `blue/green/orange 500` | 섹션 구분 칩 |

> [!tip] KEI 메인 컬러로 바꾸기
> `globals.css`의 **`[KEI 시맨틱 토큰]` 블록만** 교체한다(예: `--color-primary: #<KEI색>`). 컴포넌트는 안 건드린다.
> TDS 컴포넌트 자체 색은 `ThemeProvider({ token })`(seed token)로 재정의 가능 — 도입 시점에 연결.

---

## 3. 타이포그래피 · 간격
- 폰트: `Pretendard` → 시스템 한글 폰트 폴백. 본문 15.5px / 1.55–1.75. 한글은 `word-break: keep-all`.
- 위계: 페이지 제목 26–28px/800, 섹션(제N조 등) 17–20px/700, 본문 15.5px.
- 간격 스케일(4의 배수): `--space-1`(4) … `--space-8`(48). 모서리: `--radius-sm/md/lg` = 6/10/16.
- 그림자: `--shadow-card`(은은) / `--shadow-pop`(팝오버).

---

## 4. 컴포넌트 규약
| 컴포넌트 | 위치 | 규약 |
|---|---|---|
| **Layout** | `web/components/Layout.tsx` | sticky 헤더(브랜드+사내전용 플래그) · `--maxw`(1120) 중앙 정렬 · breadcrumb · footer(내부전용 고지) |
| **목록(GuideList)** | `web/components/GuideList.tsx` | TDS `SegmentedControl`(섹션 탭) + `SearchField`(검색) + 행. 행 = `규정번호 │ 제목·칩 │ 개정일·상태badge`. hover 강조, 1열 반응형 |
| **칩(섹션)** | — | 규정집=blue, 가이드=green, 용어집=orange. `data-section`으로 색 분기 |
| **상태 배지** | — | `미검수`=orange, `검수완료`=green. 항상 표시(거버넌스) |
| **Markdown** | `web/components/Markdown.tsx` | `[[위키링크]]`는 빌드타임에 `/d/<slug>/#조` 링크로 변환 → 내부는 `next/link`. **제N조 헤딩에 id 부여 → 조 단위 점프(앵커)**. 표/인용/코드 토큰 스타일 |
| **관계 그래프** | `web/components/GraphCanvas.tsx` | `react-force-graph-2d`로 규정 상호참조를 노드·간선으로 시각화. 노드 클릭 → 해당 문서로 이동. 코드 스플릿(동적 import)으로 초기 번들과 분리 |
| TDS 컴포넌트 | `@toss/tds-mobile` | `TDSMobileAITProvider`로 감싼다. `SearchField`·`SegmentedControl` 등 데스크톱에 맞는 것부터 점진 도입 |

---

## 5. 접근성
- 키보드 포커스 링(`:focus-visible`), 탭 `role="tab"`/`aria-selected`, 검색 `aria-label`, breadcrumb `aria-label`.
- 색만으로 정보 전달 금지(칩/배지에 텍스트 병기). 본문 대비 AA 이상.

---

## 6. 로드맵 (이 디자인 시스템 기준)
- [x] W0 파운데이션: Next.js+TDS 스캐폴드, 토큰, 정적 export
- [x] W1 목록·문서·검색·백링크 (가독성 재설계)
- [x] W2 TDS 컴포넌트 심화(`SearchField`·`SegmentedControl` 도입 — 목록 검색/섹션탭)
- [x] W2 제N조 단위 앵커(헤딩 id) → 조 단위 점프
- [x] W3 관계 그래프 뷰(`react-force-graph-2d`, 노드 클릭→문서 이동, 코드 스플릿)
- [ ] KEI 메인 컬러 토큰 교체 (미정 — 사용자가 색을 주면 `globals.css` 토큰 한 블록 교체)
- [ ] 번들 경량화(현재 first-load ~388KB, TDS)
- [ ] TDS 컴포넌트 추가 확대

> 최종 수정: 2026-06-19 · 변경 시 이 문서를 먼저 갱신하고 코드에 반영한다(원칙 3 일관성).
