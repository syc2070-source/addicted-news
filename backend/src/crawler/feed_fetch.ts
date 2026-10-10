// ============================================================
// feed_fetch.ts (NEWS-Q2 ■4) — 피드 읽기(헤더·403 재시도·깨진 XML 관용·HTML 공지 목록).
//  · 처음부터 브라우저 UA·Accept 를 보낸다(옛: 기본 rss-parser UA → 403/406 뒤에만 UA 재시도).
//  · 403/406/429 는 잠시 쉬고 다른 UA 로 1회 더(무한 재시도 금지).
//  · XML 파싱이 실패하면 맨 &·제어문자·BOM 을 고친 사본으로 1회 더(us-drugfree 꼴).
//  · format='html' 소스는 list_pattern(이름 묶음 link·title·date)으로 공지 목록을 항목으로 바꾼다.
//  · format='json' 소스는 json_map(목록·제목·링크·날짜 칸 이름)으로 기관 뉴스 API 를 항목으로 바꾼다(WHO).
//  · 주소의 {yesterday_mdy} 는 어제 날짜 MM/DD/YYYY 로 바뀐다(EurekAlert 날짜별 목록).
// ============================================================
import axios from 'axios';
import Parser from 'rss-parser';

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const ALT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export const FEED_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, text/html;q=0.7, */*;q=0.5',
  'Accept-Language': 'ko,en;q=0.8',
};

const RETRY_STATUSES = new Set([403, 406, 429]);

export type HttpGet = (url: string, config: Record<string, unknown>) => Promise<{ status: number; data: unknown }>;

export interface FetchTextResult {
  text: string;
  status: number;
  retried: boolean;
}

/** 피드 본문 가져오기. 200 이 아니면 "status code NNN" 꼴 오류(옛 httpStatusOf 와 맞춤). */
export async function fetchFeedText(
  url: string,
  opts: { timeoutMs?: number; get?: HttpGet; waitMs?: number } = {},
): Promise<FetchTextResult> {
  const get: HttpGet = opts.get || ((u, c) => axios.get(u, c));
  const base = {
    timeout: opts.timeoutMs ?? 15000,
    responseType: 'text',
    transformResponse: [(d: unknown) => d],
    validateStatus: () => true,
    maxRedirects: 5,
  };
  let res = await get(url, { ...base, headers: FEED_HEADERS });
  let retried = false;
  if (RETRY_STATUSES.has(res.status)) {
    retried = true;
    await new Promise((r) => setTimeout(r, opts.waitMs ?? 1500));
    res = await get(url, { ...base, headers: { ...FEED_HEADERS, 'User-Agent': ALT_UA } });
  }
  if (res.status !== 200) throw new Error(`Request failed with status code ${res.status}`);
  return { text: String(res.data ?? ''), status: res.status, retried };
}

/** 흔한 XML 고장 고치기: BOM·앞 쓰레기, 제어문자, 엔티티가 아닌 맨 &. */
export function sanitizeXml(xml: string): string {
  let s = xml || '';
  const lt = s.indexOf('<');
  if (lt > 0) s = s.slice(lt);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  s = s.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{0,31}|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;');
  return s;
}

export async function parseFeedTolerant(
  xml: string,
  parser: Parser<any>,
): Promise<{ feed: { items?: any[] }; repaired: boolean }> {
  try {
    return { feed: await parser.parseString(xml), repaired: false };
  } catch (first) {
    const fixed = sanitizeXml(xml);
    if (fixed === xml) throw first;
    return { feed: await parser.parseString(fixed), repaired: true };
  }
}

function stripTags(s: string): string {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** HTML 공지 목록 → 피드 항목. pattern 은 이름 묶음 link·title(필수)·date(선택). */
export function parseHtmlList(html: string, pattern: string, baseUrl: string, limit = 30): Array<Record<string, string>> {
  const re = new RegExp(pattern, 'gis');
  const out: Array<Record<string, string>> = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(re)) {
    const g = m.groups || {};
    const title = stripTags(g.title || '');
    if (!title || !g.link) continue;
    let link: string;
    try {
      link = new URL(g.link.replace(/&amp;/g, '&'), baseUrl).href;
    } catch {
      continue;
    }
    if (seen.has(link)) continue;
    seen.add(link);
    const item: Record<string, string> = { title, link };
    const raw = (g.date || '').trim();
    let dt = raw ? new Date(raw) : null;
    if (raw && (!dt || Number.isNaN(dt.getTime()))) dt = new Date(raw.replace(/[./]/g, '-'));
    if (dt && !Number.isNaN(dt.getTime())) item.isoDate = dt.toISOString();
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export interface JsonMap {
  items: string;
  title: string;
  link: string;
  date?: string;
  link_prefix?: string;
}

/** 기관 뉴스 JSON → 피드 항목. */
export function parseJsonList(text: string, map: JsonMap, limit = 30): Array<Record<string, string>> {
  const data = JSON.parse(text);
  const list = map.items.split('.').reduce((o: any, k) => (o == null ? o : o[k]), data);
  if (!Array.isArray(list)) throw new Error(`json_map.items(${map.items}) 가 목록이 아님`);
  const out: Array<Record<string, string>> = [];
  for (const row of list) {
    const title = String(row?.[map.title] ?? '').trim();
    const rawLink = String(row?.[map.link] ?? '').trim();
    if (!title || !rawLink) continue;
    const link = /^https?:\/\//i.test(rawLink) ? rawLink : `${map.link_prefix || ''}${rawLink}`;
    const item: Record<string, string> = { title, link };
    const d = map.date ? new Date(String(row?.[map.date] ?? '')) : null;
    if (d && !Number.isNaN(d.getTime())) item.isoDate = d.toISOString();
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** 주소 틀: {yesterday_mdy} → 어제(기준 now) MM/DD/YYYY. */
export function expandUrlTemplate(url: string, now: Date = new Date()): string {
  if (!url.includes('{yesterday_mdy}')) return url;
  const y = new Date(now.getTime() - 24 * 3600 * 1000);
  const mdy = `${String(y.getUTCMonth() + 1).padStart(2, '0')}/${String(y.getUTCDate()).padStart(2, '0')}/${y.getUTCFullYear()}`;
  return url.split('{yesterday_mdy}').join(mdy);
}

export interface FeedFetchResult {
  feed: { items?: any[] };
  retried: boolean;
  repaired: boolean;
}

export async function fetchFeed(
  conf: { url: string; format?: 'rss' | 'html' | 'json'; listPattern?: string; jsonMap?: JsonMap },
  parser: Parser<any>,
  opts: { timeoutMs?: number; get?: HttpGet; waitMs?: number; now?: Date } = {},
): Promise<FeedFetchResult> {
  const url = expandUrlTemplate(conf.url, opts.now);
  const { text, retried } = await fetchFeedText(url, opts);
  if (conf.format === 'json') {
    if (!conf.jsonMap) throw new Error('json 소스에 json_map 없음');
    return { feed: { items: parseJsonList(text, conf.jsonMap) }, retried, repaired: false };
  }
  if (conf.format === 'html') {
    if (!conf.listPattern) throw new Error('html 소스에 list_pattern 없음');
    return { feed: { items: parseHtmlList(text, conf.listPattern, url) }, retried, repaired: false };
  }
  const { feed, repaired } = await parseFeedTolerant(text, parser);
  return { feed, retried, repaired };
}
