import Link from "next/link";
import type { SeasonalItem } from "../../lib/vault";
import c from "../../styles/Calendar.module.css";

// 캘린더 항목 제목 = 문서 링크(있을 때). 그리드·스트립 공용 한 줄 렌더(2026-07-20 추출).
export default function TitleLink({ it, className }: { it: SeasonalItem; className?: string }) {
  const body = (
    <>
      {it.title}
      {it.상태 === "예시" ? <sup className={c.draftMark} title="자료 확정 전">⁎</sup> : null}
    </>
  );
  if (it.근거slug)
    return <Link className={className} href={`/d/${encodeURIComponent(it.근거slug)}/?from=/calendar/`}>{body}</Link>;
  if (it.관련페이지) return <Link className={className} href={it.관련페이지}>{body}</Link>;
  return <span className={className}>{body}</span>;
}
