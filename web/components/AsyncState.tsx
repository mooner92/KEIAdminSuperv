// v1 ⑪(S8-#17): 공용 비동기 상태 — 로딩·에러(재시도)·빈 상태를 한 컴포넌트로 통일.
// 6곳(문서 드로어·그래프 패널·결재선 드로어/페이지·인증 게이트 등)이 제각각이던 표현을 맞춘다.
import styles from "./AsyncState.module.css";

export default function AsyncState({
  loading,
  error,
  onRetry,
  empty,
  emptyText,
  loadingText = "불러오는 중…",
}: {
  loading?: boolean;
  error?: string;
  /** 있으면 에러 시 '다시 시도' 버튼 표시 */
  onRetry?: () => void;
  empty?: boolean;
  emptyText?: string;
  loadingText?: string;
}) {
  if (loading)
    return (
      <div className={styles.box} role="status" aria-live="polite">
        <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
        {loadingText}
      </div>
    );
  if (error)
    return (
      <div className={styles.box} role="alert">
        <div className={styles.err}>⚠ {error}</div>
        {onRetry ? (
          <button type="button" className={styles.retry} onClick={onRetry}>🔄 다시 시도</button>
        ) : null}
      </div>
    );
  if (empty) return <div className={styles.box}>{emptyText}</div>;
  return null;
}
