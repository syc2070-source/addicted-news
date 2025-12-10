import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'articles' })
export class Article {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ length: 300 })
  title: string;

  // ★ 여기서 문제가 되었던 부분: union 타입 제거
  @Column({ length: 500, nullable: true })
  teaser?: string; // string | null 대신 이렇게

  @Column({ type: 'text' })
  summary: string;

  @Column({ length: 50 })
  category: string;

  @Column({ length: 10 })
  region: string;

  @Column({ length: 150 })
  source: string;

  @Column({ name: 'source_url', length: 500 })
  sourceUrl: string;

  @Column({ length: 20, default: 'crawler' })
  origin: string;

  @Column({ name: 'is_top', type: 'boolean', default: false })
  isTop: boolean;

  @Column({ name: 'is_feature', type: 'boolean', default: false })
  isFeature: boolean;

  @Column({ name: 'published_at', type: 'date' })
  publishedAt: string; // 'YYYY-MM-DD' 문자열로 다뤄도 됨

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'NOW()',
  })
  createdAt: Date;

  @Column({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'NOW()',
  })
  updatedAt: Date;
}
