import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Section from "../common/Section";
import { ResultList } from "../common/ResultRow";
import RateLine from "./RateLine";
import RegionFinder from "./RegionFinder";
import { TRAVEL_REG_SLUG } from "../../lib/travelMeta";
import type { TravelRates } from "../../lib/travel";
import s from "./Travel.module.css";

// 여비 계산기(docs/72 P1) — 직급·구간을 고르면 **여비규정 별표 원문 그대로의** 정액을 보여준다.
// ⛔ 절대 규칙: ① 금액은 전부 별표 원문(lib/travel.ts 파싱) ② 줄마다 근거 원문행 표시
//              ③ 계산은 '정액 × 일수'와 그 합산까지만(비율·가산 자동 적용 금지)
//              ④ 확정 못 한 값은 빈칸 + "원문 확인"(추정치 금지).

const HO_KEY = "kei-travel-ho"; // 마지막 선택 직급(결재선 판정기의 kei-approval-role과 같은 관례)
const won = (n: number) => `${n.toLocaleString()}원`;

export default function TravelCalc({ rates }: { rates: TravelRates }) {
  const [mode, setMode] = useState<"국내" | "국외">("국내");
  const [ho, setHo] = useState(6);
  const [kind, setKind] = useState<"관외" | "근무지내">("관외");
  // ⚠ 입력 상태는 **문자열**이다. 숫자 상태로 두면 '01'을 쳤을 때 Number('01')===1이라
  //   React가 값이 같다고 보고 다시 그리지 않아 화면에 '01'이 그대로 남는다(실측 결함).
  //   타이핑 중에는 사용자가 친 그대로 두고, 계산에는 아래 파생 숫자(daysN·nightsN)를 쓴다.
  const [daysIn, setDaysIn] = useState("1");
  const [nightsIn, setNightsIn] = useState("0");
  const clampNum = (v: string, lo: number, hi: number, dflt: number) => {
    const n = Number(v);
    return v.trim() === "" || Number.isNaN(n) ? dflt : Math.max(lo, Math.min(hi, Math.floor(n)));
  };
  const days = clampNum(daysIn, 1, 365, 1);
  const nights = clampNum(nightsIn, 0, 364, 0);
  const [area, setArea] = useState("특별시");
  const [grade, setGrade] = useState("가");
  const [hours4, setHours4] = useState<"이상" | "미만">("이상");

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(HO_KEY));
      if (saved >= 1 && saved <= 6) setHo(saved);
    } catch { /* ignore */ }
  }, []);
  const pickHo = (n: number) => {
    setHo(n);
    try { localStorage.setItem(HO_KEY, String(n)); } catch { /* ignore */ }
  };

  const dom = useMemo(() => rates.domestic.find((d) => d.호.includes(ho)) || null, [rates.domestic, ho]);
  const ovsRows = useMemo(() => rates.overseas.filter((o) => o.호.includes(ho)), [rates.overseas, ho]);
  const ovs = useMemo(() => ovsRows.find((o) => o.등급 === grade) || null, [ovsRows, grade]);
  const air = useMemo(
    () => rates.airfare.find((a) => a.호.includes(ho)) || rates.airfare.find((a) => a.호.length === 0) || null,
    [rates.airfare, ho],
  );
  const cap = useMemo(() => dom?.숙박상한.find((c) => c.지역 === area) || null, [dom, area]);

  if (!rates.ok) {
    return (
      <Section icon="⚠️" title="여비 표를 읽지 못했습니다">
        <p className={s.src}>
          여비규정 별표(지급표)를 이 화면이 읽지 못했어요. <b>금액을 추정해 보여드리지 않습니다.</b>{" "}
          <Link href={`/d/${TRAVEL_REG_SLUG}/`}>여비규정 원문</Link>에서 직접 확인하시거나 담당 부서에 문의하세요.
        </p>
      </Section>
    );
  }

  // ── 정액 합계: 확정된 정액(일비·식비) × 일수만. 실비(숙박·운임)는 넣지 않는다. ──
  const perDiem = mode === "국내" ? dom?.일비.amount ?? null : ovs?.일비.amount ?? null;
  const meal = mode === "국내" ? dom?.식비.amount ?? null : ovs?.식비.amount ?? null;
  const fixedTotal =
    kind === "근무지내" && mode === "국내"
      ? null
      : perDiem !== null && meal !== null
        ? (perDiem + meal) * days
        : null;
  const money = (n: number) => (mode === "국내" ? won(n) : `$${n.toLocaleString()}`);

  const gradeLabel = rates.grades.find((g) => g.호 === `제${ho}호`);

  return (
    <>
      <Section icon="🧾" title="출장 조건" desc="직급·구간을 고르면 별표 원문 그대로의 정액을 보여드려요.">
        <div className={s.controls}>
          <span className={s.seg} role="group" aria-label="국내·국외 구분">
            {(["국내", "국외"] as const).map((m) => (
              <button key={m} type="button" className={mode === m ? `${s.segBtn} ${s.segOn}` : s.segBtn}
                onClick={() => setMode(m)} aria-pressed={mode === m}>{m} 출장</button>
            ))}
          </span>
          <label className={s.field}>
            <b>직급</b>
            <select className={s.sel} value={ho} onChange={(e) => pickHo(Number(e.target.value))} aria-label="직급(여비 지급 구분)">
              {rates.grades.map((g, i) => (
                <option key={g.호} value={i + 1}>{g.호} · {g.대상}</option>
              ))}
            </select>
          </label>
          {mode === "국내" ? (
            <span className={s.seg} role="group" aria-label="국내 출장 유형">
              {(["관외", "근무지내"] as const).map((k) => (
                <button key={k} type="button" className={kind === k ? `${s.segBtn} ${s.segOn}` : s.segBtn}
                  onClick={() => setKind(k)} aria-pressed={kind === k}>
                  {k === "관외" ? "관외(일반)" : "근무지 내"}
                </button>
              ))}
            </span>
          ) : (
            <label className={s.field}>
              <b>지역등급</b>
              <select className={s.sel} value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="국외 지역등급">
                {ovsRows.map((o) => <option key={o.등급} value={o.등급}>{o.등급} 등급</option>)}
              </select>
            </label>
          )}
          {!(mode === "국내" && kind === "근무지내") ? (
            <>
              <label className={s.field}>
                <b>여행일수</b>
                <input className={s.num} type="number" min={1} max={365} inputMode="numeric" value={daysIn}
                  onChange={(e) => setDaysIn(e.target.value)}
                  onBlur={() => setDaysIn(String(clampNum(daysIn, 1, 365, 1)))} aria-label="여행일수" />일
              </label>
              <label className={s.field}>
                <b>숙박</b>
                <input className={s.num} type="number" min={0} max={364} inputMode="numeric" value={nightsIn}
                  onChange={(e) => setNightsIn(e.target.value)}
                  onBlur={() => setNightsIn(String(clampNum(nightsIn, 0, 364, 0)))} aria-label="숙박 수" />박
              </label>
            </>
          ) : (
            <span className={s.seg} role="group" aria-label="출장 여행시간">
              {(["이상", "미만"] as const).map((h) => (
                <button key={h} type="button" className={hours4 === h ? `${s.segBtn} ${s.segOn}` : s.segBtn}
                  onClick={() => setHours4(h)} aria-pressed={hours4 === h}>4시간 {h}</button>
              ))}
            </span>
          )}
          {mode === "국내" && kind === "관외" && (dom?.숙박상한.length ?? 0) > 0 ? (
            <label className={s.field}>
              <b>숙박 지역</b>
              <select className={s.sel} value={area} onChange={(e) => setArea(e.target.value)} aria-label="숙박 지역">
                {dom!.숙박상한.map((c) => <option key={c.지역} value={c.지역}>{c.지역}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        {mode === "국외" ? <RegionFinder regions={rates.regions} onPick={setGrade} /> : null}
        {gradeLabel ? (
          <p className={s.src}>
            📄 [여비규정 별표 1] {gradeLabel.원문행} — 이 직급이 지급표의 <b>{gradeLabel.호}</b>입니다.
          </p>
        ) : null}
      </Section>

      <Section
        icon="💴"
        title={mode === "국내" ? (kind === "관외" ? "국내(관외) 출장 여비" : "근무지 내 국내 출장 여비") : "국외 출장 여비"}
        desc={mode === "국외" && rates.overseasCurrency ? `단위: ${rates.overseasCurrency} — 환율 환산은 규정에 없어 하지 않습니다.` : undefined}
      >
        <ResultList>
          {mode === "국내" && kind === "관외" && dom ? (
            <>
              <RateLine 항목="일비" 값={`${dom.일비.원문}원 (1일당)`} 근거="여비규정 별표 2" 원문행={dom.원문행} 태그="정액"
                계산={dom.일비.amount !== null ? `${won(dom.일비.amount)} × ${days}일 = ${won(dom.일비.amount * days)}` : undefined}
                미확정={dom.일비.amount === null} />
              <RateLine 항목="식비" 값={`${dom.식비.원문}원 (1일당)`} 근거="여비규정 별표 2" 원문행={dom.원문행} 태그="정액"
                계산={dom.식비.amount !== null ? `${won(dom.식비.amount)} × ${days}일 = ${won(dom.식비.amount * days)}` : undefined}
                미확정={dom.식비.amount === null} />
              <RateLine 항목="숙박비" 값={dom.숙박비.원문} 근거="여비규정 별표 2" 원문행={dom.원문행} 실비
                태그={cap ? `${area} 상한` : "상한 표기 없음"}
                계산={nights === 0 ? "숙박 없음(0박)" : cap ? `상한 ${won(cap.amount)} × ${nights}박 = ${won(cap.amount * nights)}까지` : undefined}
                미확정={nights > 0 && !cap} />
              <RateLine 항목="운임" 근거="여비규정 별표 2" 원문행={dom.원문행} 실비
                값={`철도 ${dom.철도운임} · 선박 ${dom.선박운임} · 항공 ${dom.항공운임} · 자동차 ${dom.자동차운임}`} />
            </>
          ) : null}

          {mode === "국내" && kind === "근무지내" ? (
            rates.inArea ? (
              (() => {
                const c = hours4 === "이상" ? rates.inArea.이상4시간 : rates.inArea.미만4시간;
                return (
                  <RateLine
                    항목={`근무지 내 출장 (여행시간 4시간 ${hours4})`}
                    값={c.원문}
                    // ⛔ 제18조는 '1일당'이라 쓰지 않았다 — 일수 곱을 임의로 하지 않고 원문 정액만 보여준다.
                    계산={c.amount !== null ? won(c.amount) : undefined}
                    미확정={c.amount === null}
                    근거="여비규정 제18조" 원문행={rates.inArea.원문} 태그="정액(출장 건별)" />
                );
              })()
            ) : (
              <RateLine 항목="근무지 내 출장" 값="" 근거="여비규정 제18조" 원문행="원문에서 정액을 확인하지 못했습니다." 미확정 />
            )
          ) : null}

          {mode === "국외" && ovs ? (
            <>
              <RateLine 항목="일비" 값={`$${ovs.일비.원문} (1일당)`} 근거="여비규정 별표 5" 원문행={ovs.원문행} 태그="정액"
                계산={ovs.일비.amount !== null ? `$${ovs.일비.amount.toLocaleString()} × ${days}일 = $${(ovs.일비.amount * days).toLocaleString()}` : undefined}
                미확정={ovs.일비.amount === null} />
              <RateLine 항목="식비" 값={`$${ovs.식비.원문} (1일당)`} 근거="여비규정 별표 5" 원문행={ovs.원문행} 태그="정액"
                계산={ovs.식비.amount !== null ? `$${ovs.식비.amount.toLocaleString()} × ${days}일 = $${(ovs.식비.amount * days).toLocaleString()}` : undefined}
                미확정={ovs.식비.amount === null} />
              <RateLine 항목="숙박비" 값={ovs.숙박상한.원문} 근거="여비규정 별표 5" 원문행={ovs.원문행} 실비 태그={`${ovs.등급} 등급 상한`}
                계산={nights === 0 ? "숙박 없음(0박)"
                  : ovs.숙박상한.amount !== null ? `상한 $${ovs.숙박상한.amount.toLocaleString()} × ${nights}박 = $${(ovs.숙박상한.amount * nights).toLocaleString()}까지` : undefined}
                미확정={nights > 0 && ovs.숙박상한.amount === null} />
              {air ? (
                <RateLine 항목="국외 항공운임" 값={air.등급} 근거="여비규정 별표 3" 원문행={air.원문행} 태그="정액(좌석 등급)" />
              ) : null}
            </>
          ) : null}
        </ResultList>

        {fixedTotal !== null ? (
          <div className={s.total}>
            <span className={s.totalLabel}>정액 합계 (일비 + 식비, {days}일)</span>
            <span className={s.totalValue}>{money(fixedTotal)}</span>
            <span className={s.totalNote}>숙박비·운임은 <b>실비</b>라 합계에 넣지 않았습니다.</span>
          </div>
        ) : null}
      </Section>

      <Section icon="⚠️" title="자동 계산에 넣지 않은 감액·특례" desc="아래는 규정 원문 그대로입니다 — 해당 여부는 담당 부서에서 확인하세요.">
        <ul className={s.notes}>
          {rates.notes.map((n) => (
            <li key={n.조} className={s.note}><b>{n.조}</b> — {n.원문}</li>
          ))}
        </ul>
        {rates.domesticNotes.length ? (
          <ul className={s.notes}>
            {rates.domesticNotes.map((n, i) => <li key={i} className={s.note}><b>별표 2 비고</b> — {n}</li>)}
          </ul>
        ) : null}
      </Section>

      <p className={s.disclaimer}>
        이 화면의 금액은 <b>여비규정 별표 원문 그대로</b>이며(개정일 {rates.개정일 || "원문 확인"}), 계산은{" "}
        <b>정액 × 일수</b>와 그 합산뿐입니다. 실비(운임·숙박비)는 영수증·정산 기준이라 금액을 만들지 않습니다.
        {rates.valueStoreTotal > 0 ? ` (국외 지급표 ${rates.valueStoreChecked}/${rates.valueStoreTotal}칸 — 검수완료 표 스토어와 대조 확인)` : ""}
        {" "}👉 <Link href={`/d/${TRAVEL_REG_SLUG}/`}>여비규정 원문 보기</Link>
        <br />
        <b>최종 판단은 원문과 담당 부서 확인 바랍니다.</b>
      </p>
    </>
  );
}
