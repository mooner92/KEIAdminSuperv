import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import Layout from "../components/Layout";
import { api, ApiError, type FlagMeta, type FlagAudit, type Stats } from "../lib/api";
import styles from "../styles/Admin.module.css";

// 기능 플래그 관리자 페이지. 관리자만 접근(백엔드 /flags/manage가 403로 막음 → 안내).
// 정적 export라 데이터는 클라이언트에서 런타임 fetch.
export default function AdminPage() {
  const [flags, setFlags] = useState<FlagMeta[] | null>(null);
  const [audit, setAudit] = useState<FlagAudit[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [admin, setAdmin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const loadAudit = useCallback(() => {
    api.flagsAudit().then(setAudit).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api
      .flagsManage()
      .then((r) => {
        setFlags(r.flags);
        setAdmin(r.admin);
        setErr("");
        loadAudit();
        api.stats().then(setStats).catch(() => {});
      })
      .catch((e) => {
        if (e instanceof ApiError) {
          setErr(
            e.status === 403
              ? "관리자 전용 페이지입니다. (APP_ADMINS에 등록된 계정으로 로그인 필요)"
              : e.status === 401
                ? "로그인이 필요합니다."
                : e.message
          );
        } else {
          setErr("불러오기에 실패했습니다.");
        }
      });
  }, [loadAudit]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (f: FlagMeta) => {
    setBusy(f.key);
    try {
      const u = await api.setFlag(f.key, !f.enabled);
      setFlags(
        (prev) =>
          prev?.map((x) =>
            x.key === f.key ? { ...x, enabled: u.enabled, updated_by: u.updated_by, updated_at: u.updated_at } : x
          ) ?? null
      );
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "토글 실패");
    } finally {
      setBusy("");
    }
  };

  return (
    <Layout
      breadcrumb={
        <span>
          <Link href="/">전직원 연구행정 가이드</Link>
          <span className={styles.sep}>›</span>관리자
        </span>
      }
    >
      <Head>
        <title>관리자 · 대시보드</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <h1 className={styles.h1}>관리자</h1>

      {err ? <div className={styles.err}>{err}</div> : null}

      {stats ? (
        <section className={styles.dash}>
          <h2 className={styles.h2}>
            운영 대시보드 <span className={styles.dashDays}>최근 {stats.days}일</span>
          </h2>
          <p className={styles.privacy}>
            🔒 개인정보 보호: 인기 질문·콘텐츠 갭은 서로 다른 <b>{stats.k_anon}명 이상</b>이 물은 항목만
            집계(숫자=질문한 사용자 수)로 표시됩니다. 개별 채팅 내용·작성자는 관리자도 볼 수 없습니다.
          </p>
          <div className={styles.cards}>
            <div className={styles.card}>
              <div className={styles.cardN}>{stats.users}</div>
              <div className={styles.cardL}>사용자</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardN}>{stats.chats}</div>
              <div className={styles.cardL}>대화</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardN}>{stats.questions}</div>
              <div className={styles.cardL}>질문</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardN}>{Math.round(stats.refusal_rate * 100)}%</div>
              <div className={styles.cardL}>거부율 ({stats.refusals}/{stats.answers})</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardN}>👍 {stats.feedback.up} · 👎 {stats.feedback.down}</div>
              <div className={styles.cardL}>피드백</div>
            </div>
          </div>
          <div className={styles.dashGrid}>
            <div>
              <h3 className={styles.h3}>인기 질문</h3>
              <ol className={styles.qlist}>
                {stats.top_questions.map((q, i) => (
                  <li key={i}>
                    <span className={styles.qn}>{q.n}</span> {q.q}
                  </li>
                ))}
                {stats.top_questions.length === 0 ? (
                  <li className={styles.muted}>{stats.k_anon}명 이상이 물은 질문이 아직 없습니다</li>
                ) : null}
              </ol>
            </div>
            <div>
              <h3 className={styles.h3}>
                콘텐츠 갭 <span className={styles.muted}>(거부된 질문 — 보강 우선순위)</span>
              </h3>
              <ol className={styles.qlist}>
                {stats.gaps.map((q, i) => (
                  <li key={i}>
                    <span className={`${styles.qn} ${styles.qnGap}`}>{q.n}</span> {q.q}
                  </li>
                ))}
                {stats.gaps.length === 0 ? (
                  <li className={styles.muted}>반복된 거부 질문 없음 👍</li>
                ) : null}
              </ol>
            </div>
          </div>
        </section>
      ) : null}

      <h2 className={styles.h2}>기능 플래그 관리</h2>
      <p className={styles.lead}>
        새 기능을 켜고/끕니다. 변경은 <b>즉시 반영</b>(재배포 불필요)되고 <b>감사 기록</b>이 남습니다.
        다 쓴 플래그는 만료일에 맞춰 코드에서 제거하세요.
      </p>

      {flags ? (
        <>
          <div className={styles.who}>로그인 관리자: <b>{admin}</b></div>
          <ul className={styles.list}>
            {flags.map((f) => (
              <li key={f.key} className={styles.row}>
                <div className={styles.meta}>
                  <code className={styles.key}>{f.key}</code>
                  <div className={styles.desc}>{f.description}</div>
                  <div className={styles.subline}>
                    소유 {f.owner || "—"} · 만료 {f.expires || "장수(상시)"}
                    {f.updated_by ? ` · 최근 변경 ${f.updated_by}` : ""}
                  </div>
                </div>
                <button
                  className={`${styles.toggle} ${f.enabled ? styles.on : ""}`}
                  disabled={busy === f.key}
                  onClick={() => toggle(f)}
                  role="switch"
                  aria-checked={f.enabled}
                  aria-label={`${f.key} ${f.enabled ? "끄기" : "켜기"}`}
                >
                  <span className={styles.knob} />
                </button>
              </li>
            ))}
          </ul>

          <h2 className={styles.h2}>변경 이력 (감사)</h2>
          <ul className={styles.audit}>
            {audit.map((a, i) => (
              <li key={i}>
                <span className={styles.at}>{new Date(a.at * 1000).toLocaleString("ko-KR")}</span> ·{" "}
                <b>{a.key}</b> → <span className={a.enabled ? styles.tOn : styles.tOff}>{a.enabled ? "ON" : "OFF"}</span> ·{" "}
                {a.actor}
              </li>
            ))}
            {audit.length === 0 ? <li className={styles.muted}>이력 없음</li> : null}
          </ul>
        </>
      ) : !err ? (
        <div className={styles.muted}>불러오는 중…</div>
      ) : null}
    </Layout>
  );
}
