import Link from 'next/link';
import styles from './Masthead.module.css';

export default function Masthead() {
  return (
    <div className={styles.masthead}>
      <Link href="/" className={styles.brand} aria-label="중독뉴스 홈">
        <span className={styles.wordmark}>중독뉴스</span>
        <span className={styles.latin}>Addiction News</span>
      </Link>
      <div className={styles.right}>
        <div className={styles.meta}>
          <span>라파중독연구소 발행</span>
          <span>중독 전문 뉴스 · 백과</span>
        </div>
        <div className={styles.actions}>
          <form action="/search" className={styles.search} role="search">
            <input className="input" name="q" placeholder="기사·용어 검색" aria-label="검색" />
          </form>
          <Link className="btn btn-secondary" href="/encyclopedia">중독백과</Link>
        </div>
      </div>
    </div>
  );
}
