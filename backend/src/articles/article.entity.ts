// backend/src/articles/article.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('articles')
export class Article {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ name: 'original_title', type: 'varchar', length: 500, nullable: true })
  originalTitle: string | null;

  @Column({ type: 'text', nullable: true })
  teaser: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'varchar', length: 100 })
  category: string;

  @Column({ type: 'varchar', length: 20, default: 'KR' })
  region: string;

  @Column({ type: 'varchar', length: 100 })
  source: string;

  @Column({ name: 'source_url', type: 'varchar', length: 2000 })
  sourceUrl: string;

  @Column({ name: 'google_url', type: 'varchar', length: 2000, nullable: true })
  googleUrl: string | null;

  @Column({ type: 'varchar', length: 50, default: 'crawler' })
  origin: string;

  @Column({ name: 'is_top', type: 'boolean', default: false })
  isTop: boolean;

  @Column({ name: 'is_feature', type: 'boolean', default: false })
  isFeature: boolean;

  @Column({ name: 'is_rapha', type: 'boolean', default: false })
  isRapha: boolean;

  @Column({ name: 'is_issue', type: 'boolean', default: false })
  isIssue: boolean;

  @Column({ name: 'image_url', type: 'varchar', length: 2000, nullable: true })
  imageUrl: string | null;

  @Column({ name: 'published_at', type: 'varchar', length: 50 })
  publishedAt: string;

  @Column({ type: 'varchar', length: 10, default: 'ko' })
  lang: string;

  @Column({ name: 'is_foreign', type: 'boolean', default: false })
  isForeign: boolean;

  @Column({ name: 'source_type', type: 'varchar', length: 32, nullable: true })
  sourceType: string | null;

  @Column({ name: 'outlet_id', type: 'varchar', length: 100, nullable: true })
  outletId: string | null;

  @Column({ type: 'simple-array', nullable: true })
  keywords: string[] | null;

  @Column({ type: 'boolean', default: false })
  blocked: boolean;

  @Column({ name: 'blocked_reason', type: 'varchar', length: 200, nullable: true })
  blockedReason: string | null;

  // v5.4: 판정 상태. 'restored_manual' 이면 judge_cleanup 재심사에서 제외.
  @Column({ name: 'judge_status', type: 'varchar', length: 32, nullable: true })
  judgeStatus: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}