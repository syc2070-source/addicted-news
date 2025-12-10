import { ArticlesService } from './articles.service';
import { Article } from './article.entity';
import { Controller, Get, Param, Query } from '@nestjs/common';

// URL 키 → DB에 저장된 한글 카테고리 이름 매핑
const CATEGORY_MAP: Record<string, string> = {
  policy: '중독정책',
  alcohol: '알코올·약물중독',
  gambling: '도박중독',
  game: '게임·디지털중독',
  ai: 'AI 관련 정책과 중독',
  community: '공동체',
  religion: '종교',
  issue: '시사 이슈',
};

@Controller('articles')
export class ArticlesController {
  constructor(private readonly service: ArticlesService) {}

  // 기본: 최신 20개
  @Get()
  async getAll(): Promise<Article[]> {
    return this.service.findAll();
  }

  // TOP 뉴스
  @Get('top')
  async getTop(): Promise<Article[]> {
    return this.service.findTop();
  }

  // 최신 뉴스 (동일 데이터라도 별도 엔드포인트)
  @Get('latest')
  async getLatest(): Promise<Article[]> {
    return this.service.findLatest();
  }

  // 기획기사
  @Get('featured')
  async getFeatured(): Promise<Article[]> {
    return this.service.findFeatured();
  }

  // 카테고리별
  // 예: /articles/category/policy  → 중독정책
  //     /articles/category/alcohol → 알코올·약물중독
  @Get('category/:key')
  async getByCategory(@Param('key') key: string): Promise<Article[]> {
    const categoryName = CATEGORY_MAP[key];
    if (!categoryName) {
      // 매핑 안 되면 그냥 빈 배열 반환 (간단 처리)
      return [];
    }
    return this.service.findByCategory(categoryName);
  }

   @Get('search')
  async search(@Query('q') q: string): Promise<Article[]> {
    if (!q || q.trim() === '') {
      return [];
    }
    return this.service.search(q.trim());
  }
}
