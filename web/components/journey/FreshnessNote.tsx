import type { JourneyFreshness } from "../../lib/vault";
import s from "./FreshnessNote.module.css";

/** 여정 신선도 알림(specs/13 T01b) — 손으로 만든 여정이 낡았을 수 있다는 사실을 화면이 말한다.
 *
 * 여정은 사람이 큐레이션해서 규정이 개정·삭제되면 조용히 낡는다. 01k2가 근거 조문을 효력
 * 인덱스와 대조한 결과를 여기서 보여준다. ⛔ 자동 수정은 없다 — 사람이 원문을 보고 고친다.
 * 문구는 단정하지 않는다: '개정'은 "달라졌을 수 있다"이지 "틀렸다"가 아니다(과장 경보 금지).
 */
const TONE: Record<string, { icon: string; head: string; cls: string }> = {
  삭제: { icon: "⛔", head: "삭제된 조문을 근거로 하고 있어요", cls: "bad" },
  미확인: { icon: "⚠️", head: "근거 조문을 확인하지 못했어요", cls: "warn" },
  개정: { icon: "🔄", head: "근거 규정이 최근 개정됐어요", cls: "info" },
};

export default function FreshnessNote({ f }: { f?: JourneyFreshness }) {
  if (!f?.최고심각도) return null;
  const t = TONE[f.최고심각도] ?? TONE.개정;
  return (
    <aside className={`${s.note} ${s[t.cls]}`} role="note" aria-label="여정 신선도 안내">
      <b className={s.head}>{t.icon} {t.head}</b>
      <span className={s.sub}>
        {f.최고심각도 === "개정"
          ? "안내 내용이 원문과 달라졌을 수 있어요. 아래 근거 조문을 열어 확인해 주세요."
          : "이 여정은 재검토가 필요해요. 공식 기준은 항상 원문입니다."}
      </span>
      <ul className={s.list}>
        {f.항목.slice(0, 5).map((r, i) => (
          <li key={i}>
            <span className={s.node}>{r.노드명}</span>
            <span className={s.basis}>{r.규정명} {r.조}</span>
            <span className={s.why}>{r.사유}</span>
          </li>
        ))}
        {f.항목.length > 5 ? <li className={s.why}>… 외 {f.항목.length - 5}건</li> : null}
      </ul>
    </aside>
  );
}
