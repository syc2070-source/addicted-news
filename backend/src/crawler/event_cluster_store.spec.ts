import { backfillClusters, loadClusterPool, savedPct } from './event_cluster_store';
import { recentCrawlRuns, recordCrawlRun, CrawlRunSummary } from './crawl_runs';

// NEWS-Q3 ■1: 수집기 묶음 기억 · 30일 되짚기(열 있을 때만 · 두 열만) · 집계
const NOW = Date.parse('2026-10-13T03:00:00Z');
const FLAGS = { deletedAt: true, tier: true, publishedTs: true, sourceGrade: true, cluster: true };
const TEXT = { fieldStopwords: ['예방'], ignoreLeads: [] as string[] };
const rows = [
  { id: 1, title: '서울역 광장 금주구역 지정…과태료 5만원 - 연합뉴스', published_ts: '2026-10-12T01:00:00Z', published_at: '2026-10-12', cluster_id: null, cluster_size: 1, tier: 'publish', category: 'A' },
  { id: 2, title: '서울역 광장 금주구역 지정…과태료 5만원 부과 - YTN', published_ts: '2026-10-12T02:00:00Z', published_at: '2026-10-12', cluster_id: '2', cluster_size: 1, tier: 'publish', category: 'A' },
  { id: 3, title: '청주시 버스정류소 금연 안내 스티커 설치', published_ts: '2026-10-12T03:00:00Z', published_at: '2026-10-12', cluster_id: '3', cluster_size: 1, tier: 'publish', category: 'B' },
];

describe('event_cluster_store', () => {
  it('묶음 SQL 3 열이 없으면 되짚기 안 함(쿼리 0)', async () => {
    const query = jest.fn(async () => rows);
    expect(await backfillClusters(query, { ...FLAGS, cluster: false }, TEXT, 30, NOW)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('되짚기: 30일 publish 만 읽고 달라진 행의 cluster_id·cluster_size 두 열만 고친다', async () => {
    const calls: Array<{ sql: string; params?: any[] }> = [];
    const query = jest.fn(async (sql: string, params?: any[]) => {
      calls.push({ sql, params });
      return sql.startsWith('SELECT') ? rows : [];
    });
    const r = await backfillClusters(query, FLAGS, TEXT, 30, NOW);
    expect(r).toEqual({ rows: 3, clusters: 1, updated: 2, sameArticle: { pairs: 0, together: 0, folded: 0, left: 0 } });
    expect(calls[0].sql).toContain("tier = 'publish'");
    expect(calls[0].sql).toContain('deleted_at IS NULL');
    const upd = calls.filter((c) => c.sql.includes('UPDATE'));
    expect(upd).toHaveLength(1);
    expect(upd[0].sql).toMatch(/SET cluster_id = v\.cid, cluster_size = v\.sz\s+FROM unnest/);
    expect(upd[0].sql).not.toMatch(/DELETE|title|summary|source_url/);
    expect(upd[0].params).toEqual([[1, 2], ['1', '1'], [2, 2]]); // 3 은 이미 맞음(혼자 · 자기 id)
  });

  it('묶음 기억: 최근 저장분(보관 포함)을 넣고 같은 사건이면 대표의 tier·분류를 돌려준다', async () => {
    const query = jest.fn(async () => rows.slice(0, 1));
    const pool = await loadClusterPool(query, FLAGS, TEXT, NOW);
    expect(pool.size).toBe(1);
    const m = pool.match({ id: -1, title: '서울역 광장 금주구역 지정, 과태료 5만원 - 경향신문', ts: Date.parse('2026-10-12T05:00:00Z') });
    expect(m?.data).toMatchObject({ tier: 'publish', category: 'A', articleId: 1 });
    expect((query.mock.calls[0] as any[])[0]).toContain("tier IN ('publish', 'archive')");
  });

  it('절감 % = 건너뛴 / (건너뛴 + 판정)', () => {
    expect(savedPct(30, 70)).toBe(30);
    expect(savedPct(0, 0)).toBe(0);
    expect(savedPct(1, 2)).toBe(33.3);
  });
});

describe('crawl_runs — 묶음 집계 칸 · 최근 실행 공개 요약', () => {
  const s = {
    field: 'f', startedAt: new Date('2026-10-12T03:00:28Z'), finishedAt: new Date('2026-10-12T03:42:06Z'), readOnly: false,
    sourcesTotal: 110, feedsOk: 90, feedsFailed: 4, failedFeeds: ['x [404]'], itemsSeen: 2079, candidates: 300, dupSkipped: 118,
    deepseekCalls: 112, promptTokens: 1, completionTokens: 1, costUsd: 0.05, saved: 27, archived: 12, rejected: 12, timedOut: true,
    perSource: {}, urlBackfill: null,
    clusterStats: { poolLoaded: 50, inherited: 10, inheritedRejected: 2, foreignSkipped: 1, savedPct: 10.4, backfill: null },
  } as CrawlRunSummary;

  it('cluster_stats 열이 있을 때만 22번째 값으로 넣는다', async () => {
    const q1 = jest.fn(async () => []);
    await recordCrawlRun(q1, s);
    expect((q1.mock.calls[0] as any[])[0]).not.toContain('cluster_stats');
    const q2 = jest.fn(async () => []);
    await recordCrawlRun(q2, s, { clusterStatsColumn: true });
    const [sql, params] = q2.mock.calls[0] as any[];
    expect(sql).toContain('cluster_stats');
    expect(params).toHaveLength(22);
    expect(JSON.parse(params[21]).inherited).toBe(10);
  });

  it('최근 실행: 소요 초 · 40분 넘김 · 실패 피드 이름(숫자와 이름만)', async () => {
    const q = jest.fn(async () => [{
      started_at: s.startedAt, finished_at: s.finishedAt, timed_out: true, sources_total: 110, feeds_ok: 90, feeds_failed: 4,
      failed_feeds: JSON.stringify(['wpr-1 (X) [404]: Request failed']), items_seen: 2079, candidates: 300, dup_skipped: 118,
      deepseek_calls: 112, cost_usd_est: '0.047288', saved: 27, archived: 12, rejected: 12, url_backfill: { ok: 90 }, cluster_stats: null,
    }]);
    const [r] = await recentCrawlRuns(q, 5);
    expect(r).toMatchObject({ durationSec: 2498, timedOut: true, feedsOk: 90, failedFeeds: ['wpr-1 (X) [404]: Request failed'], costUsd: 0.047288 });
    expect((q.mock.calls[0] as any[])[1]).toEqual([5]);
    expect(await recentCrawlRuns(async () => { throw new Error('no table'); }, 5)).toEqual([]);
  });
});
