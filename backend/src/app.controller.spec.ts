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
    it('ok · commit · startedAt · lastRun 만 돌려준다(비밀 없음 · DB 없으면 lastRun=null)', async () => {
      const health = await appController.getHealth();
      expect(Object.keys(health).sort()).toEqual(['commit', 'lastRun', 'ok', 'startedAt']);
      expect(health.ok).toBe(true);
      expect(health.lastRun).toBeNull();
      expect(Number.isNaN(Date.parse(health.startedAt))).toBe(false);
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

    it('commit = RENDER_GIT_COMMIT, 없으면 "local"', () => {
      expect(appService.getHealth({ RENDER_GIT_COMMIT: 'abc123' } as NodeJS.ProcessEnv).commit).toBe('abc123');
      expect(appService.getHealth({} as NodeJS.ProcessEnv).commit).toBe('local');
    });
  });
});
