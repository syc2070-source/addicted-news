import type { Metadata } from 'next';
import './globals.css';
import Masthead from '@/components/Masthead';
import SiteNav from '@/components/SiteNav';
import SiteFooter from '@/components/SiteFooter';

const SITE_NAME = '중독뉴스';
const SITE_DESC = '중독 관련 뉴스 큐레이션과 중독백과 — 라파중독연구소 발행';

export const metadata: Metadata = {
  metadataBase: new URL('https://addictionnews.net'),
  title: { default: `${SITE_NAME} — 중독 전문 뉴스`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESC,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — 중독 전문 뉴스`,
    description: SITE_DESC,
    locale: 'ko_KR',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header>
          <div className="container">
            <Masthead />
          </div>
          <SiteNav />
        </header>
        <main className="container" style={{ paddingTop: 24, paddingBottom: 8 }}>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
