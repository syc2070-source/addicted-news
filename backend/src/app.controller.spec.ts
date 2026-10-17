import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  describe('root', () => {
    it('GET / 는 짧은 글을 돌려준다', () => {
      expect(appController.getHello()).toBe('addicted-news api ok');
    });
  });

  describe('health', () => {
    it('ok · commit · startedAt · lastRun · schema · feeds · alerts · broadcast 만 돌려준다(비밀 없음 · DB 없으면 lastRun=null · 열 인식 null)', async () => {
      const health = await appController.getHealth();
      expect(Object.keys(health).sort()).toEqual(['alerts', 'broadcast', 'commit', 'feeds', 'lastRun', 'ok', 'schema', 'startedAt']);
      expect(health.ok).toBe(true);
      expect(health.lastRun).toBeNull();
      expect(health.alerts).toBeNull();
      // NEWS-Q6 ■4: 열쇠는 on|off 로만(값 0) · 기록 없으면 lastRun null
      // NEWS-Q8 ■2: 채널별 읽기 결과(feeds) — 기록 없으면 null
      expect(health.broadcast).toEqual({ api: process.env.YOUTUBE_API_KEY ? 'on' : 'off', lastRun: null, feeds: null });
      expect(JSON.stringify(health)).not.toContain(process.env.YOUTUBE_API_KEY || '\u0000none');
      expect(health.schema).toEqual({ cluster_columns: null });
      // NEWS-Q4 ■2: 설정의 막힌 피드(Render 망에서만 4 + 어디서나 403 SAMHSA 1) · 대체 검색 피드 5
      expect(health.feeds).toEqual({ blocked_from_host: 4, blocked: 5, substitutes: 5 });
      expect(Number.isNaN(Date.parse(health.startedAt))).toBe(false);
    });

    it('schema.cluster_columns = articles.cluster_id·cluster_size 둘 다 있으면 true', async () => {
      const cols = new Set(['cluster_id', 'cluster_size']);
      const query = jest.fn(async (_sql: string, params?: unknown[]) => (cols.has(String(params?.[1])) ? [{ x: 1 }] : []));
      const svc = new AppService({ isInitialized: true, query } as any);
      expect(await svc.schema(1000)).toEqual({ cluster_columns: true });
      cols.delete('cluster_size');
      expect(await svc.schema(1500)).toEqual({ cluster_columns: true }); // 60초 기억
      expect(await svc.schema(99_000)).toEqual({ cluster_columns: false });
    });

    it('lastRun 에 소요·소스 수·소스 상한 걸린 수·막힌 피드 수(per_source.__run)', async () => {
      const query = jest.fn(async (sql: string) => {
        if (sql.includes('information_schema.tables')) return [{ x: 1 }];
        return [{ started_at: '2026-10-14T03:00:00Z', finished_at: '2026-10-14T03:30:00Z', sources_total: 116, timed_out: false,
          per_source: { 'kr-a': { read: 3, timeout: true, readMs: 60000 }, '__run': { blockedSkipped: ['x', 'y'], blockedFromHost: 4 } } }];
      });
      const svc = new AppService({ isInitialized: true, query } as any);
      expect(await svc.lastRun(1000)).toMatchObject({ durationSec: 1800, sourcesTotal: 116, timedOut: false, timeouts: 1, blocked: 2, blockedFromHost: 4 });
    });

    it('lastRun 은 crawl_runs 표가 있을 때 숫자만 · 60초 기억', async () => {
      const query = jest.fn(async (sql: string) => {
        if (sql.includes('information_schema.tables')) return [{ '?column?': 1 }];
        return [{ started_at: '2026-10-11T03:00:00Z', finished_at: '2026-10-11T03:30:00Z', feeds_ok: 80, feeds_failed: 3,
          items_seen: 900, dup_skipped: 400, deepseek_calls: 120, cost_usd_est: '0.0213', saved: 25, archived: 10, rejected: 30 }];
      });
      const svc = new AppService({ isInitialized: true, query } as any);
      const r = await svc.lastRun(1000);
      expect(r).toMatchObject({ feedsOk: 80, feedsFailed: 3, saved: 25, archived: 10, rejected: 30, deepseekCalls: 120, costUsd: 0.0213 });
      await svc.lastRun(2000);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('GET /api/health/runs: DB 없으면 [] · 표 있으면 최근 실행(최대 20 · 60초 기억)', async () => {
      expect(await appController.getRuns('5')).toEqual([]);
      const query = jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('information_schema.tables')) return [{ x: 1 }];
        if (sql.includes('information_schema.columns')) return [];
        if (sql.includes('FROM rejected_articles')) return [{ reason: 'category_fit_false', n: 7 }, { reason: 'low_confidence', n: 3 }];
        expect(params).toEqual([20]);
        return [{ started_at: '2026-10-12T03:00:28Z', finished_at: '2026-10-12T03:42:06Z', timed_out: true, feeds_ok: 90 }];
      });
      const svc = new AppService({ isInitialized: true, query } as any);
      const runs = await svc.recentRuns(99, 1000);
      expect(runs[0]).toMatchObject({
        timedOut: true, durationSec: 2498, feedsOk: 90, clusterStats: null,
        rejectReasons: { category_fit_false: 7, low_confidence: 3 },
      });
      await svc.recentRuns(99, 2000);
      expect(query).toHaveBeenCalledTimes(5);
    });

    it('NEWS-Q5 ■1 alerts: 저장된 경보가 있으면 그대로 · 옛 실행은 행 숫자로 다시 센다', async () => {
      const rows = [
        { started_at: '2026-10-13T03:00:31Z', finished_at: '2026-10-13T03:42:12Z', timed_out: true, saved: 15, deepseek_calls: 69,
          per_source: { 'wp-wpr-001': { read: 5, saved: 0 }, 'kr-press-a': { read: 3, saved: 2 } } },
        { started_at: '2026-10-12T03:00:28Z', finished_at: '2026-10-12T03:42:06Z', timed_out: true, saved: 27, deepseek_calls: 112,
          per_source: { 'wp-wpr-001': { read: 5, saved: 0 } } },
      ];
      const query = jest.fn(async (sql: string) => (sql.includes('information_schema.tables') ? [{ x: 1 }] : rows));
      const svc = new AppService({ isInitialized: true, query } as any);
      expect((await svc.alerts(1000))!.map((a) => a.code)).toEqual(['timed_out', 'broadcast_zero', 'world_zero_2d']);

      rows[0].per_source = { __run: { alerts: [{ code: 'saved_zero', value: 0 }] } } as any;
      expect((await svc.alerts(2000))!.map((a) => a.code)).toEqual(['timed_out', 'broadcast_zero', 'world_zero_2d']); // 60초 기억
      expect(await svc.alerts(99_000)).toEqual([{ code: 'saved_zero', value: 0 }]);
    });

    it('commit = RENDER_GIT_COMMIT, 없으면 "local"', () => {
      expect(appService.getHealth({ RENDER_GIT_COMMIT: 'abc123' } as NodeJS.ProcessEnv).commit).toBe('abc123');
      expect(appService.getHealth({} as NodeJS.ProcessEnv).commit).toBe('local');
    });
  });
});
