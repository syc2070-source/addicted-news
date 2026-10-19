import {
  FieldProfile,
  fieldProfile,
  setFieldProfileForTest,
} from './field_profile';
import {
  hasKoreanWordAt,
  matchesFieldKeywords,
  negativeHit,
  negativeVerdict,
  resetFieldFilterCache,
} from './field_filter';

// NEWS-Q10 ■2: 「다이어트」 동행 낱말 · 스팸 낱말 하나 ∧ 제목 핵심어 → 관문 · 조사 뒤 어미 경계
const PARTICLES = [
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '의',
  '에',
  '에서',
  '도',
  '로',
  '으로',
  '과',
  '와',
  '만',
  '부터',
  '까지',
];

function withKeywords(over: Partial<FieldProfile['keywords']>): void {
  const base = fieldProfile();
  setFieldProfileForTest({
    ...base,
    field: `q10-${Math.random()}`,
    keywords: { ...base.keywords, ...over },
  });
  resetFieldFilterCache();
}

describe('field_filter — 제외어·스팸 우선순위(NEWS-Q10 ■2)', () => {
  beforeEach(() => {
    setFieldProfileForTest(null);
    resetFieldFilterCache();
  });
  afterAll(() => {
    setFieldProfileForTest(null);
    resetFieldFilterCache();
  });

  it('실제 설정: 「다이어트」·diet 는 음식중독·폭식장애·섭식 낱말이 함께 있으면 막지 않는다 · 혼자면 그대로 막음', () => {
    expect(
      matchesFieldKeywords(
        '유튜브 폭식·섭식장애 규제…먹방·다이어트 영상 수익 제한',
        '음식 중독 우려',
      ),
    ).toBe(true);
    expect(
      matchesFieldKeywords(
        'Angry personalities face higher risk of food addiction',
        'diet and craving study',
      ),
    ).toBe(true);
    expect(negativeHit('다이어트 식단 관리로 중독 끊기', '')).toBe('다이어트');
    // 맨 「폭식」(연예 고백 꼴)은 동행 낱말이 아님
    expect(
      matchesFieldKeywords('이혼 후 폭식으로 살 쪄 다이어트 중독 고백', ''),
    ).toBe(false);
  });

  it('실제 설정: 「놀이터에선 금연」 — 스팸 낱말 하나 ∧ 제목 핵심어 = 떨어뜨리지 않고 관문으로', () => {
    const t = '"놀이터에선 금연" 지적에 아이 안은 아빠 폭행한 남성';
    expect(negativeVerdict(t, '')).toEqual({ hit: '놀이터', gate: true });
    expect(negativeHit(t, '')).toBeNull();
    expect(matchesFieldKeywords(t, '', { allowIncident: true })).toBe(true);
    expect(
      matchesFieldKeywords('[사설] 약물중독 치료·재활 기반 제대로 갖춰야', ''),
    ).toBe(true);
    expect(matchesFieldKeywords('흡연 과태료 최대 200만원 집중단속', '')).toBe(
      true,
    );
  });

  it('실제 설정: 스팸만이면 지금처럼 떨어뜨림(도박 낱말 · 스팸 2 개 · 제목 핵심어 없음 · 광고 낱말 · 도박 전용 낱말)', () => {
    expect(negativeVerdict('불법 도박사이트 환전 일당 검거', '').gate).toBe(
      false,
    ); // 도박 낱말
    expect(matchesFieldKeywords('금연 놀이터 첫 충전 이벤트 진행', '')).toBe(
      false,
    ); // 스팸 2 개 이상
    expect(
      matchesFieldKeywords('동네 놀이터 새 단장', '흡연 금지 표지판도 달았다'),
    ).toBe(false); // 핵심어가 본문에만
    expect(matchesFieldKeywords('금연 안전놀이터 가입코드', '')).toBe(false); // ad_penalty
    expect(matchesFieldKeywords('인터넷 중독 용어 보너스 화면 안내', '')).toBe(
      false,
    ); // 도박 전용 낱말(spam_gate.words 밖)
  });

  it('spam_gate 설정이 없으면 옛 규칙(스팸 낱말 = 떨어뜨림)', () => {
    withKeywords({ spam_gate: undefined });
    expect(matchesFieldKeywords('"놀이터에선 금연" 지적', '')).toBe(false);
    expect(negativeVerdict('"놀이터에선 금연" 지적', '').gate).toBe(false);
  });

  it('negative_context 설정이 없으면 「다이어트」는 늘 막음 · 설정 값만 바꿔 동행 낱말을 고른다', () => {
    withKeywords({ negative_context: undefined });
    expect(negativeHit('폭식장애 다이어트', '')).toBe('다이어트');
    withKeywords({
      negative_context: { 다이어트: { keep_with_any: ['폭식장애'] } },
    });
    expect(negativeHit('폭식장애 다이어트', '')).toBeNull();
    expect(negativeHit('섭식장애 다이어트', '')).toBe('다이어트');
  });

  it('조사 뒤 어미(에서는 · 에도 · 까지도)도 낱말 경계 · 어미 설정이 없으면 옛 꼴', () => {
    expect(
      hasKoreanWordAt('도박 입금에서는', '입금', PARTICLES, ['는', '도']),
    ).toBe(true);
    expect(
      hasKoreanWordAt('뱃살까지도 뺀다', '뱃살', PARTICLES, ['는', '도']),
    ).toBe(true);
    expect(hasKoreanWordAt('다이어트에도', '다이어트', PARTICLES, ['도'])).toBe(
      true,
    );
    expect(hasKoreanWordAt('도박 입금에서는', '입금', PARTICLES)).toBe(false);
    // 어미 뒤에 한글이 또 이어지면 경계 아님(입금에서는커녕)
    expect(hasKoreanWordAt('입금에서는커녕', '입금', PARTICLES, ['는'])).toBe(
      false,
    );
    // 실제 설정: 「다이어트에선」(조사 에선) · 「다이어트에서는」(조사+어미)
    expect(negativeHit('다이어트에선 중독 조심', '')).toBe('다이어트');
    expect(negativeHit('다이어트에서는 중독 조심', '')).toBe('다이어트');
  });

  it('「사역 중독」은 그대로 실림(변경 0)', () => {
    expect(
      matchesFieldKeywords('교회 사역 중독, 목회자 번아웃 막으려면', ''),
    ).toBe(true);
  });
});
