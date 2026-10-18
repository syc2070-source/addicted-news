import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // GET / — 짧은 글 200 (전에는 AppModule 에 등록되지 않아 404였음)
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // GET /api/health — {ok, commit, startedAt, lastRun}. lastRun = 마지막 수집 실행 숫자 요약(NEWS-Q2 ■8, 표 없으면 null). 인증·비밀 0.
  @Get('api/health')
  getHealth() {
    return this.appService.getHealthWithRun();
  }

  // GET /api/health/runs?limit=5 — 최근 수집 실행(숫자 · 40분 넘김 · 실패 피드 이름 · 묶음 절감 · NEWS-Q3 ■0). 인증·비밀 0.
  // ?kind=cleanup — 정리 cron(judge_cleanup) 결과 줄(NEWS-Q9 ■3).
  @Get('api/health/runs')
  getRuns(@Query('limit') limit?: string, @Query('kind') kind?: string) {
    if (kind === 'cleanup') return this.appService.recentCleanups(Number(limit) || 5);
    return this.appService.recentRuns(Number(limit) || 5);
  }
}
