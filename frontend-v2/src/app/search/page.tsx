import type { Metadata } from 'next';
import ArticleList from '@/components/ArticleList';
import { searchArticles } from '@/lib/api';

export const metadata: Metadata = { title: '검색' };

// 검색은 쿼리 의존 → 동적 렌더.
export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? '').trim();
  const results = q ? await searchArticles(q, 30) : [];

  return (
    <section>
      <div className="section-head"><h1 style={{ fontSize: 28 }}>검색{q ? `: “${q}”` : ''}</h1></div>
      {!q ? (
        <p style={{ color: 'var(--color-neutral-600)' }}>검색어를 입력하세요.</p>
      ) : (
        <>
          <p style={{ color: 'var(--color-neutral-600)', fontSize: 13, marginBottom: 12 }}>{results.length}건</p>
          <ArticleList articles={results} />
        </>
      )}
    </section>
  );
}
