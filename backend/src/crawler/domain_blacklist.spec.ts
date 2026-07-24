import {
  isBlacklistedDomain, qualifiesForAutoBlacklist, addRuntimeBlacklist, _resetBlacklistState,
} from './domain_blacklist';

describe('domain_blacklist (v5.4.1 0원 필터)', () => {
  beforeEach(() => _resetBlacklistState());

  it('시드 카지노 SEO 스팸 도메인은 차단', () => {
    expect(isBlacklistedDomain('https://termokonteiner.ru/a')).toBe(true);
    expect(isBlacklistedDomain('http://www.les24heures.fr/x')).toBe(true);
  });

  it('정상 언론 도메인은 통과(회복 전문매체 오차단 방지)', () => {
    expect(isBlacklistedDomain('https://www.hani.co.kr/arti/1')).toBe(false);
    // addictionrecoveryebulletin.org 는 시드에 없음(오차단 해제)
    expect(isBlacklistedDomain('https://addictionrecoveryebulletin.org/post')).toBe(false);
  });

  it('자동추가 기준(완화): 누적 10+ AND cat_fit/seo 거부율 90%+ 만 true', () => {
    expect(qualifiesForAutoBlacklist(10, 9)).toBe(true);   // 90%
    expect(qualifiesForAutoBlacklist(10, 10)).toBe(true);  // 100%
    expect(qualifiesForAutoBlacklist(9, 9)).toBe(false);   // 누적 미달
    expect(qualifiesForAutoBlacklist(20, 17)).toBe(false); // 85% 미달
    expect(qualifiesForAutoBlacklist(3, 3)).toBe(false);   // 구v5.4 기준(3회)은 이제 불충분
  });

  it('addRuntimeBlacklist 후 차단', () => {
    expect(isBlacklistedDomain('https://newspam.example/x')).toBe(false);
    addRuntimeBlacklist('newspam.example');
    expect(isBlacklistedDomain('https://newspam.example/x')).toBe(true);
  });
});
