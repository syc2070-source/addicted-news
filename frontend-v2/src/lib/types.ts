// 백엔드(Render API) 응답 타입. 백엔드 무수정 — 실제 컬럼(article.entity)에 맞춤.

// F-1 작업3: 프론트에만 예약. 백엔드엔 아직 컬럼 없음(보고서 "다음 사이클 제안").
export type ArticleType = 'news' | 'report' | 'brief';

export interface Article {
  id: number;
  title: string;
  originalTitle: string | null;
  teaser: string | null;
  summary: string | null;
  category: string;
  region: string;
  source: string;
  sourceUrl: string;
  googleUrl: string | null;
  isTop: boolean;
  isFeature: boolean;
  isRapha: boolean;
  isIssue: boolean;
  imageUrl: string | null;
  publishedAt: string;
  lang: string;
  isForeign: boolean;
  keywords: string[] | null;

  // ── 스키마만 예약(현재 백엔드 미제공, nullable) ──
  title_en?: string | null;
  summary_en?: string | null;
  article_type?: ArticleType; // 미제공 시 'news'로 취급
}

export interface EncyclopediaSection {
  h: string;
  p: string;
}

export interface EncyclopediaTerm {
  id: string;
  termKo: string;
  termEn: string;
  category: string;
  definition: string;
  example: string;
  body: EncyclopediaSection[];
  advanced: EncyclopediaSection[];
  seeAlso?: string[];
  sensitive?: boolean;
  videoUrl?: string | null;
  videoStatus?: string;
  youtubeVideoId?: string | null;
  published?: boolean;
  related?: Array<{ id: string; termKo: string; termEn: string; category: string }>;
}

// /reports 응답 형식은 미확정(작업3 슬롯). 최소한만 예약.
export interface ReportSummary {
  id: number | string;
  title?: string;
  publishedAt?: string;
  [k: string]: unknown;
}
