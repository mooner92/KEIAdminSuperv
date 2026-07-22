import { useState } from "react";
import styles from "./DeadlineCalc.module.css";

// Track B: 기한 역산 계산기.
// ⛔ 절대 규칙1 준수 — 오프셋(N·단위·방향)은 규정 원문 그대로, 기준일은 사용자 입력,
// 마감일 = 기준일 ± N 의 순수 산술(추측·환각 없음). 원문 문장을 항상 함께 표시해 검증 가능.

export type Deadline = {
  조: string; 의무: string; anchor: string;
  n: number; unit: string; dir: string; type: string; 원문: string;
};

export function addOffset(base: Date, n: number, unit: string, dir: string): Date {
  const d = new Date(base.getTime());
  const k = (dir === "전" ? -1 : 1) * n;
  if (unit === "일") d.setDate(d.getDate() + k);
  else if (unit === "주") d.setDate(d.getDate() + k * 7);
  else if (unit === "개월" || unit === "월") d.setMonth(d.getMonth() + k);
  else if (unit === "년") d.setFullYear(d.getFullYear() + k);
  return d;
}
const p2 = (x: number) => String(x).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
export const ko = (d: Date) =>
  `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} (${"일월화수목금토"[d.getDay()]})`;

export function downloadIcs(summary: string, date: Date, desc: string) {
  const uid = `kei-${ymd(date)}-${Math.floor(Math.random() * 1e6)}@kei`;
  const stamp = ymd(new Date()) + "T000000Z";
  const esc = (s: string) => (s || "").replace(/[\n\r]+/g, " ").replace(/,/g, "\\,");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KEI//deadline//KO", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(date)}`,
    `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(desc)}`, "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${summary.slice(0, 40)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Row({ rule, regName, regNo }: { rule: Deadline; regName: string; regNo?: string }) {
  const [base, setBase] = useState("");
  const result = base ? addOffset(new Date(base + "T00:00:00"), rule.n, rule.unit, rule.dir) : null;
  const src = `${regName}${regNo ? ` (규정번호 ${regNo})` : ""} ${rule.조}`;
  const summary = `[마감] ${rule.의무 || "처리"} — ${regName} ${rule.조}`;
  return (
    <li className={styles.row}>
      <div className={styles.rule}>
        <span className={styles.anchor}>{rule.anchor || "기준일"}</span>
        <b className={styles.offset}>{rule.n}{rule.unit} {rule.dir === "전" ? "전까지" : "이내"}</b>
        {rule.의무 ? <span className={styles.duty}>{rule.의무}</span> : null}
        <span className={styles.jo}>{rule.조}</span>
      </div>
      <div className={styles.src}>📄 {rule.원문}</div>
      <div className={styles.calc}>
        <label>
          기준일
          <input type="date" value={base} onChange={(e) => setBase(e.target.value)} className={styles.date} />
        </label>
        {result ? (
          <>
            <span className={styles.arrow}>→</span>
            <span className={styles.deadline}>마감 {ko(result)}</span>
            <button
              className={styles.ics}
              onClick={() => downloadIcs(summary, result, `근거: ${src}\n${rule.원문}`)}
            >
              📅 캘린더(.ics)
            </button>
          </>
        ) : (
          <span className={styles.hint}>날짜를 넣으면 마감일이 계산돼요</span>
        )}
      </div>
    </li>
  );
}

export default function DeadlineList({
  deadlines, regName, regNo,
}: { deadlines: Deadline[]; regName: string; regNo?: string }) {
  // 계산 가능한 마감(anchor 有) 먼저, 기간한도/anchor 없는 건 뒤로
  const calc = deadlines.filter((d) => d.type === "마감" && d.anchor);
  const rest = deadlines.filter((d) => !(d.type === "마감" && d.anchor));
  return (
    <ul className={styles.list}>
      {calc.map((r, i) => <Row key={`c${i}`} rule={r} regName={regName} regNo={regNo} />)}
      {rest.slice(0, 6).map((r, i) => (
        <li key={`r${i}`} className={styles.rowFlat}>
          <div className={styles.rule}>
            <b>{r.n}{r.unit} {r.dir === "전" ? "이전" : "이내"}</b>
            {r.의무 ? <span className={styles.duty}>{r.의무}</span> : null}
            {r.type === "기간한도" ? <span className={styles.tag}>기간 한도</span> : null}
            <span className={styles.jo}>{r.조}</span>
          </div>
          <div className={styles.src}>📄 {r.원문}</div>
        </li>
      ))}
    </ul>
  );
}
