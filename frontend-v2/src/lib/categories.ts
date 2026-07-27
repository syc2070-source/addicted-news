// 카테고리 slug ↔ 표시명. 백엔드 CATEGORY_MAP(articles.service.ts)과 1:1 일치.
// 소스에서 확인한 값만 사용(추측 금지).

export interface CategoryDef {
  slug: string; // /articles/category/:slug 에 쓰는 영문 키
  name: string; // 한국어 표시명(백엔드 category 값과 동일)
  short: string; // 네비/모듈 헤더용 짧은 라벨
}

// F-1 네비게이션 5개 카테고리(지시서 명시).
export const CATEGORIES: CategoryDef[] = [
  { slug: 'policy', name: '중독정책', short: '중독정책' },
  { slug: 'alcohol', name: '알코올·약물중독', short: '알코올·약물' },
  { slug: 'gambling', name: '도박중독', short: '도박중독' },
  { slug: 'game', name: '게임·디지털중독', short: '게임·디지털' },
  { slug: 'issue', name: '중독사회와 회복', short: '중독사회와 회복' },
];

// 홈 4열 카테고리 모듈(1a): 앞 4개(중독정책/알코올·약물/도박중독/게임·디지털).
export const HOME_CATEGORY_MODULES = CATEGORIES.slice(0, 4);

export const CATEGORY_BY_SLUG: Record<string, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c]),
);

export function categoryName(slug: string): string {
  return CATEGORY_BY_SLUG[slug]?.name ?? slug;
}
