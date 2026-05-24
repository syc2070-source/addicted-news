// backend/src/articles/articles.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ArticlesService } from './articles.service';

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  // 최신 기사 (limit 개)
  @Get('latest')
  getLatest(@Query('limit') limit?: string) {
    return this.articlesService.getLatest(Number(limit) || 50);
  }

  // TOP 뉴스 (isTop=true인 기사)
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

  // 중독이슈 (isIssue=true인 기사)
  @Get('issue')
  getIssueNews(@Query('limit') limit?: string) {
    return this.articlesService.getIssueNews(Number(limit) || 5);
  }

  // 카테고리별 기사 (최신 페이지)
  @Get('category/:key')
  getByCategory(@Param('key') key: string, @Query('limit') limit?: string) {
    return this.articlesService.getByCategory(key, Number(limit) || 20);
  }

  // 카테고리별 기사 (페이징)
  @Get('category/:key/paged')
  getByCategoryPaged(
    @Param('key') key: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.articlesService.getByCategoryPaged(
      key,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  // 기사 검색
  @Get('search')
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.articlesService.search(q, Number(limit) || 20);
  }

  // 최신 페이지 (페이징)
  @Get('latest-paged')
  getLatestPaged(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.articlesService.getLatestPaged(
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  // 기사 상세
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.articlesService.getOne(Number(id));
  }
}