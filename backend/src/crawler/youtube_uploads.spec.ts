import {
  PLAYLIST_UNITS,
  QuotaGuard,
  lookbackUploads,
  parsePlaylistItems,
  uploadsPlaylistId,
} from './youtube_api';

// NEWS-Q11 ■2: 업로드 재생목록 되짚기(playlistItems.list · 쪽당 1단위 · 3쪽)
const FAKE_KEY = 'test-youtube-key-not-real';

function page(n: number, next: string | null) {
  return {
    nextPageToken: next ?? undefined,
    items: Array.from({ length: 50 }, (_, i) => ({
      snippet: {
        title:
          i === 0 && n === 0
            ? 'Private video'
            : `편 ${n}-${i} &quot;도박&quot;`,
        description: `설명 ${n}-${i}`,
        publishedAt: '2026-10-19T00:00:00Z',
        resourceId: { videoId: `v${String(n * 100 + i).padStart(10, '0')}` },
        thumbnails: { high: { url: 'https://i.ytimg.com/x.jpg' } },
      },
      contentDetails: { videoPublishedAt: '2026-08-11T13:30:00Z' },
    })),
  };
}

describe('youtube_api — 업로드 재생목록 되짚기(NEWS-Q11 ■2)', () => {
  it('채널 id → 업로드 재생목록 id(UC → UU) · 꼴이 아니면 null', () => {
    expect(uploadsPlaylistId('UCawCv9kO2UXbTtsK4EammRQ')).toBe(
      'UUawCv9kO2UXbTtsK4EammRQ',
    );
    expect(uploadsPlaylistId('UC1')).toBeNull();
  });

  it('응답 → 영상(비공개·삭제 버림 · 설명 전체 · 게시 시각 = videoPublishedAt) + 다음 쪽 열쇠', () => {
    const r = parsePlaylistItems(page(0, 'T1'));
    expect(r.items).toHaveLength(49);
    expect(r.items[0]).toMatchObject({
      title: '편 0-1 "도박"',
      description: '설명 0-1',
      publishedAt: '2026-08-11T13:30:00Z',
      url: 'https://www.youtube.com/watch?v=v0000000001',
    });
    expect(r.next).toBe('T1');
    expect(parsePlaylistItems({}).items).toEqual([]);
  });

  it('3쪽 = 3단위(검색 100단위 대신) · 다음 쪽 없으면 멈춤 · 열쇠는 머리글로만', async () => {
    const calls: Array<{
      url: string;
      params: Record<string, string | number>;
      headers: Record<string, string>;
    }> = [];
    const get = (
      url: string,
      params: Record<string, string | number>,
      headers: Record<string, string>,
    ) => {
      calls.push({ url, params, headers });
      const n = calls.length - 1;
      return Promise.resolve(page(n, n < 5 ? `T${n + 1}` : null));
    };
    const guard = new QuotaGuard(2000, 0);
    const r = await lookbackUploads(
      'UCawCv9kO2UXbTtsK4EammRQ',
      FAKE_KEY,
      guard,
      { pages: 3, get },
    );
    expect(r.units).toBe(3 * PLAYLIST_UNITS);
    expect(r.items).toHaveLength(149);
    expect(calls.map((c) => c.params.pageToken)).toEqual([
      undefined,
      'T1',
      'T2',
    ]);
    expect(calls[0].url.endsWith('/playlistItems')).toBe(true);
    expect(calls[0].params.playlistId).toBe('UUawCv9kO2UXbTtsK4EammRQ');
    expect(JSON.stringify(calls.map((c) => c.params))).not.toContain(FAKE_KEY);
    expect(calls[0].headers['x-goog-api-key']).toBe(FAKE_KEY);

    const one: unknown[] = [];
    const short = await lookbackUploads(
      'UCawCv9kO2UXbTtsK4EammRQ',
      FAKE_KEY,
      new QuotaGuard(),
      {
        pages: 3,
        get: () => {
          one.push(1);
          return Promise.resolve(page(1, null));
        },
      },
    );
    expect(one).toHaveLength(1);
    expect(short.units).toBe(1);
  });

  it('할당량 가드 · quotaExceeded = 멈춤 기록 · 받은 쪽은 살림', async () => {
    const full = new QuotaGuard(2000, 2000);
    const r = await lookbackUploads(
      'UCawCv9kO2UXbTtsK4EammRQ',
      FAKE_KEY,
      full,
      { get: () => Promise.resolve(page(1, null)) },
    );
    expect(r).toEqual({
      items: [],
      units: 0,
      pages: 0,
      coveredDays: null,
      error: { status: null, reason: 'quota_guard' },
    });
    expect(full.stopped).toBe(true);

    let n = 0;
    const g2 = new QuotaGuard();
    const r2 = await lookbackUploads('UCawCv9kO2UXbTtsK4EammRQ', FAKE_KEY, g2, {
      get: () => {
        n++;
        if (n === 1) return Promise.resolve(page(1, 'T'));
        return Promise.reject(
          Object.assign(new Error('403'), {
            response: {
              status: 403,
              data: { error: { errors: [{ reason: 'quotaExceeded' }] } },
            },
          }),
        );
      },
    });
    expect(r2.items).toHaveLength(50);
    expect(r2.error).toEqual({ status: 403, reason: 'quotaExceeded' });
    expect(g2.stopped).toBe(true);
    expect(
      (await lookbackUploads('bad', FAKE_KEY, new QuotaGuard())).error?.reason,
    ).toBe('bad_channel_id');
  });
});

// NEWS-Q12 ■2: 바쁜 채널은 100일을 덮을 때까지 6쪽까지 · 더 읽는 쪽은 하루 100단위 안
describe('youtube_api — 100일 덮기(NEWS-Q12 ■2)', () => {
  const NOW = Date.parse('2026-10-22T03:00:00Z');
  // 쪽 n 의 영상은 모두 (n+1)*daysPerPage 일 전
  function datedPage(n: number, daysPerPage: number) {
    const at = new Date(NOW - (n + 1) * daysPerPage * 86400000).toISOString();
    return {
      nextPageToken: `T${n + 1}`,
      items: Array.from({ length: 50 }, (_, i) => ({
        snippet: {
          title: `편 ${n}-${i}`,
          description: '',
          resourceId: { videoId: `v${String(n * 100 + i).padStart(10, '0')}` },
        },
        contentDetails: { videoPublishedAt: at },
      })),
    };
  }
  const run = (
    daysPerPage: number,
    guard = new QuotaGuard(),
    unitCapDay = 100,
  ) => {
    let n = 0;
    return lookbackUploads('UCawCv9kO2UXbTtsK4EammRQ', FAKE_KEY, guard, {
      pages: 3,
      coverDays: 100,
      maxPages: 6,
      unitCapDay,
      now: NOW,
      get: () => Promise.resolve(datedPage(n++, daysPerPage)),
    });
  };

  it('3쪽으로 100일을 덮는 채널(쪽당 40일) = 3쪽 그대로', async () => {
    const r = await run(40);
    expect(r.pages).toBe(3);
    expect(r.coveredDays).toBe(120);
  });

  it('바쁜 채널(쪽당 10일) = 6쪽에서 멈춤(60일) · 25일이면 4쪽(100일)', async () => {
    const busy = await run(10);
    expect(busy.pages).toBe(6);
    expect(busy.units).toBe(6 * PLAYLIST_UNITS);
    expect(busy.coveredDays).toBe(60);
    expect((await run(25)).pages).toBe(4);
  });

  it('더 읽는 쪽은 오늘 쓴 단위가 하루 상한(100) 안일 때만 · 기본 3쪽은 그대로', async () => {
    const r = await run(10, new QuotaGuard(2000, 98), 100);
    expect(r.pages).toBe(3);
    expect(r.units).toBe(3);
  });

  it('coverDays 없으면 옛 동작(기본 쪽 수만)', async () => {
    let n = 0;
    const r = await lookbackUploads(
      'UCawCv9kO2UXbTtsK4EammRQ',
      FAKE_KEY,
      new QuotaGuard(),
      {
        pages: 3,
        now: NOW,
        get: () => Promise.resolve(datedPage(n++, 10)),
      },
    );
    expect(r.pages).toBe(3);
  });
});
