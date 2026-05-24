// backend/src/admin/admin.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Article } from '../articles/article.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
  ) {}

  // 전체 기사 목록 (페이징 + 검색)
  async getArticles(page: number, limit: number, category?: string, search?: string) {
    const queryBuilder = this.articleRepo.createQueryBuilder('article');
    
    queryBuilder.where('article.blocked = :blocked', { blocked: false });
    
    if (category) {
      queryBuilder.andWhere('article.category = :category', { category });
    }
    
    if (search) {
      queryBuilder.andWhere('article.title LIKE :search', { search: `%${search}%` });
    }
    
    queryBuilder.orderBy('article.publishedAt', 'DESC');
    queryBuilder.addOrderBy('article.id', 'DESC');
    queryBuilder.skip((page - 1) * limit);
    queryBuilder.take(limit);
    
    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 기사 상세
  async getArticle(id: number) {
    const article = await this.articleRepo.findOne({ where: { id } });
    if (!article) {
      throw new NotFoundException('기사를 찾을 수 없습니다');
    }
    return article;
  }

  // TOP 뉴스 설정
  async setTopNews(id: number, isTop: boolean) {
    const article = await this.getArticle(id);
    
    // 최대 3개까지만 허용
    if (isTop) {
      const count = await this.articleRepo.count({ where: { isTop: true } });
      if (count >= 3) {
        const oldest = await this.articleRepo.findOne({
          where: { isTop: true },
          order: { updatedAt: 'ASC' },
        });
        if (oldest) {
          oldest.isTop = false;
          await this.articleRepo.save(oldest);
        }
      }
    }
    
    article.isTop = isTop;
    await this.articleRepo.save(article);
    return { success: true, article };
  }

  // 기획기사 설정
  async setFeature(id: number, isFeature: boolean) {
    const article = await this.getArticle(id);
    
    // 최대 3개까지만 허용
    if (isFeature) {
      const count = await this.articleRepo.count({ where: { isFeature: true } });
      if (count >= 3) {
        const oldest = await this.articleRepo.findOne({
          where: { isFeature: true },
          order: { updatedAt: 'ASC' },
        });
        if (oldest) {
          oldest.isFeature = false;
          await this.articleRepo.save(oldest);
        }
      }
    }
    
    article.isFeature = isFeature;
    await this.articleRepo.save(article);
    return { success: true, article };
  }

  // 라파뉴스 설정
  async setRapha(id: number, isRapha: boolean, imageUrl?: string) {
    const article = await this.getArticle(id);
    
    // 최대 2개까지만 허용
    if (isRapha) {
      const count = await this.articleRepo.count({ where: { isRapha: true } });
      if (count >= 2) {
        const oldest = await this.articleRepo.findOne({
          where: { isRapha: true },
          order: { updatedAt: 'ASC' },
        });
        if (oldest) {
          oldest.isRapha = false;
          await this.articleRepo.save(oldest);
        }
      }
    }
    
    article.isRapha = isRapha;
    if (imageUrl !== undefined) {
      article.imageUrl = imageUrl;
    }
    await this.articleRepo.save(article);
    return { success: true, article };
  }

  // 중독이슈 설정
  async setIssue(id: number, isIssue: boolean) {
    const article = await this.getArticle(id);
    
    // 최대 5개까지만 허용
    if (isIssue) {
      const count = await this.articleRepo.count({ where: { isIssue: true } });
      if (count >= 5) {
        const oldest = await this.articleRepo.findOne({
          where: { isIssue: true },
          order: { updatedAt: 'ASC' },
        });
        if (oldest) {
          oldest.isIssue = false;
          await this.articleRepo.save(oldest);
        }
      }
    }
    
    article.isIssue = isIssue;
    await this.articleRepo.save(article);
    return { success: true, article };
  }

  // 카테고리 변경
  async setCategory(id: number, category: string) {
    const article = await this.getArticle(id);
    article.category = category;
    await this.articleRepo.save(article);
    return { success: true, article };
  }

  // 기사 차단
  async blockArticle(id: number, blocked: boolean, reason?: string) {
    const article = await this.getArticle(id);
    article.blocked = blocked;
    article.blockedReason = reason || null;
    await this.articleRepo.save(article);
    return { success: true, article };
  }

  // 기사 완전 삭제
  async deleteArticle(id: number) {
    const article = await this.getArticle(id);
    await this.articleRepo.remove(article);
    return { success: true, id };
  }

  // 새 기사 생성
  async createArticle(data: any) {
    const article = this.articleRepo.create({
      title: data.title,
      category: data.category,
      source: data.source,
      summary: data.summary,
      teaser: data.teaser || (data.summary ? data.summary.substring(0, 200) : ''),
      sourceUrl: data.sourceUrl || '#',
      imageUrl: data.imageUrl || null,
      publishedAt: data.publishedAt || new Date().toISOString().split('T')[0],
      isTop: data.isTop || false,
      isRapha: data.isRapha || false,
      isFeature: data.isFeature || false,
      isIssue: data.isIssue || false,
      origin: 'manual',
      lang: 'ko',
      isForeign: false,
      blocked: false,
    });
    
    const saved = await this.articleRepo.save(article);
    return { success: true, article: saved };
  }

  // 기사 수정
  async updateArticle(id: number, data: any) {
    const article = await this.getArticle(id);
    
    if (data.title !== undefined) article.title = data.title;
    if (data.category !== undefined) article.category = data.category;
    if (data.source !== undefined) article.source = data.source;
    if (data.summary !== undefined) article.summary = data.summary;
    if (data.teaser !== undefined) article.teaser = data.teaser;
    if (data.sourceUrl !== undefined) article.sourceUrl = data.sourceUrl;
    if (data.imageUrl !== undefined) article.imageUrl = data.imageUrl;
    if (data.publishedAt !== undefined) article.publishedAt = data.publishedAt;
    if (data.isTop !== undefined) article.isTop = data.isTop;
    if (data.isRapha !== undefined) article.isRapha = data.isRapha;
    if (data.isFeature !== undefined) article.isFeature = data.isFeature;
    if (data.isIssue !== undefined) article.isIssue = data.isIssue;
    
    const saved = await this.articleRepo.save(article);
    return { success: true, article: saved };
  }

  // 현재 TOP 뉴스
  async getTopNews() {
    return this.articleRepo.find({
      where: { isTop: true, blocked: false },
      order: { publishedAt: 'DESC' },
    });
  }

  // 현재 기획기사
  async getFeatures() {
    return this.articleRepo.find({
      where: { isFeature: true, blocked: false },
      order: { publishedAt: 'DESC' },
      take: 3,
    });
  }

  // 라파뉴스 목록
  async getRaphaNews() {
    return this.articleRepo.find({
      where: { isRapha: true, blocked: false },
      order: { publishedAt: 'DESC' },
      take: 2,
    });
  }

  // 중독이슈 목록
  async getIssueNews() {
    return this.articleRepo.find({
      where: { isIssue: true, blocked: false },
      order: { publishedAt: 'DESC' },
      take: 5,
    });
  }

  // 통계
  async getStats() {
    const total = await this.articleRepo.count({ where: { blocked: false } });
    const today = new Date().toISOString().split('T')[0];
    const todayCount = await this.articleRepo.count({
      where: { publishedAt: today, blocked: false },
    });
    
    const byCategory = await this.articleRepo
      .createQueryBuilder('article')
      .select('article.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('article.blocked = false')
      .groupBy('article.category')
      .getRawMany();

    const topNewsCount = await this.articleRepo.count({ where: { isTop: true, blocked: false } });
    const featureCount = await this.articleRepo.count({ where: { isFeature: true, blocked: false } });
    const raphaCount = await this.articleRepo.count({ where: { isRapha: true, blocked: false } });
    const issueCount = await this.articleRepo.count({ where: { isIssue: true, blocked: false } });

    return {
      total,
      todayCount,
      byCategory,
      topNewsCount,
      featureCount,
      raphaCount,
      issueCount,
    };
  }
}