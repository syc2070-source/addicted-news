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

  // Excluded from ordinary API/duplicate-check SELECTs until the owner applies v5.5.
  // The desktop exporter reads the complete row explicitly.
  @Column({ name: 'raw_body', type: 'text', nullable: true, select: false })
  rawBody: string | null;

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

  // NEWS-Q1: soft 삭제 시각. 열은 오너가 묶음 SQL(docs/governance/sql)로 추가한다.
  // 열이 없어도 깨지지 않게 SELECT/INSERT/UPDATE 에서 빼 두고, 조건(where)에만
  // 쓴다 — 그것도 ArticlesService 가 열 존재를 확인한 뒤에만.
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true, select: false, insert: false, update: false })
  deletedAt: Date | null;

  // NEWS-Q2 묶음 SQL 2 — 열이 없을 수 있어 SELECT·INSERT·UPDATE 에 섞지 않는다(있을 때만 따로 읽고 씀).
  @Column({ type: 'text', nullable: true, select: false, insert: false, update: false })
  tier: string | null;

  @Column({ name: 'published_ts', type: 'timestamptz', nullable: true, select: false, insert: false, update: false })
  publishedTs: Date | null;

  @Column({ name: 'source_grade', type: 'text', nullable: true, select: false, insert: false, update: false })
  sourceGrade: string | null;

  @Column({ name: 'url_resolve', type: 'jsonb', nullable: true, select: false, insert: false, update: false })
  urlResolve: any; // jsonb(url_resolve.ts UrlResolveState) — 엔티티로는 읽고 쓰지 않음

  // NEWS-Q3 묶음 SQL 3 — 사건 묶음(가장 이른 보도의 id · 묶음 기사 수). 열 확인 뒤 raw SQL 로만 읽고 쓴다.
  @Column({ name: 'cluster_id', type: 'text', nullable: true, select: false, insert: false, update: false })
  clusterIdCol: string | null;

  @Column({ name: 'cluster_size', type: 'int', nullable: true, select: false, insert: false, update: false })
  clusterSizeCol: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
