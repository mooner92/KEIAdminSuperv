import { useEffect } from "react";
import { useRouter } from "next/router";

// 호롱 IA: /graph는 규정 찾기의 '그래프' 탭으로 흡수(design-revolution) — 딥링크 보존 리다이렉트.
export default function GraphRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/browse/?tab=graph"); }, [router]);
  return null;
}
