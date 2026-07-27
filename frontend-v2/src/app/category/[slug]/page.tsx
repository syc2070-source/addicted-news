import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ArticleList from '@/components/ArticleList';
import { getByCategory } from '@/lib/api';
import { CATEGORY_BY_SLUG, CATEGORIES } from '@/lib/categories';

export const revalidate = 600;

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const cat = CATEGORY_BY_SLUG[params.slug];
  if (!cat) return {};
  return { title: cat.name, description: `${cat.name} 관련 최신 중독뉴스` };
}

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const cat = CATEGORY_BY_SLUG[params.slug];
  if (!cat) notFound();
  const articles = await getByCategory(cat.slug, 30);

  return (
    <section>
      <div className="section-head"><h1 style={{ fontSize: 32 }}>{cat.name}</h1></div>
      <ArticleList articles={articles} />
    </section>
  );
}
