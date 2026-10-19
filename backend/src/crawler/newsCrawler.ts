// backend/src/crawler/newsCrawler.ts
// v4.0 - 분야 필터 강화, 외국 기사 비율 증가 · NEWS-Q2: 분야 낱말·소스는 분야 설정(field_profiles)에서
import 'dotenv/config';
import 'reflect-metadata';
import axios from 'axios';
import { DataSource, MoreThanOrEqual } from 'typeorm';
import Parser from 'rss-parser';
import * as fs from 'fs';
import * as path from 'path';
import { Article } from '../articles/article.entity';
import { RejectedArticle } from '../articles/rejected_article.entity';
import { buildSources, SourceConfig, CategoryName, adPenaltyKeywords, SourceType, defaultGrade } from './sourceConfig';
import {
  summarizeKoreanDeepSeek, deepseekAvailable, deepseekStats, Confidence, DEEPSEEK_MODEL,
  deepseekDown, DEEPSEEK_DOWN_AFTER, DEEPSEEK_TIMEOUT_MS,
} from './deepseek_summary';
import { extractArticleData, httpGetText, resolveFinalUrl } from './article_extractor';
import { isValidArticleImageUrl } from './image_validation';
import { matchesFieldKeywords, hasFieldKeyword, isIncidentReport, negativeVerdict, normalize } from './field_filter';
import { isKoreanOutput, describeLangCheck } from './lang_output';
import { isBlacklistedDomain, getBlacklistSnapshot, normalizeHost, evaluateAutoBlacklistFromDb } from './domain_blacklist';
import { notifyDiscord } from './notifier';
import { decodeEntities, crossMediaSimilarity } from './text_utils';
import { crawlerConnectionOptions } from './crawler_db';
import { insertArticleWithRawBody, RawBodyWriteState } from './raw_body_store';
import {
  BROADCAST_SOURCE_TYPE, BroadcastItem, buildBroadcastRow, decideBroadcast, fetchBroadcastItems, loadBroadcastSources, orderFailedFirst,
  passesBroadcastKeywordGate,
} from './broadcast';
import {
  DAILY_UNIT_CAP, QuotaGuard, SEARCH_UNITS, YOUTUBE_API_ENV, apiTodayFromRuns, emptyApiRecord, lookbackChannel, planChannel,
  rss404Outlets, youtubeApiKey,
} from './youtube_api';
import { feedStatusOf } from './broadcast_feeds';
import { probeSchema, SchemaFlags } from './schema_probe';
import { fieldProfile, SourceGrade } from './field_profile';
import { fetchFeed } from './feed_fetch';
import { KnownIndex, loadKnownIndex, preDuplicate } from './dedup';
import { DeepseekBudget, dailyCap, estimateCostUsd, priceOf, usedTodayFromRuns } from './deepseek_budget';
import { decideTier, effectiveTier, Tier } from './tier';
import {
  CrawlRunSummary, SourceRunStat, digestPerSource, emptySourceStat, feedHealthLines, lastFailedFeeds, recentCrawlRuns, recordCrawlRun,
} from './crawl_runs';
import { alertFactsOf, alertLine, evaluateRunAlerts } from './run_alerts';
import { backfillGoogleUrls, hostOf, isGoogleNewsLink, UrlResolveState } from './url_resolve';
import { decodeGoogleNewsUrl } from './google_news_url';
import { writeRowExtras } from './row_extras';
import { ClusterPool, leadOf, paraOf } from './event_cluster';
import {
  BROADCAST_SHARE_MS, ReadCtx, ReadOutcome, RunProgress, SOURCE_CAP_MS, SOURCE_CONCURRENCY, crawlTimeoutMs,
  GOOGLE_SEARCH_CAP_MS, sourceCapMs,
  emptyProgress, lastRunLastSourceId, planSources, runSources,
} from './crawl_schedule';
import { PoolData, backfillClusters, loadClusterPool, savedPct } from './event_cluster_store';
import { missedDaySources, planMissedDay, recentRunBriefs } from './missed_day';

// NEWS-Q2 ■1: 분야 설정(FIELD_PROFILE, 기본 = data/field_profiles/DEFAULT). 없으면 여기서 시끄럽게 실패한다.
const PROFILE = fieldProfile();

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
  rawBody: string | null;
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
  // NEWS-Q2: 묶음 SQL 2 의 열(있을 때만 기록) · 소스 집계 열쇠
  tier?: Tier;
  publishedTs?: Date | null;
  sourceGrade?: SourceGrade | null;
  urlResolve?: UrlResolveState | null;
  sourceId?: string;
  /** NEWS-Q3 ■1: 묶음 둘째 기사(관문 건너뛰고 대표 판정 상속) — 저장 때 제목 닮음 중복으로 버리지 않는다 */
  clusterMember?: boolean;
};

const RSS_TIMEOUT = Number(process.env.RSS_TIMEOUT_MS ?? 15000);
const RSS_CUSTOM_FIELDS = {
  item: ['source', 'media:content', 'media:thumbnail', 'content:encoded', 'description', 'enclosure'] as string[],
};
const parser = new Parser<RssItem>({ timeout: RSS_TIMEOUT, customFields: RSS_CUSTOM_FIELDS });

function httpStatusOf(err: any): number | null {
  const m = String(err?.message || err || '').match(/status code\s*(\d{3})/i);
  return m ? Number(m[1]) : null;
}

// NEWS-Q2 ■4: 피드 읽기 = feed_fetch.fetchFeed(브라우저 헤더 · 403/406/429 1회 재시도 · 깨진 XML 고쳐 1회 더 · html 목록).

// ---------- 설정값 ----------
const MAX_FOREIGN_ARTICLES = Number(process.env.MAX_FOREIGN_ARTICLES ?? 100);  // 50→100 증가
const ENABLE_IMAGE_EXTRACT = process.env.ENABLE_IMAGE_EXTRACT !== 'false';
const MIN_FIELD_SCORE = 2;  // 카테고리 분류용 참고(채택 게이트는 field_filter)
// 하루 1회 제한 해제: SKIP_DAILY_CHECK=true, 또는 Render 환경(RENDER=true)에서 자동 해제.
// Cron Job은 매일 1회 실행되는 스케줄 자체가 제한 역할을 하므로, 락 파일에 걸려
// 스킵되는 footgun을 방지한다(Render Cron은 파일시스템도 휘발성이라 이중 안전).
const SKIP_DAILY_CHECK =
  process.env.SKIP_DAILY_CHECK === 'true' || process.env.RENDER === 'true';
// v5.2 #3: 본문 최소 길이. 미만이면 추측 요약 방지를 위해 스킵.
const MIN_BODY_CHARS = Number(process.env.MIN_BODY_CHARS ?? 300);
// Cron 안전장치: 전체 크롤 상한 시간(NEWS-Q4 ■1ⓔ 기본 55분 · NEWS-Q5 ■3 그보다 짧은 env 는 55분으로 올림). 초과 시 그때까지 수집분을 저장하고 종료.
const CRAWL_TIMEOUT_MS = crawlTimeoutMs(process.env, (m) => console.log(m));
let crawlDeadline = Number.POSITIVE_INFINITY;  // main()에서 startTime 기준 설정

let foreignArticleCount = 0;
let crawlStats = {
  itemsSeen: 0,
  filterPass: 0,
  filterSkip: 0,
  incidentSkip: 0,      // v5.2 #1: 사건사고 스킵(키워드 1차 거름망)
  judgeIncidentSkip: 0, // v5.4: 딥시크 판정 incident 스킵
  judgeCatSkip: 0,      // v5.4: 딥시크 판정 category_fit=false 스킵
  gateRejectLowConf: 0, // v5.4: 확신도 부족(medium/low) 거부
  deepseekFailSkip: 0,  // 판정 자체 실패(judgment_missing) — DeepSeek 응답 없음/장애 신호
  langRetry: 0,         // LANG-GUARD-1: 비한국어 산출물 감지 → 한국어 강제 재생성 시도
  langRejectSkip: 0,    // LANG-GUARD-1: 재생성 후에도 비한국어 → non_korean_output 격리
  blacklistSkip: 0,     // v5.4: 블랙리스트 도메인 즉시 폐기(딥시크 호출 없음)
  quarantined: 0,       // v5.4: rejected_articles 격리 저장
  crossMediaDupSkip: 0, // v5.4.1 3-2: 크로스매체 동일 사건 중복 스킵
  sameArticleSkip: 0, // NEWS-Q6 ■2: 같은 기사(정규화 URL · 같은 매체 24h) 스킵
  deepseekDownLogged: false, // NEWS-Q6 ⓑ′: DeepSeek 연결 실패 연속 → 이번 실행 판정 멈춤 로그 1회
  dateParseFail: 0,     // v5.4.1 3-3: published_at 파싱 실패(now 대체)
  dupSkipKeyword: 0,    // v5.2 #4: 핵심어 기반 중복 스킵
  thinBodySkip: 0,      // v5.2 #3: 본문 부실 스킵
  bodyExtractTried: 0,  // v5.2 #3: 원문 추출 시도 수
  bodyExtractOk: 0,     // v5.2 #3: 원문 추출 성공 수(>=MIN_BODY_CHARS)
  broadcastSeen: 0,          // NEWS-Q1 ■4: 방송 RSS 항목
  broadcastKeywordPass: 0,   // 핵심어 관문 통과(→ DeepSeek)
  broadcastAccepted: 0,      // DeepSeek 관문 통과(저장 후보)
  broadcastRejected: 0,      // DeepSeek 관문 거부
  dupPreSkip: 0,             // NEWS-Q2 ■2: DeepSeek 앞 중복 건너뜀(기억표·DB)
  capSkip: 0,                // NEWS-Q2 ■2: 하루 DeepSeek 상한으로 건너뜀
  archiveTier: 0,            // NEWS-Q2 ■6: 보관(archive) 판정
  urlResolved: 0,            // NEWS-Q2 ■3: 구글 링크 → 원문 성공
  urlResolveFail: 0,         // NEWS-Q2 ■3: 해석 실패(구글 링크 유지)
  spamToGate: 0,             // NEWS-Q10 ■2: 스팸 낱말 하나 ∧ 제목 핵심어 → 관문으로 보낸 후보
  feedsOk: 0,               // NEWS-Q2 ■4: 피드 읽기 성공
  feedsRepaired: 0,          // NEWS-Q2 ■4: 깨진 XML 고쳐 읽음
  clusterInherit: 0,         // NEWS-Q3 ■1: 묶음 둘째 기사 — 관문 건너뛰고 대표 판정 상속(저장 후보)
  clusterInheritRejected: 0, // NEWS-Q3 ■1: 대표가 거부라 함께 거부(호출 0)
  clusterForeignSkip: 0,     // NEWS-Q3 ■1: 묶음 외국어 기사(번역 없이 싣지 않음 · 호출 0)
  judgedForCluster: 0,       // NEWS-Q3 ■1: DeepSeek 로 판정한 기사 수(절감 % 분모)
  sourceTimeouts: [] as string[], // NEWS-Q4 ■1: 소스별 60초 상한에 걸린 소스
  failedFeeds: [] as string[],
  // v5.4.1 작업5: 구조화된 피드 실패(상태코드별 분류·복구 판단용)
  feedFailures: [] as { id: string; source: string; sourceType: SourceType; status: number | null; retried: boolean }[],
};

// v5.4: 입구 게이트에서 거부된 기사 격리(rejected_articles). 블랙리스트는 제외(저장 가치 없음).
type RejectedRecord = {
  title: string; originalTitle: string | null; summary: string | null; category: string;
  source: string; sourceUrl: string; googleUrl: string | null; publishedAt: string;
  lang: string; sourceType: SourceType; rejectReason: string; confidence: Confidence | null;
  domain: string | null;
};
const rejectedAll: RejectedRecord[] = [];

// ---------- DB ----------
const ds = new DataSource(crawlerConnectionOptions(process.env));

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

// ---------- 이미지 URL 검증 (image_validation.ts 공용) ----------
function isValidImageUrl(url: string | null): boolean {
  return isValidArticleImageUrl(url);
}

// ---------- v4.0: 분야 키워드 시스템 (NEWS-Q2 ■1: 낱말은 분야 설정) ----------
const VALID_CATEGORIES: CategoryName[] = PROFILE.categories.list;
const DEFAULT_CATEGORY: CategoryName = PROFILE.categories.default;

// 핵심 분야 키워드 (가중치 2점) — 설정 keywords.core
const CORE_FIELD_KEYWORDS: string[] = PROFILE.keywords.core;

// 카테고리별 키워드 (가중치 1점) — 설정 categories.keywords
const CATEGORY_KEYWORDS: Record<CategoryName, string[]> = Object.fromEntries(
  VALID_CATEGORIES.map((c) => [c, PROFILE.categories.keywords[c] || []]),
);

function isPromotionalAd(title: string, content: string): boolean {
  const text = (title + ' ' + content).toLowerCase();
  if (adPenaltyKeywords().some((kw) => text.includes(kw.toLowerCase()))) return true;
  const specialChars = text.match(/[!@#$%^&*()_+={}\[\]|\\:;"'<>,.?\/~`]/g) || [];
  return specialChars.length > 50;
}

function hasCoreFieldKeyword(title: string, content: string): boolean {
  const text = (title + ' ' + content).toLowerCase();
  return CORE_FIELD_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

/** 카테고리별 적합도: 설정 requires_core_keyword 카테고리는 핵심 키워드 없으면 0(일반 의료·사회면사 배제) */
function categoryFitScore(title: string, content: string, category: CategoryName): number {
  if (isPromotionalAd(title, content)) return -100;
  const text = (title + ' ' + content).toLowerCase();
  const t = title.toLowerCase();
  const hasCore = hasCoreFieldKeyword(title, content);
  if (PROFILE.categories.requires_core_keyword.includes(category) && !hasCore) return 0;

  let score = 0;
  for (const kw of CORE_FIELD_KEYWORDS) {
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

// v4.0: 분야 관련성 점수 (저장 게이트) — 광고 차단 + 핵심 키워드 필수
function calculateFieldScore(title: string, content: string): number {
  if (isPromotionalAd(title, content)) return -100;
  const text = (title + ' ' + content).toLowerCase();
  if (!hasCoreFieldKeyword(title, content)) return 0;

  let score = 0;
  for (const kw of CORE_FIELD_KEYWORDS) {
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

// v4.0: 개선된 분야 관련성 필터
function isFieldRelated(title: string, content: string): boolean {
  const score = calculateFieldScore(title, content);
  return score >= MIN_FIELD_SCORE;
}

// 카테고리 분류
function normalizeCategory(category: string): CategoryName {
  const alias = PROFILE.categories.aliases[category];
  if (alias) return alias;
  if (VALID_CATEGORIES.includes(category as CategoryName)) return category as CategoryName;
  return DEFAULT_CATEGORY;
}

function classifyCategory(title: string, content: string, defaultCategory: CategoryName): CategoryName {
  const def = normalizeCategory(defaultCategory);
  const scores: Record<CategoryName, number> = Object.fromEntries(VALID_CATEGORIES.map((c) => [c, 0]));
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
  if (maxScore < MIN_FIELD_SCORE) return def;
  return bestCategory;
}

function isValidCategory(category: string): category is CategoryName {
  return VALID_CATEGORIES.includes(category as CategoryName);
}

/** Google 검색·전문 기관 직접 RSS는 통과 점수 1, 그 외는 MIN_FIELD_SCORE */
function minFieldPassScore(conf: SourceConfig): number {
  if (conf.id.includes('google') || conf.isSpecialized) return 1;
  return MIN_FIELD_SCORE;
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
  // v5.4.1 3-3: 파싱 실패 시 2026-01-01 같은 고정값이 아니라 '수집 시각(now)'으로.
  //   최신순 정렬 왜곡 방지. 실패 건수는 END 집계에 표기(parse_failed 대체 로그).
  const raw = item.isoDate || item.pubDate;
  if (!raw) { crawlStats.dateParseFail++; return toYmd(new Date()); }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) { crawlStats.dateParseFail++; return toYmd(new Date()); }
  return toYmd(dt);
}

// NEWS-Q2 ■7: 보도 시각(published_ts) — 피드 시각, 없거나 틀리면 수집 시각.
function parsePublishedTs(item: RssItem): Date {
  const raw = item.isoDate || item.pubDate;
  const dt = raw ? new Date(raw) : null;
  return dt && !Number.isNaN(dt.getTime()) ? dt : new Date();
}

// ---------- NEWS-Q2: 실행 맥락(스키마 깃발 · 중복 기억표 · DeepSeek 상한 · 소스별 집계) ----------
type RunContext = {
  flags: SchemaFlags;
  known: KnownIndex;
  query: ((sql: string, params?: unknown[]) => Promise<any[]>) | null;
  budget: DeepseekBudget;
  perSource: Record<string, SourceRunStat>;
  /** NEWS-Q3 ■1: 사건 묶음 기억(최근 저장분 + 이번 실행 판정분). 못 읽으면 null(옛 동작). */
  pool: ClusterPool<PoolData> | null;
  poolLoaded: number;
  /** NEWS-Q4 ■1: 순서·상한 기록(crawl_runs.per_source.__run) */
  progress: RunProgress | null;
};
const RUN: RunContext = {
  flags: {
    deletedAt: false, kind: false, tier: false, publishedTs: false, sourceGrade: false, urlResolve: false, crawlRuns: false,
    cluster: false, clusterStats: false,
  },
  known: new KnownIndex(),
  query: null,
  budget: new DeepseekBudget(dailyCap(process.env, PROFILE.gate.deepseek_daily_cap), 0),
  perSource: {},
  pool: null,
  poolLoaded: 0,
  progress: null,
};
// 이번 실행 묶음 후보의 임시 id(음수 · DB id 와 겹치지 않음)
let clusterTempId = 0;
const CLUSTER_TEXT = {
  fieldStopwords: PROFILE.keywords.dup_stopwords,
  ignoreLeads: [PROFILE.prompts.fallback_summary_line],
};

function sourceStat(id: string): SourceRunStat {
  return (RUN.perSource[id] ||= emptySourceStat());
}

/** 하루 DeepSeek 상한(■2) — 새 기사를 시작할 수 있으면 true, 아니면 그날 중단 로그 1회. */
function deepseekRoomLeft(): boolean {
  if (!deepseekAvailable) return true;
  if (deepseekDown()) {
    if (!crawlStats.deepseekDownLogged) {
      crawlStats.deepseekDownLogged = true;
      console.warn(`  ⛔ DeepSeek 연결 실패 ${DEEPSEEK_DOWN_AFTER}회 연속(요청당 ${DEEPSEEK_TIMEOUT_MS / 1000}초) — 이번 실행 남은 후보는 판정 없이 건너뜀(거부 기록 0)`);
    }
    crawlStats.capSkip++;
    return false;
  }
  if (RUN.budget.canStart(deepseekStats.calls)) return true;
  if (RUN.budget.markExhausted()) {
    console.warn(`  ⛔ DeepSeek 하루 상한 도달(상한 ${RUN.budget.cap} · 오늘 앞 실행 ${RUN.budget.usedBefore} · 이번 ${deepseekStats.calls}) — 남은 후보는 판정 없이 건너뜀`);
  }
  crawlStats.capSkip++;
  return false;
}

/** 게이트 거부 사유 → 기존 통계 칸. */
function countReject(reason: string) {
  if (reason === 'keyword_incident' || reason === 'is_incident') crawlStats.judgeIncidentSkip++;
  else if (reason === 'category_fit_false') crawlStats.judgeCatSkip++;
  else if (reason === 'judgment_missing') crawlStats.deepseekFailSkip++;
  else crawlStats.gateRejectLowConf++;
}

function feedSourceName(it: any): string | null {
  const v = it?.source;
  if (!v) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'object' && typeof v._ === 'string') return v._.trim() || null;
  return null;
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
    // undici(fetch) 대신 axios 기반 httpGetText 사용(스트리밍 abort 지뢰 회피)
    const res = await httpGetText(url);
    if (!res || !res.ok) return null;

    const html = res.body;
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

// v5.2 #5: 이미지 폴백 순서 — (1) 원문 og:image → (2) RSS enclosure/미디어 → (3) og fetch.
// 본문 추출 단계에서 이미 받아온 og:image 힌트(ogHint)가 있으면 재요청 없이 우선 사용.
async function getArticleImage(item: RssItem, sourceUrl: string, ogHint?: string | null): Promise<string | null> {
  if (ogHint && isValidImageUrl(ogHint)) return ogHint;
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
  while (out.length < 3) out.push(PROFILE.prompts.fallback_summary_line);
  return out.map(s => /[.!?。！？]$/.test(s) ? s : s + '.').join('\n');
}

// ---------- OpenAI pack ----------
type AiPack = { titleKo: string; teaser: string; summary: string; keywords: string[]; suggestedCategory?: CategoryName; isIncident?: boolean; categoryFit?: boolean; confidence?: Confidence };

function safeJsonParse<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

function compactKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  return keywords.map(k => String(k || '').trim()).filter(k => k.length > 0).slice(0, 12);
}

async function generateKoreanPack(originalTitle: string, content: string, lang: DetectedLang, defaultCategory: CategoryName): Promise<AiPack> {
  const isForeign = lang !== 'ko';

  // DeepSeek 통일: 한국어 요약 / 외국어 번역+요약 + 최종 판정(report_type/category_fit)
  const pack = await summarizeKoreanDeepSeek(originalTitle, content, { translate: isForeign, category: defaultCategory });
  if (pack?.summary) {
    const teaser = pack.summary.replace(/\s+/g, ' ').slice(0, 220);
    return {
      titleKo: isForeign ? pack.titleKo : originalTitle,
      teaser,
      summary: pack.summary,
      keywords: [],
      isIncident: pack.isIncident,
      categoryFit: pack.categoryFit,
      confidence: pack.confidence,
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

// ---------- URL resolve (article_extractor.resolveFinalUrl 공용) ----------

// ---------- 중복 체크 ----------
// v5.2 #4: 구두점(…·따옴표 등)을 공백으로, 라틴↔한글 경계를 분리("ai챗봇"→"ai 챗봇")해
// 토큰이 뭉치지 않도록 정규화. 표현 변형 간 핵심어 겹침이 잘 드러난다.
function normalizeForDuplicateCheck(title: string): string {
  // 공용 normalize()로 문자 통일(따옴표·엔티티·대시·전각 등) 후 토큰화 전처리
  return normalize(title)
    .toLowerCase()
    .replace(/([a-z0-9])([가-힣])/g, '$1 $2')
    .replace(/([가-힣])([a-z0-9])/g, '$1 $2')
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// v5.2 #4: 한글 조사·어미 제거로 표현 변형("강원랜드가"≠"강원랜드")까지 동일 핵심어로.
const KO_PARTICLES = [
  '으로써', '으로서', '이라고', '라고', '으로', '로서', '로써', '에서', '에게', '에의',
  '까지', '부터', '조차', '마저', '처럼', '만큼', '보다', '이나', '이란', '라는', '이라는',
  '와의', '과의', '에는', '에도', '에만', '이라', '이란', '으론', '이든', '든지',
  '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '만', '로', '란', '및',
];

// v5.2 #4: 서술어 어미 제거("도입한다"→"도입", "나선다"→"나서")로 변형 흡수
const KO_ENDINGS = [
  '한다는', '한다', '했다', '된다', '되다', '하며', '하고', '하는', '했던',
  '였다', '이다', '나선다', '나섰다', '나서', '시켰다', '시킨', '밝혔다', '내놨다',
];

function stripKoParticle(word: string): string {
  let w = word;
  // 한글로 끝나는 경우에만 접미 조사 제거(가장 긴 것부터)
  for (const p of KO_PARTICLES) {
    if (w.length > p.length + 1 && w.endsWith(p) && /[가-힣]$/.test(w)) {
      w = w.slice(0, w.length - p.length);
      break;
    }
  }
  for (const e of KO_ENDINGS) {
    if (w.length > e.length + 1 && w.endsWith(e) && /[가-힣]$/.test(w)) {
      w = w.slice(0, w.length - e.length);
      break;
    }
  }
  return w;
}

// 중복 판정 전용 불용어. 일반 뉴스 상투어 + 분야 상용어(설정 keywords.dup_stopwords, 변별력 낮음).
// ※ 채택 필터(field_filter)와 무관 — 오직 "같은 사건" 판정 시 핵심 엔티티만 비교하기 위함.
const DUP_STOPWORDS = new Set([
  '에서', '으로', '이다', '하는', '있는', '되는', '위한', '대한', '통해', '관련',
  '오늘', '내일', '어제', '올해', '지난', '이번', '최근', '다시', '또한', '위해',
  '대해', '따라', '밝혀', '밝혀져', '전했다', '말했다', '나타났다', '드러났다',
  '종합', '단독', '속보', '기자', '뉴스', '보도', '영상', '사진', '인터뷰',
  // 분야 상용어(거의 모든 기사에 등장 → 중복 판정에서 노이즈) — 분야 설정
  ...PROFILE.keywords.dup_stopwords,
]);

function extractCoreKeywords(title: string): Set<string> {
  const normalized = normalizeForDuplicateCheck(title);
  const words = normalized
    .split(' ')
    .map(stripKoParticle)
    .filter((w) => w.length >= 2 && !DUP_STOPWORDS.has(w));
  return new Set(words);
}

// v5.2 #4: 대표 선정용 sourceType 우선순위(낮을수록 우선: 기관·학술·전문 > 주요지 > 포털/지방지)
function sourceTypeRank(t: SourceType): number {
  switch (t) {
    case 'institution': return 0;  // NEWS-Q2 ■5: 기관 > 학술 > 언론 > 집계기
    case 'academic': return 0;
    case 'specialty': return 0;
    case 'world_press': return 1;
    case 'kr_press': return 1;
    case 'aggregator': return 2;
    default: return 3;
  }
}

// ---------- NEWS-Q1 ■4: 방송(YouTube RSS) ----------
// 핵심어 관문(0원) → DeepSeek 관문 → 저장 후보. 기사 경로(crawlOneSource)와 섞지 않는다:
// 설명은 짧아 본문 길이 기준·기사용 사건사고 거름망이 맞지 않는다.
async function crawlBroadcastSources(deadline: number = crawlDeadline): Promise<Candidate[]> {
  let sources = loadBroadcastSources();
  const out: Candidate[] = [];
  if (!sources.length) return out;
  // NEWS-Q2 ■8: 지난 실행에서 실패한 채널을 맨 앞으로(crawl_runs 있을 때)
  let failedRaw: string[] = [];
  if (RUN.flags.crawlRuns && RUN.query) {
    failedRaw = await lastFailedFeeds(RUN.query, PROFILE.field);
    const failed = failedRaw.filter((s) => s.startsWith('broadcast:')).map((s) => s.slice('broadcast:'.length).split(' ')[0]);
    if (failed.length) {
      sources = orderFailedFirst(sources, failed);
      console.log(`  📺 지난 실행 실패 채널 먼저: ${failed.join(', ')}`);
    }
  }
  // NEWS-Q6 ■4: 되짚기(YouTube Data API) — 열쇠 있을 때만 · 채널당 하루 1회 · 하루 2,000 단위 가드 · 열쇠 값 로그 0
  const apiKey = youtubeApiKey();
  const today = apiKey && RUN.flags.crawlRuns && RUN.query ? await apiTodayFromRuns(RUN.query, PROFILE.field) : { units: 0, channels: [] };
  const guard = new QuotaGuard(DAILY_UNIT_CAP, today.units);
  const api = emptyApiRecord(apiKey ? 'on' : 'off', today.units);
  if (RUN.progress) RUN.progress.broadcastApi = api;
  const rssDown = new Set(rss404Outlets(failedRaw));
  console.log(`\n📺 방송 추적 ${sources.length}채널 (핵심어 → DeepSeek 관문) · 되짚기 API ${api.mode}` +
    (apiKey ? ` (오늘 앞서 ${today.units}단위 · 상한 ${DAILY_UNIT_CAP})` : ` (env ${YOUTUBE_API_ENV} 없음 → RSS 만)`));
  for (const source of sources) {
    if (Date.now() > deadline) {
      console.log('  ⏱️ 방송 몫 시간 도달 — 방송 추적 중단');
      break;
    }
    const stat = sourceStat(`broadcast:${source.outletId}`);
    const plan = planChannel({
      hasKey: !!apiKey, rss404LastRun: rssDown.has(source.outletId),
      searchedToday: today.channels.includes(source.outletId), quotaLeft: !guard.stopped && guard.canSpend(SEARCH_UNITS),
    });
    let items: BroadcastItem[] = [];
    let rssFailed: string | null = null;
    let apiError: { status: number | null; reason: string } | null = null;
    const rssTried = plan.rss || plan.reason === 'api_only_rss404';
    if (rssTried) {
      // RSS 가 지난 실행에 404 였고 열쇠가 있으면 한 번만 물어본다(10회 재시도 대신) — 살아나면 다시 RSS
      try {
        items = await fetchBroadcastItems(source, 15, plan.rss ? undefined : 1);
        crawlStats.feedsOk++;
      } catch (e) {
        const status = httpStatusOf(e);
        rssFailed = String(status ?? 'ERR');
        console.warn(`  ├─ [${source.program}] ❌ RSS 실패${plan.api ? '(API 로 되짚기)' : '(스킵)'}${status ? ` [${status}]` : ''}: ${(e as Error).message}`);
        crawlStats.failedFeeds.push(`broadcast:${source.outletId}${status ? ` [${status}]` : ''}`);
      }
    }
    if (plan.api && apiKey) {
      const rssIds = new Set(items.map((it) => it.videoId));
      const lb = await lookbackChannel(source.channelId, apiKey, guard, {
        needFull: (it) => !rssIds.has(it.videoId) && passesBroadcastKeywordGate(it),
      });
      api.calls += lb.units > SEARCH_UNITS ? 2 : lb.units > 0 ? 1 : 0;
      api.units += lb.units;
      api.unitsToday = guard.used;
      api.quotaStopped = guard.stopped;
      if (lb.units > 0) api.channels.push(source.outletId);
      if (plan.reason === 'api_only_rss404') api.apiOnly.push(source.outletId);
      if (lb.error) {
        apiError = lb.error;
        api.errors.push(`${source.outletId}:${lb.error.status ?? ''}:${lb.error.reason}`);
        console.warn(`  ├─ [${source.program}] ⚠️ 되짚기 실패 [${lb.error.status ?? '-'}] ${lb.error.reason}`);
      }
      api.items += lb.items.length;
      for (const it of lb.items) {
        if (rssIds.has(it.videoId)) continue;
        items.push(it);
        api.newItems++;
        if (passesBroadcastKeywordGate(it)) api.keywordPass++;
      }
      console.log(`  ├─ [${source.program}] 되짚기 ${lb.items.length}편(RSS 에 없던 것 ${lb.items.filter((it) => !rssIds.has(it.videoId)).length}) · ${lb.units}단위`);
    }
    // NEWS-Q8 ■2: 채널별 마지막 읽기 결과(health broadcast.feeds[])
    if (RUN.progress) {
      (RUN.progress.broadcastFeeds ||= []).push(feedStatusOf({
        id: source.outletId, plan, hasKey: !!apiKey, rssTried, rssFailed, apiError, items: items.length, at: new Date(),
      }));
    }
    if (rssFailed && !items.length) {
      stat.failed = rssFailed;
      continue;
    }
    stat.read = items.length;
    let accepted = 0;
    for (const item of items) {
      crawlStats.broadcastSeen++;
      const pre = decideBroadcast(item, null, true);
      if (pre.action === 'skip' && pre.reason === 'keyword_miss') continue;
      crawlStats.broadcastKeywordPass++;
      stat.candidates++;
      if (!deepseekAvailable) {
        console.log(`  │   ⏭️ DeepSeek 없음 → 방송 저장 보류: ${item.title.slice(0, 40)}`);
        continue;
      }
      // ■2: 이미 저장·판정한 영상이면 DeepSeek 0
      if (await preDuplicate(RUN.known, RUN.query, { urls: [item.url], titles: [] })) {
        crawlStats.dupPreSkip++;
        stat.dup++;
        continue;
      }
      if (!deepseekRoomLeft()) break;
      // NEWS-Q6 ⓑ′: 방송 몫 시간은 채널 사이만이 아니라 판정 하나마다 본다(10-15: 한 채널 안에서 62분)
      if (Date.now() > deadline) break;
      const callsBefore = deepseekStats.calls;
      const provCategory = classifyCategory(item.title, item.description, DEFAULT_CATEGORY);
      const pack = await summarizeKoreanDeepSeek(item.title, item.description || item.title, {
        translate: false, category: provCategory,
      });
      stat.calls += deepseekStats.calls - callsBefore;
      if (deepseekDown() && pack?.categoryFit === undefined) break;
      const judgment = pack
        ? { categoryFit: pack.categoryFit, isIncident: pack.isIncident, confidence: pack.confidence }
        : null;
      const decision = decideBroadcast(item, judgment, true);
      if (decision.action !== 'accept') {
        crawlStats.broadcastRejected++;
        stat.rejected++;
        const reason = decision.reason;
        console.log(`  │   🚫 방송 관문 거부(${reason}): ${item.title.slice(0, 40)}`);
        rejectedAll.push({
          title: item.title, originalTitle: item.title, summary: pack?.summary || null,
          category: provCategory, source: source.program, sourceUrl: item.url, googleUrl: null,
          publishedAt: buildBroadcastRow(source, item, { category: provCategory }).publishedAt,
          lang: 'ko', sourceType: BROADCAST_SOURCE_TYPE, rejectReason: `broadcast:${reason}`,
          confidence: pack?.confidence ?? null,
          // domain 비움: youtube.com 이 기사용 자동 블랙리스트 집계에 섞이지 않게.
          domain: null,
        });
        continue;
      }
      const row: Candidate = {
        ...(buildBroadcastRow(source, item, { summary: pack?.summary, category: provCategory }) as Candidate),
        tier: 'publish', urlResolve: null, sourceId: `broadcast:${source.outletId}`,
      };
      out.push(row);
      accepted++;
      crawlStats.broadcastAccepted++;
      console.log(`  │   📺 방송 채택: [${source.program}] ${item.title.slice(0, 40)}`);
    }
    console.log(`  ├─ [${source.program}] 읽음 ${items.length} · 채택 ${accepted}`);
  }
  return out;
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

/**
 * 이번 실행 안 중복: 'exact' = 같은 제목(바로 건너뜀) · 'similar' = 핵심어 50%+ 닮음 · null = 처음.
 * NEWS-Q3: 'similar' 은 바로 버리지 않고 사건 묶음(■1)에 들면 묶음 기사로 싣는다. 묶음에 안 들면 예전처럼 건너뜀.
 */
function sessionDuplicate(title: string): 'exact' | 'similar' | null {
  const normalized = normalizeForDuplicateCheck(title);
  if (seenTitles.has(normalized)) return 'exact';
  for (const [, seenOrig] of seenTitles.entries()) {
    const similarity = calculateTitleSimilarity(title, seenOrig);
    if (similarity >= 0.5) return 'similar';
  }
  seenTitles.set(normalized, title);
  return null;
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

// ---------- Read one (NEWS-Q4 ■1: 동시 4 · 소스별 60초 · 이번 실행 공유 상태는 건드리지 않음) ----------
// 피드 가져오기·해석 + 항목별 네트워크 일(기존 기사 확인 읽기 · 구글 링크 풀기 · 원문 추출)만 한다.
// 이번 실행 중복(seenTitles)·묶음·DeepSeek·집계는 판정(judgeSource)에서 소스 순서대로.
interface ReadItem {
  it: RssItem;
  rawTitle: string;
  itemLink: string;
  /** 같은 소스 안 같은 제목(판정에서 'exact' 로 빠짐) — 네트워크 일 안 함 */
  sameSourceDup: boolean;
  /** ■2: 링크·제목이 이미 저장됨 */
  preDup: boolean;
  publishedAt: string;
  publishedTs: Date;
  rawContent: string;
  ogImageHint: string | null;
  fieldOk: boolean;
  /** 스니펫(200자+)만으로 분야 미통과 */
  snippetSkip: boolean;
  isGoogle: boolean;
  resolvedUrl: string;
  urlResolve: UrlResolveState | null;
  /** 풀린 원문 링크가 이미 저장됨 */
  resolvedDup: boolean;
  bodyTried: boolean;
  /** 원문 추출로 본문이 길어졌으면 그 길이 */
  bodyGrewTo: number;
  bodyOk: boolean;
}

interface ReadSource {
  items: ReadItem[];
  total: number;
  retried: boolean;
  repaired: boolean;
}

async function readItem(it: RssItem, allowIncident: boolean, seenHere: Set<string>): Promise<ReadItem> {
  const rawTitle = normalizeText(it.title || '');
  const itemLink = it.link ? String(it.link) : '';
  const r: ReadItem = {
    it, rawTitle, itemLink, sameSourceDup: false, preDup: false, publishedAt: '', publishedTs: new Date(), rawContent: '',
    ogImageHint: null, fieldOk: false, snippetSkip: false, isGoogle: false, resolvedUrl: itemLink, urlResolve: null,
    resolvedDup: false, bodyTried: false, bodyGrewTo: 0, bodyOk: false,
  };
  if (!rawTitle) return r;
  const key = normalizeForDuplicateCheck(rawTitle);
  if (seenHere.has(key)) { r.sameSourceDup = true; return r; }
  seenHere.add(key);

  // ■2: DeepSeek·본문 추출 앞 중복 확인(링크·제목 → 기억표 · DB) — 읽기만
  if (await preDuplicate(RUN.known, RUN.query, { urls: [itemLink], titles: [rawTitle] })) { r.preDup = true; return r; }

  r.publishedAt = parsePublishedAt(it);
  r.publishedTs = parsePublishedTs(it);
  // 1) RSS 스니펫 → 분야 필터 → (필요 시) 원문 추출 후 재검사 → 요약 재료
  r.rawContent = extractContent(it);
  r.fieldOk = matchesFieldKeywords(rawTitle, r.rawContent || '', { allowIncident });
  if (!r.fieldOk && (r.rawContent || '').length >= 200) { r.snippetSkip = true; return r; }

  // ■3: 구글뉴스 링크는 원문으로 한 번만 푼다(못 풀면 구글 링크 유지 + 해석 실패 표시).
  r.isGoogle = isGoogleNewsLink(itemLink);
  if (r.isGoogle) {
    const decoded = await decodeGoogleNewsUrl(itemLink).catch(() => null);
    const at = new Date().toISOString();
    if (decoded && !isGoogleNewsLink(decoded)) {
      r.resolvedUrl = decoded;
      r.urlResolve = { status: 'ok', attempts: 1, at };
      if (await preDuplicate(RUN.known, RUN.query, { urls: [decoded], titles: [] })) { r.resolvedDup = true; return r; }
    } else {
      r.urlResolve = { status: 'pending', attempts: 1, at };
    }
  }

  // 원문 본문 추출(부족·미통과 시). og:image 힌트도 함께 수집(v5.2 #5).
  if ((!r.fieldOk || !r.rawContent || r.rawContent.length < MIN_BODY_CHARS) && r.resolvedUrl) {
    r.bodyTried = true;
    const data = await extractArticleData(r.resolvedUrl);
    r.ogImageHint = data.ogImage;
    if (data.body && data.body.length > (r.rawContent || '').length) {
      r.rawContent = data.body;
      r.bodyGrewTo = data.body.length;
      r.fieldOk = matchesFieldKeywords(rawTitle, r.rawContent, { allowIncident });
    }
    r.bodyOk = (r.rawContent || '').length >= MIN_BODY_CHARS;
  }
  return r;
}

async function readSource(conf: SourceConfig, ctx: ReadCtx<ReadSource>): Promise<ReadSource> {
  const { feed, retried, repaired } = await fetchFeed(
    { url: normalizeRssFeedUrl(conf.url), format: conf.format, listPattern: conf.listPattern, jsonMap: conf.jsonMap },
    parser,
    { timeoutMs: RSS_TIMEOUT },
  );
  const raw = (feed.items || []).slice(0, conf.maxItems ?? 30) as RssItem[];
  const res: ReadSource = { items: [], total: raw.length, retried: !!retried, repaired: !!repaired };
  ctx.partial(res);
  // ■6: tier 열이 있고 설정이 사건·사고 = 보관이면, 키워드 사건 거름망을 통과시켜 판정 뒤 보관한다.
  const allowIncident = RUN.flags.tier && PROFILE.gate.incident === 'archive';
  const seenHere = new Set<string>();
  for (const it of raw) {
    // 소스 상한(60초)·전체 상한이면 그때까지 읽은 것만 판정으로
    if (ctx.cancelled() || Date.now() > ctx.deadlineAt || Date.now() > crawlDeadline) break;
    const r = await readItem(it, allowIncident, seenHere);
    if (ctx.cancelled()) break;
    res.items.push(r);
  }
  return res;
}

function recordFeedFailure(conf: SourceConfig, e: any): void {
  const stat = sourceStat(conf.id);
  const status = httpStatusOf(e);
  console.error(`  └─ [${conf.id}] ❌ ERROR (스킵 후 계속)${status ? ` [${status}]` : ''}:`, e?.message || e);
  crawlStats.failedFeeds.push(`${conf.id} (${conf.sourceName})${status ? ` [${status}]` : ''}: ${e?.message || e}`);
  crawlStats.feedFailures.push({ id: conf.id, source: conf.sourceName, sourceType: conf.sourceType, status, retried: false });
  stat.failed = String(status ?? 'ERR');
}

// ---------- Judge one (소스 순서대로 하나씩 · 이번 실행 중복 → 묶음 → DeepSeek) ----------
async function judgeSource(
  conf: SourceConfig,
  outcome: ReadOutcome<ReadSource>,
  opts: { blockedRetry?: boolean } = {},
): Promise<Candidate[]> {
  const stat = sourceStat(conf.id);
  stat.readMs = outcome.ms;
  if (conf.verifiedByFetch === false) {
    console.log(`  ├─ [${conf.id}] verified_by_fetch=false — 시도 후 실패 시 스킵`);
  }
  if (outcome.status === 'error') {
    if (opts.blockedRetry) {
      // ■2: 막힌 피드의 주·월 1회 재시도 실패는 예상된 것 — 실패 피드 목록·경고에 넣지 않고 blocked 로 남김
      const status = httpStatusOf(outcome.error);
      stat.failed = `blocked:${status ?? 'ERR'}`;
      stat.blocked = true;
      console.log(`  └─ [${conf.id}] 막힌 피드 재시도 실패${status ? ` [${status}]` : ''} — 대체 피드(${conf.blocked?.substitute ?? '-'})가 읽음`);
      return [];
    }
    recordFeedFailure(conf, outcome.error);
    return [];
  }
  const maybe: ReadSource | null = outcome.value;
  if (outcome.status === 'timeout') {
    stat.timeout = true;
    crawlStats.sourceTimeouts.push(conf.id);
    console.warn(`  ├─ [${conf.id}] ⏱️ 소스 상한 ${sourceCapMs(conf) / 1000}초 — 읽은 ${maybe?.items.length ?? 0}/${maybe?.total ?? '?'}항목만 판정(재시도 0)`);
    if (!maybe) {
      stat.failed = opts.blockedRetry ? 'blocked:timeout' : 'timeout';
      if (opts.blockedRetry) { stat.blocked = true; return []; }
      crawlStats.failedFeeds.push(`${conf.id} (${conf.sourceName}) [timeout]: 소스 상한 ${sourceCapMs(conf) / 1000}초`);
      return [];
    }
  }
  if (!maybe) return [];
  const src = maybe;
  crawlStats.feedsOk++;
  if (src.retried) console.log(`  ├─ [${conf.id}] 403/406/429 → 다른 UA 재시도 성공`);
  if (src.repaired) { crawlStats.feedsRepaired++; console.log(`  ├─ [${conf.id}] 깨진 XML 고쳐 읽음`); }
  stat.read = src.total;
  console.log(`  ├─ [${conf.id}] Found ${src.total} items (읽기 ${(outcome.ms / 1000).toFixed(1)}초)`);

  const t0 = Date.now();
  const out: Candidate[] = [];
  try {
    for (const r of src.items) {
      // 상한 시간 초과 시 이 소스의 남은 항목 중단(수집분은 반환되어 저장됨)
      if (Date.now() > crawlDeadline) {
        console.log(`  │   ⏱️ 타임아웃 도달 — 소스 [${conf.id}] 남은 항목 중단`);
        break;
      }
      crawlStats.itemsSeen++;
      const { it, rawTitle, itemLink } = r;
      if (!rawTitle) continue;
      const sessionDup = sessionDuplicate(rawTitle);
      if (sessionDup === 'exact') continue;
      // 닮은 기사인데 묶음 기억이 없으면(옛 동작) 바로 건너뜀
      if (sessionDup === 'similar' && !RUN.pool) {
        crawlStats.dupSkipKeyword++;
        console.log(`  │   ⚠️ 유사 기사 스킵(핵심어 50%+): ${rawTitle.slice(0, 30)}...`);
        continue;
      }
      if (r.sameSourceDup) continue;

      // ■2: DeepSeek·본문 추출 앞 중복 확인(링크·제목 → 기억표 · DB) — 읽기 단계에서 확인해 둠
      if (r.preDup) {
        crawlStats.dupPreSkip++;
        stat.dup++;
        continue;
      }

      const { publishedAt, publishedTs, ogImageHint, resolvedUrl, urlResolve, isGoogle } = r;
      const rawContent = r.rawContent;
      const fieldOk = r.fieldOk;

      // 스니펫만으로 이미 걸러진 경우(사건사고 vs 일반 필터) 로그 구분
      if (r.snippetSkip) {
        if (isIncidentReport(rawTitle, rawContent || '')) {
          crawlStats.incidentSkip++;
          console.log(`  │   🚫 사건사고 스킵: ${rawTitle.slice(0, 34)}...`);
        } else {
          crawlStats.filterSkip++;
        }
        continue;
      }
      // ■2(NEWS-Q4): 대체 검색 피드의 오래된 항목(설정 max_age_days)
      if (conf.maxAgeDays && publishedTs.getTime() < Date.now() - conf.maxAgeDays * 24 * 3600 * 1000) {
        crawlStats.filterSkip++;
        continue;
      }

      // ■3: 구글뉴스 링크 풀기 결과(읽기 단계에서 한 번만 풀었음)
      if (isGoogle) {
        if (urlResolve?.status === 'ok') {
          crawlStats.urlResolved++;
          if (r.resolvedDup) {
            crawlStats.dupPreSkip++;
            stat.dup++;
            continue;
          }
        } else {
          crawlStats.urlResolveFail++;
          console.log(`  │   🔗 구글 링크 해석 실패(구글 링크 유지): ${rawTitle.slice(0, 30)}...`);
        }
      }

      // 원문 본문 추출 결과(부족·미통과 시 읽기 단계에서 추출 · og:image 힌트 포함)
      if (r.bodyTried) {
        crawlStats.bodyExtractTried++;
        if (r.bodyGrewTo) console.log(`  │   📄 원문추출 ${r.bodyGrewTo}자`);
        if (r.bodyOk) crawlStats.bodyExtractOk++;
      }

      // google_url = 구글 링크일 때만(■3). 그 밖은 원문 링크가 source_url.
      const googleUrl = isGoogle ? itemLink : null;
      const sourceUrl = isGoogle ? resolvedUrl : (itemLink || conf.url);
      const resolved = isGoogle && urlResolve?.status === 'ok';
      // 출처: 구글이면 피드 <source>(매체명) → 원문 도메인, 아니면 소스 설정 그대로.
      const sourceName = isGoogle
        ? (feedSourceName(it) || (resolved ? hostOf(sourceUrl) : '') || conf.sourceName).slice(0, 100)
        : conf.sourceName;
      const outletId = isGoogle && resolved ? hostOf(sourceUrl) || conf.outletId : conf.outletId;
      // NEWS-Q4 ■2: 대체 검색 피드(site:)는 원 피드와 같은 등급(설정 grade) — 그 밖 구글 = 풀리면 press
      const googleGrade: SourceGrade = conf.grade !== 'aggregator' ? conf.grade : 'press';
      const sourceGrade: SourceGrade = isGoogle ? (resolved ? googleGrade : 'aggregator') : conf.grade;

      if (shouldBlockByDomain(sourceUrl, googleUrl || undefined)) continue;

      // v5.4 2-1: 도메인 블랙리스트 — 딥시크 호출 없이 즉시 폐기(0원 필터, 격리 저장 안 함)
      if (isBlacklistedDomain(sourceUrl, googleUrl || undefined)) {
        crawlStats.blacklistSkip++;
        console.log(`  │   ⛔ 블랙리스트 도메인 폐기: ${rawTitle.slice(0, 30)}...`);
        continue;
      }

      // 채택 게이트: field_filter (strong≥1 && negative==0 && 사건사고 아님 — ■6 보관 모드면 사건 허용)
      if (!fieldOk) {
        if (isIncidentReport(rawTitle, rawContent || '')) {
          crawlStats.incidentSkip++;
          console.log(`  │   🚫 사건사고 스킵: ${rawTitle.slice(0, 34)}...`);
        } else {
          crawlStats.filterSkip++;
        }
        continue;
      }
      // v5.2 #3: 본문이 부실하면(제목만·짧은 스니펫) 추측 요약 방지 위해 스킵
      const usableLen = rawContent && rawContent !== rawTitle ? rawContent.length : 0;
      if (usableLen < MIN_BODY_CHARS) {
        crawlStats.thinBodySkip++;
        console.log(`  │   ✂️ 본문부실 스킵(${usableLen}자<${MIN_BODY_CHARS}): ${rawTitle.slice(0, 30)}...`);
        continue;
      }
      if (isPromotionalAd(rawTitle, rawContent)) {
        crawlStats.filterSkip++;
        continue;
      }
      crawlStats.filterPass++;
      stat.candidates++;
      if (negativeVerdict(rawTitle, rawContent).gate) crawlStats.spamToGate++;

      const lang = detectLanguage(rawTitle + ' ' + rawContent);
      const isForeign = lang !== 'ko';

      // ■1(NEWS-Q3): 같은 사건 묶음의 둘째 기사부터 = DeepSeek 관문 건너뛰고 대표의 tier·분류 상속(LLM 0).
      const clusterDoc = {
        id: -(++clusterTempId), title: rawTitle, lead: leadOf(rawContent), para: paraOf(rawContent), ts: publishedTs.getTime(), grade: sourceGrade,
      };
      const hit = RUN.pool ? RUN.pool.match(clusterDoc) : null;
      if (hit) {
        const rep = hit.data;
        const repLabel = rep.articleId ? `#${rep.articleId}` : '이번 실행';
        if (rep.tier === 'reject' || (rep.tier === 'archive' && !RUN.flags.tier)) {
          crawlStats.clusterInheritRejected++;
          stat.rejected++;
          console.log(`  │   🧩 묶음 상속 거부(대표 ${repLabel} ${rep.reason || rep.tier}): ${rawTitle.slice(0, 30)}...`);
          if (rep.tier === 'reject') {
            rejectedAll.push({
              title: rawTitle, originalTitle: rawTitle, summary: null, category: rep.category, source: sourceName, sourceUrl, googleUrl,
              publishedAt, lang, sourceType: conf.sourceType, rejectReason: `cluster_inherit:${rep.reason || 'rejected'}`.slice(0, 60),
              confidence: null, domain: normalizeHost(sourceUrl) || normalizeHost(googleUrl || undefined) || null,
            });
          }
          continue;
        }
        if (isForeign) {
          // 번역 없이 외국어 제목·요약을 싣지 않는다(LANG-GUARD) — 호출도 하지 않고 건너뜀.
          crawlStats.clusterForeignSkip++;
          console.log(`  │   🧩 묶음 외국어 기사 건너뜀(대표 ${repLabel}): ${rawTitle.slice(0, 30)}...`);
          continue;
        }
        const memberSummary = enforceThreeLines(rawContent.slice(0, 400), rawTitle);
        // 묶음 기사도 저장 전 한국어 가드(LANG-GUARD) — 못 넘으면 싣지 않음
        if (!isKoreanOutput(rawTitle, memberSummary).ok) {
          crawlStats.clusterForeignSkip++;
          continue;
        }
        crawlStats.clusterInherit++;
        stat.inherited = (stat.inherited || 0) + 1;
        console.log(`  │   🧩 같은 소식(대표 ${repLabel} · ${rep.tier}/${rep.category}) — 관문 건너뜀: ${rawTitle.slice(0, 30)}...`);
        RUN.pool!.add(clusterDoc, { ...rep, articleId: rep.articleId ?? null });
        if (rep.tier === 'archive') crawlStats.archiveTier++;
        const imageUrlM = await getArticleImage(it, sourceUrl, ogImageHint);
        const memberRow: Candidate = {
          title: rawTitle, originalTitle: rawTitle, teaser: null, summary: memberSummary,
          rawBody: rawContent.slice(0, 6000) || null,
          keywords: [], category: normalizeCategory(rep.category), region: conf.region, source: sourceName,
          sourceUrl, googleUrl, imageUrl: imageUrlM, origin: 'crawler', isTop: false, isFeature: false,
          publishedAt, lang, isForeign, blocked: false, blockedReason: null,
          sourceType: conf.sourceType, outletId,
          tier: rep.tier, publishedTs, sourceGrade, urlResolve, sourceId: conf.id, clusterMember: true,
        };
        out.push(memberRow);
        continue;
      }
      if (sessionDup === 'similar') {
        // 닮았지만 묶음에는 안 듦 → 예전처럼 건너뜀(호출 늘지 않게)
        crawlStats.dupSkipKeyword++;
        console.log(`  │   ⚠️ 유사 기사 스킵(핵심어 50%+ · 묶음 아님): ${rawTitle.slice(0, 30)}...`);
        continue;
      }

      if (isForeign) {
        if (MAX_FOREIGN_ARTICLES === 0) continue;
        if (foreignArticleCount >= MAX_FOREIGN_ARTICLES) continue;
        if (!deepseekAvailable) continue;
      }
      // ■2: 하루 DeepSeek 상한
      if (!deepseekRoomLeft()) break;

      const shortTitle = rawTitle.length > 48 ? rawTitle.slice(0, 48) + '...' : rawTitle;
      const prefix = lang === 'ko' ? '[KO]' : `[${lang.toUpperCase()}→KO]`;
      console.log(`  │   ${prefix} ${shortTitle}`);

      // 판정용 배정 카테고리(제목+본문 기준 잠정 분류) — category_fit 판정 기준
      const callsBefore = deepseekStats.calls;
      const provCategory = classifyCategory(rawTitle, rawContent, normalizeCategory(conf.category));
      crawlStats.judgedForCluster++;
      const pack = await generateKoreanPack(rawTitle, rawContent, lang, provCategory);
      // NEWS-Q6 ⓑ′: DeepSeek 가 멈춰 판정이 없으면 거부로 남기지 않는다(다음 실행이 다시 본다)
      if (deepseekDown() && pack.categoryFit === undefined) break;

      // v5.4 2-2 · NEWS-Q2 ■6: 관문 두 층(publish / archive / reject). DeepSeek 가용 시에만 엄격 적용.
      let tier: Tier = 'publish';
      if (deepseekAvailable) {
        const j = { categoryFit: pack.categoryFit, isIncident: pack.isIncident, confidence: pack.confidence };
        // 키워드 거름망이 사건사고로 보면 publish 는 안 됨(모델 오판 차단) — 보관 또는 거부
        const kwIncident = isIncidentReport(rawTitle, rawContent || '');
        const d = effectiveTier(
          decideTier(j, { keywordIncident: kwIncident, hasKeyword: hasFieldKeyword(rawTitle, rawContent), gate: PROFILE.gate }),
          RUN.flags.tier,
        );
        if (d.tier === 'reject') {
          const reason = d.reason || 'rejected';
          countReject(reason);
          stat.rejected++;
          stat.calls += deepseekStats.calls - callsBefore;
          console.log(`  │   🚫 입구 게이트 거부(${reason}): ${shortTitle}`);
          // ■1: 내용 판정 거부만 묶음 기억에(같은 사건 다음 기사는 호출 없이 함께 거부). 판정 실패는 넣지 않음.
          if (RUN.pool && reason !== 'judgment_missing') {
            RUN.pool.add(clusterDoc, { tier: 'reject', category: provCategory, reason, articleId: null });
          }
          // 격리 저장(rejected_articles) — 감사·프롬프트 개선 소재. 자동 블랙리스트는
          // 이 테이블 집계로 다음 실행 시작 시 재평가(in-memory 카운트 폐기, v5.4.1 작업2).
          rejectedAll.push({
            title: (isForeign ? pack.titleKo.trim() : rawTitle) || rawTitle,
            originalTitle: rawTitle,
            summary: pack.summary || null,
            category: provCategory,
            source: sourceName,
            sourceUrl,
            googleUrl,
            publishedAt,
            lang,
            sourceType: conf.sourceType,
            rejectReason: reason,
            confidence: pack.confidence ?? null,
            domain: normalizeHost(sourceUrl) || normalizeHost(googleUrl || undefined) || null,
          });
          continue;
        }
        tier = d.tier;
        if (tier === 'archive') {
          crawlStats.archiveTier++;
          console.log(`  │   🗄️ 보관(archive · ${d.reason}): ${shortTitle}`);
        }
      }
      if (isForeign && (!pack.titleKo.trim() || !pack.summary.trim())) { stat.calls += deepseekStats.calls - callsBefore; continue; }

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

      // ── LANG-GUARD-1 1-2: 최종 산출물 언어 가드(저장 직전, 게이트 통과 후) ──
      // 원인(LLM이 원문 언어로 응답 / 요약 실패로 원문이 그대로 실림)과 무관하게
      // '최종 title·summary'를 검사하므로 두 경로를 동시에 막는다.
      let finalTitle = titleKo;
      let finalSummary = summaryKo;
      let langCheck = isKoreanOutput(finalTitle, finalSummary);
      if (!langCheck.ok) {
        console.log(`  │   🌐 비한국어 산출물 감지(${describeLangCheck(langCheck)}) → 한국어 강제 재생성`);
        crawlStats.langRetry++;
        // 새 호출 유형을 만들지 않고 기존 요약 호출을 한국어 강제로 1회만 재실행.
        const re = await summarizeKoreanDeepSeek(rawTitle, rawContent, {
          translate: isForeign, category: provCategory, forceKorean: true,
        });
        if (re && re.titleKo.trim() && re.summary.trim()) {
          finalTitle = isForeign ? re.titleKo.trim() : rawTitle;
          finalSummary = re.summary;
          langCheck = isKoreanOutput(finalTitle, finalSummary);
        }
        if (!langCheck.ok) {
          // fail-closed: 원문을 그대로 싣는 폴백 금지. 격리 후 폐기.
          crawlStats.langRejectSkip++;
          stat.rejected++;
          stat.calls += deepseekStats.calls - callsBefore;
          console.log(`  │   🚫 비한국어 산출물 격리(${describeLangCheck(langCheck)}): ${shortTitle}`);
          rejectedAll.push({
            title: finalTitle || rawTitle, originalTitle: rawTitle, summary: finalSummary || null,
            category: provCategory, source: sourceName, sourceUrl, googleUrl, publishedAt,
            lang, sourceType: conf.sourceType,
            rejectReason: 'non_korean_output',
            confidence: pack.confidence ?? null,
            domain: normalizeHost(sourceUrl) || normalizeHost(googleUrl || undefined) || null,
          });
          continue;
        }
      }
      stat.calls += deepseekStats.calls - callsBefore;

      const imageUrl = await getArticleImage(it, sourceUrl, ogImageHint);
      // ■1: 판정을 마친 기사 = 이번 실행 묶음의 대표 후보(외국 기사는 원제로도 비교되게 한국어 제목을 altTitle 로)
      if (RUN.pool) {
        RUN.pool.add(
          { ...clusterDoc, altTitle: finalTitle !== rawTitle ? finalTitle : null },
          { tier, category: finalCategory, articleId: null },
        );
      }

      out.push({
        title: finalTitle, originalTitle: rawTitle, teaser: teaserKo, summary: finalSummary,
        rawBody: rawContent.slice(0, 6000) || null,
        keywords: keywordsKo, category: finalCategory, region: conf.region, source: sourceName,
        sourceUrl, googleUrl, imageUrl, origin: 'crawler', isTop: false, isFeature: false,
        publishedAt, lang, isForeign, blocked: false, blockedReason: null,
        sourceType: conf.sourceType, outletId,
        tier, publishedTs, sourceGrade, urlResolve, sourceId: conf.id,
      });
    }

    stat.judgeMs = Date.now() - t0;
    console.log(`  └─ [${conf.id}] Done: ${out.length} collected (판정 ${(stat.judgeMs / 1000).toFixed(1)}초)\n`);
    return out;
  } catch (e: any) {
    // 피드는 읽혔고 판정 중 오류 — 그때까지 모은 것은 살린다(피드 실패로 세지 않음)
    stat.judgeMs = Date.now() - t0;
    stat.failed = 'judge';
    console.error(`  └─ [${conf.id}] ❌ 판정 중 오류(모은 ${out.length}건 유지 · 다음 소스로):`, e?.message || e);
    return out;
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
    // Statory search supplies an abstract, not the original article body.
    rawBody: null,
    keywords: query ? [query] : [],
    category: DEFAULT_CATEGORY,
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
    tier: 'publish',
    publishedTs: null,
    sourceGrade: 'aggregator',
    urlResolve: null,
    sourceId: 'statory',
  };
}

async function finalizeStatoryCandidate(
  partial: Candidate,
  _minScore: number,
): Promise<Candidate | null> {
  const rawTitle = normalizeText(partial.originalTitle || partial.title);
  if (!rawTitle) return null;
  // Statory 후보는 묶음 상속 없이 예전대로: 같은 제목·닮은 제목이면 건너뜀
  if (sessionDuplicate(rawTitle)) { crawlStats.dupSkipKeyword++; return null; }

  const rawContent = partial.summary || rawTitle;
  if (shouldBlockByDomain(partial.sourceUrl)) return null;
  if (isBlacklistedDomain(partial.sourceUrl)) { crawlStats.blacklistSkip++; return null; }

  const lang = partial.lang;
  const isForeign = partial.isForeign;

  if (isForeign) {
    if (MAX_FOREIGN_ARTICLES === 0) return null;
    if (foreignArticleCount >= MAX_FOREIGN_ARTICLES) return null;
    if (!deepseekAvailable) return null;
  }

  if (!matchesFieldKeywords(rawTitle, rawContent)) return null;
  if (await preDuplicate(RUN.known, RUN.query, { urls: [partial.sourceUrl], titles: [rawTitle] })) {
    crawlStats.dupPreSkip++;
    sourceStat('statory').dup++;
    return null;
  }
  if (!deepseekRoomLeft()) return null;
  if (isPromotionalAd(rawTitle, rawContent)) return null;

  const provCategory = classifyCategory(rawTitle, rawContent, partial.category);
  const pack = await generateKoreanPack(rawTitle, rawContent, lang, provCategory);
  if (deepseekDown() && pack.categoryFit === undefined) return null;
  // v5.4 2-2 · NEWS-Q2 ■6: 관문 두 층. DeepSeek 가용 시에만 엄격 적용.
  let tier: Tier = 'publish';
  if (deepseekAvailable) {
    const j = { categoryFit: pack.categoryFit, isIncident: pack.isIncident, confidence: pack.confidence };
    const kwIncident = isIncidentReport(rawTitle, rawContent || '');
    const d = effectiveTier(
      decideTier(j, { keywordIncident: kwIncident, hasKeyword: hasFieldKeyword(rawTitle, rawContent), gate: PROFILE.gate }),
      RUN.flags.tier,
    );
    if (d.tier === 'archive') { tier = 'archive'; crawlStats.archiveTier++; }
    if (d.tier === 'reject') {
      const reason = d.reason || 'rejected';
      countReject(reason);
      sourceStat('statory').rejected++;
      console.log(`  │   🚫 입구 게이트 거부(${reason}, statory): ${rawTitle.slice(0, 30)}`);
      rejectedAll.push({
        title: (isForeign ? pack.titleKo.trim() : rawTitle) || rawTitle,
        originalTitle: rawTitle, summary: pack.summary || null, category: provCategory,
        source: partial.source, sourceUrl: partial.sourceUrl, googleUrl: partial.googleUrl,
        publishedAt: partial.publishedAt, lang, sourceType: partial.sourceType,
        rejectReason: reason, confidence: pack.confidence ?? null,
        domain: normalizeHost(partial.sourceUrl) || null,
      });
      return null;
    }
  }
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

  // ── LANG-GUARD-1 1-2: statory 경로도 동일하게 최종 산출물 언어 검사 ──
  let finalTitle = titleKo;
  let finalSummary = summaryKo;
  let langCheck = isKoreanOutput(finalTitle, finalSummary);
  if (!langCheck.ok) {
    console.log(`  │   🌐 비한국어 산출물 감지(statory, ${describeLangCheck(langCheck)}) → 한국어 강제 재생성`);
    crawlStats.langRetry++;
    const re = await summarizeKoreanDeepSeek(rawTitle, rawContent, {
      translate: isForeign, category: provCategory, forceKorean: true,
    });
    if (re && re.titleKo.trim() && re.summary.trim()) {
      finalTitle = isForeign ? re.titleKo.trim() : rawTitle;
      finalSummary = re.summary;
      langCheck = isKoreanOutput(finalTitle, finalSummary);
    }
    if (!langCheck.ok) {
      crawlStats.langRejectSkip++;
      console.log(`  │   🚫 비한국어 산출물 격리(statory, ${describeLangCheck(langCheck)})`);
      rejectedAll.push({
        title: finalTitle || rawTitle, originalTitle: rawTitle, summary: finalSummary || null,
        category: provCategory, source: partial.source, sourceUrl: partial.sourceUrl,
        googleUrl: partial.googleUrl, publishedAt: partial.publishedAt, lang,
        sourceType: partial.sourceType, rejectReason: 'non_korean_output',
        confidence: pack.confidence ?? null,
        domain: normalizeHost(partial.sourceUrl) || null,
      });
      return null;   // fail-closed
    }
  }

  return {
    ...partial,
    title: finalTitle,
    originalTitle: rawTitle,
    teaser: teaserKo,
    summary: finalSummary,
    keywords: keywordsKo,
    category: finalCategory,
    lang,
    isForeign,
    tier,
  };
}

async function loadStatoryCandidates(): Promise<Candidate[]> {
  const base = process.env.STATORY_API_URL?.trim();
  if (!base || !/^https?:\/\//i.test(base)) return [];

  try {
    const query = process.env.STATORY_NEWS_QUERY?.trim() ?? PROFILE.sources.statory_query;
    const limitRaw = process.env.STATORY_NEWS_LIMIT;
    const parsedLimit = limitRaw ? parseInt(limitRaw, 10) : 20;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 20;
    const regionHint = process.env.STATORY_NEWS_REGION_HINT?.trim() ?? 'KR';

    // undici(fetch) 대신 axios 사용(전체 크롤에서 undici 제거)
    const resp = await axios.post(
      `${base.replace(/\/+$/, '')}/api/search/news`,
      { query, limit, region_hint: regionHint },
      {
        timeout: 20_000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      },
    );
    if (resp.status < 200 || resp.status >= 300) throw new Error(`HTTP ${resp.status}`);
    const json = (resp.data ?? {}) as {
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

// v5.2 #4: publishedAt(YYYY-MM-DD) 기준 최근 N일 날짜 문자열 목록
function recentYmdWindow(centerYmd: string, days: number): string[] {
  const out: string[] = [];
  const base = new Date(`${centerYmd}T00:00:00`);
  if (Number.isNaN(base.getTime())) return [centerYmd];
  for (let d = -days; d <= days; d++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + d);
    out.push(toYmd(dt));
  }
  return out;
}

// ---------- DB 중복 체크 ----------
async function isDuplicateInDb(repo: any, c: Candidate): Promise<boolean> {
  if (await repo.findOne({ where: { sourceUrl: c.sourceUrl } })) return true;
  // NEWS-Q1: 방송은 영상 URL 로만 중복을 본다(기사와 제목이 닮아도 별개 자료).
  if (c.sourceType === BROADCAST_SOURCE_TYPE) return false;
  if (c.googleUrl && await repo.findOne({ where: { googleUrl: c.googleUrl } })) return true;
  if (await repo.findOne({ where: { title: c.title, publishedAt: c.publishedAt, source: c.source } })) return true;
  // NEWS-Q3 ■1: 묶음 기사는 "같은 사건 다른 매체"라서 싣는다(제목 닮음 중복 검사 건너뜀 · 같은 URL·같은 제목만 막음).
  if (c.clusterMember) return false;
  // v5.2 #4: 같은 날짜만 → 최근 3일 창으로 확장(매체별 게재일 차이 흡수)
  const window = recentYmdWindow(c.publishedAt, 3);
  const nearbyArticles = await repo.find({ where: window.map((d) => ({ publishedAt: d })) });
  for (const existing of nearbyArticles) {
    if (existing.sourceType === BROADCAST_SOURCE_TYPE) continue;
    if (calculateTitleSimilarity(c.title, existing.title) >= 0.5) return true;
  }
  // v5.4.1 3-2: 최근 72시간 저장분과 크로스매체(매체만 다른 동일 사건) 유사도 검사
  const since = new Date(Date.now() - 72 * 3600 * 1000);
  const recent72h = await repo.find({ where: { createdAt: MoreThanOrEqual(since) } });
  for (const existing of recent72h) {
    if (existing.sourceType === BROADCAST_SOURCE_TYPE) continue;
    const sim = crossMediaSimilarity(c.title, existing.title);
    if (sim >= 0.6) {
      crawlStats.crossMediaDupSkip++;
      console.log(`  │   🔁 크로스매체 중복 스킵(${Math.round(sim * 100)}%, 기존유지): ${c.title.slice(0, 30)}...`);
      return true;
    }
  }
  return false;
}

// ---------- Save ----------
async function saveCandidates(list: Candidate[]) {
  const repo = ds.getRepository(Article);
  const rawBodyState: RawBodyWriteState = { unavailable: false };
  let inserted = 0, dup = 0, withImage = 0, archived = 0;
  const q = (sql: string, params?: unknown[]) => ds.query(sql, params);

  console.log(`\n💾 Saving to DB (${list.length} candidates)...`);
  for (const c of list) {
    // v5.4.1 3-1: 저장 직전 HTML 엔티티 디코딩(제목·요약·티저·원제)
    c.title = decodeEntities(c.title);
    if (c.summary) c.summary = decodeEntities(c.summary);
    if (c.teaser) c.teaser = decodeEntities(c.teaser);
    if (c.originalTitle) c.originalTitle = decodeEntities(c.originalTitle);

    // NEWS-Q6 ■2: 정규화 URL(utm·m.·amp·끝 / 무시) ∪ 같은 매체 + 24시간 + 닮은 제목 — 이번 실행에 저장한 것까지
    const isBroadcast = c.sourceType === BROADCAST_SOURCE_TYPE;
    const sameHit = RUN.known.sameArticle({
      url: c.sourceUrl, googleUrl: c.googleUrl, title: c.title, originalTitle: c.originalTitle,
      source: isBroadcast ? null : c.source, ts: isBroadcast ? null : c.publishedTs?.getTime() ?? null,
    });
    if (sameHit || await isDuplicateInDb(repo, c)) {
      dup++;
      if (sameHit) {
        crawlStats.sameArticleSkip++;
        console.log(`  │   🔁 같은 기사(${sameHit === 'url' ? '정규화 URL' : '같은 매체 24h'}) 스킵: ${c.title.slice(0, 30)}...`);
      }
      if (c.sourceId) sourceStat(c.sourceId).dup++;
      continue;
    }
    // NEWS-Q2: 묶음 SQL 2 열(tier·published_ts·source_grade·url_resolve)은 INSERT 뒤 열이 선 것만 채운다.
    const extras = {
      tier: c.tier || 'publish',
      publishedTs: c.publishedTs ?? null,
      sourceGrade: c.sourceGrade ?? defaultGrade(c.sourceType),
      urlResolve: c.urlResolve ?? null,
    };
    const afterInsert = async (id: number | null) => {
      RUN.known.addSaved({
        url: c.sourceUrl, googleUrl: c.googleUrl, title: c.title, originalTitle: c.originalTitle,
        source: isBroadcast ? null : c.source, ts: isBroadcast ? null : c.publishedTs?.getTime() ?? null,
      });
      await writeRowExtras(q, id, extras, RUN.flags, console.warn, c.sourceUrl);
      if (c.sourceId) {
        const st = sourceStat(c.sourceId);
        if (extras.tier === 'archive') st.archived++;
        else st.saved++;
      }
      if (extras.tier === 'archive') archived++;
    };

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
        rawBody: c.rawBody,
        category: c.category, region: c.region, source: c.source, sourceUrl: c.sourceUrl,
        googleUrl: c.googleUrl, imageUrl: c.imageUrl, origin: c.origin, isTop: c.isTop,
        isFeature: c.isFeature, publishedAt: c.publishedAt, lang: c.lang, isForeign: c.isForeign,
        keywords: safeKeywords, blocked: c.blocked, blockedReason: c.blockedReason,
        sourceType: c.sourceType, outletId: c.outletId,
      });
      const newId = await insertArticleWithRawBody(repo, ent, rawBodyState);
      inserted++;
      if (c.imageUrl) withImage++;
      await afterInsert(newId);
      if (inserted % 20 === 0) console.log(`  ├─ ${inserted} saved...`);
    } catch (e: any) {
      try {
        const ent = repo.create({
          title: c.title, originalTitle: c.originalTitle, teaser: c.teaser, summary: c.summary,
          rawBody: c.rawBody,
          category: c.category, region: c.region, source: c.source, sourceUrl: c.sourceUrl,
          googleUrl: c.googleUrl, imageUrl: c.imageUrl, origin: c.origin, isTop: c.isTop,
          isFeature: c.isFeature, publishedAt: c.publishedAt, lang: c.lang, isForeign: c.isForeign,
          keywords: null, blocked: c.blocked, blockedReason: c.blockedReason,
          sourceType: c.sourceType, outletId: c.outletId,
        });
        const newId = await insertArticleWithRawBody(repo, ent, rawBodyState);
        inserted++;
        if (c.imageUrl) withImage++;
        await afterInsert(newId);
      } catch {}
    }
  }
  console.log(`  └─ Save complete! inserted=${inserted} (보관 archive ${archived}), duplicates=${dup}, withImage=${withImage}\n`);
  // NEWS-Q1: kind 열(묶음 SQL)이 있을 때만 방송 행의 kind 를 맞춘다. 없으면 source_type 으로만 구분.
  if (list.some((c) => c.sourceType === BROADCAST_SOURCE_TYPE)) {
    if (RUN.flags.kind) {
      try {
        await ds.query(
          `UPDATE articles SET kind = 'broadcast' WHERE source_type = 'broadcast' AND kind IS DISTINCT FROM 'broadcast'`,
        );
      } catch (e) {
        console.warn('[broadcast] kind 기록 실패(무시, source_type 으로 구분됨):', (e as Error).message);
      }
    } else {
      console.log('  [broadcast] kind 열 없음 — source_type=broadcast 로만 구분(묶음 SQL 적용 전)');
    }
  }
  return { inserted, dup, withImage, archived };
}

// v5.4: 거부 기사 격리 저장(rejected_articles). 실패는 개별 무시(크롤 지속).
async function saveRejected(list: RejectedRecord[]): Promise<number> {
  if (list.length === 0) return 0;
  const repo = ds.getRepository(RejectedArticle);
  let n = 0;
  for (const r of list) {
    try {
      const ent = repo.create({
        title: r.title, originalTitle: r.originalTitle, summary: r.summary,
        category: r.category, source: r.source, sourceUrl: r.sourceUrl, googleUrl: r.googleUrl,
        publishedAt: r.publishedAt, lang: r.lang, sourceType: r.sourceType,
        rejectReason: r.rejectReason, confidence: r.confidence, domain: r.domain, judgedAt: new Date(),
      });
      await repo.save(ent);
      n++;
    } catch { /* 격리 저장 실패는 무시 */ }
  }
  return n;
}

function loadBroadcastSourcesCount(): number {
  try {
    return loadBroadcastSources().length;
  } catch {
    return 0;
  }
}

// ---------- Main ----------
async function main() {
  const startTime = Date.now();
  
  console.log('\n========================================');
  console.log(`🚀 ${PROFILE.site_name} Crawler v5.1 START (field=${PROFILE.field})`);
  console.log('   - 기관·학술 + 전문 + 세계신문 + 국내 + 구글뉴스(분야 설정)');
  console.log('   - 분야 키워드 필터 + DeepSeek 한/영 요약 + 관문 두 층(publish/archive)');
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

  // NEWS-Q2: 묶음 SQL 1·2 의 열·표 확인 → 있는 것만 켠다.
  const q = (sql: string, params?: unknown[]) => ds.query(sql, params);
  RUN.query = q;
  RUN.flags = await probeSchema(q);
  console.log(`[schema] ${Object.entries(RUN.flags).map(([k, v]) => `${k}=${v ? '있음' : '없음'}`).join(' · ')}`);
  RUN.known = await loadKnownIndex(q, 30);
  // NEWS-Q3 ■1: 사건 묶음 기억(최근 108시간 저장분). 실패하면 묶음 없이 옛 동작.
  try {
    RUN.pool = await loadClusterPool(q, RUN.flags, CLUSTER_TEXT);
    RUN.poolLoaded = RUN.pool.size;
    console.log(`[cluster] 묶음 기억 ${RUN.poolLoaded}건(최근 저장분) · 묶음 열 ${RUN.flags.cluster ? '있음' : '없음(상속만 · 저장은 묶음 SQL 3 뒤)'}`);
  } catch (e) {
    RUN.pool = null;
    console.warn('[cluster] 묶음 기억 읽기 실패(묶지 않고 진행):', (e as Error).message);
  }
  const usedBefore = RUN.flags.crawlRuns ? await usedTodayFromRuns(q) : 0;
  RUN.budget = new DeepseekBudget(dailyCap(process.env, PROFILE.gate.deepseek_daily_cap), usedBefore);
  console.log(`[deepseek] 하루 상한 ${RUN.budget.cap}회 · 오늘 앞 실행 ${usedBefore}회 · 모델 ${DEEPSEEK_MODEL}`);

  // v5.4.1 작업2: rejected_articles 집계로 자동 블랙리스트 재평가(실행 시작 시).
  // 누적 판정 10+ AND cat_fit/seo 거부율 90%+ 도메인만 추가(is_incident 제외).
  try {
    const autoHits = await evaluateAutoBlacklistFromDb((sql) => ds.query(sql));
    if (autoHits.length) {
      for (const h of autoHits) {
        console.log(`⛔ 자동 블랙리스트 추가: ${h.domain} (판정 ${h.total}건, 거부 ${h.catSeoRejects})`);
        const titles = h.recentTitles.map((t) => `  · ${t}`).join('\n');
        await notifyDiscord(
          `⛔ ${PROFILE.messages.notify_prefix}: 도메인 자동 블랙리스트 추가\n도메인: ${h.domain}\n` +
          `누적 판정 ${h.total}건 중 category_fit/SEO 거부 ${h.catSeoRejects}건(≥90%)\n` +
          `최근 거부 기사:\n${titles}\n` +
          `해제: data/domain_blacklist.json 에서 제거 후 재배포(또는 DOMAIN_AUTOADD_* 조정)`,
        );
      }
    }
  } catch (e) {
    console.warn('[auto-blacklist] 평가 실패(무시):', (e as Error).message);
  }

  // v5.2 #4: 대표 선정 — 전문매체 > 주요지 > 포털/지방지 순으로 먼저 크롤해,
  // 세션 내 중복(같은 사건)에서 먼저 채택되는 것이 선호 매체가 되도록 정렬.
  const allSources = buildSources();
  let crawlSources = [...allSources].sort((a, b) => {
    const r = sourceTypeRank(a.sourceType) - sourceTypeRank(b.sourceType);
    if (r !== 0) return r;
    return (a.priority ?? 100) - (b.priority ?? 100);
  });
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

  // Cron 안전장치: startTime 기준 상한 시간 설정(■1ⓔ 55분)
  crawlDeadline = startTime + CRAWL_TIMEOUT_MS;
  let timedOut = false;
  const progress = emptyProgress(crawlSources.length, CRAWL_TIMEOUT_MS);
  RUN.progress = progress;

  // NEWS-Q1 ■4: 방송은 기사 통계(한국 비중 등)에 섞지 않고 저장만 함께 한다.
  // NEWS-Q4 ■1ⓓ: 방송 9채널을 맨 앞에(작고 빠름 · 5분 몫) — 기사 소스가 상한에 걸려도 방송은 빠지지 않는다.
  // CRAWL_SOURCE_TYPES 로 좁힌 실행에서는 broadcast 가 들어 있을 때만 돈다.
  let broadcasts: Candidate[] = [];
  const broadcastWanted = !typeFilter.length || typeFilter.includes(BROADCAST_SOURCE_TYPE);
  progress.broadcastFirst = broadcastWanted;
  if (broadcastWanted) {
    const b0 = Date.now();
    try {
      broadcasts = await crawlBroadcastSources(Math.min(crawlDeadline, b0 + BROADCAST_SHARE_MS));
    } catch (e) {
      console.warn('[broadcast] 방송 추적 실패(기사 저장은 계속):', (e as Error).message);
    }
    progress.broadcastMs = Date.now() - b0;
  }

  // ■1ⓒ: 시작점 순환(지난 실행이 마지막으로 마친 소스 다음부터) · ■2: 막힌 피드는 주·월 1회만 원 피드
  const narrowed = typeFilter.length > 0 || maxSrc > 0;
  const lastId = RUN.flags.crawlRuns && !narrowed ? await lastRunLastSourceId(q, PROFILE.field) : null;
  const plan = planSources(crawlSources, lastId);
  progress.startIndex = plan.startIndex;
  progress.startId = plan.startId;
  progress.blockedSkipped = plan.skipped.map((s) => s.id);
  progress.blockedFromHost = crawlSources.filter((s) => s.blocked?.kind === 'blocked_from_host').length;
  const retryIds = new Set(plan.retrying.map((s) => s.id));
  let order = plan.order;
  // NEWS-Q7 ■3: 놓친 날 되짚기 1회 — 기사 단계를 못 돈 실행이 있으면 국내지 site: 날짜 검색을 맨 앞에(LLM 0 · 중복 검사·관문 그대로)
  const missedCfg = PROFILE.sources.missed_day;
  if (missedCfg?.query && RUN.flags.crawlRuns && !narrowed) {
    const missed = planMissedDay(await recentRunBriefs(q, PROFILE.field), Date.now(), missedCfg.max_days ?? 3);
    if (missed) {
      const extra = missedDaySources(order, missed, missedCfg);
      progress.missedLookback = { ...missed, sources: extra.length };
      progress.total += extra.length;
      order = [...extra, ...order];
      console.log(`🩹 놓친 날 되짚기: 결손 실행 ${missed.covers.join(', ')} → 국내지 ${extra.length}곳 site: 검색 after:${missed.after} before:${missed.before}`);
    }
  }
  console.log(
    `📡 Crawling ${order.length} sources (동시 읽기 ${SOURCE_CONCURRENCY} · 소스 상한 ${SOURCE_CAP_MS / 1000}초 · 구글 검색 ${GOOGLE_SEARCH_CAP_MS / 1000}초 · 전체 ${Math.round(CRAWL_TIMEOUT_MS / 60000)}분)` +
    ` · 시작 ${plan.startIndex + 1}번째(${plan.startId ?? '-'})${lastId ? ` ← 지난 실행 끝 ${lastId}` : ''}`,
  );
  if (plan.skipped.length) console.log(`   막힌 피드 오늘 건너뜀(대체 피드가 읽음): ${progress.blockedSkipped.join(', ')}`);
  if (plan.retrying.length) console.log(`   막힌 피드 오늘 다시 해 봄(주·월 1회): ${[...retryIds].join(', ')}`);
  console.log('');

  await runSources<SourceConfig, ReadSource>(order, {
    concurrency: SOURCE_CONCURRENCY,
    capMs: SOURCE_CAP_MS,
    capFor: (conf) => sourceCapMs(conf),
    canStart: () => Date.now() <= crawlDeadline,
    read: (conf, ctx) => readSource(conf, ctx),
    consume: async (conf, outcome, i) => {
      if (Date.now() > crawlDeadline) return false;
      console.log(`[${i + 1}/${order.length}] ${conf.sourceName} (${conf.category})`);
      const retry = retryIds.has(conf.id);
      const got = await judgeSource(conf, outcome, { blockedRetry: retry });
      all.push(...got);
      progress.reached = i + 1;
      progress.lastId = conf.id;
      if (retry) {
        const ok = outcome.status === 'ok' || (outcome.status === 'timeout' && !!outcome.value);
        const status = outcome.status === 'error' ? String(httpStatusOf(outcome.error) ?? 'ERR') : ok ? undefined : 'timeout';
        progress.blockedRetried.push({ id: conf.id, ok, ...(status ? { status } : {}) });
        console.log(`  🔁 막힌 피드 재시도 ${conf.id}: ${ok ? '성공 — 설정의 blocked 를 지워도 됨' : `실패(${status}) — 대체 피드 유지`}`);
      }
      return Date.now() <= crawlDeadline;
    },
  });
  if (progress.reached < order.length) {
    timedOut = true;
    progress.timedOut = true;
    progress.stoppedAt = 'articles';
    console.warn(
      `\n⏱️ 상한 시간(${Math.round(CRAWL_TIMEOUT_MS / 60000)}분) 초과 — ${progress.reached}/${order.length} 소스에서 크롤 중단` +
      `(마지막 ${progress.lastId ?? '-'} · 다음 실행은 그 다음부터) · 수집분 저장 진행\n`,
    );
  }

  // 타임아웃이 아니면 Statory 후보도 수집
  if (!timedOut && Date.now() <= crawlDeadline) {
    const statoryCands = await loadStatoryCandidates();
    all.push(...statoryCands);
  } else if (!timedOut) {
    timedOut = true;
    progress.timedOut = true;
    progress.stoppedAt = 'statory';
  }
  progress.timeouts = [...crawlStats.sourceTimeouts];

  const result = await saveCandidates([...all, ...broadcasts]);
  // v5.4: 거부 기사 격리 저장(자동 블랙리스트는 다음 실행 시작 시 rejected 집계로 재평가)
  crawlStats.quarantined = await saveRejected(rejectedAll);

  // NEWS-Q2 ■3: 기존 행의 구글 링크를 오래된 순으로 최대 100건 원문으로(url_resolve 열 있을 때만).
  let urlBackfill: Record<string, number> | null = null;
  if (RUN.flags.urlResolve) {
    try {
      const bf = await backfillGoogleUrls({
        query: q,
        decode: (u) => decodeGoogleNewsUrl(u),
        gradeColumn: RUN.flags.sourceGrade,
        deadline: startTime + CRAWL_TIMEOUT_MS + 5 * 60 * 1000,
      });
      urlBackfill = { ...bf };
    } catch (e) {
      console.warn('[url-backfill] 실패(무시):', (e as Error).message);
    }
  } else {
    console.log('[url-backfill] url_resolve 열 없음 — 기존 행 해석은 묶음 SQL 2 적용 뒤부터');
  }
  // NEWS-Q3 ■1: 최근 30일 다시 묶어 cluster_id·cluster_size 두 열만(묶음 SQL 3 있을 때만).
  let clusterBackfill: { rows: number; clusters: number; updated: number } | null = null;
  if (RUN.flags.cluster) {
    try {
      clusterBackfill = await backfillClusters(q, RUN.flags, CLUSTER_TEXT);
      if (clusterBackfill) {
        console.log(`[cluster-backfill] 최근 30일 ${clusterBackfill.rows}건 → 묶음(2건+) ${clusterBackfill.clusters} · 열 고침 ${clusterBackfill.updated}행`);
      }
    } catch (e) {
      console.warn('[cluster-backfill] 실패(무시):', (e as Error).message);
    }
  } else {
    console.log('[cluster-backfill] cluster_id 열 없음 — 공개 API 가 응답 때 최근 7일을 묶는다(묶음 SQL 3 적용 뒤 저장)');
  }
  const clusterSkipped = crawlStats.clusterInherit + crawlStats.clusterInheritRejected + crawlStats.clusterForeignSkip;
  const clusterStats = {
    poolLoaded: RUN.poolLoaded,
    inherited: crawlStats.clusterInherit,
    inheritedRejected: crawlStats.clusterInheritRejected,
    foreignSkipped: crawlStats.clusterForeignSkip,
    savedPct: savedPct(clusterSkipped, crawlStats.judgedForCluster),
    backfill: clusterBackfill,
  };
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
  console.log(`✅ END in ${Math.floor(elapsed/60)}분 ${elapsed%60}초${timedOut ? ' (⏱️ 상한 시간 도달로 조기 종료 — 수집분 저장됨)' : ''}`);
  console.log(`   수집: ${all.length}개 (한국 ${koreanCount}, 외국 ${foreignCount})`);
  const krRatioPct = all.length > 0 ? (koreanCount / all.length) * 100 : 0;
  console.log(`   한국 콘텐츠 비중: ${krRatioPct.toFixed(1)}% (목표 참고 30%)`);
  const imgRate = result.inserted > 0 ? ((result.withImage / result.inserted) * 100).toFixed(1) : '0.0';
  console.log(`   저장: ${result.inserted}개, 이미지: ${result.withImage}개 (${imgRate}%, 폴백 제외 실이미지)`);
  console.log(`   필터: 후보 ${crawlStats.itemsSeen} → 통과 ${crawlStats.filterPass} / 스킵 ${crawlStats.filterSkip} (통과율 ${passRate}%)`);
  console.log(`   ├ 사건사고 스킵(키워드): ${crawlStats.incidentSkip}건`);
  console.log(`   ├ ⛔ 블랙리스트 도메인 폐기: ${crawlStats.blacklistSkip}건`);
  console.log(`   ├ 🚫 입구게이트 거부(incident): ${crawlStats.judgeIncidentSkip}건`);
  console.log(`   ├ 🚫 입구게이트 거부(category_fit): ${crawlStats.judgeCatSkip}건`);
  console.log(`   ├ 🚫 입구게이트 거부(확신도부족): ${crawlStats.gateRejectLowConf}건`);
  console.log(`   ├ ⚠️ 판정 실패(DeepSeek 응답없음/장애): ${crawlStats.deepseekFailSkip}건`);
  console.log(`   ├ 🌐 비한국어 산출물: 재생성 ${crawlStats.langRetry}건 / 격리 ${crawlStats.langRejectSkip}건`);
  console.log(`   ├ 📦 격리 저장(rejected_articles): ${crawlStats.quarantined}건`);
  console.log(`   ├ 🔁 DeepSeek 앞 중복 건너뜀: ${crawlStats.dupPreSkip}건 · ⛔ 하루 상한 건너뜀: ${crawlStats.capSkip}건`);
  console.log(`   ├ 🗄️ 보관(archive) 판정: ${crawlStats.archiveTier}건 · 저장 중 보관 ${result.archived}건`);
  console.log(`   ├ 🔗 구글 링크 → 원문: ${crawlStats.urlResolved}건 / 해석 실패 ${crawlStats.urlResolveFail}건`);
  console.log(`   ├ 🧩 묶음 상속(관문 건너뜀): 저장 후보 ${crawlStats.clusterInherit} · 함께 거부 ${crawlStats.clusterInheritRejected} · ` +
    `외국어 건너뜀 ${crawlStats.clusterForeignSkip} / DeepSeek 판정 ${crawlStats.judgedForCluster} → 절감 ${clusterStats.savedPct}%`);
  console.log(`   ├ 📺 방송: 읽음 ${crawlStats.broadcastSeen} → 핵심어 ${crawlStats.broadcastKeywordPass} → DeepSeek 통과 ${crawlStats.broadcastAccepted} / 거부 ${crawlStats.broadcastRejected}`);
  const blSnap = getBlacklistSnapshot();
  console.log(`   ├ 도메인 블랙리스트: ${blSnap.size}개${blSnap.runtimeAdded.length ? ` (이번 자동추가 ${blSnap.runtimeAdded.length}: ${blSnap.runtimeAdded.join(',')})` : ''}`);
  console.log(`   ├ 핵심어 중복 스킵: ${crawlStats.dupSkipKeyword}건`);
  console.log(`   ├ 🔁 크로스매체 중복 스킵: ${crawlStats.crossMediaDupSkip}건`);
  console.log(`   ├ 🔁 같은 기사 스킵(정규화 URL · 같은 매체 24h): ${crawlStats.sameArticleSkip}건`);
  console.log(`   ├ 📅 날짜 파싱 실패(now 대체): ${crawlStats.dateParseFail}건`);
  console.log(`   └ 본문부실 스킵: ${crawlStats.thinBodySkip}건`);
  const extractRate = crawlStats.bodyExtractTried > 0
    ? ((crawlStats.bodyExtractOk / crawlStats.bodyExtractTried) * 100).toFixed(1)
    : '0.0';
  console.log(`   본문추출 성공: ${crawlStats.bodyExtractOk}/${crawlStats.bodyExtractTried} (${extractRate}%)`);
  if (crawlStats.failedFeeds.length) {
    console.log(`   실패 피드 ${crawlStats.failedFeeds.length}건 (스킵):`);
    for (const f of crawlStats.failedFeeds) console.log(`     - ${f}`);
    // v5.4.1 작업5: 상태코드별 분류(복구 판단용)
    const byStatus: Record<string, string[]> = {};
    for (const ff of crawlStats.feedFailures) {
      const key = ff.status ? String(ff.status) : 'DNS/기타';
      (byStatus[key] ||= []).push(`${ff.id}(${ff.sourceType})`);
    }
    console.log('   피드 실패 분류:');
    for (const [st, ids] of Object.entries(byStatus)) {
      const hint = st === '403' || st === '406' ? '헤더/UA 조정 재시도 대상'
        : st === '404' ? 'URL 확인/대체 필요' : st === '429' ? '레이트리밋(간격 조정)'
        : 'DNS/네트워크 — 대체 소스 필요';
      console.log(`     · ${st} (${ids.length}건): ${ids.join(', ')} → ${hint}`);
    }
    // 한국 소스가 지속 실패(406/403)하면 Discord 경고
    const krFails = crawlStats.feedFailures.filter((f) => f.sourceType === 'kr_press');
    if (krFails.length) {
      await notifyDiscord(
        `⚠️ ${PROFILE.messages.notify_prefix}: 한국 피드 실패 ${krFails.length}건 — ` +
        krFails.map((f) => `${f.id}[${f.status ?? '?'}]`).join(', ') +
        `\n(406/403은 브라우저 UA 재시도 후에도 실패한 것. 소스 URL 점검/대체 필요)`,
      );
    }
  }
  // v5.4.1 작업5: 한국 콘텐츠 비중 3일 연속 30% 미달 시 Discord 경고
  try {
    await ds.query(
      `CREATE TABLE IF NOT EXISTS crawl_daily (day date PRIMARY KEY, kr_ratio real, total int, created_at timestamp DEFAULT now())`,
    );
    await ds.query(
      `INSERT INTO crawl_daily(day, kr_ratio, total) VALUES (current_date, $1, $2)
       ON CONFLICT (day) DO UPDATE SET kr_ratio=$1, total=$2, created_at=now()`,
      [Number(krRatioPct.toFixed(1)), all.length],
    );
    const recent: any[] = await ds.query(`SELECT kr_ratio FROM crawl_daily ORDER BY day DESC LIMIT 3`);
    if (recent.length >= 3 && recent.every((r) => Number(r.kr_ratio) < 30)) {
      await notifyDiscord(`⚠️ ${PROFILE.messages.notify_prefix}: 한국 콘텐츠 비중 3일 연속 30% 미달 (${recent.map((r) => r.kr_ratio + '%').join(', ')}). 한국 피드 점검 필요.`);
    }
  } catch (e) {
    console.warn('[kr-ratio] 추적 실패(무시):', (e as Error).message);
  }
  // v5.2 #6: DeepSeek 실제 호출 집계(성공/실패 분리). 기존 apiCallCount는 미호출 dead-code였음.
  const costUsd = estimateCostUsd(deepseekStats.promptTokens, deepseekStats.completionTokens, priceOf(process.env));
  console.log(`   DeepSeek 호출: 총 ${deepseekStats.calls}회 (성공 ${deepseekStats.ok} / 실패 ${deepseekStats.fail}) · ` +
    `토큰 입력 ${deepseekStats.promptTokens} / 출력 ${deepseekStats.completionTokens} · 추정 $${costUsd.toFixed(4)}`);
  // DeepSeek 전멸 감지: 호출은 있었는데 성공 0 → 게이트가 전량 거부됨(원인 로그 위 [deepseek] 참고).
  if (deepseekStats.calls > 0 && deepseekStats.ok === 0) {
    console.warn(`   ⛔ 경고: DeepSeek 성공 0/${deepseekStats.calls} — 판정 전멸로 이번 크롤 저장이 막혔을 수 있음. `
      + `위 "[deepseek]" 로그의 status/code/빈응답 여부로 원인 확인(키·잔액·모델·한도).`);
  }
  console.log('\n   카테고리별:');
  for (const [cat, count] of Object.entries(categoryStats)) {
    console.log(`     - ${cat}: ${count}개`);
  }
  // NEWS-Q2 ■4·■8: 피드 건강 표 + crawl_runs 한 행
  const feedsTotal = crawlSources.length + loadBroadcastSourcesCount();
  const summary: CrawlRunSummary = {
    field: PROFILE.field,
    startedAt: new Date(startTime),
    finishedAt: new Date(),
    readOnly: false,
    sourcesTotal: feedsTotal,
    feedsOk: crawlStats.feedsOk,
    feedsFailed: crawlStats.failedFeeds.length,
    failedFeeds: crawlStats.failedFeeds.map((f) => f.slice(0, 200)),
    itemsSeen: crawlStats.itemsSeen + crawlStats.broadcastSeen,
    candidates: crawlStats.filterPass + crawlStats.broadcastKeywordPass,
    dupSkipped: crawlStats.dupPreSkip + result.dup,
    deepseekCalls: deepseekStats.calls,
    promptTokens: deepseekStats.promptTokens,
    completionTokens: deepseekStats.completionTokens,
    costUsd,
    saved: result.inserted - result.archived,
    archived: result.archived,
    rejected: rejectedAll.length,
    timedOut,
    perSource: RUN.perSource,
    urlBackfill,
    clusterStats,
    progress: RUN.progress,
  };
  for (const line of feedHealthLines(summary)) console.log(`   ${line}`);
  // NEWS-Q5 ■1: 실행 끝 경보(LLM 0) — per_source.__run.alerts 로 저장 + Discord 한 줄(웹훅 없으면 로그)
  if (RUN.progress) {
    RUN.progress.urlResolveFail = crawlStats.urlResolveFail;
    RUN.progress.spamToGate = crawlStats.spamToGate;
    try {
      const prev = RUN.flags.crawlRuns ? await recentCrawlRuns(q, 6) : [];
      const digest = digestPerSource(RUN.perSource).sources;
      const alerts = evaluateRunAlerts([
        {
          startedAt: summary.startedAt.toISOString(),
          durationSec: elapsed,
          timedOut,
          reachedOf: `${RUN.progress.reached}/${RUN.progress.total - RUN.progress.blockedSkipped.length}`,
          broadcastExpected: RUN.progress.broadcastFirst,
          broadcastChannelsRead: digest.broadcastChannelsRead,
          worldSaved: digest.worldSaved,
          urlResolveFail: crawlStats.urlResolveFail,
          deepseekCalls: deepseekStats.calls,
          saved: summary.saved,
        },
        ...prev.map(alertFactsOf),
      ]);
      RUN.progress.alerts = alerts;
      const line = alertLine(PROFILE.messages.notify_prefix, alerts);
      if (line) {
        console.warn(`   ${line}`);
        await notifyDiscord(line);
      } else {
        console.log('   경보 없음');
      }
    } catch (e) {
      console.warn('[alerts] 경보 계산 실패(무시):', (e as Error).message);
    }
  }
  if (RUN.progress) {
    const p = RUN.progress;
    console.log(
      `   순서·상한: 시작 ${p.startId ?? '-'} → 마지막 ${p.lastId ?? '-'} · 닿음 ${p.reached}/${p.total - p.blockedSkipped.length}` +
      ` · 소스 상한 걸림 ${p.timeouts.length} · 막힌 피드 건너뜀 ${p.blockedSkipped.length} · 방송 ${p.broadcastMs != null ? `${Math.round(p.broadcastMs / 1000)}초` : '안 돎'}` +
      `${p.timedOut ? ` · 전체 상한(${p.deadlineMin}분) 걸림(${p.stoppedAt})` : ''}`,
    );
  }
  if (RUN.flags.crawlRuns) {
    try {
      await recordCrawlRun(q, summary, { clusterStatsColumn: RUN.flags.clusterStats });
      console.log('   crawl_runs 한 행 기록');
    } catch (e) {
      console.warn('[crawl_runs] 기록 실패(무시):', (e as Error).message);
    }
  } else {
    console.log('   crawl_runs 표 없음 — 집계는 로그에만(묶음 SQL 2 적용 뒤부터 기록)');
  }
  console.log('========================================\n');

  await markRunToday();
  await ds.destroy();
}

// 종료 코드: 정상/타임아웃 조기종료 = 0(Render 성공), 치명적 오류 = 1(Render 실패)
main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('\n❌ CRITICAL ERROR:', e);
    try { if (ds.isInitialized) await ds.destroy(); } catch {}
    process.exit(1);
  });
