import Head from "next/head";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import PageHero from "../components/common/PageHero";
import { useFlag } from "../lib/flags";
import { api, ApiError, type ReportRow } from "../lib/api";
import { track } from "../lib/track";
import { SITE_NAME } from "../lib/site";
import f from "../styles/Feedback.module.css";

// 의견 보내기(docs/51) — 답변 👍/👎와 별개의 능동 제보: 규정 원문 오류·개정본 누락·개선 의견.
// 진입점: 푸터·문서 드로어 '의견'·추가기능 허브. 프리필: ?doc=&anchor=&type=
const TYPES = ["오류신고", "누락신고", "개선의견", "버그신고", "기타"] as const;
const TYPE_DESC: Record<string, string> = {
  오류신고: "규정 원문·표·서식이 이상하게 보여요",
  누락신고: "최근 개정본·있어야 할 문서가 안 보여요",
  개선의견: "이렇게 바뀌면 좋겠어요",
  버그신고: "화면·기능이 제대로 동작하지 않아요",
  기타: "그 외 하고 싶은 말",
};
const STATE_BADGE: Record<string, string> = {
  접수: "⏳ 접수", 분석됨: "🔍 분석됨", 중복: "🔁 중복", 계획반영: "🗓 계획 반영",
  처리완료: "✅ 처리 완료", 보류: "⏸ 보류",
};

export default function FeedbackPage() {
  const on = useFlag("feedback_center");
  const router = useRouter();
  const [유형, set유형] = useState<string>("오류신고");
  const [대상규정, set대상규정] = useState("");
  const [대상조문, set대상조문] = useState("");
  const [내용, set내용] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [mine, setMine] = useState<ReportRow[] | null>(null);

  // 프리필(문서 드로어 → ?doc=규정명&anchor=제N조&type=오류신고)
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    if (typeof q.doc === "string" && q.doc) set대상규정(q.doc);
    if (typeof q.anchor === "string" && q.anchor) set대상조문(q.anchor);
    if (typeof q.type === "string" && (TYPES as readonly string[]).includes(q.type)) set유형(q.type);
  }, [router.isReady, router.query]);

  const load = () => api.myReports().then(setMine).catch(() => setMine([]));
  useEffect(() => { if (on) { load(); track("feedback_view"); } }, [on]);

  const submit = async () => {
    setErr("");
    setDone("");
    if (내용.trim().length < 5) {
      setErr("내용을 5자 이상 적어주세요");
      return;
    }
    setBusy(true);
    try {
      await api.createReport({ 유형, 대상규정, 대상조문, 내용: 내용.trim() });
      setDone("접수됐어요. 처리 상태는 아래 '내 제보'에서 확인할 수 있어요.");
      set내용("");
      track("feedback_submit");
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "제출에 실패했어요 — 잠시 후 다시 시도해주세요");
    } finally {
      setBusy(false);
    }
  };

  if (!on) {
    return (
      <Layout>
        <Head><title>{`의견 보내기 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <PageHero title="의견 보내기" lead="이 기능은 아직 준비 중이에요. 곧 만나요!" />
      </Layout>
    );
  }
  return (
    <Layout>
      <Head><title>{`의견 보내기 · ${SITE_NAME}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
      <PageHero title="의견 보내기" lead="규정 원문의 이상한 부분, 반영 안 된 개정본, 화면 오류, 개선 아이디어 — 무엇이든 알려주세요. 담당자가 확인해 처리 상태를 남깁니다." />

      <div className={f.wrap}>
        <section className={f.formCard} aria-label="제보 작성">
          <div className={f.typeRow} role="radiogroup" aria-label="제보 유형">
            {TYPES.map((t) => (
              <button key={t} role="radio" aria-checked={유형 === t}
                className={`${f.typeChip} ${유형 === t ? f.typeOn : ""}`}
                onClick={() => set유형(t)} title={TYPE_DESC[t]}>
                {t}
              </button>
            ))}
          </div>
          <p className={f.typeHint}>{TYPE_DESC[유형]}</p>
          <div className={f.row2}>
            <label className={f.field}>
              <span className={f.label}>관련 문서(선택)</span>
              <input className={f.input} value={대상규정} onChange={(e) => set대상규정(e.target.value)}
                placeholder="예: 여비규정" maxLength={120} />
            </label>
            <label className={f.field}>
              <span className={f.label}>관련 위치(선택)</span>
              <input className={f.input} value={대상조문} onChange={(e) => set대상조문(e.target.value)}
                placeholder="예: 제12조 / 별지 제2호" maxLength={60} />
            </label>
          </div>
          <label className={f.field}>
            <span className={f.label}>내용</span>
            <textarea className={f.textarea} value={내용} onChange={(e) => set내용(e.target.value)}
              rows={5} maxLength={4000}
              placeholder="무엇이 이상했는지, 어디서 봤는지 적어주세요. (예: 여비규정 별표 2 표가 깨져 보여요 / 우리 부서가 이번 달 개정한 ○○지침이 아직 안 올라와 있어요)" />
          </label>
          <div className={f.actions}>
            <span className={f.count}>{내용.trim().length}/4000</span>
            <button className={f.submit} onClick={submit} disabled={busy || 내용.trim().length < 5}>
              {busy ? "보내는 중…" : "보내기"}
            </button>
          </div>
          {done ? <p className={f.ok} role="status">{done}</p> : null}
          {err ? <p className={f.err} role="alert">{err}</p> : null}
        </section>

        <section className={f.mine} aria-label="내 제보">
          <h2 className={f.h2}>내 제보</h2>
          {mine === null ? <p className={f.dim}>불러오는 중…</p> : null}
          {mine !== null && mine.length === 0 ? <p className={f.dim}>아직 보낸 제보가 없어요.</p> : null}
          {(mine || []).map((r) => (
            <article key={r.id} className={f.mineCard}>
              <header className={f.mineHead}>
                <span className={f.mineType}>{r.유형}</span>
                {r.대상규정 ? <span className={f.mineDoc}>{r.대상규정}{r.대상조문 ? ` · ${r.대상조문}` : ""}</span> : null}
                <span className={f.mineState} data-state={r.상태}>{STATE_BADGE[r.상태] || r.상태}</span>
                <time className={f.mineDate} title="접수 일시">
                  {new Date(r.at * 1000).toLocaleString("ko-KR", {
                    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })}
                </time>
              </header>
              <p className={f.mineBody}>{r.내용}</p>
              {r.admin_note ? <p className={f.mineNote}>💬 처리 메모: {r.admin_note}</p> : null}
            </article>
          ))}
        </section>
      </div>
    </Layout>
  );
}
