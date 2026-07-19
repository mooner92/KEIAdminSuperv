// v1 ⑮(#48): 전역 ErrorBoundary — 렌더 오류 시 백지 대신 한국어 안내 + 새로고침.
import { Component, type ReactNode } from "react";

export default class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error("[KEI ErrorBoundary]", err); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ padding: "80px 24px", textAlign: "center", color: "var(--color-text-secondary)" }}>
        <div style={{ fontSize: 36 }}>🛠</div>
        <h1 style={{ fontSize: 20, color: "var(--color-text)" }}>화면에 문제가 생겼어요</h1>
        <p style={{ fontSize: 14 }}>일시적인 오류일 수 있어요. 새로고침으로 복구되지 않으면 관리자에게 알려주세요.</p>
        <button onClick={() => window.location.reload()}
          style={{ marginTop: 12, padding: "8px 18px", borderRadius: 8, border: "1px solid var(--color-primary)",
                   background: "var(--color-primary)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
          🔄 새로고침
        </button>
      </div>
    );
  }
}
