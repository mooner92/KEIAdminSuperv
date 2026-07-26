import Link from "next/link";
import Section from "../common/Section";
import { useEffect, useState } from "react";
import { api, ApiError, type TrustOps } from "../../lib/api";
import DataTable from "../common/DataTable";
import styles from "../../styles/Admin.module.css";

/** 관리자 · 🛡 신뢰(docs/34 ②, flag trust_ops) — 검수의 조준경.
 * 🔒 백엔드가 질문·답변 본문을 반환하지 않는다(P2.5) — 여기 보이는 건 규정 메타·집계뿐. */
export default function AdminTrust() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TrustOps | null>(null);
  const [err, setErr] = useState("");
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    setData(null);
    setErr(""); // 일시 오류 후 기간 변경으로 복구 가능하게(리뷰 확정: 오류 고착)
    let alive = true; // 빠른 기간 전환 시 늦은 응답이 최신 데이터를 덮지 않게
    api.trust(days)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : "불러오기에 실패했습니다."); });
    return () => { alive = false; };
  }, [days, retryTick]);

  const fmt = (t: number) => {
    const d = new Date(t * 1000);
    return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  if (err) {
    return (
      <div>
        <div className={styles.err}>{err}</div>
        <button className={styles.retryBtn} onClick={() => setRetryTick((t) => t + 1)}>다시 시도</button>
      </div>
    );
  }
  if (!data) return <div className={styles.muted}>불러오는 중…</div>;

  return (
    <>
      <div className={styles.trustHead}>
        <p className={styles.muted}>
          🔒 질문·답변 본문은 표시되지 않아요 — 어떤 규정을 먼저 검수하면 위험이 줄어드는지만 봅니다.
        </p>
        <label className={styles.muted}>
          기간{" "}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="집계 기간">
            <option value={7}>7일</option>
            <option value={30}>30일</option>
            <option value={90}>90일</option>
          </select>
        </label>
      </div>

      <Section icon="🚨" title="고위험 답변 레이더" badge={data.radar.length}
        desc="금액이 포함됐는데 근거가 미검수인 답변 — 먼저 검수하면 위험이 크게 줄어요.">
      {data.radar.length === 0 ? (
        <p className={styles.muted}>해당 없음 — 미검수 근거로 금액을 답한 사례가 없어요. 👍</p>
      ) : (
        <DataTable
          rows={data.radar}
          cols={[
            { key: "at", head: "시각", render: (r: any) => fmt(r.at) },
            { key: "src", head: "인용 근거(현재 검수상태)", wrap: true, render: (r: any) => r.근거.map((s: any, j: number) => (
              <span key={j} className={styles.srcChip} data-unrev={s.검수상태 !== "검수완료" || undefined}>
                {s.slug ? <Link href={`/d/${encodeURIComponent(s.slug)}/`}>{s.규정명}</Link> : s.규정명}
                {s.조 ? ` ${s.조}` : ""}{s.검수상태 !== "검수완료" ? " ⚠" : ""}
              </span>
            )) },
            { key: "n", head: "미검수", num: true, render: (r: any) => r.n_unreviewed },
          ]}
        />
      )}

      </Section>

      <Section icon="📐" title="수요 × 품질"
        desc="많이 인용되는데 미검수인 문서부터 검수하면 효과가 큽니다.">
      <DataTable
        rows={data.matrix.slice(0, 20)}
        rowKey={(m: any) => m.규정명}
        cols={[
          { key: "reg", head: "규정", wrap: true, render: (m: any) => (m.slug
            ? <Link href={`/d/${encodeURIComponent(m.slug)}/`}>{m.규정명}</Link> : m.규정명) },
          { key: "cite", head: "인용수", num: true, render: (m: any) => m.인용수 },
          { key: "rev", head: "검수상태", render: (m: any) => (m.검수상태 === "검수완료" ? "✅ 검수완료" : "⚠ 미검수") },
          { key: "down", head: "👎", num: true, render: (m: any) => m.down ?? 0 },
        ]}
      />

      </Section>

      <Section icon="👎" title="피드백 유형">
      {data.feedback_types.length === 0 ? (
        <p className={styles.muted}>기간 내 👎 피드백이 없어요.</p>
      ) : (
        <>
          <div className={styles.typeChips}>
            {data.feedback_types.map((t) => (
              <span key={t.유형} className={styles.srcChip}>{t.유형} {t.n}</span>
            ))}
          </div>
          <ul className={styles.reasonList}>
            {data.feedback_reasons.map((r, i) => (
              <li key={i}><b>[{r.유형}]</b> {r.사유} <span className={styles.muted}>({fmt(r.at)})</span></li>
            ))}
          </ul>
        </>
      )}
      </Section>
    </>
  );
}
