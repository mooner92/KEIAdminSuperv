import { useEffect, useState } from "react";
import { useFlag } from "./flags";

// 모바일 셸 활성 여부(docs/54 v2) = flag mobile_shell ∧ 좁은 뷰포트(≤640px).
// 페이지가 '무거운 컴포넌트(그래프 캔버스)를 아예 렌더 안 함' 같은 JS 분기에 쓴다.
// SSG 안전: 마운트 전엔 false(데스크톱 가정) → 마운트 후 matchMedia로 확정(정적 export 호환).
export function useMobileShell(): boolean {
  const on = useFlag("mobile_shell");
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return on && narrow;
}
