// ============================================================
// youtube_api.ts (NEWS-Q6 ■4) — 방송 되짚기: YouTube Data API v3 search.list(LLM 0).
//  · env YOUTUBE_API_KEY 가 있을 때만(값은 로그·URL 에 남기지 않음 — 머리글 x-goog-api-key 로만 보냄).
//  · 채널마다 하루 1회: search.list(channelId · order=date · type=video · publishedAfter 30일 · maxResults 50) = 100 단위
//    + 핵심어를 통과한 영상만 videos.list(전체 설명) = 1 단위. 9채널 ≈ 909 단위/일.
//  · 할당량 가드: 하루(KST) 2,000 단위 넘을 것 같으면 멈추고 기록(quotaStopped).
//  · RSS 길: 열쇠가 없으면 RSS 그대로 · 열쇠가 있고 지난 실행에서 그 채널 RSS 가 404 였으면 RSS 건너뛰고 API 만.
//  · 핵심어 관문 → DeepSeek 관문은 기존 그대로(크롤러 crawlBroadcastSources).
// ============================================================
import axios from 'axios';
import type { BroadcastItem } from './broadcast';

export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

export const YOUTUBE_API_ENV = 'YOUTUBE_API_KEY';
export const SEARCH_UNITS = 100;
export const VIDEOS_UNITS = 1;
export const DAILY_UNIT_CAP = 2000;
export const LOOKBACK_DAYS = 30;
export const SEARCH_MAX_RESULTS = 50;
const API = 'https://www.googleapis.com/youtube/v3';

/** 열쇠(없으면 null). 값은 돌려주기만 하고 어디에도 찍지 않는다. */
export function youtubeApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const k = (env[YOUTUBE_API_ENV] || '').trim();
  return k ? k : null;
}

/** health 용: 열쇠가 있나만(on|off). */
export function youtubeApiMode(env: NodeJS.ProcessEnv = process.env): 'on' | 'off' {
  return youtubeApiKey(env) ? 'on' : 'off';
}

export interface ChannelPlan {
  rss: boolean;
  api: boolean;
  /** rss_only(열쇠 없음) · rss+api · api_only(지난 실행 RSS 404) · rss_only(오늘 이미 되짚음 / 할당량) */
  reason: 'no_key' | 'rss+api' | 'api_only_rss404' | 'searched_today' | 'quota';
}

/** 채널 하나를 오늘 어떻게 읽을지. */
export function planChannel(o: { hasKey: boolean; rss404LastRun: boolean; searchedToday: boolean; quotaLeft: boolean }): ChannelPlan {
  if (!o.hasKey) return { rss: true, api: false, reason: 'no_key' };
  if (o.searchedToday) return { rss: true, api: false, reason: 'searched_today' };
  if (!o.quotaLeft) return { rss: true, api: false, reason: 'quota' };
  if (o.rss404LastRun) return { rss: false, api: true, reason: 'api_only_rss404' };
  return { rss: true, api: true, reason: 'rss+api' };
}

/** 하루 할당량 가드(오늘 앞 실행이 쓴 단위 + 이번 실행). */
export class QuotaGuard {
  used: number;
  stopped = false;
  constructor(readonly cap = DAILY_UNIT_CAP, usedBefore = 0) {
    this.used = usedBefore;
  }
  canSpend(units: number): boolean {
    return this.used + units <= this.cap;
  }
  /** 쓸 수 있으면 더하고 true · 아니면 멈춤 표시하고 false */
  spend(units: number): boolean {
    if (!this.canSpend(units)) { this.stopped = true; return false; }
    this.used += units;
    return true;
  }
}

export interface ApiTodayState {
  /** 오늘(KST) 앞 실행들이 쓴 단위 */
  units: number;
  /** 오늘 이미 되짚은 채널(outlet_id) */
  channels: string[];
}

/** 오늘(KST) 앞 실행들의 되짚기 기록(crawl_runs.per_source.__run.broadcastApi). 없거나 실패면 0. */
export async function apiTodayFromRuns(query: QueryFn, field: string): Promise<ApiTodayState> {
  try {
    const rows = await query(
      `SELECT per_source->'__run'->'broadcastApi' AS api FROM crawl_runs
        WHERE field = $1 AND (started_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date`,
      [field],
    );
    let units = 0;
    const channels = new Set<string>();
    for (const r of rows) {
      const a = typeof r.api === 'string' ? JSON.parse(r.api) : r.api;
      if (!a) continue;
      units += Number(a.units) || 0;
      for (const c of Array.isArray(a.channels) ? a.channels : []) channels.add(String(c));
    }
    return { units, channels: [...channels] };
  } catch {
    return { units: 0, channels: [] };
  }
}

/** 지난 실행에서 RSS 가 404 로 실패한 방송 채널(failed_feeds 의 "broadcast:<id> [404]"). */
export function rss404Outlets(failedFeeds: string[]): string[] {
  return failedFeeds
    .filter((s) => s.startsWith('broadcast:') && /\[404\]/.test(s))
    .map((s) => s.slice('broadcast:'.length).split(' ')[0]);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#34': '"' };
function decodeHtml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#39|#34);/g, (_m, k) => ENTITIES[k] ?? _m);
}

/** search.list 응답 → BroadcastItem[](영상만 · 설명은 짧은 snippet). */
export function parseSearchResponse(json: any): BroadcastItem[] {
  const out: BroadcastItem[] = [];
  for (const it of Array.isArray(json?.items) ? json.items : []) {
    const videoId = String(it?.id?.videoId || '');
    if (!/^[\w-]{11}$/.test(videoId)) continue;
    const sn = it.snippet || {};
    const th = sn.thumbnails || {};
    out.push({
      videoId,
      title: decodeHtml(String(sn.title || '')).trim(),
      description: decodeHtml(String(sn.description || '')).trim(),
      publishedAt: String(sn.publishedAt || ''),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: th.high?.url || th.medium?.url || th.default?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  }
  return out;
}

/** videos.list 응답 → videoId → 전체 설명. */
export function parseVideosResponse(json: any): Map<string, string> {
  const out = new Map<string, string>();
  for (const it of Array.isArray(json?.items) ? json.items : []) {
    if (it?.id && typeof it?.snippet?.description === 'string') out.set(String(it.id), it.snippet.description);
  }
  return out;
}

export type HttpGet = (url: string, params: Record<string, string | number>, headers: Record<string, string>) => Promise<any>;

const defaultGet: HttpGet = async (url, params, headers) => {
  const res = await axios.get(url, { params, headers, timeout: 20_000 });
  return res.data;
};

/** 오류에서 상태·이유만(열쇠·URL 은 담지 않는다). */
export function apiErrorOf(e: unknown): { status: number | null; reason: string } {
  const r = (e as { response?: { status?: number; data?: any } })?.response;
  const reason = String(r?.data?.error?.errors?.[0]?.reason || r?.data?.error?.status || (r ? 'http_error' : 'network'));
  return { status: typeof r?.status === 'number' ? r.status : null, reason };
}

export interface LookbackResult {
  items: BroadcastItem[];
  units: number;
  error?: { status: number | null; reason: string };
}

/**
 * 채널 하나 되짚기: search.list(100) → (needFull 이 고른 영상만) videos.list(1) 로 설명 채우기.
 * 할당량 가드가 막으면 부르지 않는다.
 */
export async function lookbackChannel(
  channelId: string,
  key: string,
  guard: QuotaGuard,
  opts: { now?: number; get?: HttpGet; needFull?: (it: BroadcastItem) => boolean } = {},
): Promise<LookbackResult> {
  const get = opts.get ?? defaultGet;
  const headers = { 'x-goog-api-key': key, accept: 'application/json' };
  const publishedAfter = new Date((opts.now ?? Date.now()) - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  if (!guard.spend(SEARCH_UNITS)) return { items: [], units: 0, error: { status: null, reason: 'quota_guard' } };
  let units = SEARCH_UNITS;
  let items: BroadcastItem[];
  try {
    const json = await get(`${API}/search`, {
      part: 'snippet', channelId, order: 'date', type: 'video', publishedAfter, maxResults: SEARCH_MAX_RESULTS,
    }, headers);
    items = parseSearchResponse(json);
  } catch (e) {
    const err = apiErrorOf(e);
    if (err.reason === 'quotaExceeded' || err.reason === 'dailyLimitExceeded') guard.stopped = true;
    return { items: [], units, error: err };
  }
  const want = items.filter(opts.needFull ?? (() => true)).map((it) => it.videoId);
  if (want.length && guard.spend(VIDEOS_UNITS)) {
    units += VIDEOS_UNITS;
    try {
      const full = parseVideosResponse(await get(`${API}/videos`, { part: 'snippet', id: want.join(','), maxResults: 50 }, headers));
      for (const it of items) {
        const d = full.get(it.videoId);
        if (d) it.description = d;
      }
    } catch {
      /* 짧은 설명으로 계속 */
    }
  }
  return { items, units };
}

/** 이번 실행 되짚기 기록(per_source.__run.broadcastApi · health). */
export interface BroadcastApiRecord {
  mode: 'on' | 'off';
  calls: number;
  units: number;
  /** 오늘 앞 실행 포함 하루 사용 */
  unitsToday: number;
  /** 되짚기로 읽은 영상 · 그중 RSS 에 없던 것 · 핵심어 통과 */
  items: number;
  newItems: number;
  keywordPass: number;
  /** 되짚은 채널(outlet_id) */
  channels: string[];
  /** RSS 404 로 API 만 쓴 채널 */
  apiOnly: string[];
  quotaStopped: boolean;
  errors: string[];
}

export function emptyApiRecord(mode: 'on' | 'off', unitsBefore = 0): BroadcastApiRecord {
  return {
    mode, calls: 0, units: 0, unitsToday: unitsBefore, items: 0, newItems: 0, keywordPass: 0,
    channels: [], apiOnly: [], quotaStopped: false, errors: [],
  };
}
