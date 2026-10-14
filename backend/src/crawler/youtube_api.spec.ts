import {
  DAILY_UNIT_CAP, QuotaGuard, SEARCH_UNITS, VIDEOS_UNITS, apiTodayFromRuns, lookbackChannel, parseSearchResponse, planChannel,
  rss404Outlets, youtubeApiKey, youtubeApiMode,
} from './youtube_api';
import { passesBroadcastKeywordGate } from './broadcast';

// NEWS-Q6 ■4: 방송 되짚기(YouTube Data API) — 가짜 응답 · 할당량 · 열쇠 없음 길 · 404 전환
const FAKE_KEY = 'test-key-not-real';
const NOW = Date.parse('2026-10-15T03:00:00Z');

function fakeSearch() {
  return {
    items: [
      { id: { kind: 'youtube#video', videoId: 'AbCdEfGhIj0' }, snippet: { title: '도박소년이 된 내 아들 &quot;PD수첩&quot;', description: '청소년 도박…', publishedAt: '2026-10-01T12:00:00Z', thumbnails: { high: { url: 'https://i.ytimg.com/vi/AbCdEfGhIj0/hqdefault.jpg' } } } },
      { id: { kind: 'youtube#video', videoId: 'ZzZzZzZzZz1' }, snippet: { title: '오늘의 날씨', description: '맑음', publishedAt: '2026-10-02T12:00:00Z' } },
      { id: { kind: 'youtube#channel', channelId: 'UCxxxx' }, snippet: { title: '채널' } },
    ],
  };
}

describe('youtube_api — 방송 되짚기(NEWS-Q6 ■4)', () => {
  it('가짜 응답: search.list → 영상만(채널 결과 버림 · &quot; 풀기) → 핵심어 통과분만 videos.list 로 전체 설명 · 열쇠는 머리글로만', async () => {
    const calls: Array<{ url: string; params: Record<string, string | number>; headers: Record<string, string> }> = [];
    const get = jest.fn(async (url: string, params: Record<string, string | number>, headers: Record<string, string>) => {
      calls.push({ url, params, headers });
      if (url.endsWith('/search')) return fakeSearch();
      return { items: [{ id: 'AbCdEfGhIj0', snippet: { description: '청소년 도박 중독을 추적한 PD수첩 전체 설명' } }] };
    });
    const guard = new QuotaGuard();
    const r = await lookbackChannel('UCawCv9kO2UXbTtsK4EammRQ', FAKE_KEY, guard, { now: NOW, get, needFull: passesBroadcastKeywordGate });
    expect(r.items.map((i) => i.videoId)).toEqual(['AbCdEfGhIj0', 'ZzZzZzZzZz1']);
    expect(r.items[0].title).toBe('도박소년이 된 내 아들 "PD수첩"');
    expect(r.items[0].description).toBe('청소년 도박 중독을 추적한 PD수첩 전체 설명');
    expect(r.items[0].url).toBe('https://www.youtube.com/watch?v=AbCdEfGhIj0');
    expect(r.units).toBe(SEARCH_UNITS + VIDEOS_UNITS);
    expect(calls[0].params).toMatchObject({ channelId: 'UCawCv9kO2UXbTtsK4EammRQ', order: 'date', type: 'video', maxResults: 50, publishedAfter: '2026-09-15T03:00:00.000Z' });
    expect(calls[1].params.id).toBe('AbCdEfGhIj0'); // 날씨는 핵심어 미통과 → 전체 설명 안 받음
    for (const c of calls) {
      expect(c.headers['x-goog-api-key']).toBe(FAKE_KEY);
      expect(JSON.stringify([c.url, c.params])).not.toContain(FAKE_KEY);
    }
    expect(parseSearchResponse({})).toEqual([]);
  });

  it('할당량: 하루 2,000 단위 — 오늘 앞 실행분을 더해 넘으면 부르지 않고 멈춤 기록 · quotaExceeded 도 멈춤', async () => {
    expect(DAILY_UNIT_CAP).toBe(2000);
    const get = jest.fn(async () => fakeSearch());
    const guard = new QuotaGuard(DAILY_UNIT_CAP, 1950);
    const r = await lookbackChannel('UC1', FAKE_KEY, guard, { now: NOW, get });
    expect(get).not.toHaveBeenCalled();
    expect(r).toMatchObject({ items: [], units: 0, error: { reason: 'quota_guard' } });
    expect(guard.stopped).toBe(true);
    const g2 = new QuotaGuard(DAILY_UNIT_CAP, 0);
    const failing = jest.fn(async () => { throw { response: { status: 403, data: { error: { errors: [{ reason: 'quotaExceeded' }] } } } }; });
    const r2 = await lookbackChannel('UC1', FAKE_KEY, g2, { now: NOW, get: failing });
    expect(r2.error).toEqual({ status: 403, reason: 'quotaExceeded' });
    expect(g2.stopped).toBe(true);
    // 오늘 앞 실행들의 단위·채널(crawl_runs.per_source.__run.broadcastApi)
    const q = jest.fn(async () => [{ api: { units: 909, channels: ['mbc_pd_note'] } }, { api: JSON.stringify({ units: 100, channels: ['sbs_truth'] }) }, { api: null }]);
    expect(await apiTodayFromRuns(q, 'addiction')).toEqual({ units: 1009, channels: ['mbc_pd_note', 'sbs_truth'] });
    expect(await apiTodayFromRuns(async () => { throw new Error('no table'); }, 'addiction')).toEqual({ units: 0, channels: [] });
  });

  it('열쇠 없음 길: env 없으면 RSS 만(API 0) · health off · 공백 값도 없음으로', () => {
    expect(youtubeApiKey({})).toBeNull();
    expect(youtubeApiKey({ YOUTUBE_API_KEY: '   ' })).toBeNull();
    expect(youtubeApiMode({})).toBe('off');
    expect(youtubeApiMode({ YOUTUBE_API_KEY: FAKE_KEY })).toBe('on');
    expect(planChannel({ hasKey: false, rss404LastRun: true, searchedToday: false, quotaLeft: true })).toEqual({ rss: true, api: false, reason: 'no_key' });
    expect(planChannel({ hasKey: true, rss404LastRun: false, searchedToday: false, quotaLeft: true })).toEqual({ rss: true, api: true, reason: 'rss+api' });
    expect(planChannel({ hasKey: true, rss404LastRun: false, searchedToday: true, quotaLeft: true }).api).toBe(false); // 채널당 하루 1회
    expect(planChannel({ hasKey: true, rss404LastRun: false, searchedToday: false, quotaLeft: false }).reason).toBe('quota');
  });

  it('404 전환: 지난 실행 RSS 404 채널은 열쇠 있으면 API 만(RSS 10회 재시도 대신 한 번만 확인)', () => {
    const failed = ['broadcast:mbc_pd_note [404]', 'broadcast:sbs_truth [500]', 'wp-wpr-002 (The Washington Post) [502]: x', 'broadcast:kbs_60min [404]'];
    expect(rss404Outlets(failed)).toEqual(['mbc_pd_note', 'kbs_60min']);
    expect(planChannel({ hasKey: true, rss404LastRun: true, searchedToday: false, quotaLeft: true })).toEqual({ rss: false, api: true, reason: 'api_only_rss404' });
  });
});
