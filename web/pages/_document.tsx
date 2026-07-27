import { Html, Head, Main, NextScript } from "next/document";

// 폰트(docs/37 D3): Pretendard GOV(SIL OFL, KRDS 공식 서체)를 self-host —
// 외부 CDN 없이 /fonts/의 dynamic-subset 로드(필요 글리프 범위만, font-display:swap). 미로드 시 시스템 폰트 폴백.
// 테마: 페인트 전에 data-theme를 설정해 다크모드 깜빡임(FOUC)을 막는다.
const themeInit = `
(function(){try{
  var p = localStorage.getItem('kei-theme');
  var dark = p ? (p === 'dark' || (p !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)) : true; /* v2: 무선호=다크 기본 */
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}catch(e){}})();
`;

export default function Document() {
  return (
    <Html lang="ko">
      <Head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="stylesheet" href="/fonts/pretendard-gov.css" />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
