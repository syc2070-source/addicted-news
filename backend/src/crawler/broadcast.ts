// ============================================================
// broadcast.ts (NEWS-Q1 ■4) — 탐사·시사 방송의 분야 편 추적(채널·핵심어 = 분야 설정 sources.broadcast).
// YouTube 공개 채널 RSS(Atom, 열쇠 불필요) → 핵심어 관문(0원) → (크롤러에서) DeepSeek 관문 → 저장.
// 저장 구분은 기존 열 source_type='broadcast' 로 한다(kind 열은 묶음 SQL 적용 뒤 함께 기록).
//
// 읽기 전용 점검(DB·DeepSeek 접속 없음):
//   npx ts-node src/crawler/broadcast.ts          # 채널마다 최근 15개 → 핵심어 통과 표
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import Parser from 'rss-parser';
import { Judgment, passesIngestionGate, rejectReason } from './judge_article';
import { fieldProfile } from './field_profile';
import { originalAirDate, withAiredLine } from './broadcast_aired';

export const BROADCAST_SOURCE_TYPE = 'broadcast';

/** 핵심어(제목+설명에 하나 이상) — 분야 설정 sources.broadcast.keywords(NEWS-Q1 ■4ⓑ 목록 그대로 옮김). */
export function broadcastKeywords(): string[] {
  return fieldProfile().sources.broadcast.keywords;
}

/** YouTube RSS 재시도 횟수(NEWS-Q2 ■8: 6 → 10). */
export const BROADCAST_FETCH_ATTEMPTS = 10;

export interface BroadcastSource {
  outletId: string;
  program: string;
  channelTitle: string;
  channelId: string;
  feedUrl: string;
  sharedChannel: boolean;
  /** NEWS-Q12 ■4: 프로그램 영어 이름(없으면 null) */
  programEn: string | null;
  /** NEWS-Q13 ■2: 한 프로그램 전용 채널(설정 solo_channel · 공용 채널이면 늘 false) — 관련 클립 자동 묶기는 여기서만 */
  soloChannel: boolean;
  /** NEWS-Q16 ■3: 채널별 클립 길이 문턱(초 · 설정 clip_max_seconds · 없으면 분야 설정 sources.broadcast.clip_max_seconds) */
  clipMaxSec?: number | null;
}

export interface BroadcastItem {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string; // ISO 8601 (YouTube <published>)
  url: string;
  thumbnailUrl: string | null;
}

export function feedUrlFor(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export function loadBroadcastSources(
  file = path.join(__dirname, '../../data', fieldProfile().sources.broadcast.file || 'missing.json'),
  read: (f: string) => string = (f) => fs.readFileSync(f, 'utf8'),
): BroadcastSource[] {
  try {
    const raw = JSON.parse(read(file)) as { feeds?: Array<Record<string, unknown>> };
    return (raw.feeds || [])
      .filter((f) => /^UC[\w-]{22}$/.test(String(f.channel_id || '')))
      .map((f) => ({
        outletId: String(f.outlet_id),
        program: String(f.program),
        channelTitle: String(f.channel_title || f.program),
        channelId: String(f.channel_id),
        feedUrl: feedUrlFor(String(f.channel_id)),
        sharedChannel: f.shared_channel === true,
        programEn: typeof f.program_en === 'string' && f.program_en.trim() ? f.program_en.trim() : null,
        soloChannel: f.solo_channel === true && f.shared_channel !== true,
        clipMaxSec: Number.isInteger(f.clip_max_seconds) && Number(f.clip_max_seconds) > 0 ? Number(f.clip_max_seconds) : null,
      }));
  } catch (e) {
    console.warn(`[broadcast] 소스 파일을 읽지 못함(방송 추적 건너뜀): ${(e as Error).message}`);
    return [];
  }
}

/** NEWS-Q16 ■3: 이 채널의 길이 규칙(채널 clip_max_seconds 가 있으면 그것 · 없으면 분야 설정 그대로). */
export function channelLengthRule<R extends { clipMaxSec?: number }>(rule: R, source: Pick<BroadcastSource, 'clipMaxSec'>): R {
  return source.clipMaxSec ? { ...rule, clipMaxSec: source.clipMaxSec } : rule;
}

/** NEWS-Q12 ■4: 프로그램 이름(articles.source) → 영어 이름(내보내기 sourceEn). */
export function broadcastEnglishNames(sources: BroadcastSource[] = loadBroadcastSources()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sources) if (s.programEn) out[s.program] = s.programEn;
  return out;
}

/** 핵심어를 품었지만 뜻이 다른 낱말(분야 설정 sources.broadcast.false_friends). */
export function matchedBroadcastKeywords(title: string, description: string): string[] {
  let text = `${title}\n${description}`;
  for (const word of fieldProfile().sources.broadcast.false_friends) text = text.split(word).join(' ');
  return broadcastKeywords().filter((k) => text.includes(k));
}

/** NEWS-Q2 ■8: 지난 실행에서 실패한 채널을 맨 앞으로(순서는 그 밖 그대로). */
export function orderFailedFirst<T extends { outletId: string }>(sources: T[], failedOutletIds: string[]): T[] {
  const failed = new Set(failedOutletIds);
  return [...sources.filter((s) => failed.has(s.outletId)), ...sources.filter((s) => !failed.has(s.outletId))];
}

export function passesBroadcastKeywordGate(item: Pick<BroadcastItem, 'title' | 'description'>): boolean {
  return matchedBroadcastKeywords(item.title, item.description).length > 0;
}

function firstText(value: unknown): string {
  if (Array.isArray(value)) return firstText(value[0]);
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v._ === 'string') return v._;
    return '';
  }
  return typeof value === 'string' ? value : '';
}

function thumbnailOf(group: Record<string, unknown> | undefined, videoId: string): string | null {
  const thumb = group?.['media:thumbnail'];
  const node = Array.isArray(thumb) ? thumb[0] : thumb;
  const url = (node as { $?: { url?: string } } | undefined)?.$?.url;
  if (url) return url;
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

const atomParser = new Parser<Record<string, unknown>, Record<string, unknown>>({
  customFields: { item: ['media:group', 'yt:videoId'] as string[] },
});

/** rss-parser 결과(YouTube Atom) → BroadcastItem[]. 영상 ID 가 없는 항목은 버린다. */
export function toBroadcastItems(feed: { items?: Array<Record<string, unknown>> }, limit = 15): BroadcastItem[] {
  const out: BroadcastItem[] = [];
  for (const it of (feed.items || []).slice(0, limit)) {
    const idField = String(it['yt:videoId'] || it.id || '');
    const videoId = idField.replace(/^yt:video:/, '').trim();
    if (!/^[\w-]{11}$/.test(videoId)) continue;
    const group = it['media:group'] as Record<string, unknown> | undefined;
    const description = firstText(group?.['media:description']).trim();
    out.push({
      videoId,
      title: String(it.title || '').trim(),
      description,
      publishedAt: String(it.isoDate || it.pubDate || ''),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: thumbnailOf(group, videoId),
    });
  }
  return out;
}

export async function parseBroadcastXml(xml: string, limit = 15): Promise<BroadcastItem[]> {
  return toBroadcastItems(await atomParser.parseString(xml), limit);
}

/**
 * YouTube 채널 RSS 는 같은 주소에 404/500 을 섞어 낸다(곧 다시 200, 2026-10-10 실측)
 * → 짧은 간격으로 여러 번 다시 묻는다.
 */
export async function fetchBroadcastItems(
  source: BroadcastSource,
  limit = 15,
  attempts = BROADCAST_FETCH_ATTEMPTS,
  waitMs = (n: number) => 1000 * n,
): Promise<BroadcastItem[]> {
  let lastError: unknown;
  for (let n = 1; n <= attempts; n++) {
    try {
      const res = await axios.get<string>(source.feedUrl, {
        timeout: Number(process.env.RSS_TIMEOUT_MS ?? 15000),
        responseType: 'text',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AddictedNewsBot/1.0)' },
      });
      return await parseBroadcastXml(res.data, limit);
    } catch (e) {
      lastError = e;
      if (n < attempts) await new Promise((r) => setTimeout(r, waitMs(n)));
    }
  }
  throw lastError;
}

/** KST 기준 YYYY-MM-DD (articles.published_at 기존 규약: 날짜만). */
export function kstYmd(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 설명 요지: 해시태그·링크 줄을 뺀 앞부분. */
export function descriptionGist(description: string, max = 300): string {
  const lines = description
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(#\S+\s*)+$/.test(l) && !/^https?:\/\//.test(l));
  const text = lines.join(' ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** raw_body 에 남길 원자료(정확한 게시 시각 포함). */
export function broadcastRawBody(source: BroadcastSource, item: BroadcastItem): string {
  return [
    `프로그램: ${source.program}`,
    `채널: ${source.channelTitle} (${source.channelId})`,
    `게시 시각: ${item.publishedAt}`,
    `영상: ${item.url}`,
    '',
    item.description,
  ].join('\n').slice(0, 6000);
}

export type BroadcastDecision =
  | { action: 'skip'; reason: 'keyword_miss' | 'no_deepseek' }
  | { action: 'reject'; reason: string }
  | { action: 'accept' };

/**
 * 관문 순서: 핵심어(0원) → DeepSeek 판정(passesIngestionGate 와 같은 기준).
 * DeepSeek 가 없거나 판정이 없으면 저장하지 않는다(fail-closed).
 * 키워드 사건사고 거름망은 쓰지 않는다 — 탐사 방송은 사건을 다루는 것이 본업이라
 * 기사용 거름망이 분야 편까지 막는다. 사건 보도 판정은 DeepSeek 의 is_incident 로만.
 */
export function decideBroadcast(
  item: Pick<BroadcastItem, 'title' | 'description'>,
  judgment: Judgment | null,
  aiAvailable: boolean,
): BroadcastDecision {
  if (!passesBroadcastKeywordGate(item)) return { action: 'skip', reason: 'keyword_miss' };
  if (!aiAvailable) return { action: 'skip', reason: 'no_deepseek' };
  const j = judgment ?? {};
  if (passesIngestionGate(j, false)) return { action: 'accept' };
  return { action: 'reject', reason: rejectReason(j, false) || 'rejected' };
}

/**
 * 저장 행(articles). 종류 구분 = source_type 'broadcast' (kind 열은 있으면 크롤러가 따로 맞춤).
 * NEWS-Q16 ■1: 재업로드(원 방송일이 게시일보다 aired_date_min_days 넘게 앞섬)는 published_at = 원 방송일 · published_ts 비움 ·
 * raw_body 머리에 「원 방송일:」 줄.
 */
export function buildBroadcastRow(
  source: BroadcastSource,
  item: BroadcastItem,
  ai: { summary?: string | null; category: string },
) {
  const gist = descriptionGist(item.description);
  const summary = (ai.summary && ai.summary.trim()) || gist || item.title;
  const aired = originalAirDate(item.title, item.description, item.publishedAt, fieldProfile().sources.broadcast.aired_date_min_days);
  const reupload = aired?.reupload ? aired : null;
  const rawBody = broadcastRawBody(source, item);
  return {
    title: item.title,
    originalTitle: item.title,
    teaser: gist ? gist.slice(0, 220) : null,
    summary,
    rawBody: reupload ? withAiredLine(rawBody, reupload).slice(0, 6000) : rawBody,
    keywords: matchedBroadcastKeywords(item.title, item.description),
    category: ai.category,
    region: 'kr',
    source: source.program,
    sourceUrl: item.url,
    googleUrl: null,
    imageUrl: item.thumbnailUrl,
    origin: 'crawler',
    isTop: false,
    isFeature: false,
    publishedAt: reupload?.aired || kstYmd(item.publishedAt) || kstYmd(new Date().toISOString())!,
    lang: 'ko' as const,
    isForeign: false,
    blocked: false,
    blockedReason: null,
    sourceType: BROADCAST_SOURCE_TYPE,
    outletId: source.outletId,
    // NEWS-Q2 ■7: 게시 시각(published_ts 열이 있으면 기록) · ■5 출처 등급
    publishedTs: reupload || Number.isNaN(Date.parse(item.publishedAt)) ? null : new Date(item.publishedAt),
    /** NEWS-Q16 ■1: 재업로드면 원 방송일(세기 · 기록용 · 저장 칸 아님) */
    airedReupload: reupload?.aired ?? null,
    sourceGrade: 'press' as const,
  };
}

async function readOnlyReport() {
  const sources = loadBroadcastSources();
  console.log(`=== 방송 추적 읽기 전용 점검 (${sources.length}채널 · 채널마다 최근 15개 · 핵심어 관문만, DB·DeepSeek 없음) ===`);
  let total = 0, passed = 0;
  for (const s of sources) {
    try {
      const items = await fetchBroadcastItems(s, 15);
      const ok = items.filter(passesBroadcastKeywordGate);
      total += items.length; passed += ok.length;
      console.log(`\n[${s.program}] ${s.channelId} · 읽음 ${items.length} · 통과 ${ok.length}`);
      for (const it of ok) {
        const kw = matchedBroadcastKeywords(it.title, it.description).join(',');
        console.log(`  ✓ ${kstYmd(it.publishedAt)} ${it.title}  [${kw}]`);
      }
    } catch (e) {
      console.log(`\n[${s.program}] ${s.channelId} · ❌ ${(e as Error).message}`);
    }
  }
  console.log(`\n=== 합계: 읽음 ${total} · 핵심어 통과 ${passed} ===`);
}

if (require.main === module) {
  readOnlyReport().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
