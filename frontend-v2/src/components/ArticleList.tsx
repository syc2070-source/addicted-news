import Link from 'next/link';
import Thumb from './Thumb';
import { displaySummary } from '@/lib/summary';
import { fmtDate } from '@/lib/format';
import type { Article } from '@/lib/types';
import styles from './ArticleList.module.css';

export default function ArticleList({ articles }: { articles: Article[] }) {
  if (!articles.length) {
    return <p className={styles.empty}>표시할 기사가 없습니다.</p>;
  }
  return (
    <div className={styles.list}>
      {articles.map((a) => (
        <article key={a.id} className={styles.row}>
          <Link href={`/article/${a.id}`} className={styles.thumbLink}>
            <Thumb src={a.imageUrl} alt={a.title} category={a.category} ratio="4/3" className={styles.thumb} />
          </Link>
          <div className={styles.body}>
            <span className={styles.cat}>{a.category}</span>
            <h3 className={styles.title}><Link href={`/article/${a.id}`}>{a.title}</Link></h3>
            <p className={styles.summary}>{displaySummary(a)}</p>
            <div className={styles.meta}><span>{fmtDate(a.publishedAt)}</span><span>{a.source}</span></div>
          </div>
        </article>
      ))}
    </div>
  );
}
