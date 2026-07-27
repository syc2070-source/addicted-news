import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import YouTubeEmbed from '@/components/YouTubeEmbed';
import { getEncyclopediaTerm } from '@/lib/api';
import s from '../encyclopedia.module.css';

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const t = await getEncyclopediaTerm(params.id);
  if (!t) return { title: '항목을 찾을 수 없습니다' };
  return {
    title: `${t.termKo} — 중독백과`,
    description: (t.definition || '').slice(0, 160),
    openGraph: { title: `${t.termKo} — 중독백과`, description: (t.definition || '').slice(0, 160), type: 'article' },
  };
}

export default async function TermPage({ params }: { params: { id: string } }) {
  const t = await getEncyclopediaTerm(params.id);
  if (!t) notFound();

  return (
    <article className={s.detail}>
      <Link href="/encyclopedia" className={s.back}>← 중독백과</Link>
      <h1 className={s.dTerm}>{t.termKo}</h1>
      <div className={s.dEn}>
        {t.termEn && <span>{t.termEn} · </span>}
        <span className={s.dCat}>{t.category}</span>
      </div>

      {/* 이관 필수: youtube_video_id 있으면 제목 아래 임베드(youtube-nocookie, 지연로드, 16:9) */}
      {t.youtubeVideoId && <YouTubeEmbed videoId={t.youtubeVideoId} title={`${t.termKo} — 중독백과`} />}

      {t.definition && <p className={s.dDef}>{t.definition}</p>}

      {t.body?.map((sec, i) => (
        <section key={i} className={s.dSection}>
          {sec.h && <h3>{sec.h}</h3>}
          {sec.p && <p>{sec.p}</p>}
        </section>
      ))}

      {t.advanced && t.advanced.length > 0 && (
        <details className={s.advanced}>
          <summary>▶ 심화 내용</summary>
          {t.advanced.map((sec, i) => (
            <section key={i} className={s.dSection}>
              {sec.h && <h3 style={{ fontSize: 18 }}>{sec.h}</h3>}
              {sec.p && <p>{sec.p}</p>}
            </section>
          ))}
        </details>
      )}

      {t.example && <div className={s.example}>{t.example}</div>}

      {t.related && t.related.length > 0 && (
        <div className={s.related}>
          <strong>관련 항목</strong><br />
          {t.related.map((r) => (
            <Link key={r.id} href={`/encyclopedia/${r.id}`}>{r.termKo}</Link>
          ))}
        </div>
      )}

      {t.sensitive && (
        <div className={s.help}>
          이 주제로 어려움을 겪고 있다면 전문기관의 도움을 받을 수 있습니다. 방법·수치 등 자극이 될 수 있는 정보는 다루지 않습니다.
        </div>
      )}
    </article>
  );
}
