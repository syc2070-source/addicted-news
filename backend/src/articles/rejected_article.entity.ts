// backend/src/articles/rejected_article.entity.ts
// v5.4: 입구 게이트에서 거부된 기사 격리 테이블(하드 삭제 금지 원칙).
// articles 와 동일 핵심 스키마 + reject_reason/confidence/judged_at.
// 보존 90일 후 cron 자동 삭제. 오판 감사·프롬프트 개선 소재 축적용.
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('rejected_articles')
export class RejectedArticle {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ name: 'original_title', type: 'varchar', length: 500, nullable: true })
  originalTitle: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  source: string | null;

  @Column({ name: 'source_url', type: 'varchar', length: 2000, nullable: true })
  sourceUrl: string | null;

  @Column({ name: 'google_url', type: 'varchar', length: 2000, nullable: true })
  googleUrl: string | null;

  @Column({ name: 'published_at', type: 'varchar', length: 50, nullable: true })
  publishedAt: string | null;

  @Column({ type: 'varchar', length: 10, default: 'ko' })
  lang: string;

  @Column({ name: 'source_type', type: 'varchar', length: 32, nullable: true })
  sourceType: string | null;

  // v5.4: 거부 사유(incident / category_fit=false / low_confidence 등)
  @Column({ name: 'reject_reason', type: 'varchar', length: 200 })
  rejectReason: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  confidence: string | null; // high|medium|low

  @Column({ name: 'judged_at', type: 'timestamp', nullable: true })
  judgedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
