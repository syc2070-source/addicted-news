import { fieldProfile, setFieldProfileForTest } from './field_profile';
import { matchesFieldKeywords, resetFieldFilterCache } from './field_filter';

// NEWS-Q7 ■1: 담배·흡연·니코틴·전자담배·금연(설정 파일만 · 관문 프롬프트 그대로) — 표본은 10-16 오후 피드에서
describe('field_filter — 담배 핵심어(NEWS-Q7 ■1)', () => {
  beforeEach(() => {
    setFieldProfileForTest(null);
    resetFieldFilterCache();
  });

  it('표본에서 떨어지던 국내 담배 기사가 이제 통과', () => {
    expect(matchesFieldKeywords('흡연율 30% 줄었는데 액상형 전자담배 사용률↑ - 연합뉴스TV', '')).toBe(true);
    expect(matchesFieldKeywords('청소년 건강 빨간불…학년 오를수록 흡연·음주 늘고 운동 줄어 - 경북신문', '')).toBe(true);
    expect(matchesFieldKeywords('전자담배 니코틴 함량 달라도 용액 1㎖당 정액과세…헌재 “합헌”', '')).toBe(true);
  });

  it('표본에서 떨어지던 영문 담배 기사가 이제 통과(nicotine · smoking cessation)', () => {
    expect(matchesFieldKeywords('Oral nicotine pouches are becoming a pathway to nicotine use for young people', '')).toBe(true);
    expect(matchesFieldKeywords('NIH and FDA leaders call for innovation in development of smoking cessation treatments', '')).toBe(true);
  });

  it('무관은 그대로 떨어지고(연기 · smoke 낱말), 구글 검색어 ko 1·en 1 이 들어 있다', () => {
    expect(matchesFieldKeywords("Indonesia's skies turn apocalyptic orange as smoke blankets Singapore", 'Haze from forest fires.')).toBe(false);
    expect(matchesFieldKeywords('You don’t have to smoke to get lung cancer. Pope Leo is proof', '')).toBe(false);
    const ids = fieldProfile().sources.google_news.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['kr-google-nicotine', 'en-google-smoking-cessation']));
  });
});
