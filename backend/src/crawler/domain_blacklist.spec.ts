import {
  isBlacklistedDomain, recordCategoryFitFail, _resetBlacklistState,
} from './domain_blacklist';

describe('domain_blacklist (v5.4 0원 필터)', () => {
  beforeEach(() => _resetBlacklistState());

  it('시드 카지노 SEO 스팸 도메인은 차단', () => {
    expect(isBlacklistedDomain('https://termokonteiner.ru/a')).toBe(true);
    expect(isBlacklistedDomain('http://www.les24heures.fr/x')).toBe(true);
    expect(isBlacklistedDomain('https://mkpsm.ru/')).toBe(true);
  });

  it('정상 언론 도메인은 통과', () => {
    expect(isBlacklistedDomain('https://www.hani.co.kr/arti/1')).toBe(false);
    expect(isBlacklistedDomain('https://news.bbc.co.uk/x')).toBe(false);
  });

  it('동일 도메인 category_fit=false 3회 → 자동 블랙리스트 추가', () => {
    const u = 'https://spam-casino-seo.example/post/1';
    expect(recordCategoryFitFail(u)).toBeNull();       // 1
    expect(recordCategoryFitFail(u)).toBeNull();       // 2
    expect(recordCategoryFitFail(u)).toBe('spam-casino-seo.example'); // 3 → 추가
    expect(isBlacklistedDomain(u)).toBe(true);         // 이후 차단
  });
});
