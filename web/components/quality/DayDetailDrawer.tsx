import Link from "next/link";
import { useEffect, useState } from "react";
import SideDrawer from "../common/SideDrawer";
import AsyncState from "../common/AsyncState";
import s from "./DayDetailDrawer.module.css";

// 자가평가 '그날의 상세'(specs/07 C) — 이력 표에서 날짜를 누르면 목록을 유지한 채 옆에서 확인.
// ⚠ 설계 판단: 60문항 전부가 아니라 **오답·검토필요만** 보여준다 — 이력을 훑는 목적은
// "그날 뭐가 틀렸나"이기 때문. 전체는 하단 링크로 /quality?date= (기존 게시판 재사용).
// 데이터는 이미 서빙 중인 공개 JSON(web/public/quality/daily/*.json) — 신규 API 없음.

type Item = {
  id: string; 질문: string; 유형: string; 판정: string; 증거?: string; 원인?: string;
  분류?: string; 출처?: { 규정명?: string; 조?: string } | null; 축?: string;
};
const AXIS: Record<string, string> = {
  amount: "💰 금액전결", impact: "🔗 개정영향", defterm: "📖 정의어", deadline: "⏱ 기한",
};
type Daily = { date: string; 정답률: number; 집계: Record<string, number>; 문항: Item[] };

const BAD = ["오답", "검토필요"];

export default function DayDetailDrawer({ date, onClose, onOpenDoc }: {
  date: string | null;
  onClose: () => void;
  /** 근거 조문을 문서 드로어로 열고 싶을 때(선택) */
  onOpenDoc?: (slug: string, anchor: string) => void;
}) {
  const [data, setData] = useState<Daily | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!date) { setData(null); setErr(""); return; }
    setData(null); setErr("");
    fetch(`/quality/daily/${date}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not-found"))))
      .then(setData)
      .catch(() => setErr("그날의 상세 기록을 불러오지 못했어요."));
  }, [date]);

  const bad = (data?.문항 || []).filter((i) => BAD.includes(i.판정));
  const agg = data?.집계 || {};

  return (
    <SideDrawer
      open={!!date}
      onClose={onClose}
      ariaLabel="그날의 자가평가 상세"
      title={date ? `${date} 자가평가` : ""}
      subtitle={data ? `정답률 ${data.정답률}% · 정답 ${agg["정답"] || 0} · 오답 ${agg["오답"] || 0} · 검토 ${agg["검토필요"] || 0}` : ""}
      actions={date ? (
        <Link className={s.full} href={`/quality/?date=${date}`}>전체 문항 보기 →</Link>
      ) : null}
    >
      {!data && !err ? <AsyncState loading /> : null}
      {err ? <AsyncState error={err} /> : null}
      {data ? (
        <div className={s.body}>
          <p className={s.lead}>
            {bad.length > 0
              ? <>이날 <b>확인이 필요한 문항 {bad.length}건</b>이에요(오답·검토필요). 전체 {data.문항.length}문항은 위 링크에서 볼 수 있어요.</>
              : <>이날은 <b>확인이 필요한 문항이 없었어요</b> 🎉 (전체 {data.문항.length}문항)</>}
          </p>
          <ul className={s.list}>
            {bad.map((i) => (
              <li key={i.id} className={s.item}>
                <div className={s.head}>
                  <span className={i.판정 === "오답" ? s.badgeBad : s.badgeRev}>{i.판정}</span>
                  {i.축 ? <span className={s.tag}>{AXIS[i.축] || i.축}</span> : null}
                  {i.유형 ? <span className={s.tag}>{i.유형}</span> : null}
                  {i.원인 ? <span className={s.tag}>{i.원인}</span> : null}
                </div>
                <div className={s.q}>{i.질문}</div>
                {i.증거 ? <div className={s.ev}>{i.증거}</div> : null}
                {i.출처?.규정명 ? (
                  onOpenDoc ? (
                    <button type="button" className={s.src}
                      onClick={() => onOpenDoc(i.출처!.규정명!, i.출처?.조 || "")}>
                      {i.출처.규정명} {i.출처.조 || ""} →
                    </button>
                  ) : (
                    <span className={s.srcFlat}>{i.출처.규정명} {i.출처.조 || ""}</span>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SideDrawer>
  );
}
