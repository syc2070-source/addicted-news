// NEWS-Q8 ■2: 방송 채널별 마지막 읽기 결과(broadcast.feeds[]).
import { broadcastFeedsOf, feedStatusOf } from './broadcast_feeds';
import { planChannel } from './youtube_api';

const AT = new Date('2026-10-17T03:00:40Z');

describe('feedStatusOf (수집기 한 줄)', () => {
  it('지난 실행 RSS 404 → API 만 읽음 = via api · result ok', () => {
    const plan = planChannel({ hasKey: true, rss404LastRun: true, searchedToday: false, quotaLeft: true });
    const s = feedStatusOf({ id: 'mbc_pd_note', plan, hasKey: true, rssTried: true, rssFailed: '404', apiError: null, items: 50, at: AT });
    expect(s).toMatchObject({ id: 'mbc_pd_note', via: 'api', rss: '404', api: 'ok', result: 'ok', items: 50, recorded: true });
    expect(s.at).toBe('2026-10-17T03:00:40.000Z');
  });

  it('할당량이 다해 RSS 로 떨어짐: RSS 성공 = via rss · RSS 도 실패 = api_quota', () => {
    const plan = planChannel({ hasKey: true, rss404LastRun: false, searchedToday: false, quotaLeft: false });
    expect(feedStatusOf({ id: 'newstapa', plan, hasKey: true, rssTried: true, rssFailed: null, items: 15, at: AT }))
      .toMatchObject({ via: 'rss', api: 'quota', result: 'ok' });
    expect(feedStatusOf({ id: 'newstapa', plan, hasKey: true, rssTried: true, rssFailed: '500', items: 0, at: AT }))
      .toMatchObject({ via: 'none', api: 'quota', rss: '500', result: 'api_quota' });
  });

  it('열쇠 없음 + RSS 500 = result 500 · API 오류(quotaExceeded) = quota · 그 밖 오류 = error', () => {
    const noKey = planChannel({ hasKey: false, rss404LastRun: false, searchedToday: false, quotaLeft: true });
    expect(feedStatusOf({ id: 'ebs_docuprime', plan: noKey, hasKey: false, rssTried: true, rssFailed: '500', items: 0, at: AT }))
      .toMatchObject({ via: 'none', api: 'off', result: '500' });
    const both = planChannel({ hasKey: true, rss404LastRun: false, searchedToday: false, quotaLeft: true });
    expect(feedStatusOf({ id: 'x', plan: both, hasKey: true, rssTried: true, rssFailed: '404', apiError: { status: 403, reason: 'quotaExceeded' }, items: 0, at: AT }))
      .toMatchObject({ api: 'quota', result: 'api_quota' });
    expect(feedStatusOf({ id: 'x', plan: both, hasKey: true, rssTried: true, rssFailed: null, apiError: { status: 400, reason: 'badRequest' }, items: 15, at: AT }))
      .toMatchObject({ api: 'error', via: 'rss', result: 'ok' });
  });
});

describe('broadcastFeedsOf (실행 한 행)', () => {
  it('기록한 줄이 있으면 그대로', () => {
    const stored = [{ id: 'a', result: 'ok', via: 'rss', rss: 'ok', api: 'off', items: 3, at: 'T', recorded: true }];
    expect(broadcastFeedsOf({ startedAt: 'S', failedFeeds: [], progress: { broadcastFeeds: stored }, perSource: {} })).toBe(stored);
  });

  it('옛 실행(10-17 12:00 꼴): failed_feeds 404 + 되짚기 채널 → API 만 5 · RSS+API 4 · 방송 아닌 실패는 뺌', () => {
    const apiOnly = ['mbc_pd_note', 'mbc_straight', 'sbs_truth', 'sbs_special', 'kbs_sisa_chang'];
    const all = [...apiOnly, 'ebs_docuprime', 'newstapa', 'kbs_60min', 'kbs_docu_insight'];
    const perSource = Object.fromEntries(all.map((id) => [`broadcast:${id}`, { read: 40 }]));
    const feeds = broadcastFeedsOf({
      startedAt: '2026-10-17T03:00:32.461Z',
      failedFeeds: [...apiOnly.map((id) => `broadcast:${id} [404]`), 'wp-wpr-002 (The Washington Post) [502]: x'],
      progress: { broadcastApi: { mode: 'on', channels: all, apiOnly, errors: [] } },
      perSource: { ...perSource, 'wp-wpr-002': { read: 0, failed: '502' } },
    });
    expect(feeds).toHaveLength(9);
    expect(feeds.filter((f) => f.via === 'api').map((f) => f.id).sort()).toEqual([...apiOnly].sort());
    expect(feeds.filter((f) => f.via === 'rss+api')).toHaveLength(4);
    expect(feeds.every((f) => f.result === 'ok' && f.items === 40 && f.recorded === false && f.at === '2026-10-17T03:00:32.461Z')).toBe(true);
  });

  it('옛 실행(10-15 꼴 · 되짚기 꺼짐): RSS 404/500 채널은 결과 = 상태 코드 · 항목 0', () => {
    const feeds = broadcastFeedsOf({
      startedAt: 'S',
      failedFeeds: ['broadcast:mbc_pd_note [404]', 'broadcast:mbc_straight [500]'],
      progress: { broadcastApi: { mode: 'off', channels: [], errors: [] } },
      perSource: { 'broadcast:mbc_pd_note': { read: 0, failed: '404' }, 'broadcast:mbc_straight': { read: 0, failed: '500' }, 'broadcast:newstapa': { read: 15 } },
    });
    expect(feeds.map((f) => [f.id, f.result, f.via, f.api, f.items])).toEqual([
      ['mbc_pd_note', '404', 'none', 'off', 0],
      ['mbc_straight', '500', 'none', 'off', 0],
      ['newstapa', 'ok', 'rss', 'off', 15],
    ]);
  });
});
