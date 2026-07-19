import { useCallback, useEffect, useState } from "react";
import { api, type ReportRow, type MaintNoticeRow } from "../lib/api";
import Markdown from "./Markdown";
import styles from "../styles/Admin.module.css";
import f from "../styles/Feedback.module.css";

// 📮 의견함(docs/51 §7) — ⓐ🔔 유지보수 알림(분석기 계획 생성 시) ⓑ최신 계획안 md
// ⓒ접수함(상태 처리·메모). ⛔ 분석기는 계획·알림만 — 여기서의 상태 변경(계획반영 등)은 사람(관리자).
const STATES = ["접수", "분석됨", "중복", "계획반영", "처리완료", "보류"] as const;
const ADMIN_SET = ["접수", "계획반영", "처리완료", "보류"]; // 관리자가 지정 가능(분석됨/중복=분석기 전용)

// 접수 일시(날짜+시각) — 언제 들어왔는지 관리자가 바로 보게(초 단위 저장, 분까지 표시)
const fmtAt = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString("ko-KR", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

// 브라우저 데스크톱 알림 옵트인(SMTP 불가 환경의 보조 수단 — 사이트 탭이 열려 있을 때 동작).
// 권한 요청은 사용자 제스처에서만(자동 팝업 금지). 거부 상태면 안내만.
function NotifyPermission() {
  const [perm, setPerm] = useState<string>("unsupported");
  useEffect(() => {
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
  }, []);
  if (perm === "unsupported" || perm === "granted") {
    return perm === "granted"
      ? <p className={styles.muted}>🖥 브라우저 알림 켜짐 — 새 계획이 생기면 데스크톱 알림이 떠요(사이트 탭이 열려 있을 때).</p>
      : null;
  }
  return (
    <p className={styles.muted}>
      {perm === "denied"
        ? "🔕 브라우저 알림이 차단돼 있어요 — 주소창 옆 사이트 설정에서 허용으로 바꾸면 데스크톱 알림을 받아요."
        : <button className={f.readAll}
            onClick={() => Notification.requestPermission().then(setPerm)}>
            🖥 브라우저 알림 켜기 (새 계획 도착 시 데스크톱 알림)
          </button>}
    </p>
  );
}

const PAGE_SIZES = [10, 30, 50] as const;
const NOTICE_STEP = 5; // 알림 기본 표시 수 — '더 보기'로 증분

// 섹션 컨테이너(사용자 요청: flat 해소) — 패널 톤(--color-bg-subtle) 위에 surface 카드가 떠서
// "이 묶음이 한 섹션"이 시각적으로 구분된다. 제목은 크고 볼드하게(위계).
function Section({ icon, title, badge, actions, children }: {
  icon: string; title: string; badge?: number;
  actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className={f.section}>
      <header className={f.sectionHead}>
        <h2 className={f.sectionTitle}>
          <span aria-hidden>{icon}</span> {title}
          {badge && badge > 0 ? <span className={f.unreadBadge}>{badge}</span> : null}
        </h2>
        {actions ? <div className={f.sectionActions}>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export default function AdminReports() {
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [notices, setNotices] = useState<{ unread: number; notices: MaintNoticeRow[] } | null>(null);
  const [plan, setPlan] = useState<{ name: string; md: string } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  // 페이지네이션(서식찾기 관례 — 10/30/50) + 최신순 고정: 더미·보류가 쌓여도 접수함이 간결하게
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(1);
  const [noticeShow, setNoticeShow] = useState<number>(NOTICE_STEP); // 알림 '더 보기' 증분

  const load = useCallback(() => {
    api.allReports(filter || undefined).then(setReports).catch(() => setReports([]));
    api.maintNotices().then(setNotices).catch(() => {});
    api.maintPlanLatest().then(setPlan).catch(() => setPlan(null)); // 404 = 아직 계획 없음
  }, [filter]);
  useEffect(load, [load]);

  const setState = async (id: number, 상태: string) => {
    try {
      await api.patchReport(id, { 상태 });
      setMsg(`#${id} → ${상태}`);
      load();
    } catch {
      setMsg("상태 변경 실패");
    }
  };
  const saveNote = async (id: number) => {
    try {
      await api.patchReport(id, { admin_note: noteDraft[id] ?? "" });
      setMsg(`#${id} 메모 저장`);
      load();
    } catch {
      setMsg("메모 저장 실패");
    }
  };
  const readAll = async () => {
    await api.maintNoticesRead().catch(() => {});
    load();
  };
  const analyzeNow = async () => {
    try {
      await api.maintAnalyze();
      setMsg("분석 시작 — 완료되면 🔔 알림이 옵니다(수십 초 소요)");
    } catch {
      setMsg("분석 시작 실패");
    }
  };
  // 오토픽스(docs/52 Phase A): 무인 Claude Code가 격리 브랜치에 수정 — 라이브 무접촉, 머지는 사람
  const autofix = async (id: number) => {
    if (!window.confirm(`#${id} 제보를 오토픽스로 처리할까요?\n격리 브랜치에 수정만 만들고, 반영(머지)은 검토 후 직접 하게 됩니다.`)) return;
    try {
      await api.maintAutofix(id);
      setMsg(`#${id} 오토픽스 시작 — 완료되면 🔔 알림에 검토 링크가 옵니다(수 분 소요)`);
    } catch (e) {
      setMsg(e instanceof Error ? `오토픽스 시작 실패 — ${e.message}` : "오토픽스 시작 실패");
    }
  };

  // 최신순 고정(백엔드도 desc지만 프론트에서 보장) + 페이지 슬라이스
  const sorted = [...(reports || [])].sort((a, b) => b.at - a.at);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pageCount);
  const paged = sorted.slice((cur - 1) * pageSize, cur * pageSize);

  return (
    <section>
      <Section icon="🔔" title="유지보수 알림" badge={notices?.unread}
        actions={<>
          <button className={f.readAll} onClick={analyzeNow}>▶ 지금 분석</button>
          {notices && notices.unread > 0 ? (
            <button className={f.readAll} onClick={readAll}>모두 읽음</button>
          ) : null}
        </>}>
        <p className={f.sectionDesc}>
          제보가 오면 잠시 뒤 자동으로, 그리고 매시간(백스톱) 로컬 모델이 분석해 게이트(위험도)별
          보고서를 만들면 여기에 알림이 옵니다(신규 없으면 실행 기록만 남음). 미확인 알림은 상단 헤더 🔔 배지로도 표시돼요.
        </p>
        <NotifyPermission />
        {notices && notices.notices.length > 0 ? (
          <div className={f.noticeList}>
            {notices.notices.slice(0, noticeShow).map((n) => (
              <div key={n.id} className={f.noticeRow} data-unread={n.unread}>
                <span>{n.unread ? "🔵" : "⚪"} {n.summary}</span>
                <time>{new Date(n.at * 1000).toLocaleString("ko-KR")}</time>
              </div>
            ))}
            {notices.notices.length > NOTICE_STEP ? (
              <div className={f.pagerRow}>
                {noticeShow < notices.notices.length ? (
                  <button className={f.readAll}
                    onClick={() => setNoticeShow(noticeShow + NOTICE_STEP)}>
                    더 보기 ({notices.notices.length - noticeShow}건 남음)
                  </button>
                ) : null}
                {noticeShow > NOTICE_STEP ? (
                  <button className={f.readAll} onClick={() => setNoticeShow(NOTICE_STEP)}>접기</button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className={styles.muted}>알림이 없습니다.</p>
        )}
      </Section>

      <Section icon="🗓" title="최신 유지보수 계획안">
        {plan ? (
          <div className={f.planBox}>
            <button className={f.planToggle} onClick={() => setPlanOpen(!planOpen)}>
              {planOpen ? "▾" : "▸"} {plan.name}
            </button>
            {planOpen ? <div className={f.planMd}><Markdown source={plan.md} /></div> : null}
          </div>
        ) : (
          <p className={styles.muted}>아직 생성된 계획이 없습니다.</p>
        )}
      </Section>

      <Section icon="📮" title="접수함" badge={undefined}
        actions={<span className={f.sectionCount}>{sorted.length}건</span>}>
      <div className={f.filterRow}>
        <button className={`${f.typeChip} ${filter === "" ? f.typeOn : ""}`}
          onClick={() => { setFilter(""); setPage(1); }}>전체</button>
        {STATES.map((s) => (
          <button key={s} className={`${f.typeChip} ${filter === s ? f.typeOn : ""}`}
            onClick={() => { setFilter(s); setPage(1); }}>{s}</button>
        ))}
        {msg ? <span className={f.adminMsg} role="status">{msg}</span> : null}
      </div>
      {reports === null ? <p className={styles.muted}>불러오는 중…</p> : null}
      {reports !== null && reports.length === 0 ? <p className={styles.muted}>제보가 없습니다.</p> : null}
      {paged.map((r) => (
        <article key={r.id} className={f.mineCard}>
          <header className={f.mineHead}>
            <b>#{r.id}</b>
            <span className={f.mineType}>{r.유형}</span>
            {r.대상규정 ? <span className={f.mineDoc}>{r.대상규정}{r.대상조문 ? ` · ${r.대상조문}` : ""}</span> : null}
            <span className={f.mineDoc}>{r.제보자}</span>
            {r.group ? <span className={f.mineDoc} title="분석 그룹">{r.group}</span> : null}
            <select className={f.stateSel} value={r.상태} onChange={(e) => setState(r.id, e.target.value)}
              aria-label={`#${r.id} 상태 변경`}>
              {(ADMIN_SET.includes(r.상태) ? ADMIN_SET : [r.상태, ...ADMIN_SET]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <time className={f.mineDate} title="접수 일시">{fmtAt(r.at)}</time>
          </header>
          <p className={f.mineBody}>{r.내용}</p>
          <div className={f.noteRow}>
            <input className={f.input} placeholder="처리 메모(제보자에게 보임)"
              value={noteDraft[r.id] ?? r.admin_note}
              onChange={(e) => setNoteDraft({ ...noteDraft, [r.id]: e.target.value })} />
            <button className={f.readAll} onClick={() => saveNote(r.id)}>저장</button>
            {(r.상태 === "접수" || r.상태 === "분석됨") ? (
              <button className={f.readAll} onClick={() => autofix(r.id)}
                title="무인 Claude Code가 격리 브랜치에 수정을 만듭니다(라이브 무접촉·머지는 사람)">
                🤖 자동 수정
              </button>
            ) : null}
          </div>
        </article>
      ))}
      {sorted.length > 0 ? (
        <div className={f.pagerRow}>
          <span className={styles.muted}>{sorted.length}건 · 최신순</span>
          {PAGE_SIZES.map((n) => (
            <button key={n} className={`${f.typeChip} ${pageSize === n ? f.typeOn : ""}`}
              onClick={() => { setPageSize(n); setPage(1); }}>{n}개씩</button>
          ))}
          <button className={f.readAll} disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="이전 페이지">‹</button>
          <span className={styles.muted}>{cur} / {pageCount}</span>
          <button className={f.readAll} disabled={cur >= pageCount} onClick={() => setPage(cur + 1)} aria-label="다음 페이지">›</button>
        </div>
      ) : null}
      </Section>
    </section>
  );
}
