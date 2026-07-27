/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 기사 이미지는 임의 외부 도메인 → next/image 원격 설정 부담을 피하려고 일반 <img> 사용.
  // (이미지 없거나 로드 실패 시 텍스트 카드로 폴백 — 디자인 원칙)
  async redirects() {
    return [];
  },
};

module.exports = nextConfig;
