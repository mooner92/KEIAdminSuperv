import { useMemo, useState } from "react";
import type { RegionGrade } from "../../lib/travel";
import s from "./Travel.module.css";

/** 국외 지역등급(가·나·다·라) 찾기 — 별표 5 비고2의 국가·도시 목록 원문 그대로 검색.
 *  ⛔ 목록에 없는 나라는 추정하지 않는다(원문 비고3: 가장 가까운 국가 등급 적용 → 안내만). */
export default function RegionFinder({ regions, onPick }: {
  regions: RegionGrade[];
  onPick: (등급: string) => void;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim();
    if (!t) return [];
    const out: { 등급: string; 국가: string }[] = [];
    for (const r of regions) {
      for (const c of r.국가) {
        if (c.includes(t)) out.push({ 등급: r.등급, 국가: c });
      }
    }
    return out.slice(0, 12);
  }, [regions, q]);
  return (
    <div className={s.finder}>
      <label className={s.field}>
        <b>나라·도시로 등급 찾기</b>
        <input
          className={s.sel}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="예: 도쿄, 독일, 베트남"
          aria-label="나라·도시로 지역등급 찾기"
        />
      </label>
      {q.trim() ? (
        hits.length ? (
          <span className={s.hitList}>
            {hits.map((h) => (
              <button key={`${h.등급}-${h.국가}`} type="button" className={s.hitBtn} onClick={() => onPick(h.등급)}>
                {h.국가} → <b>{h.등급} 등급</b>
              </button>
            ))}
          </span>
        ) : (
          <span className={s.hit}>
            별표 5 비고2 목록에 없어요. 원문 비고3에 따라 <b>수도까지 거리가 가장 가까운 국가의 등급</b>을
            적용합니다 — 담당 부서에 확인하세요.
          </span>
        )
      ) : null}
    </div>
  );
}
