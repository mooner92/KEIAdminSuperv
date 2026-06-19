import type { AppProps } from "next/app";
import { TDSMobileAITProvider } from "@toss/tds-mobile-ait";
import { ThemeProvider } from "../lib/theme";
import "../styles/globals.css";

// ThemeProvider가 <html data-theme>를 관리(KEI 시맨틱 토큰 분기),
// TDS Provider는 전역 CSS 변수·컴포넌트 동작을 셋업한다. TDS 컴포넌트의 다크 적용은
// 사용처에서 <ColorSchemeArea theme={resolved}>로 감싼다(현재 Explorer의 SearchField).
export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider>
      <TDSMobileAITProvider>
        <Component {...pageProps} />
      </TDSMobileAITProvider>
    </ThemeProvider>
  );
}
