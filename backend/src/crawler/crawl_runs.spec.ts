import { CrawlRunSummary, feedHealthLines, lastFailedBroadcastOutlets, recordCrawlRun } from './crawl_runs';
import { buildExtrasUpdate, writeRowExtras } from './row_extras';
import { BROADCAST_FETCH_ATTEMPTS, orderFailedFirst } from './broadcast';
import { AdminService } from '../admin/admin.service';

// NEWS-Q2 ■8: 집계 · 묶음 SQL 2 열 채우기 · 방송 재시도 · 관리자 soft 삭제
const FLAGS = {
  deletedAt: true, kind: true, tier: true, publishedTs: true, sourceGrade: true, urlResolve: true, crawlRuns: true,
  cluster: false, clusterStats: false,
};

describe('crawl_runs', () => {
  const summary: CrawlRunSummary = {
    field: 'f', startedAt: new Date('2026-10-11T03:00:00Z'), finishedAt: new Date('2026-10-11T03:30:00Z'), readOnly: false,
    sourcesTotal: 119, feedsOk: 116, feedsFailed: 2, failedFeeds: ['wp-x (X) [404]', 'broadcast:kbs_docu_insight [404]'],
    itemsSeen: 2500, candidates: 300, dupSkipped: 200, deepseekCalls: 180, promptTokens: 400000, completionTokens: 90000,
    costUsd: 0.0812, saved: 30, archived: 12, rejected: 40, timedOut: false,
    perSource: { 'wp-x': { read: 0, candidates: 0, dup: 0, calls: 0, saved: 0, archived: 0, rejected: 0, failed: '404' } },
    urlBackfill: { picked: 100, ok: 90, pending: 8, failed: 2 },
  };

  it('실행마다 한 행: 숫자·실패 목록·소스별 표를 넣는다', async () => {
    const query = jest.fn(async () => []);
    await recordCrawlRun(query, summary);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/^INSERT INTO crawl_runs/);
    expect(params).toHaveLength(21);
    expect(params[7]).toBe(JSON.stringify(summary.failedFeeds));
    expect(JSON.parse(params[19] as string)['wp-x'].failed).toBe('404');
  });

  it('피드 건강 표 · 지난 실행 실패 방송 채널', async () => {
    expect(feedHealthLines(summary)[0]).toBe('피드 건강: 소스 119 · 성공 116 · 실패 2');
    const q = jest.fn(async () => [{ failed_feeds: summary.failedFeeds }]);
    expect(await lastFailedBroadcastOutlets(q, 'f')).toEqual(['kbs_docu_insight']);
    expect(await lastFailedBroadcastOutlets(async () => { throw new Error('no table'); }, 'f')).toEqual([]);
  });
});

describe('방송 재시도(■8)', () => {
  it('실패 채널을 맨 앞으로 · 재시도 10회', () => {
    const s = [{ outletId: 'a' }, { outletId: 'b' }, { outletId: 'c' }];
    expect(orderFailedFirst(s, ['c']).map((x) => x.outletId)).toEqual(['c', 'a', 'b']);
    expect(BROADCAST_FETCH_ATTEMPTS).toBe(10);
  });
});

describe('row_extras — 열이 선 것만 채움', () => {
  const x = { tier: 'archive' as const, publishedTs: new Date('2026-10-09T01:00:00Z'), sourceGrade: 'press' as const, urlResolve: { status: 'ok' as const, attempts: 1, at: 'z' } };

  it('열이 모두 있으면 네 칸, 없으면 아무것도 안 씀 · publish 는 기본값이라 tier 생략', () => {
    const u = buildExtrasUpdate(5, x, FLAGS)!;
    expect(u.sql).toBe('UPDATE articles SET tier = $2, published_ts = $3, source_grade = $4, url_resolve = $5::jsonb WHERE id = $1');
    expect(buildExtrasUpdate(5, x, { tier: false, publishedTs: false, sourceGrade: false, urlResolve: false })).toBeNull();
    expect(buildExtrasUpdate(5, { ...x, tier: 'publish' }, FLAGS)!.sql).not.toContain('tier');
  });

  it('archive 행의 tier 기록이 실패하면 공개되지 않게 막는다(fail-closed)', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('UPDATE articles SET tier')) throw new Error('boom');
      return [];
    });
    await writeRowExtras(query, 9, x, FLAGS, () => undefined);
    expect(query.mock.calls[1][0]).toContain("blocked = true, blocked_reason = 'tier_write_failed'");
  });
});

describe('관리자 기사 삭제 = soft(■8)', () => {
  function svc(hasColumn: boolean) {
    const query = jest.fn(async (sql: string) => (sql.includes('information_schema') ? (hasColumn ? [{ x: 1 }] : []) : []));
    const repo = { findOne: jest.fn(async () => ({ id: 3 })), remove: jest.fn(), query };
    return { s: new AdminService(repo as any), repo };
  }

  it('deleted_at 을 찍고 remove(하드 삭제)는 부르지 않는다', async () => {
    const { s, repo } = svc(true);
    await expect(s.deleteArticle(3)).resolves.toEqual({ success: true, id: 3, soft: true });
    expect(repo.remove).not.toHaveBeenCalled();
    expect(repo.query.mock.calls.some((c: any) => String(c[0]).startsWith('UPDATE articles SET deleted_at = now()'))).toBe(true);
  });

  it('열이 없으면 지우지 않고 오류', async () => {
    const { s, repo } = svc(false);
    await expect(s.deleteArticle(3)).rejects.toThrow(/deleted_at/);
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
