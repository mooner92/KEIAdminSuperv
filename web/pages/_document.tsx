import { Html, Head, Main, NextScript } from "next/document";

// 내부 전용 사이트 — 외부 폰트 CDN 없이 시스템 한글 폰트로 폴백(globals.css 폰트 스택).
export default function Document() {
  return (
    <Html lang="ko">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
