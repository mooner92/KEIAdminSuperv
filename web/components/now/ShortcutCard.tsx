import Link from "next/link";
import n from "../../styles/Now.module.css";
export type Shortcut = { icon: string; title: string; desc: string; href: string; accent?: string };

/* v2(Spotify, HANDOFF §5): 이모지 아이콘 폐기 → **글자 커버 타일**(분류색 알파 배경 + 첫 글자).
 * accent = 분류색 6종 키(globals --accent-*) — 콘텐츠의 색 역할. icon prop은 하위호환용(미사용). */
export default function ShortcutCard({ title, desc, href, large, accent = "규정집" }:
  Shortcut & { large?: boolean }) {
  const tile = (
    <span
      className={`${n.tile} ${large ? n.tileLg : ""}`}
      style={{ background: `color-mix(in srgb, var(--accent-${accent}) 18%, transparent)`, color: `var(--accent-${accent})` }}
      aria-hidden
    >
      {title.replace(/\s/g, "").slice(0, 1)}
    </span>
  );
  if (large) {
    return (
      <Link className={`${n.shortcut} ${n.shortcutLg}`} href={href}>
        {tile}
        <span className={n.lgBody}>
          <b className={n.shortcutTitle}>{title}</b>
          <span className={n.shortcutDesc}>{desc}</span>
        </span>
        <span className={n.chev} aria-hidden>›</span>
      </Link>
    );
  }
  return (
    <Link className={n.shortcut} href={href}>
      {tile}
      <b className={n.shortcutTitle}>{title}</b>
      <span className={n.shortcutDesc}>{desc}</span>
    </Link>
  );
}
