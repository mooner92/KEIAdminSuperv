import type { AppProps } from "next/app";
import { TDSMobileAITProvider } from "@toss/tds-mobile-ait";
import "../styles/globals.css";

// TDS Provider가 전역 CSS 변수(--adaptive*)와 컴포넌트 동작을 셋업한다.
export default function App({ Component, pageProps }: AppProps) {
  return (
    <TDSMobileAITProvider>
      <Component {...pageProps} />
    </TDSMobileAITProvider>
  );
}
