// backend/src/crawler/newsCrawler.ts
import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import Parser from 'rss-parser';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { Article } from '../articles/article.entity';
import { SOURCES, SourceConfig } from './sourceConfig';

type RssItem = {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  'content:encoded'?: string;
  description?: string;
};

type Candidate = {
  title: string;                 // 한국어 표시 제목
  originalTitle?: string;        // 원문 제목
  teaser?: string;
  summary: string;               // 3줄 한국어 요약
  keywords: string[];
  category: string;
  region: string;
  source: string;
  sourceUrl: string;
  googleUrl?: string;
  origin: string;
  isTop: boolean;
  isFeature: boolean;
  publishedAt: string;           // YYYY-MM-DD
  lang: 'ko' | 'en' | 'ja' | 'zh' | 'other';
  isForeign: boolean;
  blocked: boolean;
  blockedReason?: string;
};

const parser = new Parser<RssItem>({
  customFields: { item: ['source', 'media:content', 'content:encoded', 'description'] },
});

// ---------- OpenAI ----------
let openai: OpenAI | null = null;
let isOpenAIAvailable = false;

function initializeOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.log('⚠️  OPENAI_API_KEY not set. Translation disabled.\n');
    return false;
  }
  if (!apiKey.startsWith('sk-')) {
    console.log('❌ Invalid OPENAI_API_KEY format.\n');
    return false;
  }
  openai = new OpenAI({ apiKey });
  console.log(`✅ OpenAI initialized (key: ${apiKey.slice(0, 10)}...${apiKey.slice(-4)})`);
  console.log('📝 Translation enabled: ALL foreign languages → KO\n');
  return true;
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let apiCallCount = 0;
let lastResetTime = Date.now();
const MAX_CALLS_PER_MINUTE = 300;

async function rateLimitedDelay() {
  const now = Date.now();
  if (now - lastResetTime > 60000) {
    apiCallCount = 0;
    lastResetTime = now;
  }
  if (apiCallCount >= MAX_CALLS_PER_MINUTE) {
    const waitTime = 60000 - (now - lastResetTime);
    console.log(`  ⏳ API throttling: wait ${Math.ceil(waitTime / 1000)}s...`);
    await new Promise((r) => setTimeout(r, waitTime));
    apiCallCount = 0;
    lastResetTime = Date.now();
  }
  apiCallCount++;
}

// ---------- DB ----------
const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD ?? ''),
  database: process.env.DB_NAME || 'addiction_news',
  entities: [Article],
  synchronize: false,
  logging: false,
});

// ---------- Daily Lock ----------
async function hasRunToday(): Promise<boolean> {
  const lockFile = path.join(__dirname, '../../logs/last_crawl.json');
  try {
    if (!fs.existsSync(lockFile)) return false;
    const data = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
    const lastRun = new Date(data.lastRun);
    const today = new Date();
    return (
      lastRun.getFullYear() === today.getFullYear() &&
      lastRun.getMonth() === today.getMonth() &&
      lastRun.getDate() === today.getDate()
    );
  } catch {
    return false;
  }
}

async function markRunToday(): Promise<void> {
  const logsDir = path.join(__dirname, '../../logs');
  const lockFile = path.join(__dirname, '../../logs/last_crawl.json');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const runTime = new Date();
  fs.writeFileSync(
    lockFile,
    JSON.stringify(
      { lastRun: runTime.toISOString(), timestamp: Date.now(), date: runTime.toLocaleDateString('ko-KR'), time: runTime.toLocaleTimeString('ko-KR') },
      null,
      2,
    ),
  );
  console.log(`✅ Run log saved: ${runTime.toLocaleString('ko-KR')}\n`);
}

// ---------- Spam block ----------
const BLOCKED_DOMAINS = new Set<string>([
  'termokonteiner.ru',
  // 필요하면 여기에 계속 추가
]);

function getHostname(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function shouldBlockByDomain(sourceUrl: string, googleUrl?: string): { blocked: boolean; reason?: string } {
  const h1 = getHostname(sourceUrl);
  const h2 = getHostname(googleUrl);
  const host = h1 || h2;
  if (host && BLOCKED_DOMAINS.has(host)) return { blocked: true, reason: `blocked_domain:${host}` };
  return { blocked: false };
}

// ---------- Addiction filter ----------
function isAddictionRelated(title: string, content: string): boolean {
  const text = (title + ' ' + content).toLowerCase();
  const kws = [
    '중독','도박','베팅','카지노','토토','불법도박','도박중독',
    '알코올','음주','알코올중독','약물','마약','오피오이드','약물중독',
    '게임','디지털','과몰입','게임중독',
    '치료','재활','상담','예방','회복','의존',
    'addiction','gambling','betting','casino','alcohol','drug','opioid','rehab','recovery','therapy',
    '依存症','ギャンブル依存','成瘾','赌博',
  ];
  return kws.some((k) => text.includes(k));
}

// ---------- Lang detect (ratio-based) ----------
type DetectedLang = 'ko' | 'en' | 'ja' | 'zh' | 'other';

function detectLanguage(text: string): DetectedLang {
  const s = (text || '').slice(0, 900);
  let ko = 0, ja = 0, zh = 0, latin = 0;

  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if ((code >= 0xac00 && code <= 0xd7af) || (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f)) { ko++; continue; }
    if ((code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff)) { ja++; continue; }
    if (code >= 0x4e00 && code <= 0x9fff) { zh++; continue; }
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) { latin++; continue; }
  }

  const max = Math.max(ko, ja, zh, latin);
  if (max < 8) return 'other';
  if (max === ko) return 'ko';
  if (max === ja) return 'ja';
  if (max === zh) return 'zh';
  if (max === latin) return 'en';
  return 'other';
}

// ---------- Clean / Content ----------
function normalizeText(s: string): string {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractContent(item: RssItem): string {
  const sources = [item['content:encoded'], item.content, item.contentSnippet, item.description];
  for (const src of sources) {
    if (src && src.trim()) {
      const cleaned = normalizeText(src);
      if (cleaned.length > 50) return cleaned.length > 1200 ? cleaned.slice(0, 1200) : cleaned;
    }
  }
  return '';
}

function makeTeaser(item: RssItem): string | undefined {
  const c = extractContent(item);
  if (!c) return undefined;
  return c.length > 480 ? c.slice(0, 480) : c;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parsePublishedAt(item: RssItem): string {
  const raw = item.isoDate || item.pubDate;
  if (!raw) return toYmd(new Date());
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return toYmd(new Date());
  return toYmd(dt);
}

// ---------- 3-line enforce ----------
function stripTitleEcho(lines: string[], title: string): string[] {
  const t = (title || '').trim();
  if (!t) return lines;
  return lines.filter((ln) => {
    const s = (ln || '').trim();
    if (!s) return false;
    if (s === t) return false;
    if (/^(제목|title|タイトル|标题)\s*[:：]/i.test(s)) return false;
    return true;
  });
}

function enforceThreeLines(raw: string, title: string): string {
  const cleaned = (raw || '').replace(/\r/g, '').trim();
  let lines = cleaned.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  lines = stripTitleEcho(lines, title);

  if (lines.length < 3) {
    const fallback = cleaned
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?。！？])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    lines = stripTitleEcho(fallback, title);
  }

  const out: string[] = [];
  for (const ln of lines) {
    if (out.length >= 3) break;
    out.push(ln);
  }
  while (out.length < 3) out.push('기사의 핵심 쟁점과 중독 관련 함의를 추가 확인할 필요가 있습니다.');
  return out.map((s) => (/[.!?。！？]$/.test(s) ? s : s + '.')).join('\n');
}

// ---------- OpenAI pack ----------
type AiPack = { titleKo: string; summary: string; keywords: string[] };

function safeJsonParse<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

function compactKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  return keywords.map((k) => String(k || '').trim()).filter((k) => k.length > 0).slice(0, 12);
}

async function generateKoreanPack(originalTitle: string, content: string, lang: DetectedLang): Promise<AiPack> {
  const isForeign = lang !== 'ko';

  // 외국어인데 OpenAI 비활성 => 저장 스킵을 유도(빈 값)
  if (!isOpenAIAvailable || !openai) {
    if (isForeign) return { titleKo: '', summary: '', keywords: [] };
    return { titleKo: originalTitle, summary: enforceThreeLines(content.slice(0, 400), originalTitle), keywords: [] };
  }

  try {
    await rateLimitedDelay();

    const rule = `JSON만 출력(코드블록/추가 텍스트 금지).
{
 "titleKo":"...",                 // 한국어 제목(원문을 자연스럽게 번역)
 "lines":["...","...","..."],     // 정확히 3개, 각 1문장, 한국어
 "keywords":["...","..."]         // 한국어 키워드 6~12개
}
규칙: lines는 불릿/번호 금지, 제목 반복 금지`;

    const prompt =
      isForeign
        ? `외국어 기사를 한국어로 이해한 뒤, 제목+3문장요약+키워드만 JSON으로 출력.\n[원문제목] ${originalTitle}\n[원문본문] ${content}\n[규칙] ${rule}`
        : `한국어 기사에서 3문장 요약+키워드 생성.\n[제목] ${originalTitle}\n[본문] ${content}\n[규칙] ${rule}`;

    const res = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: '당신은 중독 관련 뉴스의 전문 번역/요약가다. 결과는 JSON만 출력한다.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 420,
    });

    const raw = res.choices[0]?.message?.content?.trim();
    if (!raw) return isForeign ? { titleKo: '', summary: '', keywords: [] } : { titleKo: originalTitle, summary: enforceThreeLines(content.slice(0, 400), originalTitle), keywords: [] };

    const parsed = safeJsonParse<{ titleKo?: unknown; lines?: unknown; keywords?: unknown }>(raw);
    if (parsed && typeof parsed.titleKo === 'string' && Array.isArray(parsed.lines)) {
      const titleKo = String(parsed.titleKo || '').trim();
      const lines = stripTitleEcho(parsed.lines.map((x) => String(x || '').trim()).filter((s) => s.length > 0), originalTitle);
      const summary = enforceThreeLines(lines.join('\n'), originalTitle);
      const keywords = compactKeywords(parsed.keywords);
      return { titleKo, summary, keywords };
    }

    // 일탈 => 외국어는 스킵, 한국어는 강제
    if (isForeign) return { titleKo: '', summary: '', keywords: [] };
    return { titleKo: originalTitle, summary: enforceThreeLines(raw, originalTitle), keywords: [] };
  } catch (e: any) {
    console.error('  ⚠️ OpenAI failed:', e?.status, e?.message || e);
    if (isForeign) return { titleKo: '', summary: '', keywords: [] };
    return { titleKo: originalTitle, summary: enforceThreeLines(content.slice(0, 400), originalTitle), keywords: [] };
  }
}

// ---------- URL resolve ----------
async function resolveFinalUrl(maybeGoogleUrl: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(maybeGoogleUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    clearTimeout(timeout);
    const finalUrl = res.url || maybeGoogleUrl;

    if (finalUrl.includes('news.google.com')) {
      const html = await res.text();
      const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
      if (m?.[1]) return m[1];
    }

    return finalUrl;
  } catch {
    return maybeGoogleUrl;
  }
}

// ---------- Crawl one ----------
async function crawlOneSource(conf: SourceConfig): Promise<Candidate[]> {
  try {
    console.log(`  ├─ [${conf.id}] Parsing RSS...`);
    const feed = await parser.parseURL(conf.url);
    const items = (feed.items || []).slice(0, 30);
    console.log(`  ├─ [${conf.id}] Found ${items.length} items`);

    const out: Candidate[] = [];

    for (const it of items) {
      const rawTitle = normalizeText(it.title || '');
      if (!rawTitle) continue;

      const publishedAt = parsePublishedAt(it);
      const teaser = makeTeaser(it);
      const rawContent = extractContent(it) || rawTitle;

      const googleUrl = it.link ? String(it.link) : undefined;
      const baseUrl = googleUrl || conf.url;

      const sourceUrl = baseUrl.includes('news.google.com') ? await resolveFinalUrl(baseUrl) : baseUrl;

      // 0) 도메인 차단
      const b = shouldBlockByDomain(sourceUrl, googleUrl);
      if (b.blocked) continue;

      // 1) 언어감지
      const lang = detectLanguage(rawTitle + ' ' + rawContent);
      const isForeign = lang !== 'ko';

      // 2) 외국어인데 OpenAI 없으면 저장 스킵
      if (isForeign && (!isOpenAIAvailable || !openai)) continue;

      // 3) 한국어는 선필터
      if (!isForeign && !isAddictionRelated(rawTitle, rawContent)) continue;

      const shortTitle = rawTitle.length > 48 ? rawTitle.slice(0, 48) + '...' : rawTitle;
      const prefix = lang === 'ko' ? '[KO]' : lang === 'en' ? '[EN→KO]' : lang === 'ja' ? '[JA→KO]' : lang === 'zh' ? '[ZH→KO]' : '[OTHER→KO]';
      console.log(`  │   ${prefix} ${shortTitle}`);

      // 4) 번역/요약 팩
      const pack = await generateKoreanPack(rawTitle, rawContent, lang);

      // 5) 외국어는 title/summary 없으면 스킵(저장 스킵 정책)
      if (isForeign && (!pack.titleKo.trim() || !pack.summary.trim())) continue;

      const titleKo = isForeign ? pack.titleKo.trim() : rawTitle;
      const summaryKo = isForeign ? pack.summary : enforceThreeLines(pack.summary || rawContent.slice(0, 400), rawTitle);
      const keywordsKo = pack.keywords || [];

      // 6) 외국어 후필터(번역된 결과 기반)
      if (isForeign) {
        const basis = `${titleKo}\n${summaryKo}\n${keywordsKo.join(' ')}`;
        if (!isAddictionRelated(basis, basis)) continue;
      }

      out.push({
        title: titleKo,
        originalTitle: rawTitle,
        teaser,
        summary: summaryKo,
        keywords: keywordsKo,
        category: conf.category,
        region: conf.region,
        source: conf.sourceName,
        sourceUrl,
        googleUrl,
        origin: 'crawler',
        isTop: false,
        isFeature: false,
        publishedAt,
        lang,
        isForeign,
        blocked: false,
      });
    }

    console.log(`  └─ [${conf.id}] Done: ${out.length} collected\n`);
    return out;
  } catch (e: any) {
    console.error(`  └─ [${conf.id}] ❌ ERROR:`, e?.message || e);
    return [];
  }
}

// ---------- Duplicate ----------
async function isDuplicate(repo: any, c: Candidate): Promise<boolean> {
  const hit1 = await repo.findOne({ where: { sourceUrl: c.sourceUrl } });
  if (hit1) return true;
  if (c.googleUrl) {
    const hit2 = await repo.findOne({ where: { googleUrl: c.googleUrl } });
    if (hit2) return true;
  }
  const hit3 = await repo.findOne({ where: { title: c.title, publishedAt: c.publishedAt, source: c.source } });
  return !!hit3;
}

// ---------- Save ----------
async function saveCandidates(list: Candidate[]) {
  const repo = ds.getRepository(Article);
  let inserted = 0;
  let dup = 0;

  console.log(`\n💾 Saving to DB (${list.length} candidates)...`);
  for (const c of list) {
    if (await isDuplicate(repo, c)) {
      dup++;
      continue;
    }
    const ent = repo.create({
      title: c.title,                         // 한국어 제목
      originalTitle: c.originalTitle ?? null, // 원문 제목
      teaser: c.teaser ?? null,
      summary: c.summary,
      category: c.category,
      region: c.region,
      source: c.source,
      sourceUrl: c.sourceUrl,
      googleUrl: c.googleUrl ?? null,
      origin: c.origin,
      isTop: c.isTop,
      isFeature: c.isFeature,
      publishedAt: c.publishedAt,
      lang: c.lang,
      isForeign: c.isForeign,
      keywords: c.keywords?.length ? c.keywords : null,
      blocked: c.blocked,
      blockedReason: c.blockedReason ?? null,
    });
    await repo.save(ent);
    inserted++;
    if (inserted % 20 === 0) console.log(`  ├─ ${inserted} saved...`);
  }
  console.log(`  └─ Save complete! inserted=${inserted}, duplicates=${dup}\n`);
  return { inserted, dup };
}

// ---------- Main ----------
async function main() {
  console.log('\n========================================');
  console.log('🚀 Addicted News Crawler v3.2 START');
  console.log('========================================\n');

  // 테스트를 위해 "오늘 실행됨" 락이 걸리면, 아래를 임시로 주석 처리해도 됩니다.
  if (await hasRunToday()) {
    console.log('⏭️  Already ran today. (logs/last_crawl.json)');
    console.log('   테스트하려면 logs/last_crawl.json 삭제 후 재실행하세요.\n');
    return;
  }

  isOpenAIAvailable = initializeOpenAI();

  await ds.initialize();
  console.log('✅ Database connected\n');

  const all: Candidate[] = [];
  console.log(`📡 Crawling ${SOURCES.length} sources...\n`);

  for (let i = 0; i < SOURCES.length; i++) {
    const conf = SOURCES[i];
    console.log(`[${i + 1}/${SOURCES.length}] ${conf.sourceName} (${conf.category} / ${conf.region})`);
    const got = await crawlOneSource(conf);
    all.push(...got);
  }

  await saveCandidates(all);

  console.log('========================================');
  console.log(`✅ END. Collected=${all.length}, AI Calls=${apiCallCount}`);
  console.log('========================================\n');

  await markRunToday();
  await ds.destroy();
}

main().catch(async (e) => {
  console.error('\n❌ CRITICAL ERROR:', e);
  try { if (ds.isInitialized) await ds.destroy(); } catch {}
  process.exit(1);
});
