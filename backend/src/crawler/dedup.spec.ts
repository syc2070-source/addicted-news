import { KnownIndex, normalizeTitleKey, normalizeUrl, preDuplicate, loadKnownIndex, urlKnownInDb } from './dedup';
import { DeepseekBudget, dailyCap, estimateCostUsd, usedTodayFromRuns } from './deepseek_budget';

// NEWS-Q2 ■2: DeepSeek 앞 중복 확인 · 하루 상한
describe('dedup — 정규화', () => {
  it('URL: utm·추적 쿼리·#꼬리·www·끝 / 를 지우고 나머지 쿼리는 정렬해 남긴다', () => {
    expect(normalizeUrl('http://www.Example.com/news/1/?utm_source=rss&id=7&utm_medium=x#top'))
      .toBe('https://example.com/news/1?id=7');
    expect(normalizeUrl('https://example.com/a?b=2&a=1&fbclid=z')).toBe('https://example.com/a?a=1&b=2');
    expect(normalizeUrl('https://news.google.com/rss/articles/CBMiABC?oc=5')).toBe('https://news.google.com/rss/articles/CBMiABC');
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('#')).toBe('');
  });

  it('제목: 따옴표·구두점·끝의 「 - 매체명」을 무시한다', () => {
    expect(normalizeTitleKey('“불법 도박 OUT!”…강원랜드, AI 감시 - 아시아경제'))
      .toBe(normalizeTitleKey('"불법 도박 OUT!"...강원랜드, AI 감시'));
    expect(normalizeTitleKey('짧다')).toBe(''); // 너무 짧으면 비교 안 함
  });
});

describe('dedup — 중복이면 DeepSeek 를 부르지 않는다', () => {
  // 크롤러와 같은 순서: preDuplicate → 중복이 아니면 그때만 판정 호출
  async function crawlOne(idx: KnownIndex, query: any, c: { urls: string[]; titles: string[] }, judge: jest.Mock) {
    if (await preDuplicate(idx, query, c)) return 'dup';
    await judge();
    return 'judged';
  }

  it('기억표에 같은 원문 URL(쿼리 꼬리만 다름)이 있으면 호출 0', async () => {
    const idx = new KnownIndex();
    idx.add({ url: 'https://www.yna.co.kr/view/AKR1?section=x', title: '기존 기사 제목입니다' });
    const judge = jest.fn();
    expect(await crawlOne(idx, null, { urls: ['https://yna.co.kr/view/AKR1?section=x&utm_source=google'], titles: ['다른 제목이어도'] }, judge)).toBe('dup');
    expect(judge).not.toHaveBeenCalled();
  });

  it('기억표에 같은 정규화 제목(원제)이 있으면 호출 0', async () => {
    const idx = new KnownIndex();
    idx.add({ url: 'https://a.com/1', title: '번역 제목', originalTitle: 'Opioid deaths fall for second year - Reuters' });
    const judge = jest.fn();
    expect(await crawlOne(idx, null, { urls: ['https://b.com/2'], titles: ['Opioid deaths fall for second year'] }, judge)).toBe('dup');
    expect(judge).not.toHaveBeenCalled();
  });

  it('기억표에 없어도 DB 에 같은 URL 이 있으면(기간 무관) 호출 0 · 없으면 그때만 호출', async () => {
    const query = jest.fn(async (_sql: string, params?: unknown[]) =>
      ((params?.[0] as string[]) || []).includes('https://old.com/x') ? [{ '?column?': 1 }] : []);
    const judge = jest.fn();
    expect(await crawlOne(new KnownIndex(), query, { urls: ['https://old.com/x/'], titles: [] }, judge)).toBe('dup');
    expect(judge).not.toHaveBeenCalled();
    expect(await crawlOne(new KnownIndex(), query, { urls: ['https://new.com/y'], titles: ['새 기사 제목입니다'] }, judge)).toBe('judged');
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('기억표는 저장분 + 판정 거부분(judgment_missing 제외)으로 채우고, 읽기 실패면 빈 표', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM articles')) return [{ source_url: 'https://a.com/1', google_url: null, title: '저장된 기사 제목', original_title: null }];
      expect(sql).toContain("reject_reason <> 'judgment_missing'");
      return [{ source_url: 'https://r.com/1', google_url: 'https://news.google.com/rss/articles/X', title: '거부된 기사 제목', original_title: null }];
    });
    const idx = await loadKnownIndex(query, 30, () => undefined);
    expect(idx.match({ urls: ['https://news.google.com/rss/articles/X?oc=5'], titles: [] })).toBe('url');
    expect(idx.match({ urls: [], titles: ['저장된 기사 제목'] })).toBe('title');
    const broken = await loadKnownIndex(async () => { throw new Error('down'); }, 30, () => undefined);
    expect(broken.size).toBe(0);
    expect(await urlKnownInDb(async () => { throw new Error('down'); }, ['https://a.com'])).toBe(false);
  });
});

describe('deepseek_budget — 하루 상한·비용', () => {
  it('상한 = env > 설정 > 400 · 기사 하나(2회) 들어갈 자리가 있어야 시작', () => {
    expect(dailyCap({}, undefined)).toBe(400);
    expect(dailyCap({}, 250)).toBe(250);
    expect(dailyCap({ DEEPSEEK_DAILY_CAP: '10' }, 250)).toBe(10);
    const b = new DeepseekBudget(10, 6);
    expect(b.canStart(2)).toBe(true);   // 6+2+2 = 10
    expect(b.canStart(3)).toBe(false);  // 넘으면 그날 중단
    expect(b.markExhausted()).toBe(true);
    expect(b.markExhausted()).toBe(false); // 로그는 한 번
  });

  it('오늘 앞 실행 호출 수는 crawl_runs 에서, 없으면 0', async () => {
    expect(await usedTodayFromRuns(async () => [{ n: 37 }])).toBe(37);
    expect(await usedTodayFromRuns(async () => { throw new Error('no table'); })).toBe(0);
  });

  it('비용 추정 = 토큰 × 단가', () => {
    expect(estimateCostUsd(1_000_000, 500_000, { inPerM: 0.14, outPerM: 0.28 })).toBeCloseTo(0.28, 6);
  });
});
