import { useFlag } from "../../lib/flags";
import { track } from "../../lib/track";
import g from "./ReaderGlassToggle.module.css";

// 리퀴드글라스 돋보기 토글(docs/59) — 아이콘만(🔍). flag reader_glass 내장 게이트.
// 켜는 용도. 끄기는 ReaderGlass가 렌즈 위에 띄우는 고정 '끄기' 칩으로도 가능(렌즈에 안 가림).
export default function ReaderGlassToggle({ on, onToggle, drawer }: {
  on: boolean; onToggle: () => void; drawer?: boolean;
}) {
  const enabled = useFlag("reader_glass");
  if (!enabled) return null;
  return (
    <button
      type="button"
      className={`${g.toggle} ${drawer ? g.inDrawer : ""} ${on ? g.active : ""}`}
      onClick={() => { onToggle(); track("reader_glass", "/d"); }}
      aria-pressed={on}
      aria-label={on ? "돋보기 끄기" : "돋보기 켜기"}
      title={on ? "돋보기 끄기 (Esc)" : "돋보기 — 커서 위치를 확대해 읽기"}
    >
      {on ? "🔍✕" : "🔍"}
    </button>
  );
}
