/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 정적 export → nginx 127.0.0.1 (Cloudflare Zero Trust 뒤, 사내 전용)
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  // TDS·emotion 설정은 docs/37 D1에서 제거(라이선스 무명시 → 의존 자체 철거)
};

export default nextConfig;
