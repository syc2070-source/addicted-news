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

  // 전체 최신 20개
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

  // 최신 기사 20개
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

  // 카테고리별 기사 20개
  async findByCategory(categoryName: string): Promise<Article[]> {
    return this.repo.find({
      where: { category: categoryName },
      order: { publishedAt: 'DESC' },
      take: 20,
    });
  }
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

}
