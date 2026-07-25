import { useCallback, useEffect, useMemo, useState } from "react";
import SearchInput from "../common/SearchInput";
import { api, type FlagAudit, type FlagMeta } from "../../lib/api";
import styles from "../../styles/Admin.module.css";

/** 기능 플래그 탭(v1.1, docs/21 §3) — 컴팩트 행(1줄 요약↔펼침) + 검색·상태 필터 + 접이식 감사 이력. */
export default function AdminFlags() {
  const [flags, setFlags] = useState<FlagMeta[] | null>(null);
  const [audit, setAudit] = useState<FlagAudit[]>([]);
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const [filt, setFilt] = useState<"all" | "on" | "off" | "exp">("all");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(() => {
    api.flagsManage().then((r) => setFlags(r.flags)).catch(() => {});
    api.flagsAudit().then(setAudit).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const daysOf = (expires: string): number | null =>
    expires ? Math.ceil((new Date(expires + "T23:59:59").getTime() - Date.now()) / 86400000) : null;

  const shown = useMemo(() => {
    if (!flags) return [];
    const kw = q.trim().toLowerCase();
    return flags.filter((f) => {
      if (kw && !(f.key + f.description).toLowerCase().includes(kw)) return false;
      const d = daysOf(f.expires);
      if (filt === "on") return f.enabled;
      if (filt === "off") return !f.enabled;
      if (filt === "exp") return d !== null && d <= 14;
      return true;
    });
  }, [flags, q, filt]);

  const toggle = async (f: FlagMeta) => {
    setBusy(f.key);
    try {
      const u = await api.setFlag(f.key, !f.enabled);
      setFlags((prev) => prev?.map((x) => (x.key === f.key ? { ...x, enabled: u.enabled, updated_by: u.updated_by } : x)) ?? null);
      api.flagsAudit().then(setAudit).catch(() => {});
    } catch (e) {
      alert(e instanceof Error ? e.message : "토글 실패");
    } finally {
      setBusy("");
    }
  };

  if (!flags) return <p className={styles.lead}>불러오는 중…</p>;
  const CHIPS: { k: typeof filt; label: string }[] = [
    { k: "all", label: `전체 ${flags.length}` },
    { k: "on", label: `ON ${flags.filter((f) => f.enabled).length}` },
    { k: "off", label: `OFF ${flags.filter((f) => !f.enabled).length}` },
    { k: "exp", label: `만료 임박 ${flags.filter((f) => { const d = daysOf(f.expires); return d !== null && d <= 14; }).length}` },
  ];
  return (
    <section>
      <p className={styles.lead}>
        변경은 <b>즉시 반영</b>되고 감사 기록이 남습니다. 행을 클릭하면 상세 설명이 펼쳐져요. 다 쓴 플래그는 만료일에 코드에서 제거하세요.
      </p>
      <div className={styles.flagCtrl}>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")}
          placeholder="플래그 검색(키·설명)" ariaLabel="플래그 검색" />
        {CHIPS.map((c) => (
          <button key={c.k} className={`${styles.filtChip} ${filt === c.k ? styles.filtOn : ""}`}
            onClick={() => setFilt(c.k)} aria-pressed={filt === c.k}>{c.label}</button>
        ))}
      </div>
      <ul className={styles.flagListC}>
        {shown.map((f) => {
          const d = daysOf(f.expires);
          const open = openKey === f.key;
          return (
            <li key={f.key} className={styles.flagRowC}>
              <div className={styles.flagLine} onClick={() => setOpenKey(open ? null : f.key)} role="button" aria-expanded={open}>
                <code className={styles.key}>{f.key}</code>
                {d !== null && d < 0 ? (
                  <span className={styles.expOver}>D+{-d} 초과</span>
                ) : d !== null && d <= 14 ? (
                  <span className={styles.expSoon}>D-{d}</span>
                ) : null}
                {!open ? <span className={styles.flagSummary}>{f.description}</span> : null}
                <button
                  className={`${styles.toggle} ${f.enabled ? styles.on : ""}`}
                  disabled={busy === f.key}
                  onClick={(e) => { e.stopPropagation(); toggle(f); }}
                  role="switch" aria-checked={f.enabled} aria-label={`${f.key} ${f.enabled ? "끄기" : "켜기"}`}
                >
                  <span className={styles.knob} />
                </button>
              </div>
              {open ? (
                <div className={styles.flagDetail}>
                  <div className={styles.desc}>{f.description}</div>
                  <div className={styles.subline}>소유 {f.owner || "—"} · 만료 {f.expires || "장수(상시)"}{f.updated_by ? ` · 최근 변경 ${f.updated_by}` : ""}</div>
                </div>
              ) : null}
            </li>
          );
        })}
        {shown.length === 0 ? <li className={styles.muted}>조건에 맞는 플래그가 없어요.</li> : null}
      </ul>
      <details className={styles.auditBox}>
        <summary>변경 이력(감사) · {audit.length}건</summary>
        <ul className={styles.audit}>
          {audit.map((a, i) => (
            <li key={i}>
              <span className={styles.at}>{new Date(a.at * 1000).toLocaleString("ko-KR")}</span> · <b>{a.key}</b> →{" "}
              <span className={a.enabled ? styles.tOn : styles.tOff}>{a.enabled ? "ON" : "OFF"}</span> · {a.actor}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
