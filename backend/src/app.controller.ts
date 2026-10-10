import { Controller, Get } from '@nestjs/common';
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
}
