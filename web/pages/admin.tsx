import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import Layout from "../components/Layout";
import { api, ApiError, type FlagMeta, type FlagAudit } from "../lib/api";
import styles from "../styles/Admin.module.css";

// 기능 플래그 관리자 페이지. 관리자만 접근(백엔드 /flags/manage가 403로 막음 → 안내).
// 정적 export라 데이터는 클라이언트에서 런타임 fetch.
export default function AdminPage() {
  const [flags, setFlags] = useState<FlagMeta[] | null>(null);
  const [audit, setAudit] = useState<FlagAudit[]>([]);
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
        <title>관리자 · 기능 플래그</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <h1 className={styles.h1}>기능 플래그 관리</h1>
      <p className={styles.lead}>
        새 기능을 켜고/끕니다. 변경은 <b>즉시 반영</b>(재배포 불필요)되고 <b>감사 기록</b>이 남습니다.
        다 쓴 플래그는 만료일에 맞춰 코드에서 제거하세요.
      </p>

      {err ? <div className={styles.err}>{err}</div> : null}

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
