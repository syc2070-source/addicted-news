// backend/src/articles/article.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('articles')
export class Article {
  @PrimaryGeneratedColumn()
  id!: number;

  /**
   * title: 화면 표시용 제목 (한국어)
   * - 한국어 기사: 원문(title) 그대로
   * - 외국어 기사: 번역된 한국어 제목 저장
   */
  @Column({ type: 'text' })
  title!: string;

  /**
   * original_title: 원문 제목 보관(영/중/일/기타)
   */
  @Column({ name: 'original_title', type: 'text', nullable: true })
  originalTitle?: string | null;

  @Column({ type: 'text', nullable: true })
  teaser?: string | null;

  /**
   * summary: 3줄 한국어 요약(줄바꿈 포함)
   */
  @Column({ type: 'text' })
  summary!: string;

  @Column({ type: 'varchar', length: 80 })
  category!: string;

  @Column({ type: 'varchar', length: 80 })
  region!: string;

  @Column({ type: 'varchar', length: 160 })
  source!: string;

  @Index()
  @Column({ name: 'source_url', type: 'text' })
  sourceUrl!: string;

  @Index()
  @Column({ name: 'google_url', type: 'text', nullable: true })
  googleUrl?: string | null;

  @Column({ type: 'varchar', length: 40, default: 'crawler' })
  origin!: string;

  @Column({ name: 'is_top', type: 'boolean', default: false })
  isTop!: boolean;

  @Column({ name: 'is_feature', type: 'boolean', default: false })
  isFeature!: boolean;

  /**
   * published_at: YYYY-MM-DD
   */
  @Index()
  @Column({ name: 'published_at', type: 'varchar', length: 10 })
  publishedAt!: string;

  /**
   * lang / is_foreign
   */
  @Column({ type: 'varchar', length: 10, default: 'ko' })
  lang!: string;

  @Column({ name: 'is_foreign', type: 'boolean', default: false })
  isForeign!: boolean;

  /**
   * keywords: 한국어 키워드 배열
   */
  @Column({ type: 'text', array: true, nullable: true })
  keywords?: string[] | null;

  /**
   * blocked / blocked_reason
   */
  @Column({ type: 'boolean', default: false })
  blocked!: boolean;

  @Column({ name: 'blocked_reason', type: 'text', nullable: true })
  blockedReason?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
