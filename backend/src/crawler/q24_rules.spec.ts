// NEWS-Q24 ■1 — 거부 제목·까닭 기록 · 방송 RSS 막힘(API 대체) 셈 · 소스 쉼 · 큰 수 날짜.
import { kstDayRange } from '../articles/articles.service';
import { rejectNotesOf } from './broadcast_gate';
import { rssFailureBucket } from './broadcast_feeds';
import { lastRssBlocked } from './crawl_runs';
import { notRunToday } from './crawl_schedule';
import { alertFactsOf } from './run_alerts';
import {
  isResting,
  MASS_FAILURE_MIN,
  planRest,
  restAttemptOf,
  restLogFromRuns,
  restLogOf,
} from './source_rest';
import { rss404Outlets } from './youtube_api';

const rec = (
  rejectReason: string,
  title = 't',
  summary: string | null = 's',
) => ({
  title,
  source: 'src',
  rejectReason,
  summary,
});

describe('NEWS-Q24 ■1 거부 제목·까닭', () => {
  it('방송 topic_fit_false · 기사 category_fit_false(묶음 상속 포함)만 · 나눠서', () => {
    const n = rejectNotesOf([
      rec('broadcast:topic_fit_false', '방송'),
      rec('category_fit_false', '기사'),
      rec('cluster_inherit:category_fit_false', '상속', null),
      rec('broadcast:not_addiction_drunk_driving'),
      rec('non_korean_output'),
      rec('cluster_inherit:is_incident'),
    ]);
    expect(n.broadcast.map((x) => x.title)).toEqual(['방송']);
    expect(n.article.map((x) => x.title)).toEqual(['기사', '상속']);
    expect(n.article[1].summary).toBe('');
    expect(n.broadcast[0]).toEqual({
      title: '방송',
      source: 'src',
      reason: 'broadcast:topic_fit_false',
      summary: 's',
    });
  });

  it('수에 상한 없음 · 까닭 글만 160자로 자름', () => {
    const many = Array.from({ length: 500 }, () =>
      rec('category_fit_false', 't', `가 ${'나'.repeat(300)}`),
    );
    const n = rejectNotesOf(many);
    expect(n.article).toHaveLength(500);
    expect(n.article[0].summary).toHaveLength(160);
  });
});

describe('NEWS-Q24 ■1 방송 RSS 막힘(API 대체)', () => {
  it('API 가 받았을 때만 막힘 · 나머지는 실패 그대로', () => {
    expect(
      rssFailureBucket({ apiTried: true, apiError: null, items: 50 }),
    ).toBe('rss_blocked');
    expect(
      rssFailureBucket({
        apiTried: true,
        apiError: { status: 403, reason: 'quotaExceeded' },
        items: 0,
      }),
    ).toBe('failed');
    expect(rssFailureBucket({ apiTried: true, apiError: null, items: 0 })).toBe(
      'failed',
    );
    expect(rssFailureBucket({ apiTried: false, items: 0 })).toBe('failed');
  });

  it('다음 실행의 RSS 판별이 막힘 줄도 읽음(「한 번만 물어봄」 이어짐)', async () => {
    const lines = await lastRssBlocked(
      () =>
        Promise.resolve([
          { b: ['broadcast:mbc_pd_note [404]', 'broadcast:newstapa [500]'] },
        ]),
      'addiction',
    );
    expect(rss404Outlets(lines)).toEqual(['mbc_pd_note']);
    await expect(
      lastRssBlocked(() => Promise.reject(new Error('x')), 'addiction'),
    ).resolves.toEqual([]);
    await expect(
      lastRssBlocked(() => Promise.resolve([{ b: null }]), 'addiction'),
    ).resolves.toEqual([]);
  });
});

describe('NEWS-Q24 ■1 소스 쉼', () => {
  const F = false;
  const T = true;

  it('잇단 7회 실패 → 쉼 · 6회는 아님 · 중간 성공이면 셈 0', () => {
    expect(isResting([F, F, F, F, F, F])).toBe(false);
    expect(isResting([F, F, F, F, F, F, F])).toBe(true);
    expect(isResting([F, F, F, T, F, F, F, F, F, F])).toBe(false);
  });

  it('쉬는 중 잇단 2번 성공이면 복귀 · 1번은 그대로 · 실패 끼면 다시 셈', () => {
    const rest = [F, F, F, F, F, F, F];
    expect(isResting([...rest, T])).toBe(true);
    expect(isResting([...rest, T, T])).toBe(false);
    expect(isResting([...rest, T, F, T])).toBe(true);
    expect(isResting([...rest, T, T, F])).toBe(false);
  });

  it('시도 칸: 막힌 피드 · 503 단락기 = 시도 아님 · rest:/timeout/상태 = 실패 · 빈 칸 = 성공', () => {
    expect(restAttemptOf({ failed: 'blocked:403' })).toBeNull();
    expect(restAttemptOf({ failed: 'breaker:503' })).toBeNull();
    expect(restAttemptOf(null)).toBeNull();
    expect(restAttemptOf({ failed: 'rest:502' })).toBe(false);
    expect(restAttemptOf({ failed: 'timeout' })).toBe(false);
    expect(restAttemptOf({ failed: '502' })).toBe(false);
    expect(restAttemptOf({})).toBe(true);
    expect(restAttemptOf({ failed: 'judge' })).toBe(true);
  });

  it('대체 피드는 쉬지 않음(막힌 피드 몫이 비면 안 됨)', () => {
    const fails = Array<boolean>(9).fill(false);
    const plan = planRest(
      [{ id: 'sub', substituteFor: 'blk' }],
      { sub: fails },
      Date.parse('2026-11-05T03:00:00Z'),
    );
    expect(plan.skipped.size).toBe(0);
  });

  it('기록: 방송 · __run 뺌 · 망 장애 회차(절반 이상 실패)는 세지 않음', () => {
    const names = Array.from({ length: MASS_FAILURE_MIN }, (_, i) => `s${i}`);
    const ok = Object.fromEntries(names.map((id) => [id, {}]));
    const down = Object.fromEntries(names.map((id) => [id, { failed: 'ERR' }]));
    const log = restLogOf([
      {
        ...ok,
        wapo: { failed: '502' },
        'broadcast:x': { failed: '404' },
        __run: { failed: 'no' },
      },
      down,
      JSON.stringify({ ...ok, wapo: { failed: '502' } }),
    ]);
    expect(log.wapo).toEqual([false, false]);
    expect(log.s0).toEqual([true, true]);
    expect(log['broadcast:x']).toBeUndefined();
    expect(log.__run).toBeUndefined();
  });

  it('계획: 월요일(KST)만 재시도 · 그 밖은 건너뜀 · 막힌 피드는 제 규칙이라 뺌 · 없는 소스는 안 쉼', () => {
    const fails = Array<boolean>(9).fill(false);
    const sources = [
      { id: 'wapo' },
      { id: 'ok' },
      { id: 'blk', blocked: { retry: 'weekly' } },
    ];
    const log = { wapo: fails, blk: fails, ok: [true] };
    const thu = Date.parse('2026-11-05T03:00:00Z');
    const mon = Date.parse('2026-11-09T03:00:00Z');
    const a = planRest(sources, log, thu);
    expect([...a.skipped]).toEqual(['wapo']);
    expect(a.retrying.size).toBe(0);
    const b = planRest(sources, log, mon);
    expect(b.skipped.size).toBe(0);
    expect([...b.retrying]).toEqual(['wapo']);
  });

  it('DB 오류면 아무도 안 쉼 · 새것 먼저 온 행을 뒤집어 읽음', async () => {
    await expect(
      restLogFromRuns(() => Promise.reject(new Error('x')), 'addiction'),
    ).resolves.toEqual({});
    const log = await restLogFromRuns(
      () =>
        Promise.resolve([
          { per_source: { a: {} } },
          { per_source: { a: { failed: '502' } } },
        ]),
      'addiction',
    );
    expect(log.a).toEqual([false, true]);
  });

  it('닿음 n/m: 쉬는 소스는 m 에서 뺌(시간 초과로 오해 0)', () => {
    expect(notRunToday({ blockedSkipped: ['a'], resting: ['b', 'c'] })).toBe(3);
    expect(notRunToday({})).toBe(0);
    const facts = alertFactsOf({
      startedAt: '2026-11-05T03:00:00.000Z',
      durationSec: 1,
      timedOut: false,
      deepseekCalls: 0,
      saved: 0,
      sources: { broadcastChannelsRead: 9, worldSaved: 0, worldArchived: 0 },
      progress: {
        reached: 100,
        total: 110,
        blockedSkipped: ['a'],
        resting: ['b'],
      },
    } as never);
    expect(facts.reachedOf).toBe('100/108');
  });
});

describe('NEWS-Q24 ■3 큰 수 날짜', () => {
  it('KST 자정 경계 · 끝은 그날 마지막 1ms', () => {
    const r = kstDayRange(Date.parse('2026-11-03T15:30:00Z')); // KST 11-04 00:30
    expect(r.day).toBe('2026-11-04');
    expect(r.from.toISOString()).toBe('2026-11-03T15:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-04T14:59:59.999Z');
    expect(kstDayRange(Date.parse('2026-11-03T14:59:59Z')).day).toBe(
      '2026-11-03',
    );
  });
});
