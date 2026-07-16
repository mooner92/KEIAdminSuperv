import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import Layout from "../components/Layout";
import AdminCorpus from "../components/AdminCorpus";
import AdminFlags from "../components/AdminFlags";
import AdminReports from "../components/AdminReports";
import AdminTableRestore from "../components/AdminTableRestore";
import AdminTrust from "../components/AdminTrust";
import AdminUsers from "../components/AdminUsers";
import { api, ApiError, type FeedbackRow, type Stats, type Usage } from "../lib/api";
import { SITE_NAME } from "../lib/site";
import { useFlag } from "../lib/flags";
import styles from "../styles/Admin.module.css";

// 관리자 페이지(v1.1 UX 개편, docs/21) — 탭 셸: 대시보드 / 코퍼스 관리 / 기능 플래그.
// 탭 상태는 URL 해시(#corpus 등)와 동기화(새로고침·딥링크 유지). 접근은 백엔드 403이 방어.
type Tab = "dash" | "corpus" | "restore" | "trust" | "reports" | "users" | "flags";
const TABS: { k: Tab; label: string }[] = [
  { k: "dash", label: "📊 대시보드" },
  { k: "corpus", label: "📚 코퍼스 관리" },
  { k: "restore", label: "🔧 표 복원" },
  { k: "trust", label: "🛡 신뢰" },
  { k: "reports", label: "📮 의견함" },
  { k: "users", label: "👥 사용자" },
  { k: "flags", label: "🚩 기능 플래그" },
];

export default function AdminPage() {
  const corpusOn = useFlag("corpus_admin");
  const restoreOn = useFlag("table_restore");
  const usersOn = useFlag("user_directory");
  const trustOn = useFlag("trust_ops");
  const reportsOn = useFlag("feedback_center"); // docs/51: 📮 의견함
  const [tab, setTab] = useState<Tab>("dash");
  const [gate, setGate] = useState<"loading" | "ok" | string>("loading");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statDays, setStatDays] = useState(30); // docs/34 ③: 대시보드 기간 필터(일/주/월)
  const [downs, setDowns] = useState<FeedbackRow[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null); // docs/35: 기능 사용량(집계만)

  // 해시 ↔ 탭 동기화(딥링크·새로고침 유지)
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "") as Tab;
      if (["dash", "corpus", "restore", "trust", "reports", "users", "flags"].includes(h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const go = (t: Tab) => { setTab(t); window.history.replaceState(null, "", `#${t}`); };

  const load = useCallback(() => {
    api.flagsManage()
      .then(() => {
        setGate("ok");
        api.stats(statDays).then(setStats).catch(() => {});
        api.usage(statDays).then(setUsage).catch(() => {});
        api.feedbackList("down").then(setDowns).catch(() => {});
      })
      .catch((e) => {
        setGate(e instanceof ApiError
          ? (e.status === 403 ? "관리자 전용 페이지입니다. (APP_ADMINS에 등록된 계정으로 로그인 필요)"
            : e.status === 401 ? "로그인이 필요합니다." : e.message)
          : "불러오기에 실패했습니다.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statDays]);
  useEffect(load, [load]);

  return (
    <Layout breadcrumb={<span><Link href="/">{SITE_NAME}</Link><span className={styles.sep}>›</span>관리자</span>}>
      <Head>
        <title>{`관리자 · ${SITE_NAME}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <h1 className={styles.h1}>관리자</h1>
      {gate !== "ok" ? (
        <div className={styles.err}>{gate === "loading" ? "확인 중…" : gate}</div>
      ) : (
        <>
          <nav className={styles.tabBar} role="tablist" aria-label="관리자 메뉴">
            {TABS.filter((t) => (t.k !== "corpus" || corpusOn) && (t.k !== "restore" || restoreOn)
              && (t.k !== "users" || usersOn) && (t.k !== "trust" || trustOn)
              && (t.k !== "reports" || reportsOn)).map((t) => (
              <button key={t.k} role="tab" aria-selected={tab === t.k}
                className={`${styles.tabBtn} ${tab === t.k ? styles.tabOn : ""}`}
                onClick={() => go(t.k)}>
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "dash" ? (
            <section>
              {stats ? (
                <section className={styles.dash}>
                  <h2 className={styles.h2}>운영 대시보드{" "}
                    <select className={styles.daysSel} value={statDays} onChange={(e) => setStatDays(Number(e.target.value))} aria-label="집계 기간">
                      <option value={1}>오늘(1일)</option>
                      <option value={7}>주간(7일)</option>
                      <option value={30}>월간(30일)</option>
                    </select>
                  </h2>
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
                </section>
              ) : <p className={styles.lead}>불러오는 중…</p>}
              {usage && usage.events.length > 0 ? (
                <section className={styles.dash}>
                  <h2 className={styles.h2}>📈 기능 사용량 <span className={styles.dashDays}>최근 {usage.days}일 · 집계만 표시(개별 행위 미노출·{usage.min_users}명 미만은 가림)</span></h2>
                  <div className={styles.usageGrid}>
                    <div>
                      <h3 className={styles.h3}>이벤트별</h3>
                      <table className={styles.table}>
                        <thead><tr><th>이벤트</th><th>횟수</th><th>사용자</th></tr></thead>
                        <tbody>
                          {usage.events.slice(0, 12).map((e) => (
                            /* users=null → k-익명 마스킹(서버) — 소수 사용자의 활동 특정 방지 */
                            <tr key={e.name}><td>{e.name}</td><td>{e.n}</td><td>{e.users ?? `${usage.min_users}명 미만`}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <h3 className={styles.h3}>페이지뷰 상위 <span className={styles.muted}>({usage.min_users}명 이상 본 경로만)</span></h3>
                      <table className={styles.table}>
                        <thead><tr><th>경로</th><th>뷰</th></tr></thead>
                        <tbody>
                          {usage.pages.map((pg) => (
                            <tr key={pg.page}><td>{pg.page}</td><td>{pg.n}</td></tr>
                          ))}
                          {usage.pages.length === 0 ? (
                            <tr><td colSpan={2} className={styles.muted}>표시할 경로 없음(k-익명 기준 미달)</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                      <h3 className={styles.h3}>일별 활성 사용자</h3>
                      <p className={styles.muted}>
                        {usage.dau.map((d) => `${d.day.slice(5)}: ${d.users ?? `<${usage.min_users}`}`).join(" · ") || "데이터 없음"}
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}
              {downs && downs.length > 0 ? (
                <section className={styles.dash}>
                  <h2 className={styles.h2}>👎 부정 피드백 사유 <span className={styles.dashDays}>최근 {Math.min(downs.length, 20)}건</span></h2>
                  <p className={styles.privacy}>🔒 질문·답변 본문은 표시하지 않습니다 — 근거 규정 메타와 사유만(검수 우선순위 참고용).</p>
                  <ul className={styles.qlist}>
                    {downs.slice(0, 20).map((fb, i) => (
                      <li key={i}>
                        <b>{fb.sources?.map((s2) => `${s2.규정명} ${s2.조}`.trim()).slice(0, 2).join(", ") || "(근거 메타 없음)"}</b>
                        {fb.reason ? <> — “{fb.reason}”</> : <span className={styles.muted}> (사유 없음)</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </section>
          ) : null}

          {tab === "corpus" && corpusOn ? <AdminCorpus /> : null}
          {tab === "restore" && restoreOn ? <AdminTableRestore /> : null}
          {tab === "trust" && trustOn ? <AdminTrust /> : null}
          {tab === "reports" && reportsOn ? <AdminReports /> : null}
          {tab === "users" && usersOn ? <AdminUsers /> : null}
          {tab === "flags" ? <AdminFlags /> : null}
        </>
      )}
    </Layout>
  );
}
