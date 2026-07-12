// backend/src/crawler/sourceConfig.ts
// v5.1 — 세계신문 60 + 국내 10 + 중독전문 4 + 국내 구글 소수
import * as fs from 'fs';
import * as path from 'path';

export const AD_PENALTY_KEYWORDS = [
  '가입코드', '추천인', '공식주소', '입금플러스', '꽁머니',
  '안전놀이터', '수익보장', '텔레그램 문의', '단톡방', '롤링', '마틴루틴',
];

export type CategoryName =
  | '중독정책'
  | '알코올·약물중독'
  | '도박중독'
  | '게임·디지털중독'
  | '중독사회와 회복';

export type SourceType = 'world_press' | 'kr_press' | 'specialty' | 'aggregator';

export interface SourceConfig {
  id: string;
  url: string;
  sourceName: string;
  category: CategoryName;
  region: string;
  lang: string;
  sourceType: SourceType;
  outletId: string;
  verifiedByFetch?: boolean;
  /** 전문 기관/직접 RSS — 중독 점수 통과 임계값 완화(1점) */
  isSpecialized?: boolean;
  /** 수집 순서(낮을수록 먼저, 미지정 100) */
  priority?: number;
}

const DATA_DIR = path.join(__dirname, '../../data');

function loadJson<T>(name: string): T | null {
  const p = path.join(DATA_DIR, name);
  try {
    if (!fs.existsSync(p)) {
      console.warn(`[sourceConfig] missing ${p}`);
      return null;
    }
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch (e) {
    console.warn(`[sourceConfig] failed to load ${name}:`, e);
    return null;
  }
}

function categoryForRegion(regionId: string): CategoryName {
  // 기본 버킷 — 키워드 필터 통과 후 classifyCategory 가 재분류할 수 있음
  if (regionId === 'kr') return '중독사회와 회복';
  if (regionId === 'specialty') return '중독사회와 회복';
  return '중독사회와 회복';
}

function loadWorldPress(): SourceConfig[] {
  const raw = loadJson<{ feeds?: Array<Record<string, unknown>> }>('world_press_rss.json');
  const feeds = raw?.feeds;
  if (!Array.isArray(feeds)) return [];
  const out: SourceConfig[] = [];
  feeds.forEach((f, i) => {
    const rss = String(f.rss_url || '').trim();
    if (!rss) return;
    const outletId = String(f.outlet_id || f.feed_id || `wp-${i}`);
    const nameEn = String(f.name_en || outletId);
    const regionId = String(f.region_id || 'global');
    const lang = String(f.lang_primary || 'en');
    const feedId = String(f.feed_id || outletId);
    const verified = f.verified_by_fetch !== false;
    out.push({
      id: `wp-${feedId}`,
      url: rss,
      sourceName: nameEn,
      category: categoryForRegion(regionId),
      region: regionId,
      lang,
      sourceType: 'world_press',
      outletId,
      verifiedByFetch: verified,
      isSpecialized: true,
      priority: 20,
    });
  });
  return out;
}

function loadKrPress(): SourceConfig[] {
  const raw = loadJson<{ feeds?: Array<Record<string, unknown>> }>('kr_press_rss.json');
  const feeds = raw?.feeds;
  if (!Array.isArray(feeds)) return [];
  const out: SourceConfig[] = [];
  feeds.forEach((f, i) => {
    const rss = String(f.rss_url || '').trim();
    if (!rss) return;
    const outletId = String(f.outlet_id || `kr-${i}`);
    out.push({
      id: `kr-press-${outletId}`,
      url: rss,
      sourceName: outletId,
      category: '중독사회와 회복',
      region: String(f.region_id || 'kr'),
      lang: String(f.lang_primary || 'ko'),
      sourceType: 'kr_press',
      outletId,
      verifiedByFetch: true,
      isSpecialized: true,
      priority: 10,
    });
  });
  return out;
}

function loadSpecialtyPress(): SourceConfig[] {
  const raw = loadJson<{ feeds?: Array<Record<string, unknown>> }>('specialty_press_rss.json');
  const feeds = raw?.feeds;
  if (!Array.isArray(feeds)) return [];
  const out: SourceConfig[] = [];
  feeds.forEach((f, i) => {
    const rss = String(f.rss_url || '').trim();
    if (!rss) return;
    const outletId = String(f.outlet_id || f.feed_id || `spec-${i}`);
    const nameEn = String(f.name_en || outletId);
    const regionId = String(f.region_id || 'specialty');
    const lang = String(f.lang_primary || 'en');
    const feedId = String(f.feed_id || outletId);
    const verified = f.verified_by_fetch !== false;
    out.push({
      id: feedId.startsWith('spec-') ? feedId : `spec-${feedId}`,
      url: rss,
      sourceName: nameEn,
      category: categoryForRegion(regionId),
      region: regionId,
      lang,
      sourceType: 'specialty',
      outletId,
      verifiedByFetch: verified,
      isSpecialized: true,
      priority: 5,
    });
  });
  return out;
}

/** 국내 구글 — 중독 키워드 검색만 소수 유지 */
const KR_GOOGLE_AGGREGATORS: SourceConfig[] = [
  {
    id: 'kr-google-policy',
    url: 'https://news.google.com/rss/search?q="중독"+AND+(정책+OR+규제+OR+법안+OR+대책+OR+예방)&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '중독정책',
    region: 'kr',
    lang: 'ko',
    sourceType: 'aggregator',
    outletId: 'google-kr-policy',
    priority: 50,
  },
  {
    id: 'kr-google-alcohol',
    url: 'https://news.google.com/rss/search?q="알코올중독"+OR+"알코올+의존"+OR+"음주+중독"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '알코올·약물중독',
    region: 'kr',
    lang: 'ko',
    sourceType: 'aggregator',
    outletId: 'google-kr-alcohol',
    priority: 51,
  },
  {
    id: 'kr-google-drug',
    url: 'https://news.google.com/rss/search?q="약물중독"+OR+"마약+중독"+OR+"펜타닐"+OR+"필로폰"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '알코올·약물중독',
    region: 'kr',
    lang: 'ko',
    sourceType: 'aggregator',
    outletId: 'google-kr-drug',
    priority: 52,
  },
  {
    id: 'kr-google-gambling',
    url: 'https://news.google.com/rss/search?q="도박중독"+OR+"불법도박"+OR+"사행산업"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '도박중독',
    region: 'kr',
    lang: 'ko',
    sourceType: 'aggregator',
    outletId: 'google-kr-gambling',
    priority: 53,
  },
  {
    id: 'kr-google-digital',
    url: 'https://news.google.com/rss/search?q="게임중독"+OR+"스마트폰중독"+OR+"인터넷중독"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '게임·디지털중독',
    region: 'kr',
    lang: 'ko',
    sourceType: 'aggregator',
    outletId: 'google-kr-digital',
    priority: 54,
  },
];

/** 중독 전문 직접 RSS (소수) */
const SPECIALIZED: SourceConfig[] = [
  {
    id: 'kr-docdocdoc-rss',
    url: 'http://www.docdocdoc.co.kr/rss/clickTop.xml',
    sourceName: '청년의사',
    category: '알코올·약물중독',
    region: 'kr',
    lang: 'ko',
    sourceType: 'aggregator',
    outletId: 'docdocdoc',
    isSpecialized: true,
    priority: 8,
  },
  {
    id: 'us-drugfree',
    url: 'https://drugfree.org/feed/',
    sourceName: 'Partnership to End Addiction',
    category: '알코올·약물중독',
    region: 'north_america',
    lang: 'en',
    sourceType: 'aggregator',
    outletId: 'drugfree',
    isSpecialized: true,
    priority: 30,
  },
  {
    id: 'global-who-substance',
    url: 'https://www.who.int/rss-feeds/news-english.xml',
    sourceName: 'WHO',
    category: '중독정책',
    region: 'global',
    lang: 'en',
    sourceType: 'aggregator',
    outletId: 'who',
    isSpecialized: true,
    priority: 31,
  },
];

export function buildSources(): SourceConfig[] {
  const world = loadWorldPress();
  const kr = loadKrPress();
  const specialty = loadSpecialtyPress();
  console.log(
    `[sourceConfig] world_press=${world.length}, kr_press=${kr.length}, specialty=${specialty.length}, google_kr=${KR_GOOGLE_AGGREGATORS.length}`,
  );
  // 전문매체 우선 → 국내 → 세계신문 → 기타 전문/애그리게이터
  return [...specialty, ...kr, ...world, ...SPECIALIZED, ...KR_GOOGLE_AGGREGATORS];
}

/** 크롤러가 쓰는 통합 목록 (로드 시점에 구성) */
export const SOURCES: SourceConfig[] = buildSources();
