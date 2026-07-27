import Link from 'next/link';
import Corners from '@/components/Corners';
import Thumb from '@/components/Thumb';
import { HOME_CATEGORY_MODULES } from '@/lib/categories';
import {
  getTop, getFeatured, getRapha, getIssue, getLatest, getByCategory, getEncyclopedia,
} from '@/lib/api';
import { displaySummary } from '@/lib/summary';
import { fmtDate, fmtTime, fmtMonthDay, topKeywords } from '@/lib/format';
import type { Article, EncyclopediaTerm } from '@/lib/types';
import s from './home.module.css';

export const revalidate = 600; // ISR 10분

export default async function HomePage() {
  const [top, featured, rapha, issue, latest, enc, ...cats] = await Promise.all([
    getTop(), getFeatured(), getRapha(6), getIssue(6), getLatest(8), getEncyclopedia(),
    ...HOME_CATEGORY_MODULES.map((c) => getByCategory(c.slug, 3)),
  ]);

  const lead: Article | undefined = top[0] ?? latest[0];
  const brief = latest.slice(0, 6);
  const keywords = topKeywords(latest, 5);
  const encVideo: EncyclopediaTerm | undefined =
    enc.find((t) => t.youtubeVideoId) ?? enc[0];

  return (
    <div className={s.paper}>
      <div className={s.homeGrid}>
        {/* ── 메인 컬럼 ── */}
        <div className={s.mainCol}>
          {/* 리드 + 속보 브리핑 */}
          <div className={s.leadGrid}>
            <article>
              {lead ? (
                <>
                  <Thumb src={lead.imageUrl} alt={lead.title} category={lead.category} ratio="16/9" />
                  <div className={s.leadTags}>
                    <span className="tag tag-accent" style={{ fontFamily: 'var(--font-heading)', letterSpacing: '.1em' }}>TOP NEWS</span>
                    <span className={s.leadCat}>{lead.category}</span>
                  </div>
                  <h2 className={s.leadTitle}><Link href={`/article/${lead.id}`}>{lead.title}</Link></h2>
                  <p className={s.leadSummary}>{displaySummary(lead)}</p>
                  <div className={s.meta}><span>{fmtDate(lead.publishedAt)}</span><span>{lead.source}</span></div>
                </>
              ) : (
                <p className={s.emptyNote}>표시할 리드 기사가 아직 없습니다.</p>
              )}
            </article>

            <div className={s.rail}>
              <div className="section-head"><h4>속보 브리핑</h4><Link href="/" style={{ fontSize: 13 }}>더보기</Link></div>
              <div className={s.briefList}>
                {brief.map((a) => (
                  <div key={a.id} className={s.briefRow}>
                    <span className={s.briefTime}>{fmtTime(a.publishedAt)}</span>
                    <Link className={s.briefText} href={`/article/${a.id}`}>{a.title}</Link>
                  </div>
                ))}
                {brief.length === 0 && <p className={s.emptyNote}>브리핑이 아직 없습니다.</p>}
              </div>
              {keywords.length > 0 && (
                <div className={`blueprint ${s.keywords}`}>
                  <Corners />
                  <div className={s.keywordsHead}>오늘의 키워드</div>
                  <div className={s.chips}>
                    {keywords.map((k) => <span key={k} className="tag tag-outline">{k}</span>)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 4열 카테고리 모듈 */}
          <div className={s.catGrid}>
            {HOME_CATEGORY_MODULES.map((c, i) => {
              const list = cats[i] as Article[];
              const [m0, ...rest] = list;
              return (
                <section key={c.slug} className={s.catModule}>
                  <div className={s.catHead}>
                    <h3>{c.short}</h3>
                    <Link href={`/category/${c.slug}`}>더보기</Link>
                  </div>
                  {m0 ? (
                    <>
                      <Thumb src={m0.imageUrl} alt={m0.title} category={c.short} ratio="4/3" />
                      <Link className={s.catLead} href={`/article/${m0.id}`}>{m0.title}</Link>
                      <div className={s.catMeta}>{fmtDate(m0.publishedAt)} · {m0.source}</div>
                      <div className="hr" style={{ margin: '2px 0' }} />
                      {rest.slice(0, 2).map((a) => (
                        <Link key={a.id} className={s.catItem} href={`/article/${a.id}`}>{a.title}</Link>
                      ))}
                    </>
                  ) : (
                    <p className={s.emptyNote}>기사 준비 중</p>
                  )}
                </section>
              );
            })}
          </div>

          {/* 기획 + 오피니언 */}
          <div className={s.midGrid}>
            <section>
              <div className="section-head"><h3>기획기사</h3><span className="kicker">연속기획</span></div>
              {featured.slice(0, 2).map((a) => (
                <Link key={a.id} className={`blueprint ${s.featureCard}`} href={`/article/${a.id}`} style={{ marginBottom: 14 }}>
                  <Corners />
                  <Thumb src={a.imageUrl} alt={a.title} ratio="4/3" />
                  <div className={s.featureBody}>
                    <span className="kicker" style={{ fontSize: 12 }}>기획</span>
                    <div className={s.featureTitle}>{a.title}</div>
                    <p className={s.featureText}>{displaySummary(a)}</p>
                    <div className={s.catMeta}>{fmtDate(a.publishedAt)} · {a.source}</div>
                  </div>
                </Link>
              ))}
              {featured.length === 0 && <p className={s.emptyNote}>기획기사 준비 중</p>}
            </section>

            <section>
              <div className="section-head"><h3>오피니언 · 칼럼</h3><span className="tag tag-accent" style={{ fontSize: 11 }}>신설</span></div>
              {/* 데이터 소스 없음(전용 오피니언 API 부재) — 보고서 "필요 API 목록"에 기재 */}
              <p className={s.emptyNote}>칼럼·기고 코너를 준비하고 있습니다.</p>
            </section>
          </div>
        </div>

        {/* ── 아사이드 ── */}
        <aside className={s.aside}>
          {encVideo && (
            <section className={`blueprint ${s.encCard}`}>
              <Corners />
              <div className={s.encHead}><h3>오늘의 중독백과</h3><span className="kicker" style={{ fontSize: 11 }}>영상</span></div>
              <Link href={`/encyclopedia/${encVideo.id}`}>
                <figure className={`duotone ${s.playFig}`} style={{ background: 'var(--color-neutral-300)', border: '1px solid var(--color-divider)' }}>
                  <span className={s.play} />
                </figure>
              </Link>
              <div className={s.encTerm}>{encVideo.termKo} {encVideo.termEn && <span style={{ fontSize: 14, color: 'var(--color-neutral-600)' }}>{encVideo.termEn}</span>}</div>
              <p className={s.encDef}>{(encVideo.definition || '').slice(0, 120)}</p>
              <Link className="btn btn-secondary btn-block" href="/encyclopedia" style={{ marginTop: 12 }}>용어 사전 A–Z</Link>
            </section>
          )}

          <section>
            <div className="section-head"><h3>중독이슈 랭킹</h3><span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>최근</span></div>
            <ol className={s.rankList}>
              {issue.map((a, i) => (
                <li key={a.id} className={s.rankItem}>
                  <span className={s.rankNo}>{i + 1}</span>
                  <Link className={s.rankText} href={`/article/${a.id}`}>{a.title}</Link>
                </li>
              ))}
            </ol>
            {issue.length === 0 && <p className={s.emptyNote}>이슈 랭킹 준비 중</p>}
          </section>

          <section>
            <div className="section-head"><h3>라파뉴스</h3><span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>라파공동체</span></div>
            <div className={s.raphaList}>
              {rapha.slice(0, 3).map((a) => (
                <div key={a.id} className={s.raphaRow}>
                  <span className={s.raphaDate}>{fmtMonthDay(a.publishedAt)}</span>
                  <Link href={`/article/${a.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{a.title}</Link>
                </div>
              ))}
              {rapha.length === 0 && <p className={s.emptyNote}>라파뉴스 준비 중</p>}
            </div>
          </section>

          <section className={`blueprint ${s.helpCard}`}>
            <Corners />
            <h3>도움이 필요하십니까</h3>
            <p>가까운 중독관리통합지원센터와 치료보호기관을 지역으로 찾아볼 수 있습니다.</p>
            {/* 지원기관 검색 데이터/페이지 미구현 — 보고서 "다음 사이클 제안" */}
            <Link className="btn btn-primary btn-block" href="/reports">지원기관 찾기</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
