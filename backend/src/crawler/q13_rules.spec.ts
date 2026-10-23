import * as fs from 'fs';
import * as path from 'path';
import {
  EpisodeItem,
  archiveListedBroadcasts,
  existingEpisodeMains,
  foldEpisodes,
  hasMainEvidence,
  listedArchiveIds,
  relatedClip,
  restoreKeptBroadcasts,
  returnedRows,
} from './broadcast_episode';
import { keywordGroupsOf } from './keyword_groups';
import {
  QuotaGuard,
  SEARCH_UNITS,
  VIDEOS_UNITS,
  BACKFILL_MAX_TRIES,
  backfillStateFromRuns,
  backfillSearch,
  lastLookbackFromRuns,
  lookbackUploads,
} from './youtube_api';
import {
  Attempt,
  attemptsFromRuns,
  isPromoted,
  mergeAttempts,
  planPromotion,
  standbyLast,
} from './blocked_promote';
import { planSources } from './crawl_schedule';
import { partialNoteOf, emptyBroadcastGateStats } from './broadcast_gate';
import { loadBroadcastSources } from './broadcast';

const FAKE_KEY = 'test-youtube-key-not-real';

type ProfileJson = {
  sources: {
    broadcast: {
      max_pages: number;
      backfill_search_once: {
        channels: string[];
        days: number;
        max_pages: number;
        unit_cap_day: number;
      };
    };
    google_news: Array<{ id: string; active?: boolean }>;
  };
};
type RssJson = {
  feeds: Array<{
    program_en?: string;
    name_source?: string;
    name_source_url?: string;
  }>;
};
type KrJson = {
  feeds: Array<{ outlet_id?: string; blocked?: Record<string, unknown> }>;
};

function readJson<T>(rel: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../data', rel), 'utf8'),
  ) as T;
}

/** jest.fn() 첫 부름의 SQL 글 */
function firstSql(m: jest.Mock): string {
  return String((m.mock.calls as unknown[][])[0][0]);
}

// ---------- ■1 기록 수리 ----------
describe('NEWS-Q13 ■1 — UPDATE … RETURNING 꼴', () => {
  it('typeorm postgres 의 [행들, 바뀐 수] 와 SELECT 의 행들 둘 다 행들로', () => {
    expect(returnedRows([[{ id: 1 }, { id: 2 }], 2])).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(returnedRows([{ id: 3 }])).toEqual([{ id: 3 }]);
    expect(returnedRows([[], 0])).toEqual([]);
    expect(returnedRows(null)).toEqual([]);
  });

  it('archive_ids: 옮긴 id 를 그대로 돌려준다(Q12 는 [[…],11] 을 못 읽어 [] 로 남았음)', async () => {
    const ids = [
      5868, 5869, 5870, 5871, 5872, 5874, 5880, 5883, 5884, 5893, 5896,
    ];
    const query = jest
      .fn()
      .mockResolvedValue([ids.map((id) => ({ id })), ids.length]);
    await expect(archiveListedBroadcasts(query, ids)).resolves.toEqual(ids);
    // 다시 돌면 이미 보관 → 0
    query.mockResolvedValue([[], 0]);
    await expect(archiveListedBroadcasts(query, ids)).resolves.toEqual([]);
  });

  it('keep_ids 되돌림 · archive_ids 와 겹치면 keep 이 앞섬', async () => {
    const query = jest.fn().mockResolvedValue([[{ id: 5868 }], 1]);
    await expect(restoreKeptBroadcasts(query, [5868])).resolves.toEqual([5868]);
    expect(firstSql(query)).toMatch(
      /SET tier = 'publish'[\s\S]*source_type = 'broadcast' AND tier = 'archive'/,
    );
    expect(listedArchiveIds([1, 2, 3], [2])).toEqual([1, 3]);
    expect(listedArchiveIds(undefined, undefined)).toEqual([]);
    await expect(
      restoreKeptBroadcasts(jest.fn().mockRejectedValue(new Error('x')), [1]),
    ).resolves.toEqual([]);
  });
});

// ---------- ■2 관련 클립 자동 묶기(10-21~10-23 실제 행) ----------
describe('NEWS-Q13 ■2 — 관련 클립 자동 묶기', () => {
  // 방송 관문이 붙인 하위 주제 + 제목 묶음(실행과 같은 꼴)
  const it_ = (
    program: string,
    publishedAt: string,
    title: string,
    subtopic: string,
  ): EpisodeItem => ({
    program,
    publishedAt,
    title,
    groups: [...keywordGroupsOf(title), subtopic],
  });
  const PD = 'MBC PD수첩';
  const main5873 = it_(
    PD,
    '2026-08-11T13:21:16Z',
    '[PD수첩] "도박소년이 된 내 아들" - 2026년 8월 11일 밤 10시 20분 방송',
    '도박',
  );
  const clips = [
    it_(
      PD,
      '2026-08-13T09:00:00Z',
      '도박 청소년이 성인이 되면 | PD수첩',
      '도박',
    ), // 5868
    it_(
      PD,
      '2026-08-13T09:00:00Z',
      "드라마 '참교육' 실사판, 도박사이트 총판을 만나다 | PD수첩",
      '도박',
    ), // 5869
    it_(
      PD,
      '2026-08-13T09:00:00Z',
      '"내 출연료 만 원 줘", 도박 중독의 위험성 | PD수첩',
      '도박',
    ), // 5870
    it_(
      PD,
      '2026-08-13T09:00:00Z',
      '"교실 컴퓨터 연결해서 바카라해요" | PD수첩',
      '도박',
    ), // 5871
  ];
  const opts = { solo: true, days: 7, relatedDays: 3 };

  it('PD수첩 5868~5871 = related(보관) · 본편 5873 은 main 그대로', () => {
    const roles = foldEpisodes([main5873, ...clips], [], opts);
    expect(roles).toEqual(['main', 'related', 'related', 'related', 'related']);
  });

  it('본편이 지난 실행에 이미 실렸어도(DB) 클립 넷은 related', () => {
    expect(foldEpisodes(clips, [main5873], opts)).toEqual([
      'related',
      'related',
      'related',
      'related',
    ]);
  });

  it('리뷰 1: 표시 없는 쇼츠가 본편보다 먼저(같은 날 · 앞 실행) 와도 본편은 main · 쇼츠는 본편 노릇 못 함', () => {
    const shortFirst = it_(
      PD,
      '2026-08-11T01:00:00Z', // KST 10:00
      '교실을 점령한 불법 도박 #PD수첩',
      '도박',
    );
    // 같은 실행: 쇼츠(이른 것)가 먼저 본편 후보로 들어가도 본편 5873 은 related 가 아님
    expect(foldEpisodes([shortFirst, main5873], [], opts)).toEqual([
      'main',
      'main',
    ]);
    // 앞 실행이 쇼츠를 실었어도(DB) 본편은 main
    expect(foldEpisodes([main5873], [shortFirst], opts)).toEqual(['main']);
    // 같은 날 본편보다 이른 표시 없는 클립은 묶지 않음(시각 견줌)
    expect(
      relatedClip(
        { ...clips[0], publishedAt: '2026-08-11T05:00:00Z' },
        main5873,
      ),
    ).toBe(false);
    expect(hasMainEvidence('스트레이트 356회 (26.10.11)')).toBe(true);
    expect(hasMainEvidence('추적60분 KBS 260522 방송')).toBe(true);
    expect(hasMainEvidence('도박 청소년이 성인이 되면 | PD수첩')).toBe(false);
    // 반박 리뷰: 「3회 연속」·「5회 투약」·「생방송」은 본편 표시 아님 · 1518회 는 표시
    expect(hasMainEvidence('도박 3회 연속 적발 | PD수첩')).toBe(false);
    expect(hasMainEvidence('마약 5회 투약한 10대')).toBe(false);
    expect(hasMainEvidence('도박 상담 생방송')).toBe(false);
    expect(hasMainEvidence('[PD수첩 1518회] 도박소년')).toBe(true);
    // 반박 리뷰: 표시 없는 같은 회차 클립이 먼저 와도 본편(표시 있음)이 main · 클립이 episode_dup
    const earlyClip = {
      ...it_(
        PD,
        '2026-08-10T01:00:00Z',
        '도박소년이 된 내 아들 미리 보는 이야기 | PD수첩',
        '도박',
      ),
      description: '도박소년이 된 내 아들 8월 11일 방송',
    };
    expect(foldEpisodes([earlyClip, main5873], [], opts)).toEqual([
      'episode_dup',
      'main',
    ]);
  });

  it('공용·혼합 채널(solo 아님)에서는 묶지 않음 — 옛 동작', () => {
    expect(
      foldEpisodes([main5873, ...clips], [], { ...opts, solo: false }),
    ).toEqual(['main', 'main', 'main', 'main', 'main']);
  });

  it('실린 본편 잃음 0 — 10-21~10-23 실림 9편(다른 프로그램 · 다른 날)은 모두 main', () => {
    const k = 'KBS 추적60분';
    const rows = [
      it_(
        k,
        '2026-08-02',
        "어떤 투자는 '도박'이다? 주식 투자 때문에 인생이 무너진 사람들 | 추적60분 KBS 방송",
        '도박',
      ),
      it_(
        k,
        '2026-06-21',
        '"부모가 막을 수가 없어요" 틱톡과 악성앱을 통해 아이들 사이에서 번지는 도박과 학폭 | 추적60분 KBS 260522 방송',
        '도박',
      ),
      it_(
        k,
        '2026-06-03',
        '전교 1등도 예외 없었다? 스마트폰 관련 비행 과의존 사례 650건 이상 분석한 박원철 판사 인터뷰 | 추적60분 KBS 방송',
        '게임·디지털',
      ),
      it_(
        k,
        '2026-05-22',
        '[full] 모두가 자식의 폰과 싸우고 있다 | 추적60분 KBS 260522 방송',
        '게임·디지털',
      ),
      it_(
        k,
        '2026-02-27',
        '[full] 파는 자와 쫓는 자, 텔레그램 시대의 마약 전쟁 | 추적60분 KBS 260227 방송',
        '약물',
      ),
    ];
    expect(foldEpisodes(rows, [], opts)).toEqual([
      'main',
      'main',
      'main',
      'main',
      'main',
    ]);
    expect(foldEpisodes([main5873], [], opts)).toEqual(['main']);
  });

  it('다른 프로그램 오묶음 0 · 하위 주제 다르면 · 회차 다르면 · 본편보다 이르면 · 4일 뒤면 · [full] 이면 묶지 않음', () => {
    const other = { ...clips[0], program: 'MBC 스트레이트' };
    expect(relatedClip(other, main5873)).toBe(false);
    const diffTopic = it_(
      PD,
      '2026-08-12',
      '교실 속 전자담배 연기 | PD수첩',
      '담배',
    );
    expect(relatedClip(diffTopic, main5873)).toBe(false);
    const otherEp = it_(
      PD,
      '2026-08-12',
      '[PD수첩 1519회] 도박 학교 2부',
      '도박',
    );
    expect(
      relatedClip(
        otherEp,
        it_(PD, '2026-08-11', '[PD수첩 1518회] 도박 학교 1부', '도박'),
      ),
    ).toBe(false);
    expect(
      relatedClip(
        it_(PD, '2026-08-10', '도박 청소년 | PD수첩', '도박'),
        main5873,
      ),
    ).toBe(false);
    expect(
      relatedClip(
        it_(PD, '2026-08-15', '도박 청소년 | PD수첩', '도박'),
        main5873,
      ),
    ).toBe(false);
    expect(
      relatedClip(
        it_(PD, '2026-08-12', '[full] 도박 청소년 | PD수첩', '도박'),
        main5873,
      ),
    ).toBe(false);
    // 기타만이면 겹침 아님
    expect(
      relatedClip(
        { ...clips[0], groups: ['기타'] },
        { ...main5873, groups: ['기타'] },
      ),
    ).toBe(false);
  });

  it('한국 날짜로 견줌 — 본편 밤 10시(KST) 다음 날 낮 = 1일', () => {
    const m = { ...main5873, publishedAt: '2026-08-11T13:30:00Z' }; // KST 22:30
    expect(
      relatedClip({ ...clips[0], publishedAt: '2026-08-14T15:30:00Z' }, m),
    ).toBe(false); // KST 08-15 00:30 = 4일
    expect(
      relatedClip({ ...clips[0], publishedAt: '2026-08-14T14:00:00Z' }, m),
    ).toBe(true); // KST 08-14 23:00 = 3일
    expect(
      relatedClip({ ...clips[0], publishedAt: '2026-08-11T14:00:00Z' }, m),
    ).toBe(true); // KST 08-11 23:00 = 0일
  });

  it('DB 본편 읽기: keywords(쉼표 글)의 하위 주제를 groups 로', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        title: '[PD수첩] "도박소년이 된 내 아들"',
        keywords: '도박,MBC PD수첩',
        published_at: '2026-08-11',
      },
    ]);
    const rows = await existingEpisodeMains(
      query,
      PD,
      '2026-08-04',
      '2026-08-20',
      { deletedAt: true },
    );
    expect(rows[0].groups).toContain('도박');
    expect(firstSql(query)).toContain('keywords::text');
  });

  it('단독 채널 표(설정) = PD수첩 · 스트레이트 · 추적60분 · 공용 채널은 늘 아님', () => {
    const src = loadBroadcastSources();
    expect(
      src
        .filter((s) => s.soloChannel)
        .map((s) => s.outletId)
        .sort(),
    ).toEqual(['kbs_60min', 'mbc_pd_note', 'mbc_straight']);
    expect(src.some((s) => s.soloChannel && s.sharedChannel)).toBe(false);
  });

  it('folded.related 칸', () => {
    expect(emptyBroadcastGateStats().folded).toEqual({
      clip: 0,
      episode_dup: 0,
      related: 0,
    });
  });
});

// ---------- ■3 이어짐 · 100일 메우기 ----------
describe('NEWS-Q13 ■3 — 이어짐(since) · gap', () => {
  const NOW = Date.parse('2026-10-24T03:00:00Z');
  function datedPage(n: number, daysPerPage: number, last = 99) {
    const at = new Date(NOW - (n + 1) * daysPerPage * 86400000).toISOString();
    return {
      nextPageToken: n >= last ? undefined : `T${n + 1}`,
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
    sinceDaysAgo: number,
    last = 99,
    unitCapDay = 100,
  ) => {
    let n = 0;
    return lookbackUploads(
      'UCawCv9kO2UXbTtsK4EammRQ',
      FAKE_KEY,
      new QuotaGuard(),
      {
        pages: 3,
        coverDays: 100,
        maxPages: 6,
        unitCapDay,
        now: NOW,
        since: NOW - sinceDaysAgo * 86400000,
        get: () => Promise.resolve(datedPage(n++, daysPerPage, last)),
      },
    );
  };

  it('지난번 실행(1일 전 + 여유 1일) 에 첫 쪽에서 닿으면 1쪽에서 멈춤 · gap 0(옛 3쪽보다 적게)', async () => {
    const r = await run(5, 2);
    expect(r.pages).toBe(1);
    expect(r.units).toBe(1);
    expect(r.gap).toBe(0);
  });

  it('바쁜 채널(쪽당 1일) · 지난번이 10일 전 → 6쪽까지 읽고도 못 닿음 → gap = 4일', async () => {
    const r = await run(1, 10);
    expect(r.pages).toBe(6);
    expect(r.gap).toBe(4);
  });

  it('채널 영상이 끝나면(다음 쪽 없음) gap 0', async () => {
    const r = await run(1, 10, 1);
    expect(r.pages).toBe(2);
    expect(r.gap).toBe(0);
  });

  it('기본 쪽 수 뒤는 하루 단위 상한 안에서만 — 상한이 막으면 3쪽 · gap 남음', async () => {
    const r = await run(1, 10, 99, 3);
    expect(r.pages).toBe(3);
    expect(r.gap).toBe(7);
  });

  it('since 가 없으면 옛 cover_days 규칙 · gap 칸 없음', async () => {
    let n = 0;
    const r = await lookbackUploads(
      'UCawCv9kO2UXbTtsK4EammRQ',
      FAKE_KEY,
      new QuotaGuard(),
      {
        pages: 3,
        coverDays: 100,
        maxPages: 6,
        unitCapDay: 100,
        now: NOW,
        get: () => Promise.resolve(datedPage(n++, 40)),
      },
    );
    expect(r.pages).toBe(3);
    expect('gap' in r).toBe(false);
  });
});

describe('NEWS-Q13 ■3 — 100일 한 번 메우기(search.list · 가짜 응답)', () => {
  const NOW = Date.parse('2026-10-24T03:00:00Z');
  const searchPage = (n: number, next: boolean) => ({
    nextPageToken: next ? `S${n + 1}` : undefined,
    items: Array.from({ length: 50 }, (_, i) => ({
      id: { videoId: `s${String(n * 100 + i).padStart(10, '0')}` },
      snippet: {
        title: `마약 ${n}-${i}`,
        description: '짧은',
        publishedAt: '2026-08-01T00:00:00Z',
      },
    })),
  });

  it('채널당 최대 2쪽 · 쪽당 100+1 단위 · q · publishedAfter 100일 전 · 전체 설명 채움', async () => {
    const calls: Array<[string, Record<string, string | number>]> = [];
    let n = 0;
    const get = (url: string, params: Record<string, string | number>) => {
      calls.push([url, params]);
      if (url.endsWith('/videos')) {
        return Promise.resolve({
          items: String(params.id)
            .split(',')
            .map((id) => ({ id, snippet: { description: `긴 설명 ${id}` } })),
        });
      }
      return Promise.resolve(searchPage(n++, true));
    };
    const guard = new QuotaGuard(2000, 40);
    const r = await backfillSearch(
      'UCPx-7AKiN1Z_qEVKhLQ5pAw',
      FAKE_KEY,
      guard,
      {
        query: '중독|도박|마약',
        days: 100,
        maxPages: 2,
        unitCap: 1000,
        now: NOW,
        get,
      },
    );
    expect(r.pages).toBe(2);
    expect(r.units).toBe(2 * (SEARCH_UNITS + VIDEOS_UNITS));
    expect(r.items).toHaveLength(100);
    expect(r.items[0].description).toMatch(/^긴 설명/);
    const s = calls.filter(([u]) => u.endsWith('/search'));
    expect(s[0][1]).toMatchObject({
      q: '중독|도박|마약',
      channelId: 'UCPx-7AKiN1Z_qEVKhLQ5pAw',
      type: 'video',
      order: 'date',
      publishedAfter: '2026-07-16T03:00:00.000Z',
    });
    expect(s[1][1].pageToken).toBe('S1');
    expect(guard.used).toBe(40 + 202);
  });

  it('그날 상한 1,000 · 네 채널 2쪽씩 = 808 단위(되짚기 41 더해도 상한 안) · 넘으면 부르지 않음', async () => {
    const guard = new QuotaGuard(2000, 41);
    const get = (url: string) =>
      Promise.resolve(
        url.endsWith('/videos') ? { items: [] } : searchPage(0, true),
      );
    for (let c = 0; c < 4; c++) {
      const r = await backfillSearch(
        'UCPx-7AKiN1Z_qEVKhLQ5pAw',
        FAKE_KEY,
        guard,
        { query: 'q', days: 100, maxPages: 2, unitCap: 1000, get },
      );
      expect(r.pages).toBe(2);
    }
    expect(guard.used).toBe(41 + 808);
    const more = await backfillSearch(
      'UCPx-7AKiN1Z_qEVKhLQ5pAw',
      FAKE_KEY,
      guard,
      { query: 'q', days: 100, maxPages: 2, unitCap: 1000, get },
    );
    expect(more.pages).toBe(1); // 849 + 101 = 950 ≤ 1000 → 1쪽 · 다음은 1051 > 1000
    expect(more.error?.reason).toBe('unit_cap'); // 덜 메움 = 오류(「끝」 아님 → 그 채널은 다음 실행이 다시)
    const stop = await backfillSearch(
      'UCPx-7AKiN1Z_qEVKhLQ5pAw',
      FAKE_KEY,
      guard,
      { query: 'q', days: 100, maxPages: 2, unitCap: 1000, get },
    );
    expect(stop).toMatchObject({
      pages: 0,
      units: 0,
      error: { reason: 'quota_guard' },
    });
  });

  it('오류 = 이유만(열쇠 0) · quotaExceeded 면 가드 멈춤', async () => {
    const guard = new QuotaGuard();
    const err = Object.assign(new Error('x'), {
      response: {
        status: 403,
        data: { error: { errors: [{ reason: 'quotaExceeded' }] } },
      },
    });
    const r = await backfillSearch(
      'UCPx-7AKiN1Z_qEVKhLQ5pAw',
      FAKE_KEY,
      guard,
      {
        query: 'q',
        days: 100,
        maxPages: 2,
        unitCap: 1000,
        get: () => Promise.reject(err),
      },
    );
    expect(r.error).toEqual({ status: 403, reason: 'quotaExceeded' });
    expect(guard.stopped).toBe(true);
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
  });

  it('runs 읽기: 채널별 지난번 잘 되짚은 시각(오류 · 판정 끊김 · gap · judged 없는 옛 기록 뺌) · 메우기 상태', async () => {
    const q = jest.fn().mockResolvedValue([
      {
        started_at: '2026-10-24T03:00:00Z',
        api: {
          cover: {
            mbc_pd_note: { pages: 1, judged: false }, // 판정 끊김 → 기준 아님
            kbs_60min: { pages: 6, judged: true, gap: 4 }, // 이어지지 못함 → 기준 아님
            sbs_truth: { pages: 1, judged: true, gap: 0 },
          },
          errors: [],
        },
      },
      {
        started_at: '2026-10-23T03:00:39Z',
        api: {
          cover: {
            mbc_pd_note: { pages: 1, judged: true },
            newstapa: { pages: 2, judged: true },
            kbs_60min: { pages: 3, judged: true, gap: 0 },
          },
          errors: ['newstapa:403:forbidden'],
        },
      },
      {
        started_at: '2026-10-22T03:00:37Z',
        api: JSON.stringify({
          cover: {
            mbc_pd_note: { pages: 3 },
            newstapa: { pages: 3, judged: true },
          },
          errors: [],
        }),
      },
    ]);
    await expect(lastLookbackFromRuns(q, 'addiction')).resolves.toEqual({
      sbs_truth: Date.parse('2026-10-24T03:00:00Z'),
      mbc_pd_note: Date.parse('2026-10-23T03:00:39Z'),
      kbs_60min: Date.parse('2026-10-23T03:00:39Z'),
      newstapa: Date.parse('2026-10-22T03:00:37Z'),
    });
    // judged 없는 옛 기록(Q12 까지)만 있으면 기준 없음 → 옛 cover_days 규칙
    await expect(
      lastLookbackFromRuns(
        jest.fn().mockResolvedValue([
          {
            started_at: '2026-10-23T03:00:39Z',
            api: { cover: { mbc_pd_note: { pages: 3, days: 132 } } },
          },
        ]),
        'addiction',
      ),
    ).resolves.toEqual({});
    await expect(
      lastLookbackFromRuns(
        jest.fn().mockRejectedValue(new Error('no table')),
        'addiction',
      ),
    ).resolves.toEqual({});
    // 메우기 상태: 앞 실행에서 끝난 채널은 이어받고 · 3번 해 보면 그만 · done 이면 끝 · 실패면 끝(단위 0)
    const st = (rows: unknown[]) =>
      backfillStateFromRuns(
        jest.fn().mockResolvedValue(rows),
        'addiction',
        'q13-100d',
      );
    await expect(st([])).resolves.toEqual({
      done: false,
      tries: 0,
      finished: [],
    });
    await expect(
      st([
        {
          b: {
            done: false,
            channels: {
              sbs_special: { pages: 2 },
              kbs_docu_insight: { pages: 1, error: 'cut_short' },
            },
          },
        },
      ]),
    ).resolves.toEqual({ done: false, tries: 1, finished: ['sbs_special'] });
    await expect(
      st([{ b: JSON.stringify({ done: true, channels: {} }) }]),
    ).resolves.toMatchObject({ done: true });
    const tried = {
      b: { done: false, channels: { ebs_docuprime: { error: 'cut_short' } } },
    };
    await expect(st([tried, tried, tried])).resolves.toMatchObject({
      done: true,
      tries: BACKFILL_MAX_TRIES,
    });
    // 반박 리뷰: 검색 0 인 실행(같은 날 둘째 · 할당량 · 시간)은 「해 봄」으로 세지 않음
    await expect(
      st([tried, { b: { done: false, channels: {} } }, { b: { done: false } }]),
    ).resolves.toMatchObject({ done: false, tries: 1 });
    await expect(
      backfillStateFromRuns(
        jest.fn().mockRejectedValue(new Error('x')),
        'addiction',
        'q13-100d',
      ),
    ).resolves.toMatchObject({ done: true });
  });

  it('설정 깃발: 못 닿은 넷만 · 2쪽 · 상한 1,000', () => {
    const p = readJson<ProfileJson>('field_profiles/addiction.json');
    const bf = p.sources.broadcast.backfill_search_once;
    expect(bf.channels.sort()).toEqual([
      'ebs_docuprime',
      'kbs_docu_insight',
      'kbs_sisa_chang',
      'sbs_special',
    ]);
    expect(bf).toMatchObject({ days: 100, max_pages: 2, unit_cap_day: 1000 });
    expect(p.sources.broadcast.max_pages).toBe(6);
  });
});

// ---------- ■4 partial 기록 ----------
describe('NEWS-Q13 ■4 — partial 판정 기록', () => {
  it('{id(저장 뒤) · 제목 · 사유 = 하위 주제 · 요약 앞부분}', () => {
    const n = partialNoteOf(
      "[사사건건] 교도소에서 '우표' 걸고 도박",
      '도박',
      '교도소 안 도박을 사례로\n 다룬다. '.repeat(30),
    );
    expect(n.id).toBeNull();
    expect(n.reason.startsWith('도박 · 교도소 안 도박을 사례로 다룬다.')).toBe(
      true,
    );
    expect(n.reason.length).toBeLessThanOrEqual('도박 · '.length + 160);
    expect(partialNoteOf('t', '기타', null).reason).toBe('기타');
  });
});

// ---------- ■5 영문 이름 출처 ----------
describe('NEWS-Q13 ■5 — program_en 출처', () => {
  it('9 채널 모두 program_en + name_source(official 이면 출처 URL)', () => {
    const raw = readJson<RssJson>('broadcast_youtube_rss.json');
    expect(raw.feeds).toHaveLength(9);
    for (const f of raw.feeds) {
      expect(typeof f.program_en).toBe('string');
      expect(['official', 'translation']).toContain(f.name_source);
      if (f.name_source === 'official')
        expect(f.name_source_url).toMatch(/^https:\/\//);
    }
  });
});

// ---------- ■6 막힌 피드 되살리기 ----------
describe('NEWS-Q13 ■6 — 재시도 2번 잇단 성공 = 주 피드 · 대체 = 예비', () => {
  const r = (
    date: string,
    ok: boolean,
    kind: Attempt['kind'] = 'retry',
  ): Attempt => ({ date, ok, kind });

  it('10-19 성공 1번(기록)만 = 아직 · 10-26 성공 더하면 주 피드', () => {
    expect(
      isPromoted(mergeAttempts([{ date: '2026-10-19', ok: true }], [])),
    ).toBe(false);
    expect(
      isPromoted(
        mergeAttempts(
          [{ date: '2026-10-19', ok: true }],
          [r('2026-10-26', true)],
        ),
      ),
    ).toBe(true);
    expect(
      isPromoted(
        mergeAttempts(
          [{ date: '2026-10-19', ok: true }],
          [r('2026-10-26', false)],
        ),
      ),
    ).toBe(false);
  });

  it('기록과 실행이 같은 날이면 한 번만(실행 쪽) · 잇달아 = 마지막 두 번', () => {
    const m = mergeAttempts(
      [{ date: '2026-10-19', ok: true }],
      [r('2026-10-19', true), r('2026-10-12', false)],
    );
    expect(m.map((a) => a.date)).toEqual(['2026-10-12', '2026-10-19']);
    expect(isPromoted(m)).toBe(false);
  });

  it('주 피드가 3번 잇달아 실패하면 옛 규칙 · 사이에 성공 하나면 그대로', () => {
    const base = [r('2026-10-19', true), r('2026-10-26', true)];
    expect(
      isPromoted([
        ...base,
        r('2026-10-27', false, 'primary'),
        r('2026-10-28', false, 'primary'),
      ]),
    ).toBe(true);
    expect(
      isPromoted([
        ...base,
        r('2026-10-27', false, 'primary'),
        r('2026-10-28', false, 'primary'),
        r('2026-10-29', false, 'primary'),
      ]),
    ).toBe(false);
    expect(
      isPromoted([
        ...base,
        r('2026-10-27', false, 'primary'),
        r('2026-10-28', true, 'primary'),
        r('2026-10-29', false, 'primary'),
      ]),
    ).toBe(true);
    // 리뷰 2: 강등 뒤 재시도 성공 하나로는 다시 오르지 않음(다시 2번 잇달아)
    const demoted = [
      ...base,
      r('2026-10-27', false, 'primary'),
      r('2026-10-28', false, 'primary'),
      r('2026-10-29', false, 'primary'),
    ];
    expect(isPromoted([...demoted, r('2026-11-02', true)])).toBe(false);
    expect(
      isPromoted([...demoted, r('2026-11-02', true), r('2026-11-09', true)]),
    ).toBe(true);
    // 리뷰 2: 기록 창(최근 60 실행)에서 옛 재시도가 빠져도 primary 로 시작하면 주 피드 그대로
    expect(
      isPromoted([
        r('2026-12-20', true, 'primary'),
        r('2026-12-21', true, 'primary'),
      ]),
    ).toBe(true);
    expect(isPromoted([])).toBe(false);
    // 반박 리뷰: 설정 retry_log(실패로 끝남)가 늘 앞에 붙어도 창 안 primary 가 있으면 주 피드 그대로
    expect(
      isPromoted(
        mergeAttempts(
          [{ date: '2026-10-12', ok: false }],
          [r('2026-12-20', true, 'primary'), r('2026-12-21', false, 'primary')],
        ),
      ),
    ).toBe(true);
  });

  it('계획: 주 피드는 날마다(재시도·건너뜀 아님) · 대체는 끄지 않고 맨 뒤 예비', () => {
    const sources = [
      {
        id: 'kr-press-동아일보',
        blocked: {
          retry: 'weekly' as const,
          substitute: 'kr-google-site-donga',
          retry_log: [{ date: '2026-10-19', ok: true }],
        },
      },
      {
        id: 'kr-press-프레시안',
        blocked: {
          retry: 'weekly' as const,
          substitute: 'kr-google-site-pressian',
        },
      },
      { id: 'kr-google-site-donga', blocked: null },
      { id: 'kr-google-site-pressian', blocked: null },
      { id: 'kr-press-국민일보', blocked: null },
    ];
    const plan = planPromotion(sources, {
      'kr-press-동아일보': [r('2026-10-26', true)],
      'kr-press-프레시안': [r('2026-10-19', false), r('2026-10-26', true)],
    });
    expect([...plan.promoted]).toEqual(['kr-press-동아일보']);
    expect([...plan.standby]).toEqual([
      ['kr-google-site-donga', 'kr-press-동아일보'],
    ]);
    const tue = Date.parse('2026-10-27T03:00:00Z');
    const sp = planSources(sources, null, tue, plan.promoted);
    expect(sp.order.map((s) => s.id)).toContain('kr-press-동아일보');
    expect(sp.skipped.map((s) => s.id)).toEqual(['kr-press-프레시안']);
    expect(
      standbyLast(sp.order, plan.standby)
        .map((s) => s.id)
        .pop(),
    ).toBe('kr-google-site-donga');
    // 주 피드가 없으면 그대로
    expect(standbyLast(sp.order, new Map())).toBe(sp.order);
  });

  it('runs 읽기: blockedRetried(retry) · blockedPrimary(primary) · KST 날짜 · 실패면 {}', async () => {
    const q = jest.fn().mockResolvedValue([
      {
        started_at: '2026-10-27T03:00:00Z',
        r: null,
        p: [{ id: 'kr-press-동아일보', ok: true }],
      },
      {
        started_at: new Date('2026-10-26T03:00:00Z'),
        r: JSON.stringify([{ id: 'kr-press-동아일보', ok: true }]),
        p: null,
      },
    ]);
    await expect(attemptsFromRuns(q, 'addiction')).resolves.toEqual({
      'kr-press-동아일보': [
        r('2026-10-26', true),
        r('2026-10-27', true, 'primary'),
      ],
    });
    await expect(
      attemptsFromRuns(
        jest.fn().mockRejectedValue(new Error('x')),
        'addiction',
      ),
    ).resolves.toEqual({});
  });

  it('설정: 동아 원 피드에 10-19 성공 기록 · promote_after 2 · 대체 피드는 그대로 있음', () => {
    const kr = readJson<KrJson>('kr_press_rss.json');
    const donga = kr.feeds.find((f) => f.outlet_id === '동아일보');
    expect(donga?.blocked).toMatchObject({
      substitute: 'kr-google-site-donga',
      promote_after: 2,
      retry_log: [{ date: '2026-10-19', ok: true }],
    });
    const p = readJson<ProfileJson>('field_profiles/addiction.json');
    const sub = p.sources.google_news.find(
      (f) => f.id === 'kr-google-site-donga',
    );
    expect(sub && sub.active !== false).toBe(true);
  });
});
