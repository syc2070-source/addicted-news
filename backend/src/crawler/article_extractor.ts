// ============================================================
// 기사 원문 본문 추출 (요약 재료용)
// - 구글 뉴스 링크 → 실제 기사 URL 해석 → 본문 텍스트 추출
// - 실패해도 throw 하지 않음(빈 문자열 반환). 요약은 폴백으로 진행.
// ============================================================

// Node 18+ 전역 fetch 가정.
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

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.8' },
      signal: ctrl.signal,
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 구글 뉴스 링크 등에서 실제 기사 URL 을 해석.
 */
async function resolveRealUrl(link: string): Promise<string> {
  try {
    const u = new URL(link);
    if (!/news\.google\./.test(u.hostname)) return link;
    const res = await fetchWithTimeout(link);
    if (res && res.url && !/news\.google\./.test(new URL(res.url).hostname)) {
      return res.url;
    }
    return link;
  } catch {
    return link;
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
 * 기사 링크에서 본문 텍스트를 추출.
 * 실패 시 빈 문자열 반환(호출측이 RSS 스니펫으로 폴백).
 */
export async function extractArticleBody(link: string): Promise<string> {
  try {
    if (!link || !String(link).trim()) return '';
    const realUrl = await resolveRealUrl(link);
    const res = await fetchWithTimeout(realUrl);
    if (!res || !res.ok) return '';
    const ctype = res.headers.get('content-type') || '';
    if (!/text\/html/i.test(ctype)) return '';
    const html = await res.text();
    const text = extractText(html, realUrl);
    return text.length >= 120 ? text.slice(0, 6000) : '';
  } catch {
    return '';
  }
}
