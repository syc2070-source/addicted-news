// backend/src/articles/articles.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Like, Not, Or, Repository } from 'typeorm';
import { Article } from './article.entity';
import { columnExists } from '../crawler/schema_probe';

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

/** 공개 목록 종류: 기본은 기사만, 방송은 ?kind=broadcast 로만(NEWS-Q1 ■4ⓓ). */
export type ArticleKind = 'article' | 'broadcast';

export function parseKind(value?: string): ArticleKind {
  return value === 'broadcast' ? 'broadcast' : 'article';
}

/**
 * 공개 조회 공통 조건.
 *  · blocked=false (기존)
 *  · 종류: 방송 = source_type 'broadcast', 기사 = 그 밖(NULL 포함)
 *  · deleted_at 열이 있으면 deleted_at IS NULL 만(soft 삭제 숨김, NEWS-Q1 ■1ⓑ)
 */
export function visibleWhere(
  extra: FindOptionsWhere<Article>,
  opts: { kind: ArticleKind; deletedAtAvailable: boolean },
): FindOptionsWhere<Article> {
  const where: FindOptionsWhere<Article> = {
    ...extra,
    blocked: false,
    sourceType: opts.kind === 'broadcast' ? 'broadcast' : Or(IsNull(), Not('broadcast')),
  };
  if (opts.deletedAtAvailable) where.deletedAt = IsNull();
  return where;
}

@Injectable()
export class ArticlesService implements OnModuleInit {
  private readonly logger = new Logger(ArticlesService.name);
  private deletedAtAvailable = false;

  constructor(
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
  ) {}

  async onModuleInit() {
    await this.refreshSchemaFlags();
  }

  /** deleted_at 열이 있는지 확인(묶음 SQL 적용 여부). 확인 실패는 "없음"(옛 동작). */
  async refreshSchemaFlags() {
    this.deletedAtAvailable = await columnExists(
      (sql, params) => this.articleRepo.query(sql, params),
      'articles',
      'deleted_at',
    );
    this.logger.log(`articles.deleted_at ${this.deletedAtAvailable ? '있음 → soft 삭제 숨김 켬' : '없음 → 옛 동작'}`);
  }

  private where(extra: FindOptionsWhere<Article> = {}, kind: ArticleKind = 'article') {
    return visibleWhere(extra, { kind, deletedAtAvailable: this.deletedAtAvailable });
  }

  // 최신 기사
  async getLatest(limit: number, kind: ArticleKind = 'article') {
    return this.articleRepo.find({
      where: this.where({}, kind),
      order: { publishedAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  // TOP 뉴스
  async getTopNews() {
    return this.articleRepo.find({
      where: this.where({ isTop: true }),
      order: { publishedAt: 'DESC' },
      take: 3,
    });
  }

  // 기획기사
  async getFeatured() {
    return this.articleRepo.find({
      where: this.where({ isFeature: true }),
      order: { publishedAt: 'DESC' },
      take: 5,
    });
  }

  // 라파뉴스
  async getRaphaNews() {
    return this.articleRepo.find({
      where: this.where({ isRapha: true }),
      order: { publishedAt: 'DESC' },
      take: 2,
    });
  }

  // 중독이슈
  async getIssueNews(limit: number = 5) {
    return this.articleRepo.find({
      where: this.where({ isIssue: true }),
      order: { publishedAt: 'DESC' },
      take: limit,
    });
  }

  // 카테고리별 기사
  async getByCategory(slug: string, limit: number, kind: ArticleKind = 'article') {
    const categoryKey = CATEGORY_MAP[slug] || slug;
    return this.articleRepo.find({
      where: this.where({ category: categoryKey }, kind),
      order: { publishedAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  // 카테고리별 기사 (페이징)
  async getByCategoryPaged(slug: string, page: number, limit: number, kind: ArticleKind = 'article') {
    const categoryKey = CATEGORY_MAP[slug] || slug;
    const [items, total] = await this.articleRepo.findAndCount({
      where: this.where({ category: categoryKey }, kind),
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
  async search(q: string, limit: number, kind: ArticleKind = 'article') {
    if (!q || q.trim().length < 2) {
      return [];
    }
    return this.articleRepo.find({
      where: [
        this.where({ title: Like(`%${q}%`) }, kind),
        this.where({ summary: Like(`%${q}%`) }, kind),
      ],
      order: { publishedAt: 'DESC' },
      take: limit,
    });
  }

  // 최신 기사 (페이징)
  async getLatestPaged(page: number, limit: number, kind: ArticleKind = 'article') {
    const [items, total] = await this.articleRepo.findAndCount({
      where: this.where({}, kind),
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

  // 기사 상세 (종류 무관 · soft 삭제는 숨김)
  async getOne(id: number) {
    const where: FindOptionsWhere<Article> = { id, blocked: false };
    if (this.deletedAtAvailable) where.deletedAt = IsNull();
    return this.articleRepo.findOne({ where });
  }
}
