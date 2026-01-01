import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Article } from './article.entity';

@Injectable()
export class ArticlesService {
  constructor(
    @InjectRepository(Article)
    private readonly repo: Repository<Article>,
  ) {}

  // 전체 최신 20개 (메인용)
  async findAll(): Promise<Article[]> {
    return this.repo.find({
      order: { publishedAt: 'DESC' },
      take: 20,
    });
  }

  // TOP 기사 5개
  async findTop(): Promise<Article[]> {
    return this.repo.find({
      where: { isTop: true },
      order: { publishedAt: 'DESC' },
      take: 5,
    });
  }

  // 최신 기사 20개 (메인·초기 화면에서 사용)
  async findLatest(): Promise<Article[]> {
    return this.repo.find({
      order: { publishedAt: 'DESC' },
      take: 20,
    });
  }

  // 기획기사 10개
  async findFeatured(): Promise<Article[]> {
    return this.repo.find({
      where: { isFeature: true },
      order: { publishedAt: 'DESC' },
      take: 10,
    });
  }

  // 카테고리별 기사 20개 (카테고리 화면의 "첫 페이지"용)
  async findByCategory(categoryName: string): Promise<Article[]> {
    return this.repo.find({
      where: { category: categoryName },
      order: { publishedAt: 'DESC' },
      take: 20,
    });
  }

  // 검색 (최대 50개)
  async search(keyword: string): Promise<Article[]> {
    return this.repo
      .createQueryBuilder('a')
      .where('a.title ILIKE :kw', { kw: `%${keyword}%` })
      .orWhere('a.teaser ILIKE :kw', { kw: `%${keyword}%` })
      .orWhere('a.summary ILIKE :kw', { kw: `%${keyword}%` })
      .orderBy('a.publishedAt', 'DESC')
      .limit(50)
      .getMany();
  }

  // ─────────────────────────────────
  // 여기부터 "페이지네이션용" 메서드 추가
  //   - 각 카테고리 더보기에서 page=1,2,... 로 사용
  //   - 20개 이상 데이터는 DB에만 있고, 필요할 때만 꺼내오기
  // ─────────────────────────────────

  // 내부에서 page/limit 정리용
  private normalizePageLimit(page?: number, limit?: number) {
    const rawPage = page ?? 1;
    const rawLimit = limit ?? 20;

    const safePage = Math.max(rawPage, 1);
    // 한 페이지 1~50개 사이로 제한 (원하시면 20 고정도 가능)
    const safeLimit = Math.min(Math.max(rawLimit, 1), 50);

    return { safePage, safeLimit };
  }

  // 전체 최신 기사 페이지네이션
  // 예: /articles/latest?page=1&limit=20
  async findLatestPaginated(
    page?: number,
    limit?: number,
  ): Promise<{ items: Article[]; page: number; limit: number; total: number }> {
    const { safePage, safeLimit } = this.normalizePageLimit(page, limit);

    const [items, total] = await this.repo.findAndCount({
      order: { publishedAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      items,
      page: safePage,
      limit: safeLimit,
      total,
    };
  }

  // 카테고리별 페이지네이션
  // 예: /articles/category/:category?page=1&limit=20
  async findByCategoryPaginated(
    categoryName: string,
    page?: number,
    limit?: number,
  ): Promise<{ items: Article[]; page: number; limit: number; total: number }> {
    const { safePage, safeLimit } = this.normalizePageLimit(page, limit);

    const [items, total] = await this.repo.findAndCount({
      where: { category: categoryName },
      order: { publishedAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      items,
      page: safePage,
      limit: safeLimit,
      total,
    };
  }
}
