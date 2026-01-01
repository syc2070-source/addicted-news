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

  // 기본: 최신 20개 (메인 종합 최신 영역)
  @Get()
  async getAll(): Promise<Article[]> {
    return this.service.findAll();
  }

  // TOP 뉴스
  @Get('top')
  async getTop(): Promise<Article[]> {
    return this.service.findTop();
  }

  // 최신 뉴스 20개 (기존 로직 그대로 유지)
  @Get('latest')
  async getLatest(): Promise<Article[]> {
    return this.service.findLatest();
  }

  // 기획기사 10개
  @Get('featured')
  async getFeatured(): Promise<Article[]> {
    return this.service.findFeatured();
  }

  // 카테고리별 20개 (카테고리 첫 화면용)
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

  // 검색 (최대 50개)
  @Get('search')
  async search(@Query('q') q: string): Promise<Article[]> {
    if (!q || q.trim() === '') {
      return [];
    }
    return this.service.search(q.trim());
  }

  // ─────────────────────────────
  // 여기부터 "페이지네이션 전용" 엔드포인트
  // 프론트의 "더보기 / 페이지 이동"에서 사용할 것
  // ─────────────────────────────

  // 최신 뉴스 페이지네이션
  // 예: /articles/latest-paged?page=1&limit=20
  @Get('latest-paged')
  async getLatestPaged(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<{
    items: Article[];
    page: number;
    limit: number;
    total: number;
  }> {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    return this.service.findLatestPaginated(pageNum, limitNum);
  }

  // 카테고리별 페이지네이션
  // 예: /articles/category/policy/paged?page=1&limit=20
  @Get('category/:key/paged')
  async getByCategoryPaged(
    @Param('key') key: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<{
    items: Article[];
    page: number;
    limit: number;
    total: number;
  }> {
    const categoryName = CATEGORY_MAP[key];
    if (!categoryName) {
      return {
        items: [],
        page: Number(page) || 1,
        limit: Number(limit) || 20,
        total: 0,
      };
    }

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    return this.service.findByCategoryPaginated(categoryName, pageNum, limitNum);
  }
}
