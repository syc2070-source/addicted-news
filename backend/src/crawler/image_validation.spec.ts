import {
  isGoogleBlockedImageUrl,
  isValidArticleImageUrl,
} from './image_validation';

describe('image_validation', () => {
  const GOOGLE_LOGO =
    'https://lh3.googleusercontent.com/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc=s0-w300-rw';

  it('구글 뉴스 로고 URL → 무효', () => {
    expect(isGoogleBlockedImageUrl(GOOGLE_LOGO)).toBe(true);
    expect(isValidArticleImageUrl(GOOGLE_LOGO)).toBe(false);
  });

  it('gstatic 로고 URL → 무효', () => {
    const url =
      'https://www.gstatic.com/images/branding/googleg/1x/googleg_standard_color_128dp.png';
    expect(isValidArticleImageUrl(url)).toBe(false);
  });

  it('언론사 og:image → 유효', () => {
    const url = 'https://cdn.example.co.kr/wp-content/uploads/2024/03/news-photo.jpg';
    expect(isGoogleBlockedImageUrl(url)).toBe(false);
    expect(isValidArticleImageUrl(url)).toBe(true);
  });
});
