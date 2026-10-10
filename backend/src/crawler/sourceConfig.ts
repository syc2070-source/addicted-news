// backend/src/crawler/sourceConfig.ts
// v5.1 — 세계신문 60 + 국내 10 + 전문 4 + 국내 구글 소수
// NEWS-Q2 ■1·■5: 고정 목록(구글뉴스·전문·기관·학술)은 분야 설정(field_profiles/*.json)으로 옮김.
//   코드에는 분야 글자가 없다. 신문 피드 파일 이름도 분야 설정 sources.press_files 에서.
import * as fs from 'fs';
import * as path from 'path';
import { fieldProfile, FieldProfile, ProfileFeed, SourceGrade } from './field_profile';

/** 광고·홍보 감점 낱말(분야 설정 keywords.ad_penalty). */
export function adPenaltyKeywords(): string[] {
  return fieldProfile().keywords.ad_penalty;
}

/** 분류 이름 — 목록은 분야 설정 categories.list. */
export type CategoryName = string;

// 'broadcast' (NEWS-Q1): YouTube 방송 RSS. SOURCES 에는 넣지 않고 broadcast.ts 가 따로 돈다.
// 'institution'·'academic' (NEWS-Q2 ■5): 기관 뉴스룸·학술 뉴스.
export type SourceType =
  | 'world_press' | 'kr_press' | 'specialty' | 'aggregator' | 'broadcast' | 'institution' | 'academic';

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
  /** 전문 기관/직접 RSS — 분야 점수 통과 임계값 완화(1점) */
  isSpecialized?: boolean;
  /** 수집 순서(낮을수록 먼저, 미지정 100) */
  priority?: number;
  /** 출처 등급(기관 > 학술 > 언론 > 집계기) — NEWS-Q2 ■5 */
  grade: SourceGrade;
  /** 한 번에 읽을 항목 수(기본 30) */
  maxItems?: number;
  /** false 면 건너뜀(죽은 피드 · 대체 없음) — NEWS-Q2 ■4 */
  active: boolean;
  inactiveReason?: string;
  format?: 'rss' | 'html' | 'json';
  listPattern?: string;
  jsonMap?: ProfileFeed['json_map'];
}

export const GRADE_RANK: Record<SourceGrade, number> = { institution: 0, academic: 1, press: 2, aggregator: 3 };

/** 종류별 기본 등급. 구글뉴스로 찾은 기사도 원문으로 풀리면 press. */
export function defaultGrade(t: SourceType): SourceGrade {
  if (t === 'institution') return 'institution';
  if (t === 'academic') return 'academic';
  if (t === 'aggregator') return 'aggregator';
  return 'press';
}

const DATA_DIR = path.join(__dirname, '../../data');

function loadJson<T>(name: string | undefined): T | null {
  if (!name) return null;
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

function activeOf(f: Record<string, unknown>): { active: boolean; inactiveReason?: string } {
  if (f.active === false) return { active: false, inactiveReason: String(f.inactive_reason || '비활성') };
  return { active: true };
}

function loadWorldPress(p: FieldProfile): SourceConfig[] {
  const raw = loadJson<{ feeds?: Array<Record<string, unknown>> }>(p.sources.press_files.world);
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
      category: p.categories.default,
      region: regionId,
      lang,
      sourceType: 'world_press',
      outletId,
      verifiedByFetch: verified,
      isSpecialized: true,
      priority: 20,
      grade: 'press',
      ...activeOf(f),
    });
  });
  return out;
}

function loadKrPress(p: FieldProfile): SourceConfig[] {
  const raw = loadJson<{ feeds?: Array<Record<string, unknown>> }>(p.sources.press_files.kr);
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
      category: p.categories.default,
      region: String(f.region_id || 'kr'),
      lang: String(f.lang_primary || 'ko'),
      sourceType: 'kr_press',
      outletId,
      verifiedByFetch: true,
      isSpecialized: true,
      priority: 10,
      grade: 'press',
      ...activeOf(f),
    });
  });
  return out;
}

function loadSpecialtyPress(p: FieldProfile): SourceConfig[] {
  const raw = loadJson<{ feeds?: Array<Record<string, unknown>> }>(p.sources.press_files.specialty);
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
      category: p.categories.default,
      region: regionId,
      lang,
      sourceType: 'specialty',
      outletId,
      verifiedByFetch: verified,
      isSpecialized: true,
      priority: 5,
      grade: 'press',
      ...activeOf(f),
    });
  });
  return out;
}

/** 분야 설정의 피드 목록(구글뉴스·전문·기관·학술) → SourceConfig. */
export function profileFeedsToSources(
  feeds: ProfileFeed[],
  sourceType: SourceType,
  p: FieldProfile,
  opts: { isSpecialized?: boolean; defaultPriority?: number } = {},
): SourceConfig[] {
  return feeds
    .filter((f) => f && f.id && f.url)
    .map((f) => ({
      id: f.id,
      url: f.url,
      sourceName: f.source_name || f.id,
      category: f.category && p.categories.list.includes(f.category) ? f.category : p.categories.default,
      region: f.region || 'global',
      lang: f.lang || 'en',
      sourceType,
      outletId: f.outlet_id || f.id,
      isSpecialized: opts.isSpecialized,
      priority: f.priority ?? opts.defaultPriority,
      grade: f.grade || defaultGrade(sourceType),
      maxItems: f.max_items,
      active: f.active !== false,
      inactiveReason: f.active === false ? f.inactive_reason || '비활성' : undefined,
      format: f.format,
      listPattern: f.list_pattern,
      jsonMap: f.json_map,
    }));
}

/** 전 소스(비활성 포함) — 읽기 전용 점검·피드 건강 표용. */
export function buildAllSources(p: FieldProfile = fieldProfile()): SourceConfig[] {
  const world = loadWorldPress(p);
  const kr = loadKrPress(p);
  const specialty = loadSpecialtyPress(p);
  const s = p.sources;
  const specialized = profileFeedsToSources(s.specialized, 'aggregator', p, { isSpecialized: true, defaultPriority: 30 });
  const institutions = profileFeedsToSources(s.institutions, 'institution', p, { isSpecialized: true, defaultPriority: 3 });
  const academic = profileFeedsToSources(s.academic, 'academic', p, { isSpecialized: true, defaultPriority: 4 });
  const google = profileFeedsToSources(s.google_news, 'aggregator', p, { defaultPriority: 50 });
  console.log(
    `[sourceConfig] field=${p.field} world_press=${world.length}, kr_press=${kr.length}, specialty=${specialty.length}, ` +
    `institution=${institutions.length}, academic=${academic.length}, specialized=${specialized.length}, google=${google.length}`,
  );
  // 기관·학술 → 전문매체 → 국내 → 세계신문 → 기타 전문/애그리게이터 → 구글
  return [...institutions, ...academic, ...specialty, ...kr, ...world, ...specialized, ...google];
}

/** 크롤러가 쓰는 소스(활성만). */
export function buildSources(p: FieldProfile = fieldProfile()): SourceConfig[] {
  const all = buildAllSources(p);
  const off = all.filter((s) => !s.active);
  if (off.length) console.log(`[sourceConfig] 비활성 ${off.length}: ${off.map((s) => `${s.id}(${s.inactiveReason})`).join(', ')}`);
  return all.filter((s) => s.active);
}
