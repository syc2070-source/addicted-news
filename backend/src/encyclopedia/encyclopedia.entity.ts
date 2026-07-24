import { Entity, PrimaryColumn, Column } from 'typeorm';

// Article 과 완전히 분리된 독립 엔티티. 컬럼명은 DDL(snake_case)과 1:1로 명시해 모호함 제거.
@Entity('encyclopedia_terms')
export class EncyclopediaTerm {
  @PrimaryColumn({ type: 'text' })
  id: string; // slug

  @Column({ name: 'term_ko', type: 'text' })
  termKo: string;

  @Column({ name: 'term_en', type: 'text' })
  termEn: string;

  @Column({ type: 'text' })
  category: string;

  @Column({ type: 'text' })
  definition: string;

  @Column({ type: 'text', default: '' })
  example: string;

  @Column({ name: 'see_also', type: 'jsonb', default: () => "'[]'" })
  seeAlso: string[];

  @Column({ type: 'boolean', default: false })
  trend: boolean;

  @Column({ type: 'boolean', default: false })
  sensitive: boolean;

  @Column({ name: 'video_url', type: 'text', nullable: true })
  videoUrl: string | null;

  @Column({ name: 'video_status', type: 'text', default: 'pending' })
  videoStatus: string;

  // v2 작업3: 유튜브 업로드 성공 시 채워지는 영상 ID(백과 페이지 임베드용). 없으면 미표시.
  @Column({ name: 'youtube_video_id', type: 'text', nullable: true })
  youtubeVideoId: string | null;

  @Column({ type: 'boolean', default: true })
  published: boolean;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;

  @Column({ name: 'body', type: 'jsonb', default: () => "'[]'" })
  body: { h: string; p: string }[];

  @Column({ name: 'advanced', type: 'jsonb', default: () => "'[]'" })
  advanced: { h: string; p: string }[];

  @Column({ name: 'definition_en', type: 'text', default: '' })
  definitionEn: string;

  @Column({ name: 'example_en', type: 'text', default: '' })
  exampleEn: string;

  @Column({ name: 'body_en', type: 'jsonb', default: () => "'[]'" })
  bodyEn: { h: string; p: string }[];

  @Column({ name: 'advanced_en', type: 'jsonb', default: () => "'[]'" })
  advancedEn: { h: string; p: string }[];
}
