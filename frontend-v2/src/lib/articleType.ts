// F-1 작업3: article_type 예약 + 렌더링 분기 '연결 지점'.
// 현재는 'news'만 실제 렌더. report/brief는 형식 확정 후 여기서 분기한다.
import type { Article, ArticleType } from './types';

export function articleTypeOf(a: Pick<Article, 'article_type'>): ArticleType {
  return a.article_type ?? 'news'; // 백엔드 미제공 → 기본 news
}

// TODO(스태토리 세션에서 형식 확정 후):
//   switch (articleTypeOf(a)) {
//     case 'report': return <ReportLayout .../>;  // 미구현 — 리포트 상세 레이아웃
//     case 'brief':  return <BriefLayout .../>;   // 미구현 — 브리프 레이아웃
//     case 'news':
//     default:       return <NewsLayout .../>;    // 현재 구현된 기사 상세
//   }
// DB에 article_type 컬럼 추가 필요(백엔드 무수정 원칙 → 다음 사이클).
