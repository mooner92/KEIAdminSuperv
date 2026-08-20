import Link from "next/link";
import type { GianArticle } from "../../lib/gian";
import s from "./Gian.module.css";

/** 규정 조문 한 줄 — 원문 그대로, 길면 절단 표시 + 원문 링크.
 *  ⛔ 절대 규칙 2(의역 금지): 여기서 문장을 다듬지 않는다. 화면이 줄이는 것은 **길이**뿐이고,
 *     줄였다는 사실은 " … 원문 보기"로 말한다. */
export function ArticleNote({ a, max = 400 }: { a: GianArticle; max?: number }) {
  return (
    <li className={s.note}>
      <b><Link href={`/d/${a.slug}/`}>{a.규정명} {a.조}</Link>({a.제목})</b> — {a.원문.slice(0, max)}
      {a.원문.length > max ? <> … <Link href={`/d/${a.slug}/`}>원문 보기</Link></> : null}
    </li>
  );
}

/** 조문 목록 — `only`를 주면 그 조문만(화면이 고른 대표 조문). 없으면 전부. */
export default function ArticleNotes({ items, only, max }: {
  items: GianArticle[]; only?: string[]; max?: number;
}) {
  const list = only ? items.filter((a) => only.includes(a.조)) : items;
  if (!list.length) return null;
  return <ul className={s.notes}>{list.map((a) => <ArticleNote key={a.조} a={a} max={max} />)}</ul>;
}
