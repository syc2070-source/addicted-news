import { missedDaySources, planMissedDay, RunBrief } from './missed_day';
import type { SourceConfig } from './sourceConfig';
import { loadFieldProfile } from './field_profile';

// NEWS-Q7 ■3: 놓친 날 되짚기 1회 — 10-15 실행은 방송에서 62분 멈춰 기사 소스 0/107 닿음(저장 0)
const run = (startedAt: string, reached: number, extra: Partial<RunBrief> = {}): RunBrief => ({
  startedAt, reached, total: 107, timedOut: reached === 0, stoppedAt: reached === 0 ? 'articles' : null, covers: [], ...extra,
});

describe('missed_day — 놓친 날 되짚기(NEWS-Q7 ■3)', () => {
  it('결손 실행(10-15)을 찾아 앞 정상 실행 날짜부터 다음날 전까지 한 번만 메운다', () => {
    const now = Date.parse('2026-10-17T03:00:00Z');
    const runs = [run('2026-10-16T03:00:29.093Z', 102), run('2026-10-15T03:00:41.678Z', 0), run('2026-10-14T03:00:34.524Z', 102)];
    expect(planMissedDay(runs, now)).toEqual({ covers: ['2026-10-15T03:00:41.678Z'], after: '2026-10-14', before: '2026-10-16' });
    // 이미 메운 실행이 있으면 다시 하지 않음(1회) · 정상 실행만이면 없음 · 3일보다 오래된 결손도 없음
    const done = [run('2026-10-17T03:00:00Z', 105, { covers: ['2026-10-15T03:00:41.678Z'] }), ...runs];
    expect(planMissedDay(done, Date.parse('2026-10-18T03:00:00Z'))).toBeNull();
    expect(planMissedDay([runs[0], runs[2]], now)).toBeNull();
    expect(planMissedDay(runs, Date.parse('2026-10-19T04:00:00Z'))).toBeNull();
  });

  it('국내지마다 구글뉴스 site: 날짜 검색 소스 하나(막힌 피드·다른 종류는 뺌 · 무리는 kr_press)', () => {
    const base = { sourceName: 'x', category: 'c', region: 'kr', lang: 'ko', outletId: 'o', grade: 'press', active: true } as const;
    const sources: SourceConfig[] = [
      { ...base, id: 'kr-press-연합뉴스', url: 'https://www.yna.co.kr/rss/news.xml', sourceType: 'kr_press' },
      { ...base, id: 'kr-press-동아일보', url: 'https://rss.donga.com/total.xml', sourceType: 'kr_press',
        blocked: { kind: 'blocked_from_host', retry: 'weekly' } },
      { ...base, id: 'inst-mohw', url: 'https://www.mohw.go.kr/rss', sourceType: 'institution' },
    ];
    const out = missedDaySources(sources, { covers: ['t'], after: '2026-10-14', before: '2026-10-16' }, { query: '(중독 OR 마약)' });
    expect(out.map((s) => s.id)).toEqual(['kr-press-연합뉴스-missed']);
    const u = decodeURIComponent(out[0].url);
    expect(u).toContain('https://news.google.com/rss/search?q=site:yna.co.kr+(중독+OR+마약)+after:2026-10-14+before:2026-10-16&hl=ko');
    expect(out[0].maxItems).toBe(20);
    expect(out[0].substituteFor).toBe('kr-press-연합뉴스');
    // 실제 분야 설정이 되짚기 칸을 싣는다(불러오기에서 빠지지 않음)
    expect(loadFieldProfile('addiction').sources.missed_day?.query).toContain('중독');
  });
});
