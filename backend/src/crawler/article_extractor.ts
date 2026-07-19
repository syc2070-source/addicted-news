// ============================================================
// 기사 원문 본문 추출 (요약 재료용)
// - 구글 뉴스 링크 → 실제 기사 URL 해석 → 본문 텍스트 추출
// - 실패해도 throw 하지 않음(빈 문자열 반환). 요약은 폴백으로 진행.
// ============================================================

// HTTP 요청은 axios 사용(Node http/https 기반). 전역 fetch(undici)는
// 응답 스트리밍 중 AbortController abort가 겹치면 내부 assert(!this.paused)를
// uncaughtException 으로 던져 프로세스를 죽이는 지뢰가 있어 사용하지 않는다.
import axios from 'axios';
import { isValidArticleImageUrl } from './image_validation';
import { decodeGoogleNewsUrl } from './google_news_url';

// HTML 파싱: @mozilla/readability + jsdom 권장. 미설치 시 정규식 폴백.
let Readability: any = null;
let JSDOM: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Readability = require('@mozilla/readability').Readability;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  JSDOM = require('jsdom').JSDOM;
} catch {
  // 미설치 — 정규식 폴백 사용
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// v5.2 #3: 재시도용 대체 User-Agent(모바일)
const UA_ALT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 8 * 1024 * 1024; // 8MB 상한

export type HttpTextResult = {
  ok: boolean;
  status: number;
  contentType: string;
  finalUrl: string;
  body: string;
};

/**
 * axios 기반 GET(텍스트). 리다이렉트 추종·타임아웃·gzip 해제를 axios가 처리.
 * 4xx/5xx 도 throw 하지 않고 결과로 반환. 네트워크/타임아웃 실패 시 null.
 * undici(전역 fetch)를 쓰지 않으므로 스트리밍 abort 지뢰(assert)에 안전.
 */
export async function httpGetText(url: string, ua: string = UA): Promise<HttpTextResult | null> {
  try {
    const res = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 5,
      responseType: 'text',
      transformResponse: [(d: any) => d], // JSON 자동 파싱 방지, 원문 문자열 유지
      decompress: true,
      maxContentLength: MAX_HTML_BYTES,
      maxBodyLength: MAX_HTML_BYTES,
      validateStatus: () => true, // 상태코드로 throw 하지 않음
      headers: {
        'User-Agent': ua,
        'Accept-Language': 'ko,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const finalUrl: string =
      (res.request && res.request.res && res.request.res.responseUrl) || url;
    const contentType = String(res.headers?.['content-type'] || '');
    const body = typeof res.data === 'string' ? res.data : String(res.data ?? '');
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      contentType,
      finalUrl,
      body,
    };
  } catch {
    // 타임아웃·네트워크 오류·본문 초과 등 → 개별 실패로 처리(호출측이 스킵)
    return null;
  }
}

/** 구글 뉴스·RSS articles URL 여부 */
export function isGoogleNewsUrl(link: string): boolean {
  try {
    return /news\.google\./.test(new URL(link).hostname);
  } catch {
    return /news\.google\./.test(link);
  }
}

/**
 * 구글 뉴스 링크 등에서 실제 기사 URL 해석.
 * newsCrawler.resolveFinalUrl 과 동일 — canonical 폴백 포함.
 */
export async function resolveFinalUrl(maybeGoogleUrl: string): Promise<string> {
  try {
    if (isGoogleNewsUrl(maybeGoogleUrl)) {
      const decoded = await decodeGoogleNewsUrl(maybeGoogleUrl);
      if (decoded && !isGoogleNewsUrl(decoded)) return decoded;
      return maybeGoogleUrl;
    }
    const res = await httpGetText(maybeGoogleUrl);
    if (!res) return maybeGoogleUrl;
    const finalUrl = res.finalUrl || maybeGoogleUrl;
    if (finalUrl.includes('news.google.com')) {
      const m = res.body.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
      if (m?.[1] && !isGoogleNewsUrl(m[1])) return m[1];
    }
    return finalUrl;
  } catch {
    return maybeGoogleUrl;
  }
}

/** HTML 에서 본문 텍스트 추출 */
function extractText(html: string, url: string): string {
  if (Readability && JSDOM) {
    try {
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article && article.textContent) {
        return cleanup(article.textContent);
      }
    } catch {
      /* 폴백으로 */
    }
  }
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const paras = [...noScript.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' '))
    .map((s) => cleanup(s))
    .filter((s) => s.length > 40);
  return cleanup(paras.join('\n'));
}

function cleanup(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * v5.2 #5: HTML 에서 og:image(없으면 twitter:image) URL 추출.
 * 상대경로는 원문 origin 기준 절대경로로 변환. 이미지는 다운로드하지 않고 URL만.
 */
export function extractOgImageFromHtml(html: string, baseUrl: string): string | null {
  const patterns: RegExp[] = [
    /<meta[^>]+(?:property|name)=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image(?::url)?["']/i,
    /<meta[^>]+(?:name|property)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image(?::src)?["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      let img = m[1].trim();
      if (!img) continue;
      try {
        if (img.startsWith('//')) img = 'https:' + img;
        else if (img.startsWith('/')) img = new URL(baseUrl).origin + img;
        else if (!/^https?:\/\//i.test(img)) img = new URL(img, baseUrl).href;
      } catch {
        continue;
      }
      if (/^https?:\/\//i.test(img)) return img;
    }
  }
  return null;
}

export type ArticleData = { body: string; ogImage: string | null };

/**
 * v5.2 #3+#5: 기사 링크에서 본문 텍스트와 og:image를 함께 추출.
 * - 본문이 부실(120자 미만)하면 대체 UA로 1회 재시도.
 * - 본문 추출 실패해도 og:image는 살아있을 수 있으므로 별도로 반환.
 * - 실패해도 throw 하지 않음.
 */
export async function extractArticleData(link: string): Promise<ArticleData> {
  const empty: ArticleData = { body: '', ogImage: null };
  try {
    if (!link || !String(link).trim()) return empty;
    let realUrl = link;
    if (isGoogleNewsUrl(link)) {
      realUrl = await resolveFinalUrl(link);
      if (isGoogleNewsUrl(realUrl)) return empty;
    } else {
      realUrl = await resolveFinalUrl(link);
    }

    // 1차 시도(데스크톱 UA)
    const res = await httpGetText(realUrl, UA);
    let html = '';
    if (res && res.ok && /text\/html/i.test(res.contentType)) {
      html = res.body;
    }
    let body = html ? extractText(html, realUrl) : '';
    let ogImage = html ? extractOgImageFromHtml(html, realUrl) : null;

    // v5.2 #3: 본문 부실 시 대체 UA(모바일)로 1회 재시도
    if (body.length < 120) {
      const res2 = await httpGetText(realUrl, UA_ALT);
      if (res2 && res2.ok && /text\/html/i.test(res2.contentType)) {
        const body2 = extractText(res2.body, realUrl);
        if (body2.length > body.length) body = body2;
        if (!ogImage) ogImage = extractOgImageFromHtml(res2.body, realUrl);
      }
    }

    if (ogImage && !isValidArticleImageUrl(ogImage)) ogImage = null;
    return { body: body.length >= 120 ? body.slice(0, 6000) : '', ogImage };
  } catch {
    return empty;
  }
}

/**
 * 기사 링크에서 본문 텍스트를 추출.
 * 실패 시 빈 문자열 반환(호출측이 RSS 스니펫으로 폴백).
 * (하위호환 래퍼 — 내부적으로 extractArticleData 사용)
 */
export async function extractArticleBody(link: string): Promise<string> {
  const { body } = await extractArticleData(link);
  return body;
}

/**
 * 이미지 백필용: 링크(구글뉴스 리다이렉트면 해제)에서 og:image(없으면 twitter:image)
 * URL만 추출. 본문 추출 없이 1회 요청. 실패 시 null.
 * (resolveRealUrl·httpGetText·extractOgImageFromHtml 재사용 — undici 미사용)
 */
export async function extractOgImageFromUrl(link: string): Promise<string | null> {
  const { image } = await fetchImageForBackfill(link);
  return image;
}

/**
 * 백필용: og:image 추출 + 마지막 HTTP 상태코드를 함께 반환(429 감지용).
 * 구글 429는 원문 페이지 fetch가 429로 나타나므로 status 로 노출한다.
 * status: 마지막 요청의 HTTP 상태(요청 자체 실패/타임아웃이면 0).
 */
export async function fetchImageForBackfill(
  link: string,
): Promise<{ image: string | null; status: number }> {
  try {
    if (!link || !String(link).trim()) return { image: null, status: 0 };
    const realUrl = await resolveFinalUrl(link);
    const res = await httpGetText(realUrl);
    if (!res) return { image: null, status: 0 };
    if (!res.ok || !/text\/html/i.test(res.contentType)) {
      return { image: null, status: res.status };
    }
    const og = extractOgImageFromHtml(res.body, res.finalUrl || realUrl);
    return { image: isValidArticleImageUrl(og) ? og : null, status: res.status };
  } catch {
    return { image: null, status: 0 };
  }
}
