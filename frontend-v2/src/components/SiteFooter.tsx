import Link from 'next/link';
import styles from './SiteFooter.module.css';

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.brandCol}>
          <div className={styles.brand}>
            중독뉴스 <span className={styles.latin}>ADDICTION NEWS</span>
          </div>
          <div className={styles.pub}>발행처 · 라파중독연구소 &nbsp;|&nbsp; 충북 옥천군 안남면 지수2길 13-7</div>
          <div className={styles.copy}>
            © 2026 중독뉴스 · 함께 보기:{' '}
            <a href="https://addictionsociety.net" target="_blank" rel="noopener noreferrer">중독사회</a>
            {' · '}
            <a href="https://statory.org" target="_blank" rel="noopener noreferrer">statory</a>
          </div>
        </div>
        <div className={styles.sitemap}>
          <div className={styles.col}>
            <span className={styles.head}>편집</span>
            <span>편집 원칙</span><span>보도 가이드</span><span>제보하기</span>
          </div>
          <div className={styles.col}>
            <span className={styles.head}>자료</span>
            <Link href="/encyclopedia">중독백과</Link>
            <Link href="/reports">리포트</Link>
            <span>주간 다이제스트</span>
          </div>
          <div className={styles.col}>
            <span className={styles.head}>연구소</span>
            <span>라파중독연구소</span><span>후원</span><span>문의</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
