import { useEffect, useMemo, useState } from "react";
import { api, type CorpusDoc } from "../lib/api";
import Section from "./Section";
import styles from "../styles/Admin.module.css";
import ex from "./Explorer.module.css";

/** 코퍼스 관리 탭(v1.1, docs/20·21) — 둘러보기형 필터 + 제외 문서함 분리 + 업로드/재색인/롤백. */
const PAGE = 30;
const GUBUN_LABEL: Record<string, string> = {
  "10_업무가이드": "연구행정 가이드", "20_규정원문": "규정집", "30_용어집": "용어집", "40_시스템": "사내 시스템", "50_대외업무": "대외업무",
};

type Filters = { gubun: Set<string>; cat: Set<string>; rev: Set<string>; idx: Set<string> };

export default function AdminCorpus() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.corpusList>> | null>(null);
  const [view, setView] = useState<"all" | "excluded">("all");
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filters>({ gubun: new Set(), cat: new Set(), rev: new Set(), idx: new Set() });
  const [page, setPage] = useState(1);
  // 업로드(P3)
  const [pending, setPending] = useState<{ id: string; name: string; warn: string }[]>([]);
  const [preview, setPreview] = useState<{ id: string; name: string; text: string; warn: string } | null>(null);
  const [upBusy, setUpBusy] = useState(false);
  // 재색인(P2)
  const [ridx, setRidx] = useState<Awaited<ReturnType<typeof api.corpusReindexStatus>> | null>(null);

  const load = () => api.corpusList().then(setData).catch(() => {});
  const loadUploads = () => api.corpusUploads().then((r) => setPending(r.uploads)).catch(() => {});
  useEffect(() => { load(); loadUploads(); }, []);
  useEffect(() => {
    let alive = true;
    const tick = () => api.corpusReindexStatus().then((r) => {
      if (!alive) return;
      setRidx((prev) => { if (prev?.running && !r.running) load(); return r; });
    }).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const docs = data?.docs ?? [];
  const excludedDocs = docs.filter((d) => d.excluded);

  const passes = (d: CorpusDoc, exclude?: keyof Filters) => {
    if (view === "all" ? d.excluded : !d.excluded) return false; // 제외 문서함 분리(docs/21 §2)
    const kw = q.trim().toLowerCase();
    if (kw && !(d.title + d.slug).toLowerCase().includes(kw)) return false;
    if (exclude !== "gubun" && f.gubun.size && !f.gubun.has(d.구분)) return false;
    if (exclude !== "cat" && f.cat.size && !f.cat.has(d.section)) return false;
    if (exclude !== "rev" && f.rev.size && !f.rev.has(d.검수상태)) return false;
    if (exclude !== "idx" && f.idx.size && !f.idx.has(d.needs_reindex ? "재색인 필요" : "정상")) return false;
    return true;
  };
  const filtered = useMemo(() => docs.filter((d) => passes(d)), [docs, q, f, view]);
  useEffect(() => setPage(1), [q, f, view]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pageCount);
  const items = filtered.slice((cur - 1) * PAGE, cur * PAGE);

  const gubuns = useMemo(() => Array.from(new Set(docs.map((d) => d.구분).filter(Boolean))).sort(), [docs]);
  const cats = useMemo(() => Array.from(new Set(docs.map((d) => d.section).filter(Boolean))).sort(), [docs]);
  const countFor = (group: keyof Filters, value: string) =>
    docs.filter((d) => passes(d, group) && (
      group === "gubun" ? d.구분 === value : group === "cat" ? d.section === value :
      group === "rev" ? d.검수상태 === value : (d.needs_reindex ? "재색인 필요" : "정상") === value
    )).length;
  const toggleF = (group: keyof Filters, value: string) =>
    setF((prev) => { const n = new Set(prev[group]); n.has(value) ? n.delete(value) : n.add(value); return { ...prev, [group]: n }; });
  const activeCnt = f.gubun.size + f.cat.size + f.rev.size + f.idx.size;

  const Check = ({ group, value, label }: { group: keyof Filters; value: string; label: string }) => {
    const n = countFor(group, value);
    const checked = f[group].has(value);
    return (
      <label className={`${ex.check} ${n === 0 && !checked ? ex.checkMuted : ""}`}>
        <input type="checkbox" checked={checked} onChange={() => toggleF(group, value)} />
        <span className={ex.checkLabel}>{label}</span>
        <span className={ex.checkCount}>{n}</span>
      </label>
    );
  };

  const setExcluded = async (d: CorpusDoc, excluded: boolean) => {
    await api.corpusExclude(d.slug, excluded).catch(() => {});
    load();
  };

  if (!data) return <p className={styles.lead}>불러오는 중…</p>;
  return (
    <section>

      <Section icon="📥" title="문서 반입 · 재색인"
        desc={<>업로드 → 변환 미리보기 → <b>승인해야 편입</b>(검수상태 미검수). 색인 <b>제외</b>는 파일을 지우지 않는 안전 토글 — 제외 문서는 🗂 제외 문서함에서 언제든 복귀. 토글·업로드 후 <b>⟳ 재색인 실행</b>으로 반영됩니다.</>}>
      {/* 업로드(P3) */}
      <div className={styles.uploadBar}>
        <label className={styles.uploadBtn}>
          {upBusy ? "변환 중…" : "📤 문서 업로드(md·hwp·hwpx·pdf)"}
          <input type="file" accept=".md,.hwp,.hwpx,.pdf" style={{ display: "none" }} disabled={upBusy}
            aria-label="문서 업로드"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setUpBusy(true);
              try {
                const r = await api.corpusUpload(file);
                setPreview({ id: r.id, name: r.name, text: r.preview, warn: r.warn });
                loadUploads();
              } catch (err) { alert(err instanceof Error ? err.message : "업로드 실패"); }
              finally { setUpBusy(false); }
            }} />
        </label>
      </div>
      {pending.length > 0 ? (
        <ul className={styles.pendList}>
          {pending.map((u) => (
            <li key={u.id} className={styles.pendRow}>
              <span>⏳ {u.name}{u.warn ? <em className={styles.pendWarn}> — {u.warn}</em> : null}</span>
              <span className={styles.pendBtns}>
                <button onClick={async () => {
                  const t = prompt("편입할 문서 제목(가이드로 편입):", u.name.replace(/\.[^.]+$/, ""));
                  if (t === null) return;
                  await api.corpusApprove(u.id, "guide", t).catch((e) => alert(e.message));
                  setPreview(null); loadUploads(); load();
                }}>✅ 가이드로 승인</button>
                <button onClick={async () => {
                  const t = prompt("편입할 규정명(규정원문으로 편입):", u.name.replace(/\.[^.]+$/, ""));
                  if (t === null) return;
                  await api.corpusApprove(u.id, "regulation", t).catch((e) => alert(e.message));
                  setPreview(null); loadUploads(); load();
                }}>📜 규정으로 승인</button>
                <button onClick={async () => { await api.corpusReject(u.id).catch(() => {}); setPreview(null); loadUploads(); }}>🗑 거절</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {preview ? (
        <div className={styles.previewBox}>
          <div className={styles.previewHead}>변환 미리보기 — {preview.name}
            {preview.warn ? <em className={styles.pendWarn}> ⚠ {preview.warn}</em> : null}
            <button className={styles.previewClose} onClick={() => setPreview(null)}>✕</button>
          </div>
          <pre className={styles.previewPre}>{preview.text}</pre>
        </div>
      ) : null}

      {/* 재색인·롤백(P2) */}
      <div className={styles.reindexBar}>
        <button className={styles.reindexBtn} disabled={!!ridx?.running}
          onClick={async () => { await api.corpusReindex().catch(() => {}); setRidx((r) => (r ? { ...r, running: true } : r)); }}>
          {ridx?.running ? "⟳ 재색인 진행 중…" : "⟳ 재색인 실행"}
        </button>
        {ridx?.running || ridx?.log?.length ? <span className={styles.reindexLog}>{ridx.log[ridx.log.length - 1] || "…"}</span> : null}
        {!ridx?.running && ridx?.backups?.length ? (
          <span className={styles.rollbackWrap}>
            롤백:
            {ridx.backups.slice(-2).map((b) => (
              <button key={b} className={styles.rollbackBtn} title="이 스냅샷으로 즉시 되돌리기(수 초)"
                onClick={async () => {
                  if (!confirm(`${b} 시점으로 색인을 되돌릴까요? (현재 색인은 보존됩니다)`)) return;
                  await api.corpusRollback(b).catch(() => {});
                  load(); api.corpusReindexStatus().then(setRidx).catch(() => {});
                }}>
                {b.replace("chroma.bak-", "")}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {/* docs/20 설계 원칙 4: 재색인/롤백은 검색(RAG)에만 즉시 반영 — 웹 화면은 다음 배포에 */}
      <p className={styles.reindexNote}>
        ⓘ 재색인·롤백은 <b>검색(챗봇 근거)에 즉시</b> 반영돼요. 둘러보기·그래프·문서 화면은
        다음 웹 재빌드(배포) 때 반영됩니다.
      </p>
      </Section>

      <Section icon="📚" title="문서 목록"
        actions={<span className={styles.viewSummary}>청크 {data.summary.indexed_chunks}
          {data.summary.needs_reindex > 0 ? <b> · ⟳ 재색인 필요 {data.summary.needs_reindex}</b> : null}
        </span>}>
      {/* 서브뷰: 전체 목록 / 제외 문서함 (docs/21 §2) */}
      <div className={styles.viewTabs} role="tablist">
        <button className={`${styles.viewTab} ${view === "all" ? styles.viewOn : ""}`} role="tab"
          aria-selected={view === "all"} onClick={() => setView("all")}>
          📚 전체 목록 {docs.length - excludedDocs.length}
        </button>
        <button className={`${styles.viewTab} ${view === "excluded" ? styles.viewOn : ""}`} role="tab"
          aria-selected={view === "excluded"} onClick={() => setView("excluded")}>
          🗂 제외 문서함 {excludedDocs.length}
        </button>
      </div>
      {view === "excluded" ? (
        <p className={styles.excludedNote}>
          ⛔ 여기 문서들은 <b>삭제된 것이 아닙니다</b> — 검색 색인에서만 빠져 있어요. [↩ 복귀] 후 재색인하면 다시 검색에 포함됩니다.
        </p>
      ) : null}

      <div className={styles.corpusWrap}>
        <aside className={styles.corpusSide}>
          <div className={ex.sideHead}>
            <span className={ex.sideTitle}>필터</span>
            {activeCnt > 0 ? (
              <button className={ex.reset} onClick={() => setF({ gubun: new Set(), cat: new Set(), rev: new Set(), idx: new Set() })}>
                초기화 {activeCnt}
              </button>
            ) : null}
          </div>
          <div className={ex.group}>
            <div className={ex.groupTitle}>구분</div>
            {gubuns.map((g) => <Check key={g} group="gubun" value={g} label={GUBUN_LABEL[g] || g} />)}
          </div>
          <div className={ex.group}>
            <div className={ex.groupTitle}>분류</div>
            <div className={styles.corpusScrollGroup}>
              {cats.map((c) => <Check key={c} group="cat" value={c} label={c} />)}
            </div>
          </div>
          <div className={ex.group}>
            <div className={ex.groupTitle}>검수상태</div>
            {["검수완료", "미검수"].map((r) => <Check key={r} group="rev" value={r} label={r} />)}
          </div>
          <div className={ex.group}>
            <div className={ex.groupTitle}>색인 상태</div>
            {["정상", "재색인 필요"].map((r) => <Check key={r} group="idx" value={r} label={r} />)}
          </div>
        </aside>

        <div>
          <input className={styles.corpusSearch} placeholder="문서 검색(제목·슬러그)" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="코퍼스 검색" />
          <div className={ex.metaRow}>
            <span className={ex.count}>{filtered.length}건{filtered.length > 0 ? ` · ${(cur - 1) * PAGE + 1}–${(cur - 1) * PAGE + items.length}` : ""}</span>
            {pageCount > 1 ? (
              <div className={ex.pageNav}>
                <button className={ex.navBtn} disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="이전 페이지">‹</button>
                <span className={ex.pageInfo}>{cur} / {pageCount}</span>
                <button className={ex.navBtn} disabled={cur >= pageCount} onClick={() => setPage(cur + 1)} aria-label="다음 페이지">›</button>
              </div>
            ) : null}
          </div>
          <ul className={styles.corpusList}>
            {items.map((d) => (
              <li key={d.slug} className={`${styles.corpusRow} ${d.excluded ? styles.corpusRowEx : ""}`}>
                <span className={styles.corpusTitle}>
                  {d.excluded ? <span className={styles.exBadge}>⛔ 제외됨</span> : null}
                  {d.title}
                  {/* 슬러그가 제목과 다르면 병기 — '_2' 중복 변환본이 왜 제외됐는지 한눈에 보이게 */}
                  {d.slug !== d.title ? <span className={styles.corpusMeta}> ({d.slug})</span> : null}
                  <span className={styles.corpusMeta}> · {GUBUN_LABEL[d.구분] || d.구분} · {d.section} · 청크 {d.chunks} · {d.검수상태}</span>
                  {d.needs_reindex ? <span className={styles.reindexBadge}>⟳ 재색인 필요</span> : null}
                </span>
                <button className={`${styles.exToggle} ${d.excluded ? styles.exOn : ""}`}
                  onClick={() => setExcluded(d, !d.excluded)}>
                  {d.excluded ? "↩ 복귀" : "색인 제외"}
                </button>
              </li>
            ))}
            {items.length === 0 ? (
              <li className={styles.muted}>{view === "excluded" ? "제외된 문서가 없어요 — 전체 목록에서 '색인 제외'로 옮길 수 있습니다." : "조건에 맞는 문서가 없어요."}</li>
            ) : null}
          </ul>
        </div>
      </div>
      </Section>
    </section>
  );
}
