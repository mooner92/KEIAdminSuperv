import s from "./Gian.module.css";

export type SummaryCard = {
  /** 스크롤 대상 섹션의 id */
  id: string;
  icon: string;
  label: string;
  value: number;
  unit: string;
  /** 단정 금지 라벨('권장'·'후보') — 숫자 옆에 붙어 성격을 먼저 말한다 */
  note?: string;
};

/** 업무를 고른 직후 보이는 네 숫자 — "무엇으로 · 무엇을 첨부 · 어디에 편철 · 누가 전결".
 *  ⛔ 절대 규칙 3: 숫자만 크게 두지 않고, 성격 라벨(권장·후보)을 숫자 옆에 함께 둔다.
 *  누르면 해당 섹션으로 스크롤한다(앱 셸의 스크롤 컨테이너가 window가 아니라 패널이므로
 *  해시 앵커가 아니라 scrollIntoView로 이동한다 — 실측). */
export default function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <ul className={s.cards}>
      {cards.map((c) => (
        <li key={c.id}>
          <button type="button" className={s.card} onClick={() => go(c.id)}
            aria-label={`${c.label} ${c.value}${c.unit} — 해당 항목으로 이동`}>
            <span className={s.cardTop}>
              <span aria-hidden>{c.icon}</span> {c.label}
              {c.note ? <span className={s.soft}>{c.note}</span> : null}
            </span>
            <span className={s.cardValue}>{c.value}<i>{c.unit}</i></span>
          </button>
        </li>
      ))}
    </ul>
  );
}
