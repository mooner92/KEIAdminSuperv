import { useEffect } from "react";
import { useRouter } from "next/router";

// 호롱 IA: /forms는 규정 찾기의 '서식' 탭으로 흡수(design-revolution) — 딥링크 보존 리다이렉트.
export default function FormsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/browse/?tab=forms"); }, [router]);
  return null;
}
