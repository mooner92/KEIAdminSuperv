import { useEffect, useState } from "react";
import Section from "../common/Section";
import { api, type FeedbackRow, type Stats, type Usage } from "../../lib/api";
import styles from "../../styles/Admin.module.css";

// 📊 운영 대시보드(docs/12 P2.5) — 자체 데이터 소유(stats·usage 요약·👎 사유). 관리자 접근은
// 부모(admin 페이지)가 게이트로 방어하므로 여기선 데이터만 가져온다. 상세 사용량은 📈 통계 탭.
// 🔒 개인정보: 집계만·k-익명(질문/답변 본문 미반환).
export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [downs, setDowns] = useState<FeedbackRow[] | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    api.stats(days).then(setStats).catch(() => {});
    api.usage(days).then(setUsage).catch(() => {});
    api.feedbackList("down").then(setDowns).catch(() => {});
  }, [days]);

  const goUsage = () => { window.location.hash = "usage"; };

  return (
    <>
      {stats ? (
        <Section icon="📊" title="운영 대시보드"
          actions={
            <select className={styles.daysSel} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="집계 기간">
              <option value={1}>오늘(1일)</option>
              <option value={7}>주간(7일)</option>
              <option value={30}>월간(30일)</option>
            </select>
          }>
          <p className={styles.privacy}>
            🔒 개인정보 보호: 인기 질문·콘텐츠 갭은 서로 다른 <b>{stats.k_anon}명 이상</b>이 물은 항목만
            집계로 표시됩니다. 개별 채팅 내용·작성자는 관리자도 볼 수 없습니다.
          </p>
          <div className={styles.cards}>
            <div className={styles.card}><div className={styles.cardN}>{stats.users}</div><div className={styles.cardL}>사용자</div></div>
            <div className={styles.card}><div className={styles.cardN}>{stats.chats}</div><div className={styles.cardL}>대화</div></div>
            <div className={styles.card}><div className={styles.cardN}>{stats.questions}</div><div className={styles.cardL}>질문</div></div>
            <div className={styles.card}><div className={styles.cardN}>{Math.round(stats.refusal_rate * 100)}%</div><div className={styles.cardL}>거부율 ({stats.refusals}/{stats.answers})</div></div>
            <div className={styles.card}><div className={styles.cardN}>👍 {stats.feedback.up} · 👎 {stats.feedback.down}</div><div className={styles.cardL}>피드백</div></div>
          </div>
          <div className={styles.dashGrid}>
            <div>
              <h3 className={styles.h3}>인기 질문</h3>
              <ol className={styles.qlist}>
                {stats.top_questions.map((q, i) => <li key={i}><span className={styles.qn}>{q.n}</span> {q.q}</li>)}
                {stats.top_questions.length === 0 ? <li className={styles.muted}>{stats.k_anon}명 이상이 물은 질문이 아직 없습니다</li> : null}
              </ol>
            </div>
            <div>
              <h3 className={styles.h3}>콘텐츠 갭 <span className={styles.muted}>(거부된 질문 — 보강 우선순위)</span></h3>
              <ol className={styles.qlist}>
                {stats.gaps.map((q, i) => <li key={i}><span className={`${styles.qn} ${styles.qnGap}`}>{q.n}</span> {q.q}</li>)}
                {stats.gaps.length === 0 ? <li className={styles.muted}>반복된 거부 질문 없음 👍</li> : null}
              </ol>
            </div>
          </div>
        </Section>
      ) : <p className={styles.lead}>불러오는 중…</p>}

      {usage && usage.events.length > 0 ? (
        <p className={styles.muted}>
          📈 최근 {usage.days}일 이벤트 {usage.events.reduce((s, e) => s + e.n, 0).toLocaleString()}건
          — 그래프·상세는 <button className={styles.tabBtn} onClick={goUsage}>📈 통계</button> 탭에서.
        </p>
      ) : null}

      {downs && downs.length > 0 ? (
        <Section icon="👎" title="부정 피드백 사유" badge={Math.min(downs.length, 20)}>
          <p className={styles.privacy}>🔒 질문·답변 본문은 표시하지 않습니다 — 근거 규정 메타와 사유만(검수 우선순위 참고용).</p>
          <ul className={styles.qlist}>
            {downs.slice(0, 20).map((fb, i) => (
              <li key={i}>
                <b>{fb.sources?.map((s2) => `${s2.규정명} ${s2.조}`.trim()).slice(0, 2).join(", ") || "(근거 메타 없음)"}</b>
                {fb.reason ? <> — “{fb.reason}”</> : <span className={styles.muted}> (사유 없음)</span>}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
