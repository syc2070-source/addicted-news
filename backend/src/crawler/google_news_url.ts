// ============================================================
// google_news_url.ts — post-2024 Google News RSS URL → 언론사 URL
// axios only (undici/fetch 금지). batchexecute garturlreq/res.
// ============================================================
import axios from 'axios';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const BATCH_EXECUTE_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';

const HTML_HEADERS = {
  'User-Agent': UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'max-age=0',
  'Sec-Ch-Ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

function collectCookies(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  if (!raw) return '';
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => String(c).split(';')[0]).filter(Boolean).join('; ');
}

export function extractGoogleArticleId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'news.google.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const kind = parts[parts.length - 2];
    if (kind !== 'articles' && kind !== 'read') return null;
    return parts[parts.length - 1].split('?')[0] || null;
  } catch {
    return null;
  }
}

function tryOfflineDecode(articleId: string): string | null {
  try {
    let str = Buffer.from(articleId, 'base64').toString('binary');
    const prefix = Buffer.from([0x08, 0x13, 0x22]).toString('binary');
    if (str.startsWith(prefix)) str = str.slice(prefix.length);
    const suffix = Buffer.from([0xd2, 0x01, 0x00]).toString('binary');
    if (str.endsWith(suffix)) str = str.slice(0, -suffix.length);
    const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0));
    const len = bytes[0]!;
    str = len >= 0x80 ? str.slice(2, len + 2) : str.slice(1, len + 1);
    if (/^https?:\/\//i.test(str)) return str;
    return null;
  } catch {
    return null;
  }
}

type DecodeMeta = { signature: string; timestamp: string; cookies: string; pageUrl: string };

async function fetchDecodingParams(articleId: string): Promise<DecodeMeta | null> {
  try {
    const pageUrl = `https://news.google.com/rss/articles/${articleId}`;
    const res = await axios.get(pageUrl, {
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(d: unknown) => d],
      headers: HTML_HEADERS,
    });
    if (res.status !== 200) return null;
    const body = String(res.data ?? '');
    const sg = body.match(/data-n-a-sg="([^"]+)"/);
    const ts = body.match(/data-n-a-ts="([^"]+)"/);
    if (!sg?.[1] || !ts?.[1]) return null;
    return {
      signature: sg[1],
      timestamp: ts[1],
      cookies: collectCookies(res.headers as Record<string, unknown>),
      pageUrl,
    };
  } catch {
    return null;
  }
}

async function batchexecuteDecode(
  articleId: string,
  meta: DecodeMeta,
): Promise<string | null> {
  try {
    const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${articleId}",${meta.timestamp},"${meta.signature}"]`;
    const reqData = `f.req=${encodeURIComponent(JSON.stringify([['Fbv4je', inner, null, 'generic']]))}`;
    const res = await axios.post(BATCH_EXECUTE_URL, reqData, {
      timeout: 20000,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(d: unknown) => d],
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': UA,
        Accept: '*/*',
        Origin: 'https://news.google.com',
        Referer: meta.pageUrl,
        ...(meta.cookies ? { Cookie: meta.cookies } : {}),
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    if (res.status !== 200) return null;
    const text = String(res.data ?? '');
    const parts = text.split('\n\n');
    if (parts.length < 2) return null;
    const parsed = JSON.parse(parts[1]!) as unknown[];
    const innerStr = (parsed[0] as unknown[])[2];
    const innerData = JSON.parse(String(innerStr)) as unknown[];
    const decoded = innerData[1];
    return typeof decoded === 'string' && /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export async function decodeGoogleNewsUrl(sourceUrl: string): Promise<string | null> {
  const articleId = extractGoogleArticleId(sourceUrl);
  if (!articleId) return null;

  const offline = tryOfflineDecode(articleId);
  if (offline) return offline;

  const meta = await fetchDecodingParams(articleId);
  if (!meta) return null;
  await new Promise((r) => setTimeout(r, 800));
  const decoded = await batchexecuteDecode(articleId, meta);
  if (!decoded || /news\.google\./.test(decoded)) return null;
  return decoded;
}
