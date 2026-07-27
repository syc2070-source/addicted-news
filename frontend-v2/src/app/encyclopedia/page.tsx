import Link from 'next/link';
import type { Metadata } from 'next';
import Corners from '@/components/Corners';
import { getEncyclopedia } from '@/lib/api';
import s from './encyclopedia.module.css';

export const revalidate = 600;

export const metadata: Metadata = {
  title: '중독백과',
  description: '중독 관련 용어 해설 사전 — 영상 백과 포함',
};

export default async function EncyclopediaListPage() {
  const terms = await getEncyclopedia();

  return (
    <section>
      <div className="section-head"><h1 style={{ fontSize: 32 }}>중독백과</h1>
        <span className="kicker" style={{ fontSize: 12 }}>용어 사전 A–Z</span>
      </div>
      {terms.length === 0 ? (
        <p className={s.empty}>항목을 불러오지 못했습니다.</p>
      ) : (
        <div className={s.grid}>
          {terms.map((t) => (
            <Link key={t.id} href={`/encyclopedia/${t.id}`} className={`blueprint ${s.card}`}>
              <Corners />
              <div className={s.cardTop}>
                <span className={s.term}>{t.termKo}</span>
                {t.youtubeVideoId && <span className="tag tag-accent" style={{ fontSize: 10 }}>영상</span>}
              </div>
              {t.termEn && <span className={s.termEn}>{t.termEn}</span>}
              <p className={s.def}>{(t.definition || '').slice(0, 90)}</p>
              <span className={s.cardCat}>{t.category}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
