// backend/src/articles/articles.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Article } from './article.entity';

// 카테고리 slug → key 매핑
const CATEGORY_MAP: Record<string, string> = {
  policy: '중독정책',
  alcohol: '알코올·약물중독',
  gambling: '도박중독',
  game: '게임·디지털중독',
  ai: 'AI중독',
  community: '공동체',
  religion: '종교',
  issue: '중독사회와 회복',
};

@Injectable()
export class ArticlesService {
  constructor(
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
  ) {}

  // 최신 기사
  async getLatest(limit: number) {
    return this.articleRepo.find({
      where: { blocked: false },
      order: { publishedAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  // TOP 뉴스
  async getTopNews() {
    return this.articleRepo.find({
      where: { isTop: true, blocked: false },
      order: { publishedAt: 'DESC' },
      take: 3,
    });
  }

  // 기획기사
  async getFeatured() {
    return this.articleRepo.find({
      where: { isFeature: true, blocked: false },
      order: { publishedAt: 'DESC' },
      take: 5,
    });
  }

  // 라파뉴스
  async getRaphaNews() {
    return this.articleRepo.find({
      where: { isRapha: true, blocked: false },
      order: { publishedAt: 'DESC' },
      take: 2,
    });
  }

  // 중독이슈
  async getIssueNews(limit: number = 5) {
    return this.articleRepo.find({
      where: { isIssue: true, blocked: false },
      order: { publishedAt: 'DESC' },
      take: limit,
    });
  }

  // 카테고리별 기사
  async getByCategory(slug: string, limit: number) {
    const categoryKey = CATEGORY_MAP[slug] || slug;
    return this.articleRepo.find({
      where: { category: categoryKey, blocked: false },
      order: { publishedAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  // 카테고리별 기사 (페이징)
  async getByCategoryPaged(slug: string, page: number, limit: number) {
    const categoryKey = CATEGORY_MAP[slug] || slug;
    const [items, total] = await this.articleRepo.findAndCount({
      where: { category: categoryKey, blocked: false },
      order: { publishedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 기사 검색
  async search(q: string, limit: number) {
    if (!q || q.trim().length < 2) {
      return [];
    }
    return this.articleRepo.find({
      where: [
        { title: Like(`%${q}%`), blocked: false },
        { summary: Like(`%${q}%`), blocked: false },
      ],
      order: { publishedAt: 'DESC' },
      take: limit,
    });
  }

  // 최신 기사 (페이징)
  async getLatestPaged(page: number, limit: number) {
    const [items, total] = await this.articleRepo.findAndCount({
      where: { blocked: false },
      order: { publishedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 기사 상세
  async getOne(id: number) {
    return this.articleRepo.findOne({
      where: { id, blocked: false },
    });
  }
}