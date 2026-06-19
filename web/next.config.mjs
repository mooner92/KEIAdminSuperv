/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 정적 export → nginx 127.0.0.1 (Cloudflare Zero Trust 뒤, 사내 전용)
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  // emotion(=TDS 기반)을 Next 컴파일러로 처리
  compiler: { emotion: true },
  // TDS 패키지는 트랜스파일 필요
  transpilePackages: ["@toss/tds-mobile", "@toss/tds-mobile-ait"],
};

export default nextConfig;
