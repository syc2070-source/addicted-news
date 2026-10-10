// ============================================================
// dedup.ts (NEWS-Q2 ■2) — DeepSeek 앞 중복 확인.
// 후보의 정규화 URL(원문·구글 링크, 쿼리 꼬리·utm 제거)과 정규화 제목을
//  · 최근 N일 저장분(articles, soft 삭제·차단 포함)과 최근 판정 거부분(rejected_articles)의 기억표,
//  · URL 은 기간 없이 DB 직접 조회
// 로 대조해, 이미 있으면 DeepSeek 를 부르지 않는다.
// rejected 중 judgment_missing(호출 실패)은 다시 판정 받을 수 있게 기억표에 넣지 않는다.
// ============================================================
import { normalize } from './field_filter';

export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid', 'ocid', 'cmpid', 'smid', 'smtyp',
  'ref', 'ref_src', 'referrer', 'src', 'from', 'feature', 'rss', 'oc', 'cid', 'ito', 'mod',
]);

/** 비교용 URL 열쇠: https·소문자 호스트·www 제거·#꼬리 제거·utm_*·추적 쿼리 제거·끝 / 제거. */
export function normalizeUrl(raw: string | null | undefined): string {
  const s = (raw || '').trim();
  if (!s || s === '#') return '';
  try {
    const u = new URL(s);
    u.hash = '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const keep: Array<[string, string]> = [];
    u.searchParams.forEach((v, k) => {
      const key = k.toLowerCase();
      if (key.startsWith('utm_') || TRACKING_PARAMS.has(key)) return;
      keep.push([k, v]);
    });
    keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const q = keep.length ? '?' + keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
    const pathName = u.pathname.replace(/\/+$/, '') || '';
    return `https://${host}${u.port ? ':' + u.port : ''}${pathName}${q}`;
  } catch {
    return s.toLowerCase();
  }
}

/** 비교용 제목 열쇠: 공용 normalize → 소문자 → 끝의 " - 매체명"(구글뉴스 꼴) 제거 → 낱말 문자만. */
export function normalizeTitleKey(raw: string | null | undefined): string {
  let t = normalize(raw || '').toLowerCase();
  const dash = t.lastIndexOf(' - ');
  if (dash > 8 && t.length - dash <= 30) t = t.slice(0, dash);
  t = t.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 6 ? t : '';
}

export class KnownIndex {
  readonly urls = new Set<string>();
  readonly titles = new Set<string>();

  add(row: { url?: string | null; googleUrl?: string | null; title?: string | null; originalTitle?: string | null }): void {
    for (const u of [row.url, row.googleUrl]) {
      const k = normalizeUrl(u);
      if (k) this.urls.add(k);
    }
    for (const t of [row.title, row.originalTitle]) {
      const k = normalizeTitleKey(t);
      if (k) this.titles.add(k);
    }
  }

  /** 'url' | 'title' | null */
  match(c: { urls: Array<string | null | undefined>; titles: Array<string | null | undefined> }): 'url' | 'title' | null {
    if (c.urls.some((u) => { const k = normalizeUrl(u); return !!k && this.urls.has(k); })) return 'url';
    if (c.titles.some((t) => { const k = normalizeTitleKey(t); return !!k && this.titles.has(k); })) return 'title';
    return null;
  }

  get size(): number {
    return this.urls.size + this.titles.size;
  }
}

/** 기억표 채우기(최근 days 일). 실패하면 빈 표(옛 동작 — 저장 직전 중복 확인은 그대로 있다). */
export async function loadKnownIndex(query: QueryFn, days = 30, log: (s: string) => void = console.log): Promise<KnownIndex> {
  const idx = new KnownIndex();
  try {
    const rows = await query(
      `SELECT source_url, google_url, title, original_title FROM articles WHERE created_at >= now() - ($1 || ' days')::interval`,
      [String(days)],
    );
    for (const r of rows) idx.add({ url: r.source_url, googleUrl: r.google_url, title: r.title, originalTitle: r.original_title });
    const rej = await query(
      `SELECT source_url, google_url, title, original_title FROM rejected_articles
        WHERE created_at >= now() - ($1 || ' days')::interval AND reject_reason <> 'judgment_missing'`,
      [String(days)],
    );
    for (const r of rej) idx.add({ url: r.source_url, googleUrl: r.google_url, title: r.title, originalTitle: r.original_title });
    log(`[dedup] 기억표: 저장 ${rows.length} · 판정 거부 ${rej.length} (최근 ${days}일) → 열쇠 ${idx.size}`);
  } catch (e) {
    log(`[dedup] 기억표 읽기 실패(빈 표로 계속): ${(e as Error).message}`);
  }
  return idx;
}

/** URL 은 기간 없이 DB 에서 직접(원문·구글 링크 모두, 원래 꼴과 정규화 꼴). */
export async function urlKnownInDb(query: QueryFn, urls: Array<string | null | undefined>): Promise<boolean> {
  const list = [...new Set(urls.flatMap((u) => (u ? [u, normalizeUrl(u)] : [])).filter(Boolean))];
  if (!list.length) return false;
  try {
    const rows = await query(
      `SELECT 1 FROM articles WHERE source_url = ANY($1::text[]) OR google_url = ANY($1::text[]) LIMIT 1`,
      [list],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** 후보 하나 대조: 기억표(URL·제목) → DB URL. 'url'|'title'|null */
export async function preDuplicate(
  idx: KnownIndex,
  query: QueryFn | null,
  c: { urls: Array<string | null | undefined>; titles: Array<string | null | undefined> },
): Promise<'url' | 'title' | null> {
  const hit = idx.match(c);
  if (hit) return hit;
  if (query && (await urlKnownInDb(query, c.urls))) return 'url';
  return null;
}
