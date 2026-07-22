import { useFlag } from "../../lib/flags";
import { track } from "../../lib/track";
import g from "./ReaderGlassToggle.module.css";

// 리퀴드글라스 돋보기 토글(docs/59) — 문서 읽기 화면(문서 페이지·드로어)의 플로팅 버튼.
// flag reader_glass 내장 게이트: off면 렌더 안 함. 켜면 부모가 ReaderGlass를 마운트.
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
      title={on ? "돋보기 끄기 (Esc)" : "돋보기 — 커서 위치를 확대해 읽기"}
    >
      🔍 {on ? "돋보기 끄기" : "돋보기"}
    </button>
  );
}
