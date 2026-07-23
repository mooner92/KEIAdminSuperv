import Link from "next/link";
import n from "../../styles/Now.module.css";

// 추가 기능 허브의 바로가기 카드(2026-07-20) — now.tsx가 7개를 인라인 반복하던 것을
// 데이터(icon·title·desc·href) 기반 단일 컴포넌트로. 플래그 게이팅은 부모가 목록에서 담당.
export type Shortcut = { icon: string; title: string; desc: string; href: string };

export default function ShortcutCard({ icon, title, desc, href, large }: Shortcut & { large?: boolean }) {
  return (
    <Link className={`${n.shortcut} ${large ? n.shortcutLg : ""}`} href={href}>
      <span className={`${n.shortcutIcon} ${large ? n.shortcutIconLg : ""}`}>{icon}</span>
      <b className={n.shortcutTitle}>{title}</b>
      <span className={n.shortcutDesc}>{desc}</span>
    </Link>
  );
}
