// G6: 요약 플레이스홀더가 화면에 노출되지 않도록 폴백.
// 규칙(메모 확정): summary(플레이스홀더/빈값이면) → teaser → title.
// 백엔드에 원문 body 컬럼이 없으므로 teaser가 사실상 유일한 대체 본문.

import type { Article } from './types';

// 관측된 플레이스홀더/부실 요약 패턴. 하나라도 걸리면 폴백.
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /추가\s*확인할?\s*필요가?\s*있습니다/,
  /확인이\s*필요합니다/,
  /요약\s*(생성|준비)\s*중/,
  /^n\/?a$/i,
  /^-+$/,
];

export function isPlaceholder(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (t.length < 8) return true; // 사실상 빈 값
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

/** 화면에 보여줄 안전한 요약 텍스트(플레이스홀더 0건 보장). */
export function displaySummary(article: Pick<Article, 'summary' | 'teaser' | 'title'>): string {
  if (!isPlaceholder(article.summary)) return article.summary!.trim();
  if (!isPlaceholder(article.teaser)) return article.teaser!.trim();
  return article.title.trim();
}
