import { fieldProfile, FieldProfile, setFieldProfileForTest } from './field_profile';
import { hasFieldKeyword, matchesFieldKeywords, resetFieldFilterCache, strongHit } from './field_filter';
import { buildAllSources } from './sourceConfig';

// NEWS-Q9 ■1: 「금주」 = 술 끊기 / 이번 주 — 조건부 핵심어(설정 keywords.strong_context) · ■2: 행동중독(일·음식·AI) 핵심어
describe('field_filter — 「금주」 뜻 가르기(NEWS-Q9 ■1)', () => {
  beforeEach(() => {
    setFieldProfileForTest(null);
    resetFieldFilterCache();
  });
  afterAll(() => {
    setFieldProfileForTest(null);
    resetFieldFilterCache();
  });

  it('「금주의 ○○」 칼럼(이번 주)은 핵심어가 아니다', () => {
    expect(matchesFieldKeywords('"내가 가르친 신입보다 월급이 적었다"…일본 직장인 퇴사 사연 [금주의 이슈]', '')).toBe(false);
    expect(matchesFieldKeywords('[금주의 안성시] 반려동물 문화교실 운영', '')).toBe(false);
    expect(hasFieldKeyword('금주의 로봇 캘린더(2026. 10. 12 ~ 10. 18)', '')).toBe(false);
  });

  it('「금주 ○○」(이슈·전망·만기·재판일정 따위)은 술 낱말이 있어도 핵심어가 아니다', () => {
    expect(strongHit('[금주 뉴욕증시 전망] 은행 실적·CPI 시험대', '')).toBeNull();
    expect(strongHit('[금주 재판일정] 1심 14일 선고', '음주 운전 사건 포함')).toBeNull();
    expect(strongHit('지난주 CP 발행…금주 만기 9조831억', '')).toBeNull();
  });

  it('「금주」 단독은 제목·첫 문단에 술·알코올·음주·단주·절주가 있을 때만 핵심어', () => {
    expect(strongHit('이화영, 금주 재심 청구하나', '법조계선 바늘구멍 뚫기라는 평가가 나온다.')).toBeNull();
    expect(strongHit('아이돌 위해 금주 결정', '그는 데뷔 뒤 술을 끊었다고 밝혔다.')).toBe('금주');
    expect(strongHit('나 홀로 금주 30일', '알코올 없이 지낸 한 달의 기록.')).toBe('금주');
    // 「기술」 속 「술」은 맥락 낱말이 아니다(낱말 머리만)
    expect(strongHit('신작 금주 공개', '최신 기술 동향을 다룬다.')).toBeNull();
  });

  it('첫 문단만 본다 — 술 낱말이 뒤 문단에만 있으면 핵심어 아님', () => {
    const body = `${'증시와 환율 흐름을 정리한 주간 보고서다. 금리와 수출 지표를 함께 살펴본다. '.repeat(2)}\n\n둘째 문단에 음주 이야기가 잠깐 나온다.`;
    expect(strongHit('금주 국내외 흐름', body)).toBeNull();
    expect(strongHit('금주 국내외 흐름', `음주 문화가 바뀐다.\n${body}`)).toBe('금주');
  });

  it('뜻이 굳은 꼴(금주구역 · 금주령 · 금주를 · 금주 운동)은 맥락 낱말 없이도 핵심어', () => {
    expect(strongHit('서울역 광장 일대 금주구역 지정', '기자명 홍길동 입력 2026.10.12')).toBe('금주');
    expect(strongHit('서울역 광장, 금주 구역으로 지정된다', '')).toBe('금주');
    expect(strongHit('1년 지켜온 금주를 풀었다', '딸과 함께한 전주 1박 2일')).toBe('금주');
    expect(strongHit('100년 전 백령도 장촌의 금주 단연 운동', '')).toBeNull(); // 「금주 단연」 = 단독 · 맥락 없음
    expect(strongHit('미국 금주법 100년', '')).toBe('금주');
  });

  it('다른 strong 핵심어가 있으면 「금주의」 칼럼이어도 그대로 통과(금주 조건은 금주 하나만)', () => {
    expect(matchesFieldKeywords('[금주의 사건사고] 필로폰 투약 30대 검거', '마약 수사 확대', { allowIncident: true })).toBe(true);
    expect(strongHit('「단주」 모임 10년', '')).toBe('단주');
  });

  it('설정이 없는 분야는 옛 부분문자열 맞춤(하위호환)', () => {
    const base = fieldProfile();
    setFieldProfileForTest({
      ...base,
      field: `q9-${Math.random()}`,
      keywords: { ...base.keywords, strong_context: undefined } as FieldProfile['keywords'],
    });
    resetFieldFilterCache();
    expect(hasFieldKeyword('[금주의 이슈] 퇴사 사연', '')).toBe(true);
  });
});

describe('field profile — 행동중독 핵심어·검색어(NEWS-Q9 ■2 · 오너 결정 10-17)', () => {
  beforeEach(() => {
    setFieldProfileForTest(null);
    resetFieldFilterCache();
  });

  it('일·음식·AI 중독 핵심어가 거름망을 지난다(ko·en)', () => {
    expect(strongHit('박 시장 "제가 워커홀릭이라"', '')).toBe('워커홀릭');
    expect(strongHit('10대 여성 폭식증 진료 51% 늘어', '')).toBe('폭식');
    expect(strongHit('청소년 챗봇 의존 우려', '')).toBe('챗봇 의존');
    expect(matchesFieldKeywords('쉴 때 교회 일 생각하나요… 사역 중독 의심을', '')).toBe(true);
    expect(strongHit('Soho House founder: workaholism harms', '')).toBe('workaholism');
    expect(strongHit('Binge eating common among U.S. high schoolers', '')).toBe('binge eating');
    expect(strongHit('Teens and chatbot dependence', '')).toBe('chatbot dependence');
  });

  it('모음 기사(주요 신문 톱뉴스 · 주요 일간지 1면 · 건강 뉴스 업데이트)는 제외어', () => {
    expect(matchesFieldKeywords('[전국 주요 신문 톱뉴스](21일 조간)', 'AI 중독 인류 퇴화')).toBe(false);
    expect(matchesFieldKeywords('[미디어분석] 9월 21일 주요 일간지 1면, 인사검증', '중독')).toBe(false);
  });

  it('검색어 2(kr/en-google-behavioral) · 맨 「폭식」·「binge eating」 단독 검색은 없음', () => {
    const g = buildAllSources(fieldProfile()).filter((s) => s.id.endsWith('-google-behavioral'));
    expect(g.map((s) => s.id).sort()).toEqual(['en-google-behavioral', 'kr-google-behavioral']);
    for (const s of g) expect(s.active).toBe(true);
    const ko = decodeURIComponent(g.find((s) => s.lang === 'ko')!.url);
    expect(ko).toContain('"폭식장애"');
    expect(ko).not.toMatch(/"폭식"/);
    expect(decodeURIComponent(g.find((s) => s.lang === 'en')!.url)).toContain('"binge+eating+disorder"');
  });
});
