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

/** AMP·모바일 쿼리(값이 무엇이든 정본과 같은 기사). */
const AMP_PARAMS = new Set(['amp', 'outputtype', 'output']);

/**
 * 비교용 URL 열쇠: https·소문자 호스트·www/m./mobile./amp. 제거·#꼬리 제거·utm_*·추적·AMP 쿼리 제거·
 * 경로의 /amp(끝 또는 맨 앞) 제거·끝 / 제거. (NEWS-Q6 ■2: m.·amp → 정본)
 */
export function normalizeUrl(raw: string | null | undefined): string {
  const s = (raw || '').trim();
  if (!s || s === '#') return '';
  try {
    const u = new URL(s);
    u.hash = '';
    // 앞머리를 뗀 뒤에도 점이 남을 때만 뗀다(amp.dev → dev 같은 일 없음)
    const host = u.hostname.toLowerCase().replace(/^(?:www|m|mobile|amp)\.(?=[^.]+\.)/, '').replace(/^www\.(?=[^.]+\.)/, '');
    const keep: Array<[string, string]> = [];
    u.searchParams.forEach((v, k) => {
      const key = k.toLowerCase();
      if (key.startsWith('utm_') || TRACKING_PARAMS.has(key) || AMP_PARAMS.has(key)) return;
      keep.push([k, v]);
    });
    keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const q = keep.length ? '?' + keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
    const pathName = u.pathname.replace(/\/+$/, '').replace(/\/amp(\.html)?$/i, '').replace(/^\/amp(?=\/)/i, '') || '';
    return `https://${host}${u.port ? ':' + u.port : ''}${pathName}${q}`;
  } catch {
    return s.toLowerCase();
  }
}

// ---------- NEWS-Q6 ■2: 같은 매체 같은 기사(제목 조금 다름 · URL 꼴 다름) ----------

/** 같은 매체로 보는 시간 창·제목 닮음 하한(0.6: 연재 「① …」「② …」는 0.53 이라 따로 남는다). */
export const SAME_OUTLET_HOURS = 24;
export const SAME_OUTLET_TITLE_SIM = 0.6;

export interface NearRow {
  id?: number | null;
  title: string | null | undefined;
  /** 매체 이름(articles.source) */
  source?: string | null;
  url?: string | null;
  /** 보도 시각(ms) — 없으면 비교하지 않음 */
  ts: number;
}

/** 여러 매체 기사가 한 호스트에 모이는 곳(포털·집계) — 호스트로 매체를 가르지 않는다. */
const PORTAL_HOSTS = new Set([
  'news.google.com', 'v.daum.net', 'news.v.daum.net', 'n.news.naver.com', 'news.naver.com', 'news.nate.com', 'news.zum.com',
  'msn.com', 'flipboard.com', 'news.yahoo.com', 'yahoo.com', 'youtube.com',
]);
/** 집계기 이름(옛 구글 기사 source = "Google News (KR)") — 매체 이름으로 쓰지 않는다. */
const GENERIC_SOURCE = /^(google ?news|구글 ?뉴스|naver|daum|msn|yahoo)\b/i;

/**
 * 매체 열쇠(NEWS-Q6 ■2): ① 원문 호스트(포털·집계 호스트 제외) → ② 제목 끝 " - 매체명"(구글뉴스 꼴) →
 * ③ 매체 이름(집계기 이름 제외). 모르면 '' (같은 매체 검사 안 함 · 정규화 URL 검사만).
 */
export function outletKey(r: Pick<NearRow, 'source' | 'url' | 'title'>): string {
  const u = normalizeUrl(r.url);
  const host = /^https:\/\/([^/:?]+)/.exec(u)?.[1] || '';
  if (host && !PORTAL_HOSTS.has(host)) return host;
  const t = normalize(r.title || '');
  const dash = t.lastIndexOf(' - ');
  if (dash > 8 && t.length - dash <= 30) {
    const suffix = t.slice(dash + 3).toLowerCase().replace(/\s+/g, '');
    // " - v.daum.net" 처럼 포털 이름이 붙은 것은 매체가 아니다
    if (suffix && !GENERIC_SOURCE.test(suffix) && !PORTAL_HOSTS.has(suffix.replace(/^(?:www|m)\./, ''))) return `name:${suffix}`;
  }
  const name = normalize(r.source || '').toLowerCase().replace(/\s+/g, '');
  return name && !GENERIC_SOURCE.test(name) ? `name:${name}` : '';
}

function bigrams(raw: string | null | undefined): Set<string> {
  const t = normalizeTitleKey(raw).replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** 제목 닮음(글자 두 개씩 Dice, 0~1) — 끝의 " - 매체명"·띄어쓰기·구두점 무시. */
export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const g of A) if (B.has(g)) both++;
  return (2 * both) / (A.size + B.size);
}

/** 같은 기사 두 번: 정규화 URL 같음 · 또는 같은 매체 + 24시간 안 + 제목 닮음 ≥ 0.6. */
export function isSameArticle(a: NearRow, b: NearRow, hours = SAME_OUTLET_HOURS, minSim = SAME_OUTLET_TITLE_SIM): boolean {
  const ua = normalizeUrl(a.url);
  if (ua && ua === normalizeUrl(b.url)) return true;
  const ka = outletKey(a);
  if (!ka || ka !== outletKey(b)) return false;
  if (!Number.isFinite(a.ts) || !Number.isFinite(b.ts) || Math.abs(a.ts - b.ts) > hours * 3600 * 1000) return false;
  return titleSimilarity(a.title, b.title) >= minSim;
}

/** 같은 기사 짝 찾기(매체별로 나눠 시각 순 · 24시간 창 안만 비교). 짝 = [먼저, 나중]. */
export function sameArticlePairs<T extends NearRow>(rows: T[], hours = SAME_OUTLET_HOURS): Array<[T, T]> {
  const out: Array<[T, T]> = [];
  const byOutlet = new Map<string, T[]>();
  const byUrl = new Map<string, T>();
  const paired = new Set<T>();
  for (const r of [...rows].sort((a, b) => a.ts - b.ts)) {
    const u = normalizeUrl(r.url);
    const first = u ? byUrl.get(u) : undefined;
    if (first) { out.push([first, r]); paired.add(r); continue; }
    if (u) byUrl.set(u, r);
    const k = outletKey(r);
    if (!k) continue;
    const list = byOutlet.get(k) || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      if (r.ts - o.ts > hours * 3600 * 1000) break;
      if (isSameArticle(o, r, hours)) { out.push([o, r]); paired.add(r); break; }
    }
    if (!paired.has(r)) list.push(r);
    byOutlet.set(k, list);
  }
  return out;
}

/**
 * 이미 저장된 같은 기사 → 같은 묶음(지움 0). 나중 기사가 혼자(size 1)면 먼저 기사의 묶음에 붙인다.
 * 둘이 이미 같은 묶음이면 그대로, 나중 기사가 다른 여러 건 묶음에 있으면 건드리지 않는다(left).
 */
export function foldSameArticles<T extends NearRow & { id: number }>(
  rows: T[],
  index: Map<number, { clusterId: string; size: number; representativeId: number; memberIds: number[] }>,
): { pairs: number; together: number; folded: number; left: number } {
  const res = { pairs: 0, together: 0, folded: 0, left: 0 };
  for (const [a, b] of sameArticlePairs(rows)) {
    res.pairs++;
    const ia = index.get(a.id);
    const ib = index.get(b.id);
    if (!ia || !ib) continue;
    if (ia.clusterId === ib.clusterId && ia.size > 1) { res.together++; continue; }
    if (ib.size > 1) { res.left++; continue; }
    const merged = {
      clusterId: ia.clusterId,
      size: ia.size + 1,
      representativeId: ia.representativeId,
      memberIds: [...ia.memberIds, b.id],
    };
    for (const id of merged.memberIds) index.set(id, merged);
    res.folded++;
  }
  return res;
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
  /** NEWS-Q6 ■2: 저장된 기사(매체·보도 시각) — 같은 매체 + 24시간 + 제목 닮음 검사용 */
  readonly saved: NearRow[] = [];

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

  /** 저장된 기사 하나(URL 열쇠 + 같은 매체 검사 목록). 실행 중 새로 저장한 것도 여기로. */
  addSaved(row: { url?: string | null; googleUrl?: string | null; title?: string | null; originalTitle?: string | null; source?: string | null; ts?: number | null }): void {
    this.urls.add(normalizeUrl(row.url));
    if (row.googleUrl) this.urls.add(normalizeUrl(row.googleUrl));
    this.urls.delete('');
    if (row.ts != null && Number.isFinite(row.ts)) {
      this.saved.push({ title: row.originalTitle || row.title, source: row.source, url: row.url, ts: row.ts });
    }
  }

  /** 저장 직전: 정규화 URL 이 이미 있거나 같은 매체·24시간·닮은 제목 기사가 있으면 'url' | 'outlet'. */
  sameArticle(c: { url?: string | null; googleUrl?: string | null; title?: string | null; originalTitle?: string | null; source?: string | null; ts?: number | null }): 'url' | 'outlet' | null {
    if ([c.url, c.googleUrl].some((u) => { const k = normalizeUrl(u); return !!k && this.urls.has(k); })) return 'url';
    if (c.ts == null || !Number.isFinite(c.ts)) return null;
    const me: NearRow = { title: c.originalTitle || c.title, source: c.source, url: c.url, ts: c.ts };
    const key = outletKey(me);
    if (!key) return null;
    for (const r of this.saved) {
      if (outletKey(r) === key && isSameArticle(r, me)) return 'outlet';
    }
    return null;
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
    const sql = (ts: string) =>
      `SELECT source_url, google_url, title, original_title, source, ${ts} AS ts FROM articles WHERE created_at >= now() - ($1 || ' days')::interval`;
    // published_ts 열(묶음 SQL 2)이 없는 DB 면 created_at 으로
    const rows = await query(sql('COALESCE(published_ts, created_at)'), [String(days)])
      .catch(() => query(sql('created_at'), [String(days)]));
    for (const r of rows) {
      idx.add({ url: r.source_url, googleUrl: r.google_url, title: r.title, originalTitle: r.original_title });
      const ts = r.ts ? new Date(r.ts).getTime() : NaN;
      idx.addSaved({ url: r.source_url, googleUrl: r.google_url, title: r.title, originalTitle: r.original_title, source: r.source, ts });
    }
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
