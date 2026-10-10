// backend/src/articles/articles.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, LessThan, Like, Not, Or, Repository } from 'typeorm';
import { Article } from './article.entity';
import { columnExists } from '../crawler/schema_probe';
import { fieldProfile } from '../crawler/field_profile';

/** 카테고리 slug → 이름(분야 설정 categories.slugs · NEWS-Q2 ■1). */
export function categoryKeyFor(slug: string): string {
  return fieldProfile().categories.slugs[slug] || slug;
}

/** 공개 목록 종류: 기본은 기사만, 방송은 ?kind=broadcast 로만(NEWS-Q1 ■4ⓓ). */
export type ArticleKind = 'article' | 'broadcast';

export function parseKind(value?: string): ArticleKind {
  return value === 'broadcast' ? 'broadcast' : 'article';
}

/** 관문 층: 기본 publish, 보관은 ?tier=archive 로만(NEWS-Q2 ■6). */
export type ArticleTier = 'publish' | 'archive';

export function parseTier(value?: string): ArticleTier {
  return value === 'archive' ? 'archive' : 'publish';
}

export interface VisibleOpts {
  kind: ArticleKind;
  deletedAtAvailable: boolean;
  tier?: ArticleTier;
  tierAvailable?: boolean;
}

/**
 * 공개 조회 공통 조건.
 *  · blocked=false (기존)
 *  · 종류: 방송 = source_type 'broadcast', 기사 = 그 밖(NULL 포함)
 *  · deleted_at 열이 있으면 deleted_at IS NULL 만(soft 삭제 숨김, NEWS-Q1 ■1ⓑ)
 *  · tier 열이 있으면 요청한 층만(기본 publish). 열이 없으면 publish 만 있는 셈 → archive 요청은 빈 결과.
 */
export function visibleWhere(extra: FindOptionsWhere<Article>, opts: VisibleOpts): FindOptionsWhere<Article> {
  const where: FindOptionsWhere<Article> = {
    ...extra,
    blocked: false,
    sourceType: opts.kind === 'broadcast' ? 'broadcast' : Or(IsNull(), Not('broadcast')),
  };
  if (opts.deletedAtAvailable) where.deletedAt = IsNull();
  const tier = opts.tier || 'publish';
  if (opts.tierAvailable) where.tier = tier;
  else if (tier === 'archive') where.id = LessThan(0);
  return where;
}

/** 「최신」 표시(NEWS-Q2 ■7): 보도 시각(없으면 보도 날짜 KST 0시)이 freshness_hours 안이면 true. 지우지 않는다. */
export function isFresh(publishedTs: Date | null | undefined, publishedAt: string | Date | null | undefined, hours: number, now = new Date()): boolean {
  let t = publishedTs ? new Date(publishedTs).getTime() : NaN;
  if (Number.isNaN(t) && publishedAt) {
    // published_at 은 DB 에서 date 로 읽혀 Date 가 올 수 있다(API 응답 꼴 2026-10-09T00:00:00.000Z).
    const ymd = (publishedAt instanceof Date ? publishedAt.toISOString() : String(publishedAt)).slice(0, 10);
    t = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? Date.parse(`${ymd}T00:00:00+09:00`) : Date.parse(String(publishedAt));
  }
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= hours * 3600 * 1000 && t <= now.getTime() + 3600 * 1000;
}

type Flags = { deletedAt: boolean; tier: boolean; publishedTs: boolean };

@Injectable()
export class ArticlesService implements OnModuleInit {
  private readonly logger = new Logger(ArticlesService.name);
  private flags: Flags = { deletedAt: false, tier: false, publishedTs: false };

  constructor(
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
  ) {}

  async onModuleInit() {
    await this.refreshSchemaFlags();
  }

  /** 묶음 SQL 열이 섰는지 확인(시작할 때 한 번). 확인 실패는 "없음"(옛 동작). */
  async refreshSchemaFlags() {
    const q = (sql: string, params?: unknown[]) => this.articleRepo.query(sql, params);
    const [deletedAt, tier, publishedTs] = await Promise.all([
      columnExists(q, 'articles', 'deleted_at'),
      columnExists(q, 'articles', 'tier'),
      columnExists(q, 'articles', 'published_ts'),
    ]);
    this.flags = { deletedAt, tier, publishedTs };
    this.logger.log(
      `articles 열: deleted_at ${deletedAt ? '있음(soft 삭제 숨김)' : '없음'} · tier ${tier ? '있음(보관 숨김)' : '없음'} · ` +
      `published_ts ${publishedTs ? '있음' : '없음'}`,
    );
  }

  private where(extra: FindOptionsWhere<Article> = {}, kind: ArticleKind = 'article', tier: ArticleTier = 'publish') {
    return visibleWhere(extra, {
      kind, tier, deletedAtAvailable: this.flags.deletedAt, tierAvailable: this.flags.tier,
    });
  }

  /** 응답에 publishedTs(열 있을 때)·isFresh 칸을 붙인다. */
  private async decorate<T extends Article>(items: T[]): Promise<Array<T & { publishedTs: Date | null; isFresh: boolean }>> {
    const hours = fieldProfile().freshness_hours;
    const ts = new Map<number, Date | null>();
    if (this.flags.publishedTs && items.length) {
      try {
        const rows: Array<{ id: number; published_ts: Date | null }> = await this.articleRepo.query(
          `SELECT id, published_ts FROM articles WHERE id = ANY($1::int[])`,
          [items.map((a) => a.id)],
        );
        for (const r of rows) ts.set(Number(r.id), r.published_ts);
      } catch (e) {
        this.logger.warn(`published_ts 읽기 실패(날짜로 대신): ${(e as Error).message}`);
      }
    }
    return items.map((a) => {
      const p = ts.get(a.id) ?? null;
      return Object.assign(a, { publishedTs: p, isFresh: isFresh(p, a.publishedAt, hours) });
    });
  }

  private async decorateOne<T extends Article>(a: T | null) {
    if (!a) return a;
    const [d] = await this.decorate([a]);
    return d;
  }

  // 최신 기사
  async getLatest(limit: number, kind: ArticleKind = 'article', tier: ArticleTier = 'publish') {
    return this.decorate(await this.articleRepo.find({
      where: this.where({}, kind, tier),
      order: { publishedAt: 'DESC', id: 'DESC' },
      take: limit,
    }));
  }

  // TOP 뉴스
  async getTopNews() {
    return this.decorate(await this.articleRepo.find({
      where: this.where({ isTop: true }),
      order: { publishedAt: 'DESC' },
      take: 3,
    }));
  }

  // 기획기사
  async getFeatured() {
    return this.decorate(await this.articleRepo.find({
      where: this.where({ isFeature: true }),
      order: { publishedAt: 'DESC' },
      take: 5,
    }));
  }

  // 라파뉴스
  async getRaphaNews() {
    return this.decorate(await this.articleRepo.find({
      where: this.where({ isRapha: true }),
      order: { publishedAt: 'DESC' },
      take: 2,
    }));
  }

  // 이슈
  async getIssueNews(limit: number = 5) {
    return this.decorate(await this.articleRepo.find({
      where: this.where({ isIssue: true }),
      order: { publishedAt: 'DESC' },
      take: limit,
    }));
  }

  // 카테고리별 기사
  async getByCategory(slug: string, limit: number, kind: ArticleKind = 'article', tier: ArticleTier = 'publish') {
    return this.decorate(await this.articleRepo.find({
      where: this.where({ category: categoryKeyFor(slug) }, kind, tier),
      order: { publishedAt: 'DESC', id: 'DESC' },
      take: limit,
    }));
  }

  // 카테고리별 기사 (페이징)
  async getByCategoryPaged(slug: string, page: number, limit: number, kind: ArticleKind = 'article', tier: ArticleTier = 'publish') {
    const [items, total] = await this.articleRepo.findAndCount({
      where: this.where({ category: categoryKeyFor(slug) }, kind, tier),
      order: { publishedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: await this.decorate(items),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 기사 검색
  async search(q: string, limit: number, kind: ArticleKind = 'article', tier: ArticleTier = 'publish') {
    if (!q || q.trim().length < 2) {
      return [];
    }
    return this.decorate(await this.articleRepo.find({
      where: [
        this.where({ title: Like(`%${q}%`) }, kind, tier),
        this.where({ summary: Like(`%${q}%`) }, kind, tier),
      ],
      order: { publishedAt: 'DESC' },
      take: limit,
    }));
  }

  // 최신 기사 (페이징)
  async getLatestPaged(page: number, limit: number, kind: ArticleKind = 'article', tier: ArticleTier = 'publish') {
    const [items, total] = await this.articleRepo.findAndCount({
      where: this.where({}, kind, tier),
      order: { publishedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: await this.decorate(items),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 기사 상세 (종류·층 무관 · soft 삭제는 숨김)
  async getOne(id: number) {
    const where: FindOptionsWhere<Article> = { id, blocked: false };
    if (this.flags.deletedAt) where.deletedAt = IsNull();
    return this.decorateOne(await this.articleRepo.findOne({ where }));
  }
}
