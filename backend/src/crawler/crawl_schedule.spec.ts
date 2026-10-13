import * as fs from 'fs';
import * as path from 'path';
import {
  BROADCAST_SHARE_MS, DEFAULT_CRAWL_MINUTES, LEGACY_TIMEOUT_MS, RUN_KEY, SOURCE_CAP_MS, SOURCE_CONCURRENCY,
  blockedRetryDue, crawlTimeoutMs, emptyProgress, lastRunLastSourceId, planSources, rotateSources, runSources,
} from './crawl_schedule';
import { RUN_PROGRESS_KEY, digestPerSource, recordCrawlRun } from './crawl_runs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const src = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe('crawl_schedule — 동시 읽기 · 순서대로 판정(■1ⓐ)', () => {
  it('읽기는 동시에 최대 4개 · 판정은 읽기가 끝나는 순서와 무관하게 목록 순서', async () => {
    const items = Array.from({ length: 10 }, (_, i) => src(`s${i}`));
    // 뒤 소스일수록 빨리 끝나게(끝나는 순서 = 거꾸로)
    const delay = (i: number) => 5 + (10 - i) * 4;
    let running = 0;
    let peak = 0;
    const finished: string[] = [];
    const judged: string[] = [];
    const r = await runSources(items, {
      read: async (s) => {
        running++;
        peak = Math.max(peak, running);
        await sleep(delay(Number(s.id.slice(1))));
        running--;
        finished.push(s.id);
        return s.id.toUpperCase();
      },
      consume: async (s, o) => {
        expect(o.status).toBe('ok');
        judged.push(o.status === 'ok' ? o.value : '?');
        return true;
      },
    });
    expect(SOURCE_CONCURRENCY).toBe(4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(judged).toEqual(items.map((s) => s.id.toUpperCase()));
    expect(finished).not.toEqual(items.map((s) => s.id)); // 읽기는 순서 뒤섞여 끝남
    expect(r).toEqual({ consumed: 10, stopped: false });
  });

  it('같은 입력이면 동시 1 과 동시 4 의 판정 결과가 같다(순서 무관)', async () => {
    const items = Array.from({ length: 7 }, (_, i) => src(`s${i}`));
    const runWith = async (concurrency: number) => {
      const out: string[] = [];
      await runSources(items, {
        concurrency,
        read: async (s) => { await sleep(Math.random() * 10); return `${s.id}!`; },
        consume: async (_s, o) => { out.push(o.status === 'ok' ? o.value : 'x'); return true; },
      });
      return out;
    };
    expect(await runWith(4)).toEqual(await runWith(1));
  });
});

describe('crawl_schedule — 소스별 상한(■1ⓑ)', () => {
  it('상한을 넘긴 소스 = timeout + 그때까지 읽은 것만 · 다음 소스로 · 같은 실행 재시도 0', async () => {
    const calls: Record<string, number> = {};
    const seen: Array<{ id: string; status: string; value: unknown }> = [];
    await runSources([src('slow'), src('ok')], {
      capMs: 40,
      read: async (s, ctx) => {
        calls[s.id] = (calls[s.id] || 0) + 1;
        if (s.id === 'slow') {
          const partial = { items: ['a'] };
          ctx.partial(partial);
          await sleep(200); // 한 항목이 걸려 상한 넘김
          if (!ctx.cancelled()) partial.items.push('b');
          return partial;
        }
        return { items: ['x', 'y'] };
      },
      consume: async (s, o) => {
        seen.push({ id: s.id, status: o.status, value: o.status === 'error' ? null : o.value });
        return true;
      },
    });
    expect(seen[0]).toEqual({ id: 'slow', status: 'timeout', value: { items: ['a'] } });
    expect(seen[1]).toEqual({ id: 'ok', status: 'ok', value: { items: ['x', 'y'] } });
    expect(calls).toEqual({ slow: 1, ok: 1 });
    expect(SOURCE_CAP_MS).toBe(60_000);
  });

  it('읽기 오류 = error(다음 소스는 그대로)', async () => {
    const st: string[] = [];
    await runSources([src('bad'), src('good')], {
      read: async (s) => { if (s.id === 'bad') throw new Error('403'); return 1; },
      consume: async (_s, o) => { st.push(o.status); return true; },
    });
    expect(st).toEqual(['error', 'ok']);
  });
});

describe('crawl_schedule — 시작점 순환(■1ⓒ)', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id) => src(id));
  it('지난 실행 마지막 소스 다음부터 한 바퀴', () => {
    expect(rotateSources(list, 'b').order.map((s) => s.id)).toEqual(['c', 'd', 'e', 'a', 'b']);
    expect(rotateSources(list, 'b').startIndex).toBe(2);
    expect(rotateSources(list, 'e').order.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('기록 없음·목록에 없는 id = 처음부터', () => {
    expect(rotateSources(list, null).order.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(rotateSources(list, 'zz').startIndex).toBe(0);
  });
  it('상한에 걸린 날마다 끝 위치가 바뀌어 같은 소스가 늘 꼴찌가 되지 않는다', () => {
    // 하루에 3개만 닿는다고 치면: 1일 a b c → 2일 d e a → 3일 b c d
    let last: string | null = null;
    const reachedLast: string[] = [];
    for (let day = 0; day < 3; day++) {
      const { order } = rotateSources(list, last);
      const end = order[2].id;
      last = end;
      reachedLast.push(end);
    }
    expect(reachedLast).toEqual(['c', 'a', 'd']);
  });
  it('지난 실행의 per_source.__run.lastId 를 읽는다(없거나 실패면 null)', async () => {
    const q = jest.fn(async () => [{ per_source: JSON.stringify({ x: {}, [RUN_KEY]: { lastId: 'kr-press-a' } }) }]);
    expect(await lastRunLastSourceId(q, 'addiction')).toBe('kr-press-a');
    expect(await lastRunLastSourceId(async () => [], 'addiction')).toBeNull();
    expect(await lastRunLastSourceId(async () => { throw new Error('no table'); }, 'addiction')).toBeNull();
    expect(RUN_KEY).toBe(RUN_PROGRESS_KEY);
  });
});

describe('crawl_schedule — 막힌 피드(■2)', () => {
  const MON = Date.parse('2026-10-19T03:00:00Z'); // KST 월요일 12:00
  const TUE = Date.parse('2026-10-13T03:00:00Z'); // KST 화요일
  const FIRST = Date.parse('2026-11-01T03:00:00Z'); // KST 1일(일요일)
  it('주 1회 = KST 월요일 · 월 1회 = KST 1일', () => {
    expect(blockedRetryDue({ retry: 'weekly' }, MON)).toBe(true);
    expect(blockedRetryDue({ retry: 'weekly' }, TUE)).toBe(false);
    expect(blockedRetryDue({ retry: 'monthly' }, FIRST)).toBe(true);
    expect(blockedRetryDue({ retry: 'monthly' }, MON)).toBe(false);
    // KST 자정 넘김: UTC 일요일 15:30 = KST 월요일 00:30
    expect(blockedRetryDue({ retry: 'weekly' }, Date.parse('2026-10-18T15:30:00Z'))).toBe(true);
  });
  it('재시도 날이 아니면 원 피드는 순서에서 빠지고(비활성 아님) 대체 피드는 그대로', () => {
    const list = [src('a'), src('blk', { blocked: { retry: 'weekly' } }), src('sub'), src('sam', { blocked: { retry: 'monthly' } })];
    const tue = planSources(list, null, TUE);
    expect(tue.order.map((s) => s.id)).toEqual(['a', 'sub']);
    expect(tue.skipped.map((s) => s.id)).toEqual(['blk', 'sam']);
    const mon = planSources(list, null, MON);
    expect(mon.order.map((s) => s.id)).toEqual(['a', 'blk', 'sub']);
    expect(mon.retrying.map((s) => s.id)).toEqual(['blk']);
  });
});

describe('crawl_schedule — 방송 먼저(■1ⓓ) · 전체 상한(■1ⓔ)', () => {
  it('방송 9채널은 기사 소스보다 먼저(5분 몫) — 수집기 본문 순서', () => {
    const code = fs.readFileSync(path.join(__dirname, 'newsCrawler.ts'), 'utf8');
    const main = code.slice(code.indexOf('async function main()'));
    const b = main.indexOf('crawlBroadcastSources(Math.min(crawlDeadline, b0 + BROADCAST_SHARE_MS))');
    const a = main.indexOf('await runSources<');
    expect(b).toBeGreaterThan(0);
    expect(a).toBeGreaterThan(b);
    expect(BROADCAST_SHARE_MS).toBe(5 * 60_000);
    expect(emptyProgress(10, 55 * 60_000).broadcastFirst).toBe(true);
  });
  it('전체 상한 55분 · 옛 기본 2400000 은 무시 · 다른 값은 그대로', () => {
    expect(DEFAULT_CRAWL_MINUTES).toBe(55);
    expect(crawlTimeoutMs({} as NodeJS.ProcessEnv)).toBe(55 * 60_000);
    expect(crawlTimeoutMs({ CRAWL_TIMEOUT_MS: String(LEGACY_TIMEOUT_MS) } as NodeJS.ProcessEnv)).toBe(55 * 60_000);
    expect(crawlTimeoutMs({ CRAWL_TIMEOUT_MS: '600000' } as NodeJS.ProcessEnv)).toBe(600_000);
    expect(crawlTimeoutMs({ CRAWL_TIMEOUT_MS: 'abc' } as NodeJS.ProcessEnv)).toBe(55 * 60_000);
  });
});

describe('crawl_schedule — 상한 기록(■1ⓔ)', () => {
  it('상한에 걸리면 판정까지 마친 소스 수만큼에서 멈추고 새 읽기를 시작하지 않는다', async () => {
    let clock = 0;
    const started: string[] = [];
    const r = await runSources(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => src(id)), {
      concurrency: 1,
      maxAhead: 1,
      canStart: () => clock < 3,
      read: async (s) => { started.push(s.id); await sleep(2); return s.id; },
      consume: async () => { clock++; return clock < 3; },
    });
    expect(r).toEqual({ consumed: 3, stopped: true });
    expect(started).toEqual(['a', 'b', 'c']);
  });

  it('crawl_runs 한 행: per_source 에 __run(어디까지 돌았는지) 이 함께 들어가고 health 숫자로 읽힌다', async () => {
    const q = jest.fn(async () => []);
    const progress = {
      ...emptyProgress(100, 55 * 60_000), startId: 'a', lastId: 'k', reached: 60, timedOut: true, stoppedAt: 'articles',
      timeouts: ['slow1'], blockedSkipped: ['kr-press-x'], blockedFromHost: 4, broadcastMs: 42_000,
    };
    await recordCrawlRun(q, {
      field: 'addiction', startedAt: new Date(0), finishedAt: new Date(1000), readOnly: false, sourcesTotal: 109, feedsOk: 60,
      feedsFailed: 0, failedFeeds: [], itemsSeen: 0, candidates: 0, dupSkipped: 0, deepseekCalls: 0, promptTokens: 0,
      completionTokens: 0, costUsd: 0, saved: 0, archived: 0, rejected: 0, timedOut: true,
      perSource: { slow1: { read: 3, candidates: 0, dup: 0, calls: 0, saved: 0, archived: 0, rejected: 0, timeout: true, readMs: 60_000 } },
      urlBackfill: null, progress,
    });
    const params = (q.mock.calls[0] as unknown[])[1] as unknown[];
    const perSource = JSON.parse(String(params[19]));
    expect(perSource[RUN_PROGRESS_KEY]).toMatchObject({ lastId: 'k', reached: 60, timedOut: true, stoppedAt: 'articles' });
    const d = digestPerSource(perSource);
    expect(d.progress?.lastId).toBe('k');
    expect(d.sources).toMatchObject({ timeouts: 1, blocked: 1 });
    expect(d.sources.slowest[0]).toEqual({ id: 'slow1', readSec: 60, judgeSec: 0 });
  });
});
