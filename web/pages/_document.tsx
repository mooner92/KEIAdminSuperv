import { Html, Head, Main, NextScript } from "next/document";

// 내부 전용 사이트 — 외부 폰트 CDN 없이 시스템 한글 폰트로 폴백(globals.css 폰트 스택).
// 테마: 페인트 전에 data-theme를 설정해 다크모드 깜빡임(FOUC)을 막는다.
const themeInit = `
(function(){try{
  var p = localStorage.getItem('kei-theme') || 'system';
  var dark = p === 'dark' || (p !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}catch(e){}})();
`;

export default function Document() {
  return (
    <Html lang="ko">
      <Head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
