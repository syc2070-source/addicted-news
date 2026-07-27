// Render 백엔드 읽기 전용 소비. ISR(기본 10분 재검증). 실패 시 빈 배열/ null 로 방어
// (한 엔드포인트가 죽어도 페이지 전체가 죽지 않게).

import type { Article, EncyclopediaTerm, ReportSummary } from './types';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || 'https://addicted-news-backend.onrender.com';

const REVALIDATE = 600; // 10분 (지시서 권장)

async function get<T>(path: string, fallback: T, revalidate = REVALIDATE): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { next: { revalidate } });
    if (!res.ok) {
      console.warn(`[api] ${path} → HTTP ${res.status}`);
      return fallback;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`[api] ${path} 실패:`, (e as Error).message);
    return fallback;
  }
}

// ── 기사 ──
export const getTop = () => get<Article[]>('/articles/top', []);
export const getFeatured = () => get<Article[]>('/articles/featured', []);
export const getRapha = (limit = 20) => get<Article[]>(`/articles/rapha?limit=${limit}`, []);
export const getIssue = (limit = 6) => get<Article[]>(`/articles/issue?limit=${limit}`, []);
export const getLatest = (limit = 20) => get<Article[]>(`/articles/latest?limit=${limit}`, []);
export const getByCategory = (slug: string, limit = 20) =>
  get<Article[]>(`/articles/category/${slug}?limit=${limit}`, []);
export const getArticle = (id: string | number) =>
  get<Article | null>(`/articles/${id}`, null, 300);
export const searchArticles = (q: string, limit = 30) =>
  get<Article[]>(`/articles/search?q=${encodeURIComponent(q)}&limit=${limit}`, [], 120);

// ── 백과 ──
export const getEncyclopedia = () => get<EncyclopediaTerm[]>('/encyclopedia', []);
export const getEncyclopediaTerm = (id: string) =>
  get<EncyclopediaTerm | null>(`/encyclopedia/${encodeURIComponent(id)}`, null);

// ── 리포트(슬롯) ──
export const getReports = (limit = 20) =>
  get<ReportSummary[]>(`/reports?limit=${limit}`, []);
