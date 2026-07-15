# NOTICE — 서드파티 고지 (web/)

이 웹앱이 포함·사용하는 서드파티 자산과 라이선스 목록입니다. (docs/37 D4)

## 서체

- **Pretendard GOV** — Copyright (c) 2021, Kil Hyung-jin. **SIL Open Font License 1.1**
  (전문: `web/public/fonts/OFL.txt`). KRDS(대한민국 정부 디자인 시스템) 공식 서체.
  `web/public/fonts/`에 dynamic-subset woff2로 self-host(외부 CDN 미사용).
  출처: https://github.com/orioncactus/pretendard

## 디자인 참고

- **KRDS(대한민국 정부 디자인 시스템)** — 색상 팔레트 값을 공식 토큰
  (github.com/KRDS-uiux/krds-uiux, 행정안전부)에서 참고해 자체 토큰 체계
  (`web/styles/globals.css`)에 반입. 컴포넌트 마크업/코드는 미사용(전부 자체 구현).
- Toss Design System(TDS)은 라이선스 무명시로 **2026-07 완전 제거**(docs/37 D1) —
  현재 코드에 TDS 의존성·코드 없음.

## 오픈소스 라이브러리 (npm dependencies, 전부 MIT)

- next, react, react-dom — MIT
- react-markdown, remark-gfm — MIT
- react-force-graph-2d — MIT
- gray-matter — MIT

(개발 의존성은 package.json 참조. 상세 라이선스 전문은 각 패키지 배포물 동봉본 기준.)
