import {
  KnownIndex, foldSameArticles, isSameArticle, normalizeTitleKey, normalizeUrl, preDuplicate, loadKnownIndex, titleSimilarity, urlKnownInDb,
} from './dedup';
import { LightRow, membersOf } from '../articles/cluster_view';
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

// NEWS-Q6 ■2: 같은 기사 두 번(10-12 경향 5398·5420 = RSS 원문 utm 꼬리 · 구글 피드 원문 · 1초 차 저장)
describe('dedup — 같은 기사 두 번(NEWS-Q6 ■2)', () => {
  const KHAN_RSS = 'https://www.khan.co.kr/article/202610121138001/?utm_source=khan_rss&utm_medium=rss&utm_campaign=total_news';
  const KHAN_GOOGLE = 'https://www.khan.co.kr/article/202610121138001';
  const T = Date.parse('2026-10-12T02:38:00Z');

  it('URL 정규화: utm·끝 / · m.·mobile.·amp. · /amp 경로 · amp 쿼리 → 정본(앞머리만 남는 호스트는 그대로)', () => {
    const canon = 'https://khan.co.kr/article/202610121138001';
    for (const u of [KHAN_RSS, KHAN_GOOGLE, 'http://m.khan.co.kr/article/202610121138001', 'https://amp.khan.co.kr/article/202610121138001/amp',
      'https://mobile.khan.co.kr/amp/article/202610121138001', 'https://www.khan.co.kr/article/202610121138001?outputType=amp&fbclid=x']) {
      expect(normalizeUrl(u)).toBe(canon);
    }
    expect(normalizeUrl('https://amp.dev/x')).toBe('https://amp.dev/x');
  });

  it('경향 재현: 같은 실행에서 먼저 저장한 기사(utm 꼬리) 뒤 구글 피드 원문은 저장 직전에 걸린다', () => {
    const idx = new KnownIndex();
    expect(idx.sameArticle({ url: KHAN_RSS, title: '이제 서울역 광장서 술 못 마신다…적발 땐 과태료 5만 원[서울25]', source: '경향신문', ts: T })).toBeNull();
    idx.addSaved({ url: KHAN_RSS, title: '이제 서울역 광장서 술 못 마신다…적발 땐 과태료 5만 원[서울25]', source: '경향신문', ts: T });
    expect(idx.sameArticle({
      url: KHAN_GOOGLE, googleUrl: 'https://news.google.com/rss/articles/CBMiWkFV', title: '이제 서울역 광장서 술못마신다…금주구역 지정예고[서울25] - 경향신문',
      source: '경향신문', ts: T,
    })).toBe('url');
  });

  it('같은 매체 + 24시간 + 닮은 제목 = 같은 기사 · 다른 매체 · 24시간 넘음 · 연재 ①② 는 따로', () => {
    const idx = new KnownIndex();
    idx.addSaved({ url: 'https://a.co.kr/1', title: '서울역 광장 음주없이 쾌적하게…서울 중구, 서울역 광장 금주구역 지정 예고', source: '문화일보', ts: T });
    const c = { url: 'https://a.co.kr/2', title: '서울역 광장 음주없이 쾌적하게…중구, 서울역 광장 금주구역 지정 예고 - 문화일보', source: '문화 일보', ts: T + 3600_000 };
    expect(idx.sameArticle(c)).toBe('outlet');
    expect(idx.sameArticle({ ...c, source: '연합뉴스' })).toBeNull();           // 다른 매체(통신 전재) = 묶음이 맡는다
    expect(idx.sameArticle({ ...c, ts: T + 25 * 3600_000 })).toBeNull();     // 24시간 넘음
    expect(isSameArticle(
      { title: '청소년 도박중독 실태 ① 학교가 뚫렸다', source: 'X', ts: T },
      { title: '청소년 도박중독 실태 ② 치료는 어디서', source: 'X', ts: T },
    )).toBe(false);
    expect(titleSimilarity('서울역 광장 금주구역 지정 예고', '서울역 광장 금주구역 지정 예고 - 경향신문')).toBe(1);
  });

  it('이미 저장된 같은 기사 → 같은 묶음(지움 0): 혼자면 먼저 기사 묶음에 붙이고 · 이미 같으면 그대로 · 다른 여러 건 묶음이면 둠', () => {
    const rows = [
      { id: 1, title: '서울역 광장 금주구역 지정 예고 과태료 5만원', source: '경향신문', url: 'https://khan.co.kr/a/1?utm_source=x', ts: T },
      { id: 2, title: '서울역 광장 금주구역 지정 예고…과태료 5만원 - 경향신문', source: '경향신문', url: 'https://khan.co.kr/a/1', ts: T + 1000 },
      { id: 3, title: '다른 사건 기사 제목입니다', source: 'Y', url: 'https://y.com/3', ts: T },
    ];
    const solo = (id: number) => ({ clusterId: String(id), size: 1, representativeId: id, memberIds: [id] });
    const index = new Map([[1, solo(1)], [2, solo(2)], [3, solo(3)]]);
    expect(foldSameArticles(rows, index)).toEqual({ pairs: 1, together: 0, folded: 1, left: 0 });
    expect(index.get(2)).toEqual({ clusterId: '1', size: 2, representativeId: 1, memberIds: [1, 2] });
    expect(index.get(1)!.size).toBe(2);
    expect(foldSameArticles(rows, index)).toEqual({ pairs: 1, together: 1, folded: 0, left: 0 });
    const other = { clusterId: '9', size: 3, representativeId: 9, memberIds: [9, 2, 8] };
    const index2 = new Map([[1, solo(1)], [2, other], [3, solo(3)]]);
    expect(foldSameArticles(rows, index2)).toEqual({ pairs: 1, together: 0, folded: 0, left: 1 });
  });

  it('화면 접힘: 묶음 펼침에서 같은 기사 두 번은 하나만 · 기억표는 저장분의 매체·보도 시각도 싣는다', async () => {
    const light = new Map<number, LightRow>([
      [10, { id: 10, title: '서울역 광장 금주구역 지정 - 문화일보', source: '문화일보', sourceUrl: 'https://munhwa.com/1', publishedAt: '', publishedTs: null, sourceGrade: 'press', ts: T }],
      [11, { id: 11, title: '이제 서울역 광장서 술 못 마신다[서울25]', source: '경향신문', sourceUrl: KHAN_RSS, publishedAt: '', publishedTs: null, sourceGrade: 'press', ts: T }],
      [12, { id: 12, title: '이제 서울역 광장서 술못마신다…금주구역[서울25] - 경향신문', source: '경향신문', sourceUrl: KHAN_GOOGLE, publishedAt: '', publishedTs: null, sourceGrade: 'press', ts: T }],
    ]);
    const info = { clusterId: '10', size: 3, representativeId: 10, memberIds: [10, 11, 12] };
    expect(membersOf(info, 10, light).map((r) => r.id)).toEqual([11]);
    const idx = await loadKnownIndex(async (sql: string) => (sql.includes('FROM articles')
      ? [{ source_url: KHAN_RSS, google_url: null, title: '경향 기사 제목입니다', original_title: null, source: '경향신문', ts: '2026-10-12T02:38:00Z' }]
      : []), 30, () => undefined);
    expect(idx.saved).toHaveLength(1);
    expect(idx.sameArticle({ url: KHAN_GOOGLE, title: '전혀 다른 제목', source: '경향신문', ts: T })).toBe('url');
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
