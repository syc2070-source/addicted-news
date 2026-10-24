import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { parseArchiveTier, redactArchiveList } from './crawler/broadcast_archive_list';
import { redactPublic } from './crawler/public_redact';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // GET / — 짧은 글 200 (전에는 AppModule 에 등록되지 않아 404였음)
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // GET /api/health — {ok, commit, startedAt, lastRun}. lastRun = 마지막 수집 실행 숫자 요약(NEWS-Q2 ■8, 표 없으면 null). 인증·비밀 0.
  // NEWS-Q10 ■1: 공개 응답의 모든 글에서 호스트·포트·사용자·DB 이름·경로·열쇠 꼴을 가린다(redactPublic).
  @Get('api/health')
  async getHealth() {
    return redactPublic(await this.appService.getHealthWithRun());
  }

  // GET /api/health/runs?limit=5 — 최근 수집 실행(숫자 · 40분 넘김 · 실패 피드 이름 · 묶음 절감 · NEWS-Q3 ■0). 인증·비밀 0.
  // ?kind=cleanup — 정리 cron(judge_cleanup) 결과 줄(NEWS-Q9 ■3).
  @Get('api/health/runs')
  async getRuns(@Query('limit') limit?: string, @Query('kind') kind?: string) {
    if (kind === 'cleanup') return redactPublic(await this.appService.recentCleanups(Number(limit) || 5));
    return redactPublic(await this.appService.recentRuns(Number(limit) || 5));
  }

  // GET /api/broadcast/archive?tier=all — NEWS-Q14 ■5 · Q15 ■1: 방송 보관 목록(id · tier · changedAt · videoId 만 · 보관 · 지운 편 전 기간 ·
  // 실림 최근 120일 · 인증·비밀 0).
  // SOC-R13 연대기가 읽는다. 기본 보관층만 · tier=all 이면 실림 포함. docs/BROADCAST_ARCHIVE_LIST.md.
  @Get('api/broadcast/archive')
  async getBroadcastArchive(@Query('tier') tier?: string) {
    return redactArchiveList(await this.appService.broadcastArchive(parseArchiveTier(tier)));
  }
}
