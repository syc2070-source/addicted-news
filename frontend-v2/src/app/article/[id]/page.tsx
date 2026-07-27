import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Thumb from '@/components/Thumb';
import { getArticle } from '@/lib/api';
import { displaySummary } from '@/lib/summary';
import { fmtDate } from '@/lib/format';
import { CATEGORIES } from '@/lib/categories';
import s from './article.module.css';

// 표시명 → slug 역매핑(카테고리 링크용).
function categorySlugOf(name: string): string {
  return CATEGORIES.find((c) => c.name === name)?.slug ?? '';
}

export const revalidate = 300;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const a = await getArticle(params.id);
  if (!a) return { title: '기사를 찾을 수 없습니다' };
  const desc = displaySummary(a).slice(0, 160);
  return {
    title: a.title,
    description: desc,
    openGraph: {
      title: a.title, description: desc, type: 'article',
      images: a.imageUrl ? [a.imageUrl] : undefined,
    },
  };
}

export default async function ArticlePage({ params }: { params: { id: string } }) {
  const a = await getArticle(params.id);
  if (!a) notFound();

  return (
    <article className={s.article}>
      <span className={s.cat}>{a.category}</span>
      <h1 className={s.title}>{a.title}</h1>
      {a.originalTitle && a.originalTitle !== a.title && (
        <p className={s.orig}>{a.originalTitle}</p>
      )}
      <div className={s.meta}>
        <span>{fmtDate(a.publishedAt)}</span>
        <span>{a.source}</span>
        {a.isForeign && <span>해외</span>}
      </div>

      {a.imageUrl && <Thumb src={a.imageUrl} alt={a.title} category={a.category} ratio="16/9" className={s.hero} />}

      <div className={s.summary}>
        {displaySummary(a).split('\n').filter(Boolean).map((para, i) => <p key={i}>{para}</p>)}
      </div>

      {a.keywords && a.keywords.length > 0 && (
        <div className={s.tags}>
          {a.keywords.slice(0, 8).map((k) => <span key={k} className="tag tag-neutral">{k}</span>)}
        </div>
      )}

      <div className={s.sourceRow}>
        <a className="btn btn-primary" href={a.sourceUrl} target="_blank" rel="noopener noreferrer">원문 보기</a>
        {categorySlugOf(a.category) && (
          <Link className="btn btn-secondary" href={`/category/${categorySlugOf(a.category)}`}>{a.category} 더 보기</Link>
        )}
      </div>

      <p className={s.disclaimer}>요약은 중독뉴스 편집 기준에 따라 정리한 것으로, 자세한 내용은 원문을 확인하세요.</p>
    </article>
  );
}
