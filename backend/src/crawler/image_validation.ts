// ============================================================
// image_validation.ts — 기사 썸네일 URL 유효성(구글 정적 자원 차단 포함)
// ------------------------------------------------------------
// 실측(2026-07 Supabase): 백필 오염 2447건 — 전부 동일 Google News 로고
//   https://lh3.googleusercontent.com/J6_coFbogxhRI9iM864NL_...=s0-w300-rw
//   source_url 은 news.google.com/rss/articles/... (미해제)
// newsCrawler·image_backfill·article_extractor 공용.
// ============================================================

/** DB 실측 + gstatic/news.google 등 구글 정적·뉴스 UI 자원 */
export const GOOGLE_BLOCKED_IMAGE_PATTERNS = [
  'gstatic.com',
  'ggpht.com',
  'news.google.com',
  'google.com/images',
  'google-news',
  'googlenews',
  'googleusercontent.com/proxy',
  // Google News 기본 로고(lh*.googleusercontent.com, 동일 해시 2447건)
  'lh1.googleusercontent.com',
  'lh2.googleusercontent.com',
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
  'J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc',
];

const GENERAL_BLOCKED_PATTERNS = [
  'doubleclick', 'adsystem', 'adserver', 'tracking', 'pixel', 'beacon',
  'analytics', 'advertisement', 'banner', 'sponsor',
  'facebook.com/tr', 'twitter.com/favicon', 'linkedin.com/favicon',
  'favicon', 'logo', 'icon', 'placeholder', 'default', 'noimage', 'no-image',
  'blank.gif', 'spacer.gif', '1x1', 'transparent',
  'width=1', 'height=1', 'w=1', 'h=1',
];

export function isGoogleBlockedImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const low = url.toLowerCase();
  return GOOGLE_BLOCKED_IMAGE_PATTERNS.some((p) => low.includes(p.toLowerCase()));
}

/** og:image·RSS·백필 공용 — 구글 자원·추적·로고류 배제 */
export function isValidArticleImageUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const lowerUrl = url.toLowerCase();
  if (url.length < 30) return false;

  for (const pattern of [...GOOGLE_BLOCKED_IMAGE_PATTERNS, ...GENERAL_BLOCKED_PATTERNS]) {
    if (lowerUrl.includes(pattern.toLowerCase())) return false;
  }

  const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const validImageServices = ['cloudinary', 'imgix', 'amazonaws.com', 'wp-content/uploads'];
  const hasValidExtension = validExtensions.some((ext) => lowerUrl.includes(ext));
  const isImageService = validImageServices.some((svc) => lowerUrl.includes(svc));
  return hasValidExtension || isImageService || lowerUrl.includes('/image') || lowerUrl.includes('/photo');
}

/** SQL WHERE 절용 — 차단 목록 image_url 보유 기사 조회 */
export function googleBlockedImageSqlCondition(alias = 'image_url'): string {
  const col = alias;
  const likes = GOOGLE_BLOCKED_IMAGE_PATTERNS.map(
    (p) => `${col} ILIKE '%${p.replace(/'/g, "''")}%'`,
  );
  return `(${likes.join(' OR ')})`;
}
