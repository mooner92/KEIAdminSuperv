import { useEffect } from "react";

// 모바일 뒤로가기 제스처로 오버레이(드로어·바텀시트)를 닫는다.
// 문제: 순수 React state로 여는 오버레이는 history를 안 쌓아서, 열린 상태에서 뒤로 스와이프하면
//   오버레이가 아니라 '직전 페이지'로 이탈한다(예: 채팅에서 근거 드로어 열고 뒤로 → 더보기로).
// 해결: 열릴 때 history 항목을 하나 쌓고(popstate 대상), 뒤로가기(popstate) 시 onClose만 호출.
//   버튼·배경 등으로 닫으면(state가 false로) 쌓았던 항목을 history.back()으로 소비한다.
export function useBackClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    // 중복 방지 마커
    window.history.pushState({ kraOverlay: (window.history.state?.kraOverlay || 0) + 1 }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // 프로그램적으로 닫혔고(뒤로가기가 아니라) 우리가 쌓은 항목이 아직 최상단이면 소비한다.
      if (window.history.state?.kraOverlay) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
