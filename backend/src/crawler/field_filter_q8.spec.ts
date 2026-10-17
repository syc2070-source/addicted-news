import { FieldProfile, fieldProfile, setFieldProfileForTest } from './field_profile';
import { hasKoreanWordAt, matchesFieldKeywords, negativeHit, resetFieldFilterCache } from './field_filter';

// NEWS-Q8 ■1: 제외어는 낱말 경계에서만(「출입금지」 속 「입금」은 제외어 아님) · 예외표는 설정 파일
const PARTICLES = ['은', '는', '이', '가', '을', '를', '의', '에', '에서', '도', '로', '으로', '과', '와', '만', '부터', '까지'];

function withNegatives(ko: string[], en: string[], boundary?: FieldProfile['keywords']['negative_boundary']): void {
  const base = fieldProfile();
  setFieldProfileForTest({
    ...base,
    field: `q8-${Math.random()}`,
    keywords: { ...base.keywords, negative: { ko, en }, negative_boundary: boundary },
  });
  resetFieldFilterCache();
}

describe('field_filter — 제외어 낱말 경계(NEWS-Q8 ■1)', () => {
  beforeEach(() => {
    setFieldProfileForTest(null);
    resetFieldFilterCache();
  });
  afterAll(() => {
    setFieldProfileForTest(null);
    resetFieldFilterCache();
  });

  it('「출입금지」 속 「입금」은 제외어가 아니다 · 낱말 「입금」은 그대로 막는다', () => {
    withNegatives(['입금'], [], { particles: PARTICLES });
    expect(matchesFieldKeywords('도박중독 막으려 카지노 출입금지 신청 늘어', '')).toBe(true);
    expect(matchesFieldKeywords('도박 첫 입금 30% 보너스', '')).toBe(false);
    expect(negativeHit('도박 출입금지', '')).toBeNull();
  });

  it('「뱃살」: 긴 낱말(술뱃살) 속이면 지나가고 낱말이면 막는다', () => {
    withNegatives(['뱃살'], [], { particles: PARTICLES });
    expect(matchesFieldKeywords('술뱃살보다 무서운 알코올 중독 경고 신호', '')).toBe(true);
    expect(matchesFieldKeywords('뱃살 빼는 운동, 음주 줄이기부터', '')).toBe(false);
  });

  it('조사가 붙은 꼴은 경계로 친다(입금을 · 입금에서는 X · 뱃살까지)', () => {
    withNegatives(['입금', '뱃살'], [], { particles: PARTICLES });
    expect(negativeHit('도박 사이트 입금을 유도', '')).toBe('입금');
    expect(negativeHit('도박 뱃살까지 빼 준다', '')).toBe('뱃살');
    expect(negativeHit('도박 입금에서는', '')).toBeNull(); // 「에서」 뒤에 한글이 이어짐 = 조사 하나가 아님
    expect(hasKoreanWordAt('입금으로', '입금', PARTICLES)).toBe(true);
    expect(hasKoreanWordAt('무통장입금', '입금', PARTICLES)).toBe(false);
  });

  it('앞뒤가 숫자·영문·문장부호면 경계(3입금 · VIP입금 · "입금")', () => {
    withNegatives(['입금'], [], { particles: PARTICLES });
    expect(negativeHit('도박 3입금 이벤트', '')).toBe('입금');
    expect(negativeHit('도박 VIP입금', '')).toBe('입금');
    expect(negativeHit('도박 "입금"', '')).toBe('입금');
    expect(negativeHit('도박 입금2배', '')).toBe('입금');
  });

  it('영문 제외어는 옛 규칙 그대로(낱말 경계 · casinos ≠ casino)', () => {
    withNegatives([], ['casino'], { particles: PARTICLES });
    expect(matchesFieldKeywords('Gambling addiction rises near new casino', '')).toBe(false);
    expect(matchesFieldKeywords('Gambling addiction: casinos face new rules', '')).toBe(true);
  });

  it('예외표: anywhere 는 긴 낱말 속에서도 막고 · allow_long 은 anywhere 라도 지나간다', () => {
    withNegatives(['식중독', '입금'], [], { particles: PARTICLES, anywhere: ['식중독', '입금'], allow_long: ['출입금지'] });
    expect(negativeHit('알코올 중독 아닌 집단식중독 발생', '')).toBe('식중독');
    expect(negativeHit('도박 무통장입금 안내', '')).toBe('입금');
    expect(negativeHit('도박중독자 카지노 출입금지 확대', '')).toBeNull();
  });

  it('경계 설정이 없으면 옛 부분문자열 맞춤(다른 분야 설정 하위호환)', () => {
    withNegatives(['입금'], []);
    expect(negativeHit('도박 출입금지', '')).toBe('입금');
  });

  it('실제 설정: 「출입금지」 도박 기사는 통과 · 입금 스팸은 막힘 · 식중독은 긴 낱말 속에서도 막힘', () => {
    expect(fieldProfile().keywords.negative_boundary?.particles?.length).toBeGreaterThan(0);
    expect(matchesFieldKeywords('강원랜드 도박중독자 출입금지 요청 3년 새 2배', '')).toBe(true);
    expect(matchesFieldKeywords('도박 첫 입금 보너스 지급', '')).toBe(false);
    expect(matchesFieldKeywords('급식 집단식중독 의심 신고', '중독 증상')).toBe(false);
  });

  it('실제 설정: 도박 스팸 합성어(안전놀이터 · 온라인카지노 · 최대 20만원)는 긴 낱말 속에서도 막힘 · 「다이어트약」 마약류 기사는 통과', () => {
    expect(matchesFieldKeywords('도박 중독 걱정 없는 안전놀이터 추천', '')).toBe(false);
    expect(matchesFieldKeywords('온라인카지노 도박 중독 걱정 끝', '')).toBe(false);
    expect(matchesFieldKeywords('도박 신규 회원 최대 20만원 지급', '')).toBe(false);
    expect(matchesFieldKeywords('다이어트약 마약류 오남용 중독 경고', '')).toBe(true);
  });
});
