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
    it('ok · commit · startedAt 만 돌려준다(비밀 없음)', () => {
      const health = appController.getHealth();
      expect(Object.keys(health).sort()).toEqual(['commit', 'ok', 'startedAt']);
      expect(health.ok).toBe(true);
      expect(Number.isNaN(Date.parse(health.startedAt))).toBe(false);
    });

    it('commit = RENDER_GIT_COMMIT, 없으면 "local"', () => {
      expect(appService.getHealth({ RENDER_GIT_COMMIT: 'abc123' } as NodeJS.ProcessEnv).commit).toBe('abc123');
      expect(appService.getHealth({} as NodeJS.ProcessEnv).commit).toBe('local');
    });
  });
});
