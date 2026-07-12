// backend/src/crawler/newsCrawler.ts
// v4.0 - 중독 필터 강화, 외국 기사 비율 증가
import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import Parser from 'rss-parser';
import * as fs from 'fs';
import * as path from 'path';
import { Article } from '../articles/article.entity';
import { SOURCES, SourceConfig, CategoryName, AD_PENALTY_KEYWORDS, SourceType } from './sourceConfig';
import { summarizeKoreanDeepSeek, deepseekAvailable } from './deepseek_summary';
import { extractArticleBody } from './article_extractor';
import { matchesAddictionKeywords } from './addictionFilter';

type RssItem = {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  'content:encoded'?: string;
  description?: string;
  enclosure?: { url?: string; type?: string };
  'media:content'?: { $?: { url?: string } };
  'media:thumbnail'?: { $?: { url?: string } };
};

type Candidate = {
  title: string;
  originalTitle: string | null;
  teaser: string | null;
  summary: string;
  keywords: string[];
  category: CategoryName;
  region: string;
  source: string;
  sourceUrl: string;
  googleUrl: string | null;
  imageUrl: string | null;
  origin: string;
  isTop: boolean;
  isFeature: boolean;
  publishedAt: string;
  lang: 'ko' | 'en' | 'ja' | 'zh' | 'other';
  isForeign: boolean;
  blocked: boolean;
  blockedReason: string | null;
  sourceType: SourceType;
  outletId: string;
};

const parser = new Parser<RssItem>({
  customFields: { 
    item: ['source', 'media:content', 'media:thumbnail', 'content:encoded', 'description', 'enclosure'] 
  },
});

// ---------- 설정값 ----------
const MAX_FOREIGN_ARTICLES = Number(process.env.MAX_FOREIGN_ARTICLES ?? 100);  // 50→100 증가
const ENABLE_IMAGE_EXTRACT = process.env.ENABLE_IMAGE_EXTRACT !== 'false';
const MIN_ADDICTION_SCORE = 2;  // 카테고리 분류용 참고(채택 게이트는 addictionFilter)
const SKIP_DAILY_CHECK = process.env.SKIP_DAILY_CHECK === 'true';  // true면 하루 1회 제한 해제

let foreignArticleCount = 0;
let crawlStats = {
  itemsSeen: 0,
  filterPass: 0,
  filterSkip: 0,
  failedFeeds: [] as string[],
};

let apiCallCount = 0;
let lastResetTime = Date.now();

async function rateLimitedDelay() {
  const now = Date.now();
  if (now - lastResetTime > 60000) { apiCallCount = 0; lastResetTime = now; }
  if (apiCallCount >= 300) {
    await new Promise((r) => setTimeout(r, 60000 - (now - lastResetTime)));
    apiCallCount = 0; lastResetTime = Date.now();
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
    return lastRun.getFullYear() === today.getFullYear() &&
           lastRun.getMonth() === today.getMonth() &&
           lastRun.getDate() === today.getDate();
  } catch { return false; }
}

async function markRunToday(): Promise<void> {
  const logsDir = path.join(__dirname, '../../logs');
  const lockFile = path.join(__dirname, '../../logs/last_crawl.json');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const runTime = new Date();
  fs.writeFileSync(lockFile, JSON.stringify({
    lastRun: runTime.toISOString(), timestamp: Date.now(),
    date: runTime.toLocaleDateString('ko-KR'), time: runTime.toLocaleTimeString('ko-KR')
  }, null, 2));
  console.log(`✅ Run log saved: ${runTime.toLocaleString('ko-KR')}\n`);
}

// ---------- Spam block ----------
const BLOCKED_DOMAINS = new Set<string>(['termokonteiner.ru']);

function getHostname(url?: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch { return ''; }
}

function shouldBlockByDomain(sourceUrl: string, googleUrl?: string): boolean {
  const host = getHostname(sourceUrl) || getHostname(googleUrl);
  return host ? BLOCKED_DOMAINS.has(host) : false;
}

// ---------- 이미지 URL 검증 ----------
const BLOCKED_IMAGE_PATTERNS = [
  'google.com/images', 'gstatic.com', 'googleusercontent.com/proxy',
  'news.google.com', 'google-news', 'googlenews',
  'doubleclick', 'adsystem', 'adserver', 'tracking', 'pixel', 'beacon',
  'analytics', 'advertisement', 'banner', 'sponsor',
  'facebook.com/tr', 'twitter.com/favicon', 'linkedin.com/favicon',
  'favicon', 'logo', 'icon', 'placeholder', 'default', 'noimage', 'no-image',
  'blank.gif', 'spacer.gif', '1x1', 'transparent',
  'width=1', 'height=1', 'w=1', 'h=1',
];

function isValidImageUrl(url: string | null): boolean {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  for (const pattern of BLOCKED_IMAGE_PATTERNS) {
    if (lowerUrl.includes(pattern)) return false;
  }
  const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const validImageServices = ['cloudinary', 'imgix', 'amazonaws.com', 'wp-content/uploads'];
  const hasValidExtension = validExtensions.some(ext => lowerUrl.includes(ext));
  const isImageService = validImageServices.some(svc => lowerUrl.includes(svc));
  if (url.length < 30) return false;
  return hasValidExtension || isImageService || lowerUrl.includes('/image') || lowerUrl.includes('/photo');
}

// ---------- v4.0: 강화된 중독 키워드 시스템 ----------
const VALID_CATEGORIES: CategoryName[] = [
  '중독정책',
  '알코올·약물중독',
  '도박중독',
  '게임·디지털중독',
  '중독사회와 회복',
];

// 핵심 중독 키워드 (가중치 2점)
const CORE_ADDICTION_KEYWORDS = [
  // 한국어 핵심
  '중독', '의존증', '과몰입', '재활', '단주', '단도박', '회복',
  // 영어 핵심
  'addiction', 'addicted', 'addictive', 'dependency', 'disorder', 'rehab', 'recovery', 'withdrawal',
  // 일본어 핵심
  '依存症', '依存', 'アディクション',
  // 중국어 핵심
  '成瘾', '戒断', '康复',
];

// 카테고리별 키워드 (가중치 1점) — '중독사회와 회복'은 일반 의료(병원·클리닉 등) 제거, 사회·회복 키워드 중심
const CATEGORY_KEYWORDS: Record<CategoryName, string[]> = {
  '중독정책': [
    '정책', '규제', '법안', '대책', '예방', '교육', '법률', '정부', '위원회', '입법',
    'legislation', 'regulation', 'policy', 'law', 'government',
    '政策', '規制', '法案',
  ],
  '알코올·약물중독': [
    '알코올', '마약', '오피오이드', '펜타닐', '필로폰', '음주', '약물', '대마', '단주', '금주',
    '헤로인', '코카인', '메스암페타민', '처방약',
    'opioid', 'fentanyl', 'alcohol', 'drug', 'substance', 'overdose',
    'アルコール', '薬物', 'オピオイド',
    '酒精', '毒品',
  ],
  '도박중독': [
    '도박', '베팅', '카지노', '토토', '스포츠베팅', '복권', '사행', '불법도박', '온라인도박', '단도박',
    'gambling', 'betting', 'casino', 'lottery',
    'ギャンブル', 'パチンコ', 'カジノ',
    '赌博', '博彩',
  ],
  '게임·디지털중독': [
    '게임', '스마트폰', 'SNS', '인터넷', '디지털', 'AI중독', '과몰입', '유튜브', '틱톡', '온라인',
    'AI', '인공지능', '알고리즘', '화면', '스크린',
    'gaming', 'game', 'smartphone', 'screen time', 'internet', 'digital',
    'ゲーム', 'スマホ', 'SNS',
    '游戏', '手机', '网络',
  ],
  '중독사회와 회복': [
    '공동체', '회복', '상담', '라파', '자조모임', '단주', '단도박',
    '고립', '외로움', '양극화', '사회적 자본', '사회구조', '은둔',
    '불평등', '주민자치', '재활', '가족 지원',
  ],
};

function isPromotionalAd(title: string, content: string): boolean {
  const text = (title + ' ' + content).toLowerCase();
  if (AD_PENALTY_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()))) return true;
  const specialChars = text.match(/[!@#$%^&*()_+={}\[\]|\\:;"'<>,.?\/~`]/g) || [];
  return specialChars.length > 50;
}

function hasCoreAddictionKeyword(title: string, content: string): boolean {
  const text = (title + ' ' + content).toLowerCase();
  return CORE_ADDICTION_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

/** 카테고리별 적합도: 회복 카테고리는 핵심 중독 키워드 없으면 0(일반 의료·사회면사 배제) */
function categoryFitScore(title: string, content: string, category: CategoryName): number {
  if (isPromotionalAd(title, content)) return -100;
  const text = (title + ' ' + content).toLowerCase();
  const t = title.toLowerCase();
  const hasCore = hasCoreAddictionKeyword(title, content);
  if (category === '중독사회와 회복' && !hasCore) return 0;

  let score = 0;
  for (const kw of CORE_ADDICTION_KEYWORDS) {
    const k = kw.toLowerCase();
    if (text.includes(k)) {
      score += 2;
      if (t.includes(k)) score += 1;
    }
  }
  for (const kw of CATEGORY_KEYWORDS[category]) {
    const k = kw.toLowerCase();
    if (text.includes(k)) score += 1;
  }
  return score;
}

// v4.0: 중독 관련성 점수 (저장 게이트) — 광고 차단 + 핵심 중독 키워드 필수
function calculateAddictionScore(title: string, content: string): number {
  if (isPromotionalAd(title, content)) return -100;
  const text = (title + ' ' + content).toLowerCase();
  if (!hasCoreAddictionKeyword(title, content)) return 0;

  let score = 0;
  for (const kw of CORE_ADDICTION_KEYWORDS) {
    const k = kw.toLowerCase();
    if (text.includes(k)) {
      score += 2;
      if (title.toLowerCase().includes(k)) score += 1;
    }
  }
  for (const cat of VALID_CATEGORIES) {
    for (const kw of CATEGORY_KEYWORDS[cat]) {
      if (text.includes(kw.toLowerCase())) score += 1;
    }
  }
  return score;
}

// v4.0: 개선된 중독 관련성 필터
function isAddictionRelated(title: string, content: string): boolean {
  const score = calculateAddictionScore(title, content);
  return score >= MIN_ADDICTION_SCORE;
}

// 카테고리 분류
function normalizeCategory(category: string): CategoryName {
  if (category === 'AI중독') return '게임·디지털중독';
  if (category === '공동체' || category === '종교') return '중독사회와 회복';
  if (VALID_CATEGORIES.includes(category as CategoryName)) return category as CategoryName;
  return '중독사회와 회복';
}

function classifyCategory(title: string, content: string, defaultCategory: CategoryName): CategoryName {
  const def = normalizeCategory(defaultCategory);
  const scores: Record<CategoryName, number> = {
    '중독정책': 0, '알코올·약물중독': 0, '도박중독': 0, '게임·디지털중독': 0, '중독사회와 회복': 0,
  };
  for (const cat of VALID_CATEGORIES) {
    scores[cat] = categoryFitScore(title, content, cat);
  }
  let maxScore = -Infinity;
  let bestCategory: CategoryName = def;
  for (const cat of VALID_CATEGORIES) {
    const s = scores[cat];
    if (s > maxScore) {
      maxScore = s;
      bestCategory = cat;
    } else if (s === maxScore && cat === def) {
      bestCategory = def;
    }
  }
  if (maxScore < MIN_ADDICTION_SCORE) return def;
  return bestCategory;
}

function isValidCategory(category: string): category is CategoryName {
  return VALID_CATEGORIES.includes(category as CategoryName);
}

/** Google 검색·전문 기관 직접 RSS는 통과 점수 1, 그 외는 MIN_ADDICTION_SCORE */
function minAddictionPassScore(conf: SourceConfig): number {
  if (conf.id.includes('google') || conf.isSpecialized) return 1;
  return MIN_ADDICTION_SCORE;
}

// ---------- Lang detect ----------
type DetectedLang = 'ko' | 'en' | 'ja' | 'zh' | 'other';

function detectLanguage(text: string): DetectedLang {
  const s = (text || '').slice(0, 900);
  let ko = 0, ja = 0, zh = 0, latin = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if ((code >= 0xac00 && code <= 0xd7af) || (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f)) { ko++; }
    else if ((code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff)) { ja++; }
    else if (code >= 0x4e00 && code <= 0x9fff) { zh++; }
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) { latin++; }
  }
  const max = Math.max(ko, ja, zh, latin);
  if (max < 8) return 'other';
  if (max === ko) return 'ko';
  if (max === ja) return 'ja';
  if (max === zh) return 'zh';
  if (max === latin) return 'en';
  return 'other';
}

// ---------- Text utils ----------
function normalizeText(s: string): string {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
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

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parsePublishedAt(item: RssItem): string {
  const raw = item.isoDate || item.pubDate;
  if (!raw) return toYmd(new Date());
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? toYmd(new Date()) : toYmd(dt);
}

// ---------- 이미지 추출 ----------
function extractImageFromRss(item: RssItem): string | null {
  if (!ENABLE_IMAGE_EXTRACT) return null;
  
  if (item.enclosure?.url && item.enclosure.type?.startsWith('image/')) {
    if (isValidImageUrl(item.enclosure.url)) return item.enclosure.url;
  }
  
  const mediaContent = item['media:content'] as any;
  if (mediaContent?.$?.url && isValidImageUrl(mediaContent.$.url)) return mediaContent.$.url;
  if (Array.isArray(mediaContent) && mediaContent[0]?.$?.url && isValidImageUrl(mediaContent[0].$.url)) {
    return mediaContent[0].$.url;
  }
  
  const mediaThumbnail = item['media:thumbnail'] as any;
  if (mediaThumbnail?.$?.url && isValidImageUrl(mediaThumbnail.$.url)) return mediaThumbnail.$.url;
  if (Array.isArray(mediaThumbnail) && mediaThumbnail[0]?.$?.url && isValidImageUrl(mediaThumbnail[0].$.url)) {
    return mediaThumbnail[0].$.url;
  }
  
  const contentSources = [item['content:encoded'], item.content, item.description];
  for (const src of contentSources) {
    if (src) {
      const imgMatch = src.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch?.[1] && isValidImageUrl(imgMatch[1])) {
        return imgMatch[1];
      }
    }
  }
  return null;
}

async function extractOgImage(url: string): Promise<string | null> {
  if (!ENABLE_IMAGE_EXTRACT) return null;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    
    const html = await res.text();
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch?.[1]) {
      let imgUrl = ogMatch[1];
      if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
      else if (imgUrl.startsWith('/')) imgUrl = new URL(url).origin + imgUrl;
      if (isValidImageUrl(imgUrl)) return imgUrl;
    }
    return null;
  } catch { return null; }
}

async function getArticleImage(item: RssItem, sourceUrl: string): Promise<string | null> {
  const rssImage = extractImageFromRss(item);
  if (rssImage) return rssImage;
  const ogImage = await extractOgImage(sourceUrl);
  if (ogImage) return ogImage;
  return null;
}

// ---------- Summary ----------
function stripTitleEcho(lines: string[], title: string): string[] {
  const t = (title || '').trim();
  if (!t) return lines;
  return lines.filter((ln) => {
    const s = (ln || '').trim();
    return s && s !== t && !/^(제목|title)\s*[:：]/i.test(s);
  });
}

function enforceThreeLines(raw: string, title: string): string {
  const cleaned = (raw || '').replace(/\r/g, '').trim();
  let lines = stripTitleEcho(cleaned.split('\n').map(s => s.trim()).filter(s => s.length > 0), title);
  if (lines.length < 3) {
    lines = stripTitleEcho(cleaned.replace(/\s+/g, ' ').split(/(?<=[.!?。！？])\s+/).map(s => s.trim()).filter(s => s.length > 0), title);
  }
  const out: string[] = [];
  for (const ln of lines) { if (out.length >= 3) break; out.push(ln); }
  while (out.length < 3) out.push('기사의 핵심 쟁점과 중독 관련 함의를 추가 확인할 필요가 있습니다.');
  return out.map(s => /[.!?。！？]$/.test(s) ? s : s + '.').join('\n');
}

// ---------- OpenAI pack ----------
type AiPack = { titleKo: string; teaser: string; summary: string; keywords: string[]; suggestedCategory?: CategoryName };

function safeJsonParse<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

function compactKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  return keywords.map(k => String(k || '').trim()).filter(k => k.length > 0).slice(0, 12);
}

async function generateKoreanPack(originalTitle: string, content: string, lang: DetectedLang, defaultCategory: CategoryName): Promise<AiPack> {
  const isForeign = lang !== 'ko';

  // DeepSeek 통일: 한국어 요약 / 외국어 번역+요약
  const pack = await summarizeKoreanDeepSeek(originalTitle, content, { translate: isForeign });
  if (pack?.summary) {
    const teaser = pack.summary.replace(/\s+/g, ' ').slice(0, 220);
    return {
      titleKo: isForeign ? pack.titleKo : originalTitle,
      teaser,
      summary: pack.summary,
      keywords: [],
    };
  }

  // 안전망: DeepSeek 실패 시
  if (isForeign) {
    return { titleKo: '', teaser: '', summary: '', keywords: [] };
  }
  const summary = enforceThreeLines(content.slice(0, 400), originalTitle);
  const teaser = summary.replace(/\s+/g, ' ').slice(0, 220);
  return { titleKo: originalTitle, teaser, summary, keywords: [] };
}

/* OpenAI 외국어 경로 보존(미사용) — DeepSeek로 이전됨
async function generateKoreanPackOpenAI(...) { ... }
*/

// ---------- URL resolve ----------
async function resolveFinalUrl(maybeGoogleUrl: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(maybeGoogleUrl, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timeout);
    const finalUrl = res.url || maybeGoogleUrl;
    if (finalUrl.includes('news.google.com')) {
      const html = await res.text();
      const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
      if (m?.[1]) return m[1];
    }
    return finalUrl;
  } catch { return maybeGoogleUrl; }
}

// ---------- 중복 체크 ----------
function normalizeForDuplicateCheck(title: string): string {
  return (title || '').toLowerCase().replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, '').replace(/\s+/g, ' ').trim();
}

function extractCoreKeywords(title: string): Set<string> {
  const stopWords = new Set(['에서', '으로', '이다', '하는', '있는', '되는', '위한', '대한', '통해', '관련', '오늘', '내일', '어제']);
  const normalized = normalizeForDuplicateCheck(title);
  const words = normalized.split(' ').filter(w => w.length >= 2 && !stopWords.has(w));
  return new Set(words);
}

function calculateTitleSimilarity(title1: string, title2: string): number {
  const kw1 = extractCoreKeywords(title1);
  const kw2 = extractCoreKeywords(title2);
  if (kw1.size === 0 || kw2.size === 0) return 0;
  let intersection = 0;
  for (const kw of kw1) { if (kw2.has(kw)) intersection++; }
  const union = kw1.size + kw2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

const seenTitles: Map<string, string> = new Map();

function isDuplicateInSession(title: string): boolean {
  const normalized = normalizeForDuplicateCheck(title);
  if (seenTitles.has(normalized)) return true;
  for (const [seenNorm, seenOrig] of seenTitles.entries()) {
    const similarity = calculateTitleSimilarity(title, seenOrig);
    if (similarity >= 0.5) {
      console.log(`  │   ⚠️ 유사 기사 스킵 (${Math.round(similarity * 100)}%): ${title.slice(0, 30)}...`);
      return true;
    }
  }
  seenTitles.set(normalized, title);
  return false;
}

/**
 * rss-parser가 내부적으로 Node `url.parse` + `http(s).get`을 쓰는데,
 * 쿼리에 한글·일문·따옴표 등이 그대로 있으면 "Request path contains unescaped characters"가 난다.
 * WHATWG URL로 직렬화하면 퍼센트 인코딩된 href가 되어 동일 피드도 정상 요청된다.
 */
function normalizeRssFeedUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  try {
    return new URL(s).href;
  } catch {
    return s;
  }
}

// ---------- Crawl one ----------
async function crawlOneSource(conf: SourceConfig): Promise<Candidate[]> {
  try {
    if (conf.verifiedByFetch === false) {
      console.log(`  ├─ [${conf.id}] verified_by_fetch=false — 시도 후 실패 시 스킵`);
    }
    console.log(`  ├─ [${conf.id}] Parsing RSS...`);
    const feed = await parser.parseURL(normalizeRssFeedUrl(conf.url));
    const items = (feed.items || []).slice(0, 30);
    console.log(`  ├─ [${conf.id}] Found ${items.length} items`);

    const out: Candidate[] = [];

    for (const it of items) {
      crawlStats.itemsSeen++;
      const rawTitle = normalizeText(it.title || '');
      if (!rawTitle) continue;
      if (isDuplicateInSession(rawTitle)) continue;

      const publishedAt = parsePublishedAt(it);
      // 1) RSS 스니펫 → 중독 필터 → (필요 시) 원문 추출 후 재검사 → 요약 재료
      let rawContent = extractContent(it);
      const itemLink = it.link ? String(it.link) : '';

      let addictionOk = matchesAddictionKeywords(rawTitle, rawContent || '');
      if (!addictionOk && (rawContent || '').length >= 200) {
        crawlStats.filterSkip++;
        continue;
      }
      if ((!addictionOk || !rawContent || rawContent.length < 200) && itemLink) {
        const body = await extractArticleBody(itemLink);
        if (body && body.length > (rawContent || '').length) {
          console.log(`  │   📄 원문추출 ${body.length}자`);
          rawContent = body;
          addictionOk = matchesAddictionKeywords(rawTitle, rawContent);
        }
      }
      if (!rawContent) rawContent = rawTitle;
      const googleUrl = itemLink || null;
      const baseUrl = googleUrl || conf.url;
      const sourceUrl = baseUrl.includes('news.google.com') ? await resolveFinalUrl(baseUrl) : baseUrl;

      if (shouldBlockByDomain(sourceUrl, googleUrl || undefined)) continue;

      // 채택 게이트: addictionFilter (strong≥1 && negative==0)
      if (!addictionOk) {
        crawlStats.filterSkip++;
        continue;
      }
      if (isPromotionalAd(rawTitle, rawContent)) {
        crawlStats.filterSkip++;
        continue;
      }
      crawlStats.filterPass++;

      const lang = detectLanguage(rawTitle + ' ' + rawContent);
      const isForeign = lang !== 'ko';

      if (isForeign) {
        if (MAX_FOREIGN_ARTICLES === 0) continue;
        if (foreignArticleCount >= MAX_FOREIGN_ARTICLES) continue;
        if (!deepseekAvailable) continue;
      }

      const shortTitle = rawTitle.length > 48 ? rawTitle.slice(0, 48) + '...' : rawTitle;
      const prefix = lang === 'ko' ? '[KO]' : `[${lang.toUpperCase()}→KO]`;
      console.log(`  │   ${prefix} ${shortTitle}`);

      const pack = await generateKoreanPack(rawTitle, rawContent, lang, normalizeCategory(conf.category));
      if (isForeign && (!pack.titleKo.trim() || !pack.summary.trim())) continue;

      if (isForeign) foreignArticleCount++;

      const titleKo = isForeign ? pack.titleKo.trim() : rawTitle;
      const teaserKo = pack.teaser || null;
      const summaryKo = isForeign
        ? pack.summary
        : (pack.summary && pack.summary.trim()
            ? pack.summary
            : enforceThreeLines(rawContent.slice(0, 400), rawTitle));
      const keywordsKo = pack.keywords || [];

      let finalCategory: CategoryName = pack.suggestedCategory 
        ? normalizeCategory(pack.suggestedCategory)
        : classifyCategory(titleKo, summaryKo + ' ' + keywordsKo.join(' '), normalizeCategory(conf.category));

      const imageUrl = await getArticleImage(it, sourceUrl);

      out.push({
        title: titleKo, originalTitle: rawTitle, teaser: teaserKo, summary: summaryKo,
        keywords: keywordsKo, category: finalCategory, region: conf.region, source: conf.sourceName,
        sourceUrl, googleUrl, imageUrl, origin: 'crawler', isTop: false, isFeature: false,
        publishedAt, lang, isForeign, blocked: false, blockedReason: null,
        sourceType: conf.sourceType, outletId: conf.outletId,
      });
    }

    console.log(`  └─ [${conf.id}] Done: ${out.length} collected\n`);
    return out;
  } catch (e: any) {
    console.error(`  └─ [${conf.id}] ❌ ERROR (스킵 후 계속):`, e?.message || e);
    crawlStats.failedFeeds.push(`${conf.id} (${conf.sourceName}): ${e?.message || e}`);
    return [];
  }
}

// ---------- Statory news discovery (C-6-c) ----------
function _displaySource(collectMethod: string): string {
  const map: Record<string, string> = {
    gnews_rss: 'Google News',
    gdelt: 'GDELT',
    naver_news: '네이버뉴스',
    mediacloud: 'MediaCloud',
    world_press_rss: 'World Press',
  };
  const key = (collectMethod || '').trim();
  return map[key] ?? (key || 'Statory');
}

function resolveStatoryPublishedAt(item: Record<string, unknown>): string {
  const pubYear = item.pub_year;
  if (typeof pubYear === 'number' && pubYear > 0) {
    return `${pubYear}-01-01`;
  }
  if (pubYear != null && !Number.isNaN(Number(pubYear))) {
    const y = Number(pubYear);
    if (y > 0) return `${y}-01-01`;
  }
  const meta = item.source_meta;
  if (meta && typeof meta === 'object') {
    for (const key of ['published', 'published_at', 'pubdate']) {
      const val = (meta as Record<string, unknown>)[key];
      if (val == null) continue;
      const dt = new Date(String(val));
      if (!Number.isNaN(dt.getTime())) return toYmd(dt);
    }
  }
  return toYmd(new Date());
}

function statoryItemToCandidate(item: Record<string, unknown>, query: string): Candidate | null {
  const titleRaw = typeof item.title === 'string' ? item.title : '';
  const title = normalizeText(titleRaw);
  if (!title) return null;

  const abstract =
    typeof item.abstract_text === 'string' ? item.abstract_text.trim() : '';
  const url = typeof item.url === 'string' && item.url.trim() ? item.url.trim() : '#';
  const collectMethod =
    typeof item.collect_method === 'string' ? item.collect_method : '';
  const region = process.env.STATORY_NEWS_REGION_HINT?.trim() || 'KR';
  const lang = detectLanguage(`${title} ${abstract}`);

  return {
    title,
    originalTitle: titleRaw.trim() || title,
    teaser: null,
    summary: abstract,
    keywords: query ? [query] : [],
    category: '중독사회와 회복',
    region,
    source: _displaySource(collectMethod),
    sourceUrl: url,
    googleUrl: null,
    imageUrl: null,
    origin: 'statory',
    isTop: false,
    isFeature: false,
    publishedAt: resolveStatoryPublishedAt(item),
    lang,
    isForeign: lang !== 'ko',
    blocked: false,
    blockedReason: null,
    sourceType: 'aggregator',
    outletId: collectMethod || 'statory',
  };
}

async function finalizeStatoryCandidate(
  partial: Candidate,
  _minScore: number,
): Promise<Candidate | null> {
  const rawTitle = normalizeText(partial.originalTitle || partial.title);
  if (!rawTitle) return null;
  if (isDuplicateInSession(rawTitle)) return null;

  const rawContent = partial.summary || rawTitle;
  if (shouldBlockByDomain(partial.sourceUrl)) return null;

  const lang = partial.lang;
  const isForeign = partial.isForeign;

  if (isForeign) {
    if (MAX_FOREIGN_ARTICLES === 0) return null;
    if (foreignArticleCount >= MAX_FOREIGN_ARTICLES) return null;
    if (!deepseekAvailable) return null;
  }

  if (!matchesAddictionKeywords(rawTitle, rawContent)) return null;
  if (isPromotionalAd(rawTitle, rawContent)) return null;

  const pack = await generateKoreanPack(rawTitle, rawContent, lang, partial.category);
  if (isForeign && (!pack.titleKo.trim() || !pack.summary.trim())) return null;

  if (isForeign) foreignArticleCount++;

  const titleKo = isForeign ? pack.titleKo.trim() : rawTitle;
  const teaserKo = pack.teaser || null;
  const summaryKo = isForeign
    ? pack.summary
    : (pack.summary && pack.summary.trim()
        ? pack.summary
        : enforceThreeLines(rawContent.slice(0, 400), rawTitle));
  const keywordsKo = pack.keywords.length > 0 ? pack.keywords : partial.keywords;

  const finalCategory: CategoryName = pack.suggestedCategory
    ? normalizeCategory(pack.suggestedCategory)
    : classifyCategory(
        titleKo,
        `${summaryKo} ${keywordsKo.join(' ')}`,
        partial.category,
      );

  return {
    ...partial,
    title: titleKo,
    originalTitle: rawTitle,
    teaser: teaserKo,
    summary: summaryKo,
    keywords: keywordsKo,
    category: finalCategory,
    lang,
    isForeign,
  };
}

async function loadStatoryCandidates(): Promise<Candidate[]> {
  const base = process.env.STATORY_API_URL?.trim();
  if (!base || !/^https?:\/\//i.test(base)) return [];

  try {
    const query = process.env.STATORY_NEWS_QUERY?.trim() ?? '중독';
    const limitRaw = process.env.STATORY_NEWS_LIMIT;
    const parsedLimit = limitRaw ? parseInt(limitRaw, 10) : 20;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 20;
    const regionHint = process.env.STATORY_NEWS_REGION_HINT?.trim() ?? 'KR';

    const res = await fetch(`${base.replace(/\/+$/, '')}/api/search/news`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        limit,
        region_hint: regionHint,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      success?: boolean;
      items?: unknown[];
    };
    if (json?.success === false) return [];

    const items = Array.isArray(json?.items) ? json.items : [];
    const minScore = 1;
    const out: Candidate[] = [];

    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const partial = statoryItemToCandidate(it as Record<string, unknown>, query);
      if (!partial) continue;
      const finalized = await finalizeStatoryCandidate(partial, minScore);
      if (finalized) out.push(finalized);
    }
    return out;
  } catch (e) {
    console.warn('[statory] news fetch failed:', e);
    return [];
  }
}

// ---------- DB 중복 체크 ----------
async function isDuplicateInDb(repo: any, c: Candidate): Promise<boolean> {
  if (await repo.findOne({ where: { sourceUrl: c.sourceUrl } })) return true;
  if (c.googleUrl && await repo.findOne({ where: { googleUrl: c.googleUrl } })) return true;
  if (await repo.findOne({ where: { title: c.title, publishedAt: c.publishedAt, source: c.source } })) return true;
  const sameDayArticles = await repo.find({ where: { publishedAt: c.publishedAt } });
  for (const existing of sameDayArticles) {
    if (calculateTitleSimilarity(c.title, existing.title) >= 0.5) return true;
  }
  return false;
}

// ---------- Save ----------
async function saveCandidates(list: Candidate[]) {
  const repo = ds.getRepository(Article);
  let inserted = 0, dup = 0, withImage = 0;

  console.log(`\n💾 Saving to DB (${list.length} candidates)...`);
  for (const c of list) {
    if (await isDuplicateInDb(repo, c)) { dup++; continue; }
    
    let safeKeywords: string[] | null = null;
    try {
      if (c.keywords && Array.isArray(c.keywords) && c.keywords.length > 0) {
        safeKeywords = c.keywords.map(k => String(k).trim()).filter(k => k.length > 0 && k.length < 100);
        if (safeKeywords.length === 0) safeKeywords = null;
      }
    } catch { safeKeywords = null; }

    try {
      const ent = repo.create({
        title: c.title, originalTitle: c.originalTitle, teaser: c.teaser, summary: c.summary,
        category: c.category, region: c.region, source: c.source, sourceUrl: c.sourceUrl,
        googleUrl: c.googleUrl, imageUrl: c.imageUrl, origin: c.origin, isTop: c.isTop,
        isFeature: c.isFeature, publishedAt: c.publishedAt, lang: c.lang, isForeign: c.isForeign,
        keywords: safeKeywords, blocked: c.blocked, blockedReason: c.blockedReason,
        sourceType: c.sourceType, outletId: c.outletId,
      });
      await repo.save(ent);
      inserted++;
      if (c.imageUrl) withImage++;
      if (inserted % 20 === 0) console.log(`  ├─ ${inserted} saved...`);
    } catch (e: any) {
      try {
        const ent = repo.create({
          title: c.title, originalTitle: c.originalTitle, teaser: c.teaser, summary: c.summary,
          category: c.category, region: c.region, source: c.source, sourceUrl: c.sourceUrl,
          googleUrl: c.googleUrl, imageUrl: c.imageUrl, origin: c.origin, isTop: c.isTop,
          isFeature: c.isFeature, publishedAt: c.publishedAt, lang: c.lang, isForeign: c.isForeign,
          keywords: null, blocked: c.blocked, blockedReason: c.blockedReason,
          sourceType: c.sourceType, outletId: c.outletId,
        });
        await repo.save(ent);
        inserted++;
        if (c.imageUrl) withImage++;
      } catch {}
    }
  }
  console.log(`  └─ Save complete! inserted=${inserted}, duplicates=${dup}, withImage=${withImage}\n`);
  return { inserted, dup, withImage };
}

// ---------- Main ----------
async function main() {
  const startTime = Date.now();
  
  console.log('\n========================================');
  console.log('🚀 Addicted News Crawler v5.0 START');
  console.log('   - 세계신문 60 + 국내 10 + 국내구글 소수');
  console.log('   - 중독 키워드 필터 + DeepSeek 한/영 요약');
  console.log('   - DeepSeek:', deepseekAvailable ? 'ON' : 'OFF');
  console.log('   - 하루 1회 제한: ' + (SKIP_DAILY_CHECK ? '해제' : '적용'));
  console.log('========================================\n');

  // 하루 1회 제한 체크 (SKIP_DAILY_CHECK=true면 스킵)
  if (!SKIP_DAILY_CHECK && await hasRunToday()) {
    console.log('⏭️  Already ran today. (logs/last_crawl.json)');
    console.log('   제한 해제: set SKIP_DAILY_CHECK=true');
    console.log('   또는: del logs\\last_crawl.json 후 재실행\n');
    return;
  }

  await ds.initialize();
  console.log('✅ Database connected\n');

  let crawlSources = [...SOURCES].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  const typeFilter = (process.env.CRAWL_SOURCE_TYPES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (typeFilter.length) {
    crawlSources = crawlSources.filter((s) => typeFilter.includes(s.sourceType));
    console.log(`⚠️  CRAWL_SOURCE_TYPES=${typeFilter.join(',')} — ${crawlSources.length}개\n`);
  }
  const maxSrc = Number(process.env.CRAWL_MAX_SOURCES || 0);
  if (maxSrc > 0) {
    crawlSources = crawlSources.slice(0, maxSrc);
    console.log(`⚠️  CRAWL_MAX_SOURCES=${maxSrc} — ${crawlSources.length}개만 실행\n`);
  }
  const all: Candidate[] = [];
  console.log(`📡 Crawling ${crawlSources.length} sources...\n`);

  for (let i = 0; i < crawlSources.length; i++) {
    const conf = crawlSources[i];
    console.log(`[${i + 1}/${crawlSources.length}] ${conf.sourceName} (${conf.category})`);
    const got = await crawlOneSource(conf);
    all.push(...got);
  }

  const statoryCands = await loadStatoryCandidates();
  all.push(...statoryCands);

  const result = await saveCandidates(all);
  const elapsed = Math.round((Date.now() - startTime) / 1000);

  // 통계 출력
  const koreanCount = all.filter(a => !a.isForeign).length;
  const foreignCount = all.filter(a => a.isForeign).length;
  const categoryStats: Record<string, number> = {};
  for (const a of all) {
    categoryStats[a.category] = (categoryStats[a.category] || 0) + 1;
  }

  const passRate = crawlStats.itemsSeen > 0
    ? ((crawlStats.filterPass / crawlStats.itemsSeen) * 100).toFixed(1)
    : '0.0';
  console.log('========================================');
  console.log(`✅ END in ${Math.floor(elapsed/60)}분 ${elapsed%60}초`);
  console.log(`   수집: ${all.length}개 (한국 ${koreanCount}, 외국 ${foreignCount})`);
  const krRatioPct = all.length > 0 ? (koreanCount / all.length) * 100 : 0;
  console.log(`   한국 콘텐츠 비중: ${krRatioPct.toFixed(1)}% (목표 참고 30%)`);
  console.log(`   저장: ${result.inserted}개, 이미지: ${result.withImage}개`);
  console.log(`   필터: 후보 ${crawlStats.itemsSeen} → 통과 ${crawlStats.filterPass} / 스킵 ${crawlStats.filterSkip} (통과율 ${passRate}%)`);
  if (crawlStats.failedFeeds.length) {
    console.log(`   실패 피드 ${crawlStats.failedFeeds.length}건 (스킵):`);
    for (const f of crawlStats.failedFeeds) console.log(`     - ${f}`);
  }
  console.log(`   DeepSeek 호출 추적(apiCallCount): ${apiCallCount}회`);
  console.log('\n   카테고리별:');
  for (const [cat, count] of Object.entries(categoryStats)) {
    console.log(`     - ${cat}: ${count}개`);
  }
  console.log('========================================\n');

  await markRunToday();
  await ds.destroy();
}

main().catch(async (e) => {
  console.error('\n❌ CRITICAL ERROR:', e);
  try { if (ds.isInitialized) await ds.destroy(); } catch {}
  process.exit(1);
});