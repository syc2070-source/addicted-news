// backend/src/articles/articles.controller.ts
import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ArticlesService, parseKind, parseTier } from './articles.service';
import { parseGroup } from './cluster_view';

// 목록·검색은 기본 기사만 · ?kind=broadcast 면 방송만(NEWS-Q1 ■4ⓓ)
// 기본 publish 층만 · ?tier=archive 면 보관만(NEWS-Q2 ■6). 응답 칸 isFresh·publishedTs(■7).
// NEWS-Q3 ■3: 목록은 기본 사건 묶음 단위(?group=cluster) — 대표 1건 + clusterMembers(같은 소식) ·
//   ?group=none 은 옛 꼴(한 기사 한 줄 · 랩·Statory 입구용). 응답 칸 clusterId·clusterSize·representative.
//   Statory LT15 입구는 묶음 = 이슈 단위로 읽는다(GET /articles/cluster/:id 로 매체 목록).
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  // 최신 기사 (limit 개)
  @Get('latest')
  getLatest(@Query('limit') limit?: string, @Query('kind') kind?: string, @Query('tier') tier?: string, @Query('group') group?: string) {
    return this.articlesService.getLatest(Number(limit) || 50, parseKind(kind), parseTier(tier), parseGroup(group));
  }

  // TOP 뉴스 — 72시간 안 가장 많은 매체가 다룬 묶음(NEWS-Q3 ■2) · 없으면 7일(topWindow)
  @Get('top')
  getTopNews() {
    return this.articlesService.getTopNews();
  }

  // 기획기사 (isFeature=true인 기사)
  @Get('featured')
  getFeatured() {
    return this.articlesService.getFeatured();
  }

  // 라파뉴스 (isRapha=true인 기사)
  @Get('rapha')
  getRaphaNews() {
    return this.articlesService.getRaphaNews();
  }

  // 이슈 (isIssue=true인 기사 · 없으면 묶음 단위 최신)
  @Get('issue')
  getIssueNews(@Query('limit') limit?: string, @Query('group') group?: string) {
    return this.articlesService.getIssueNews(Number(limit) || 5, parseGroup(group));
  }

  // 사건 묶음 하나 — 대표 + 매체별 제목·시각·원문(NEWS-Q3 ■3)
  @Get('cluster/:id')
  async getCluster(@Param('id') id: string) {
    const c = await this.articlesService.getCluster(Number(id));
    if (!c) throw new NotFoundException();
    return c;
  }

  // 카테고리별 기사 (최신 페이지)
  @Get('category/:key')
  getByCategory(
    @Param('key') key: string,
    @Query('limit') limit?: string,
    @Query('kind') kind?: string,
    @Query('tier') tier?: string,
    @Query('group') group?: string,
  ) {
    return this.articlesService.getByCategory(key, Number(limit) || 20, parseKind(kind), parseTier(tier), parseGroup(group));
  }

  // 카테고리별 기사 (페이징)
  @Get('category/:key/paged')
  getByCategoryPaged(
    @Param('key') key: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('kind') kind?: string,
    @Query('tier') tier?: string,
    @Query('group') group?: string,
  ) {
    return this.articlesService.getByCategoryPaged(
      key,
      Number(page) || 1,
      Number(limit) || 20,
      parseKind(kind),
      parseTier(tier),
      parseGroup(group),
    );
  }

  // 기사 검색
  @Get('search')
  search(
    @Query('q') q: string,
    @Query('limit') limit?: string,
    @Query('kind') kind?: string,
    @Query('tier') tier?: string,
    @Query('group') group?: string,
  ) {
    return this.articlesService.search(q, Number(limit) || 20, parseKind(kind), parseTier(tier), parseGroup(group));
  }

  // 최신 페이지 (페이징) — 기본 묶음 단위 · ?group=none 옛 꼴
  @Get('latest-paged')
  getLatestPaged(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('kind') kind?: string,
    @Query('tier') tier?: string,
    @Query('group') group?: string,
  ) {
    return this.articlesService.getLatestPaged(
      Number(page) || 1,
      Number(limit) || 20,
      parseKind(kind),
      parseTier(tier),
      parseGroup(group),
    );
  }

  // 기사 상세
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.articlesService.getOne(Number(id));
  }
}
