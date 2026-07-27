import type { Metadata } from 'next';
import Corners from '@/components/Corners';
import s from './reports.module.css';

// F-1 작업3: 리포트/브리프 슬롯 예약. 형식 미확정(추후 스태토리 세션에서 확정).
// 지금은 절제된 빈 상태 페이지만. 리포트 카드/상세 레이아웃은 의도적으로 만들지 않는다.
//
// 연결 지점(TODO, 형식 확정 후):
//   - 데이터: lib/api.getReports() (GET /reports) 응답 스키마 확정 → ReportSummary 확장
//   - 렌더: article_type='report'|'brief' 분기(lib/articleType.ts 참고). 현재는 'news'만 구현.
//   - DB: 백엔드 무수정 원칙 → 필요 스키마는 보고서 "다음 사이클 제안"에 기재.

export const metadata: Metadata = {
  title: '리포트',
  description: '스태토리 랩 리포트 (준비 중)',
};

export default function ReportsPage() {
  return (
    <section className={s.wrap}>
      <div className={`blueprint ${s.card}`}>
        <Corners />
        <span className="kicker">Statory Lab</span>
        <h1 className={s.title}>리포트</h1>
        <p className={s.body}>스태토리 랩 리포트가 준비 중입니다.</p>
        <p className={s.sub}>데이터·통계 기반 심층 리포트를 이 자리에서 제공할 예정입니다.</p>
      </div>
    </section>
  );
}
