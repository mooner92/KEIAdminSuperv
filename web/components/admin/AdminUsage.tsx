import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Usage } from "../../lib/api";
import DataTable from "../common/DataTable";
import styles from "../../styles/Admin.module.css";
import u from "../../styles/Usage.module.css";

// 📈 통계 탭(docs/35 §0 확장) — UsageEvent 집계를 PostHog풍 차트로.
// 외부 라이브러리 0(CSP self-only): 라인차트=SVG, 바=CSS 트랙/필. 시리즈 색은 사이트 토큰
// (--color-primary, 라이트 #256ef4·다크 #4c87f6 — dataviz 검증 PASS). 단일 시리즈라 범례 불요,
// 값은 직접 라벨(막대 끝·라인 툴팁) + 하단 '표로 보기'가 항상 존재(툴팁은 보조, 게이트 아님).
const DAYS_PRESETS = [7, 30, 90] as const;

const EVENT_LABEL: Record<string, string> = {
  page_view: "페이지뷰", now_view: "추가 기능 허브", calendar_view: "업무 캘린더",
  journey_view: "업무 한 장", changelog_view: "새로워진 점", login_via_landing: "랜딩 경유 로그인",
  chat_send: "질문 전송", forms_search: "서식 검색", forms_open: "서식 열람",
  faq_open: "FAQ 열람", trending_click: "인기 키워드 클릭", feedback_view: "의견 보내기 열람",
  feedback_submit: "제보 제출", bugreport_view: "버그리포트 열람",
};
const label = (name: string) => EVENT_LABEL[name] || name;

// ── 수평 바 목록(막대 ≤24px·4px 라운드 데이터엔드·값=끝 직접 라벨·호버 리프트) ──
function BarList({ rows, unit }: {
  rows: { key: string; n: number; sub?: string }[]; unit: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className={u.barList}>
      {rows.map((r) => (
        <div key={r.key} className={u.barRow} tabIndex={0}
          aria-label={`${r.key} ${r.n}${unit}${r.sub ? ` · ${r.sub}` : ""}`}>
          <span className={u.barLabel}>{r.key}</span>
          <span className={u.barTrack}>
            <span className={u.barFill} style={{ width: `${(r.n / max) * 100}%` }} />
          </span>
          <span className={u.barValue}>{r.n.toLocaleString()}</span>
          {r.sub ? <span className={u.barSub}>{r.sub}</span> : null}
        </div>
      ))}
      {rows.length === 0 ? <p className={styles.muted}>데이터가 없어요.</p> : null}
    </div>
  );
}

// ── DAU 라인차트(2px 라인·10% 워시·크로스헤어+툴팁·마스킹일은 갭) ──
function DauChart({ dau, minUsers }: { dau: Usage["dau"]; minUsers: number }) {
  const W = 640, H = 180, PAD = { l: 30, r: 12, t: 12, b: 22 };
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const ys = dau.map((d) => d.users).filter((v): v is number => v !== null);
  const yMax = Math.max(3, ...ys);
  // y축 눈금: 깔끔한 정수(0·중간·최대)
  const yTicks = [0, Math.round(yMax / 2), yMax];
  const x = (i: number) => PAD.l + (dau.length <= 1 ? 0 : (i / (dau.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => H - PAD.b - (v / yMax) * (H - PAD.t - PAD.b);
  // 마스킹(3명 미만=null)은 선을 끊는다 — 0으로 그리는 건 거짓이므로 갭이 정직
  const segs: string[] = [];
  let seg: string[] = [];
  dau.forEach((d, i) => {
    if (d.users === null) { if (seg.length) segs.push(seg.join(" ")); seg = []; return; }
    seg.push(`${seg.length ? "L" : "M"}${x(i).toFixed(1)},${y(d.users).toFixed(1)}`);
  });
  if (seg.length) segs.push(seg.join(" "));
  const onMove = (e: React.PointerEvent) => {
    if (!ref.current || dau.length === 0) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / Math.max(1, W - PAD.l - PAD.r)) * (dau.length - 1));
    setHover(Math.max(0, Math.min(dau.length - 1, i)));
  };
  const hv = hover !== null ? dau[hover] : null;
  return (
    <div className={u.chartWrap}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className={u.lineSvg} role="img"
        aria-label="일별 활성 사용자 추이" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className={u.grid} />
            <text x={PAD.l - 6} y={y(t) + 3.5} className={u.tick} textAnchor="end">{t}</text>
          </g>
        ))}
        {/* 면 워시(10%) — 각 세그먼트 아래만 */}
        {segs.map((d, i) => (
          <path key={`a${i}`} d={`${d} L${d.split(" ").pop()!.slice(1).split(",")[0]},${y(0)} L${d.split(" ")[0].slice(1).split(",")[0]},${y(0)} Z`} className={u.areaWash} />
        ))}
        {segs.map((d, i) => <path key={i} d={d} className={u.line} />)}
        {/* 도트는 ≤31포인트일 때만(90일은 라인만 — 밀집 시 도트가 라인을 덮음) */}
        {dau.length <= 31 ? dau.map((d, i) => d.users !== null ? (
          <circle key={i} cx={x(i)} cy={y(d.users)} r={hover === i ? 5 : 4} className={u.dot} />
        ) : null) : (hover !== null && dau[hover].users !== null ? (
          <circle cx={x(hover)} cy={y(dau[hover].users!)} r={5} className={u.dot} />
        ) : null)}
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className={u.crosshair} /> : null}
        {/* x축 라벨: 처음·중간·끝만(충돌 방지) */}
        {[0, Math.floor((dau.length - 1) / 2), dau.length - 1].filter((v, i, a) => dau.length > 0 && a.indexOf(v) === i).map((i) => (
          <text key={i} x={x(i)} y={H - 6} className={u.tick} textAnchor="middle">{dau[i].day.slice(5)}</text>
        ))}
      </svg>
      {hv ? (
        <div className={u.tooltip} style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <b>{hv.users === null ? `${minUsers}명 미만` : `${hv.users}명`}</b>
          <span>{hv.day}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [days, setDays] = useState(30);
  const load = useCallback(() => {
    api.usage(days).then(setUsage).catch(() => setUsage(null));
  }, [days]);
  useEffect(load, [load]);

  const kpi = useMemo(() => {
    if (!usage) return null;
    const total = usage.events.reduce((s, e) => s + e.n, 0);
    const chat = usage.events.find((e) => e.name === "chat_send");
    const lastDau = [...usage.dau].reverse().find((d) => d.users !== null);
    return {
      total, features: usage.events.length,
      chat: chat ? chat.n : 0,
      dau: lastDau ? `${lastDau.users}명` : `${usage.min_users}명 미만`,
    };
  }, [usage]);

  return (
    <section>
      <h2 className={styles.h2}>📈 사용량 통계 <span className={styles.dashDays}>
        집계만 표시 — 개별 행위 미노출 · {usage?.min_users ?? 3}명 미만은 가림(k-익명)</span></h2>

      {/* 필터 한 줄 — 기간 프리셋이 아래 전부를 스코프 */}
      <div className={u.filterRow}>
        {DAYS_PRESETS.map((d) => (
          <button key={d} className={`${u.rangeChip} ${days === d ? u.rangeOn : ""}`}
            onClick={() => setDays(d)}>최근 {d}일</button>
        ))}
        {usage?.collect_start ? (
          <span className={u.collectNote} title="이 날짜 이전 데이터는 존재하지 않아요(수집 기능 도입일)">
            수집 시작 {usage.collect_start}
          </span>
        ) : null}
        {usage ? (
          <button className={u.rangeChip} onClick={() => {
            const blob = new Blob([JSON.stringify(usage, null, 1)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `kei-usage-${usage.days}d-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}>⬇ JSON 내보내기</button>
        ) : null}
      </div>

      {usage === null ? <p className={styles.muted}>불러오는 중…</p> : (
        <>
          {/* KPI 타일 */}
          {kpi ? (
            <div className={u.tiles}>
              <div className={u.tile}><span className={u.tileLabel}>총 이벤트</span><b className={u.tileValue}>{kpi.total.toLocaleString()}</b></div>
              <div className={u.tile}><span className={u.tileLabel}>최근 활성 사용자</span><b className={u.tileValue}>{kpi.dau}</b></div>
              <div className={u.tile}><span className={u.tileLabel}>질문 전송</span><b className={u.tileValue}>{kpi.chat.toLocaleString()}</b></div>
              <div className={u.tile}><span className={u.tileLabel}>활성 기능</span><b className={u.tileValue}>{kpi.features}</b></div>
            </div>
          ) : null}

          <div className={u.card}>
            <h3 className={styles.h3}>일별 활성 사용자</h3>
            <DauChart dau={usage.dau} minUsers={usage.min_users} />
          </div>

          <div className={u.twoCol}>
            <div className={u.card}>
              <h3 className={styles.h3}>기능별 사용량</h3>
              <BarList unit="회" rows={usage.events.map((e) => ({
                key: label(e.name), n: e.n,
                sub: e.users !== null ? `${e.users}명` : `${usage.min_users}명 미만`,
              }))} />
            </div>
            <div className={u.card}>
              <h3 className={styles.h3}>페이지뷰 상위 <span className={styles.muted}>({usage.min_users}명 이상 본 경로)</span></h3>
              <BarList unit="뷰" rows={usage.pages.map((p) => ({ key: p.page, n: p.n }))} />
            </div>
          </div>

          {/* 표 보기 — 차트가 못 담는 전체 값(접근성·정밀값), 툴팁 없이도 전부 도달 가능 */}
          <details className={u.tableToggle}>
            <summary>표로 보기</summary>
            <div className={u.twoCol}>
              <DataTable
                rows={usage.events}
                rowKey={(e) => e.name}
                cols={[
                  { key: "ev", head: "이벤트", wrap: true, render: (e) => label(e.name) },
                  { key: "n", head: "횟수", num: true, render: (e) => e.n },
                  { key: "u", head: "사용자", num: true, render: (e) => e.users ?? `${usage.min_users}명 미만` },
                ]}
              />
              <DataTable
                rows={usage.dau}
                rowKey={(d) => d.day}
                cols={[
                  { key: "day", head: "일자", render: (d) => d.day },
                  { key: "users", head: "활성 사용자", num: true, render: (d) => d.users ?? `${usage.min_users}명 미만` },
                ]}
              />
            </div>
          </details>
        </>
      )}
    </section>
  );
}
