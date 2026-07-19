import ErrorBoundary from "../components/common/ErrorBoundary";
import type { AppProps } from "next/app";
import { ThemeProvider } from "../lib/theme";
import { FlagsProvider } from "../lib/flags";
import { AuthProvider } from "../lib/auth";
import "../styles/globals.css";

// ThemeProvider가 <html data-theme>를 관리(KEI 시맨틱 토큰 분기).
// TDS는 라이선스 무명시로 제거(docs/37 D1) — 컴포넌트는 전부 자체 구현 + 시맨틱 토큰.
export default function App({ Component, pageProps }: AppProps) {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <FlagsProvider>
          <AuthProvider>
            <Component {...pageProps} />
          </AuthProvider>
        </FlagsProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
