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

// ---------- NEWS-Q11 ■2: 업로드 재생목록 되짚기(playlistItems.list · 쪽당 1단위 · 전체 설명 포함) ----------
// search.list(100단위 · 50편 · 바쁜 채널은 5일치)를 대신한다. 채널 업로드 재생목록 = UC… → UU…(같은 꼬리).
// 3쪽(150편)이면 하루 8~10편 채널도 2주 넘게 · PD수첩 같은 주 1~2편 채널은 넉 달 넘게 거슬러 본다. 9채널 ≈ 27단위/일.
export const PLAYLIST_UNITS = 1;
export const UPLOAD_PAGES_DEFAULT = 3;
export const UPLOAD_PAGE_SIZE = 50;

/** 채널 id → 업로드 재생목록 id(UC… → UU…). 꼴이 아니면 null. */
export function uploadsPlaylistId(channelId: string): string | null {
  return /^UC[\w-]{22}$/.test(channelId) ? `UU${channelId.slice(2)}` : null;
}

const HIDDEN_TITLES = /^(private video|deleted video|비공개 동영상|삭제된 동영상)$/i;

/** playlistItems.list 응답 → BroadcastItem[](비공개·삭제 영상 버림 · 설명은 전체) + 다음 쪽 열쇠. */
export function parsePlaylistItems(json: any): { items: BroadcastItem[]; next: string | null } {
  const items: BroadcastItem[] = [];
  for (const it of Array.isArray(json?.items) ? json.items : []) {
    const sn = it?.snippet || {};
    const videoId = String(sn.resourceId?.videoId || it?.contentDetails?.videoId || '');
    const title = decodeHtml(String(sn.title || '')).trim();
    if (!/^[\w-]{11}$/.test(videoId) || !title || HIDDEN_TITLES.test(title)) continue;
    const th = sn.thumbnails || {};
    items.push({
      videoId,
      title,
      description: decodeHtml(String(sn.description || '')).trim(),
      publishedAt: String(it?.contentDetails?.videoPublishedAt || sn.publishedAt || ''),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: th.high?.url || th.medium?.url || th.default?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  }
  const next = typeof json?.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : null;
  return { items, next };
}

// NEWS-Q12 ■2: 바쁜 채널은 기본 쪽 수 뒤에도 cover_days(100일)를 덮을 때까지 더 읽는다(상한 6쪽 · 더 읽는 쪽은 하루 unit_cap_day 안에서만).
export const UPLOAD_PAGES_MAX = 6;

export interface UploadPagesPlan {
  /** 기본 쪽 수(늘 읽음) */
  pages?: number;
  /** 덮을 날 수 — 가장 오래된 영상이 이보다 새로우면 maxPages 까지 더 읽음(0/없음 = 기본 쪽 수만) */
  coverDays?: number;
  maxPages?: number;
  /** 더 읽는 쪽은 오늘 쓴 단위(guard.used)가 이 값 안일 때만 */
  unitCapDay?: number;
  now?: number;
  /**
   * NEWS-Q13 ■3 「이어짐」: 이 채널을 지난번 잘 되짚은 실행 시각(ms · 여유 하루 뺀 값). 있으면 coverDays 대신
   * 이보다 오래된 영상에 닿을 때 멈춘다(적어도 1쪽 · 최대 maxPages · 기본 쪽 수 뒤는 unitCapDay 안). 못 닿으면 gap.
   */
  since?: number;
}

/** 읽은 영상 가운데 가장 오래된 게시 시각(ms · 없으면 null). */
function oldestOf(items: BroadcastItem[]): number | null {
  let oldest = Infinity;
  for (const it of items) {
    const t = Date.parse(it.publishedAt);
    if (Number.isFinite(t) && t < oldest) oldest = t;
  }
  return Number.isFinite(oldest) ? oldest : null;
}

/** 읽은 영상 가운데 가장 오래된 것이 몇 날 전인지(게시 시각 없으면 null). */
export function coveredDaysOf(items: BroadcastItem[], now: number): number | null {
  const oldest = oldestOf(items);
  return oldest === null ? null : Math.floor((now - oldest) / 86400000);
}

/**
 * 채널 하나 되짚기: 업로드 재생목록 pages 쪽(쪽마다 1단위 · 할당량 가드가 막으면 멈춤) · coverDays 를 못 덮으면 maxPages 까지.
 * NEWS-Q13 ■3: since 가 있으면 「이어짐」 — since 보다 오래된 영상에 닿으면 멈춤 · 못 닿고 끝나면 gap(이어지지 못한 날 수).
 */
export async function lookbackUploads(
  channelId: string,
  key: string,
  guard: QuotaGuard,
  opts: UploadPagesPlan & { get?: HttpGet } = {},
): Promise<LookbackResult & { pages: number; coveredDays: number | null; gap?: number | null }> {
  const get = opts.get ?? defaultGet;
  const now = opts.now ?? Date.now();
  const playlistId = uploadsPlaylistId(channelId);
  if (!playlistId) return { items: [], units: 0, pages: 0, coveredDays: null, error: { status: null, reason: 'bad_channel_id' } };
  const headers = { 'x-goog-api-key': key, accept: 'application/json' };
  const clamp = (n: number) => Math.max(1, Math.min(UPLOAD_PAGES_MAX, Math.floor(n)));
  const pages = clamp(opts.pages ?? UPLOAD_PAGES_DEFAULT);
  const since = opts.since !== undefined && Number.isFinite(opts.since) ? opts.since : undefined;
  const maxPages = since !== undefined || opts.coverDays ? Math.max(pages, clamp(opts.maxPages ?? UPLOAD_PAGES_MAX)) : pages;
  const items: BroadcastItem[] = [];
  let units = 0;
  let pagesOk = 0;
  let pageToken: string | null = null;
  let exhausted = false;
  const reachedSince = () => {
    const oldest = oldestOf(items);
    return since !== undefined && oldest !== null && oldest <= since;
  };
  const gapOf = (): number | null | undefined => {
    if (since === undefined) return undefined;
    if (exhausted || reachedSince()) return 0;
    const oldest = oldestOf(items);
    return oldest === null ? null : Math.ceil((oldest - since) / 86400000);
  };
  const done = (error?: LookbackResult['error']) => {
    const gap = gapOf();
    return {
      items, units, pages: pagesOk, coveredDays: coveredDaysOf(items, now),
      ...(gap !== undefined ? { gap } : {}), ...(error ? { error } : {}),
    };
  };
  for (let p = 0; p < maxPages; p++) {
    if (since !== undefined) {
      // 이어짐: 지난번 본 데까지 닿았으면 멈춤 · 기본 쪽 수 뒤는 하루 상한 안에서만
      if (p > 0 && reachedSince()) break;
      if (p >= pages && opts.unitCapDay !== undefined && guard.used + PLAYLIST_UNITS > opts.unitCapDay) break;
    } else if (p >= pages) {
      // 기본 쪽 수 뒤: 이미 덮었거나 하루 상한이면 멈춤
      const covered = coveredDaysOf(items, now);
      if (covered !== null && covered >= (opts.coverDays ?? 0)) break;
      if (opts.unitCapDay !== undefined && guard.used + PLAYLIST_UNITS > opts.unitCapDay) break;
    }
    if (!guard.spend(PLAYLIST_UNITS)) {
      return done(units ? undefined : { status: null, reason: 'quota_guard' });
    }
    units += PLAYLIST_UNITS;
    try {
      const params: Record<string, string | number> = {
        part: 'snippet,contentDetails', playlistId, maxResults: UPLOAD_PAGE_SIZE,
      };
      if (pageToken) params.pageToken = pageToken;
      const page = parsePlaylistItems(await get(`${API}/playlistItems`, params, headers));
      items.push(...page.items);
      pagesOk++;
      pageToken = page.next;
      if (!pageToken) {
        exhausted = true;
        break;
      }
    } catch (e) {
      const err = apiErrorOf(e);
      if (err.reason === 'quotaExceeded' || err.reason === 'dailyLimitExceeded') guard.stopped = true;
      return done(err);
    }
  }
  return done();
}

// ---------- NEWS-Q13 ■3: 「이어짐」 기준 · 100일 한 번 메우기(search.list) ----------
/** 여유 7일: 업로드 재생목록은 올린 차례 · 게시 시각은 videoPublishedAt(예약·프리미어는 며칠 늦게 공개) */
export const CONTINUITY_MARGIN_DAYS = 7;

/**
 * 채널마다 지난번 잘 되짚은 실행 시각(ms) — 최근 실행(읽기 전용 제외)의 broadcastApi.cover 에 그 채널이 있고
 * judged(그 채널 영상을 끊김 없이 다 판정) ∧ gap 0/없음 ∧ errors 에 없으면. judged 칸이 없는 옛 기록은 세지 않는다.
 * 없거나 실패면 {}(그 채널은 옛 coverDays 규칙 — 다 읽고 다시 판정).
 */
export async function lastLookbackFromRuns(query: QueryFn, field: string): Promise<Record<string, number>> {
  try {
    const rows = await query(
      `SELECT started_at, per_source->'__run'->'broadcastApi' AS api FROM crawl_runs
        WHERE field = $1 AND read_only = false ORDER BY started_at DESC LIMIT 14`,
      [field],
    );
    const out: Record<string, number> = {};
    for (const r of rows || []) {
      const a = typeof r.api === 'string' ? JSON.parse(r.api) : r.api;
      const at = Date.parse(r.started_at instanceof Date ? r.started_at.toISOString() : String(r.started_at));
      if (!a || !a.cover || !Number.isFinite(at)) continue;
      const failed = new Set((Array.isArray(a.errors) ? a.errors : []).map((e: unknown) => String(e).split(':')[0]));
      for (const [ch, c] of Object.entries(a.cover as Record<string, { pages?: number; judged?: boolean; gap?: number | null }>)) {
        if (out[ch] !== undefined || failed.has(ch) || !(Number(c?.pages) > 0)) continue;
        // 판정이 끊겼거나 이어지지 못한(gap) 실행은 「잘 되짚음」이 아니다 → 더 앞 실행에서 이어 읽음(빈 데가 날마다 보임)
        if (c?.judged !== true || Number(c?.gap) > 0) continue;
        out[ch] = at;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 메우기를 이 만큼 해 보고도 덜 되면 그만둔다(날마다 808단위를 태우지 않게 · runs 에 giveUp). */
export const BACKFILL_MAX_TRIES = 3;

export interface BackfillState {
  /** 앞 실행이 done 을 남겼거나 BACKFILL_MAX_TRIES 번 해 봤음 → 이번엔 안 돎 */
  done: boolean;
  tries: number;
  /** 앞 실행에서 오류·끊김 없이 끝난 채널(다시 검색하지 않음) */
  finished: string[];
}

/**
 * 설정 깃발 backfill_search_once 의 id 에 대한 앞 실행 기록(per_source.__run.broadcastBackfill).
 * 실패면 done(안전: 다시 돌지 않음 · 단위 0).
 */
export async function backfillStateFromRuns(query: QueryFn, field: string, id: string): Promise<BackfillState> {
  try {
    const rows = await query(
      `SELECT per_source->'__run'->'broadcastBackfill' AS b FROM crawl_runs
        WHERE field = $1 AND per_source->'__run'->'broadcastBackfill'->>'id' = $2`,
      [field, id],
    );
    const finished = new Set<string>();
    let done = false;
    let tries = 0;
    for (const r of rows || []) {
      const b = typeof r.b === 'string' ? JSON.parse(r.b) : r.b;
      if (!b) continue;
      if (b.done === true) done = true;
      const chans = Object.entries((b.channels || {}) as Record<string, { error?: string }>);
      // 검색을 하나라도 한 실행만 「해 봄」(같은 날 둘째 실행 · 할당량 · 시간으로 채널에 못 닿은 실행은 세지 않음)
      if (chans.length) tries++;
      for (const [ch, rec] of chans) {
        if (rec && !rec.error) finished.add(ch);
      }
    }
    return { done: done || tries >= BACKFILL_MAX_TRIES, tries, finished: [...finished] };
  } catch {
    return { done: true, tries: 0, finished: [] };
  }
}

export interface BackfillChannelRecord {
  pages: number;
  items: number;
  units: number;
  error?: string;
}

export interface BackfillRecord {
  id: string;
  done: boolean;
  /** 몇 번째 해 봄(1부터) · 앞 실행에서 이미 끝난 채널(이번엔 검색 0) */
  try: number;
  carried: string[];
  query: string;
  publishedAfter: string;
  unitCap: number;
  channels: Record<string, BackfillChannelRecord>;
}

/**
 * 채널 하나 100일 메우기: search.list(channelId · q · publishedAfter · order=date · 쪽당 100단위 · 최대 maxPages)
 * + 쪽마다 videos.list(1단위 · 전체 설명). 한 쪽 부르기 전에 하루 unitCap(이날만 상한) · 하루 가드 둘 다 본다.
 */
export async function backfillSearch(
  channelId: string,
  key: string,
  guard: QuotaGuard,
  opts: { query: string; days: number; maxPages: number; unitCap: number; now?: number; get?: HttpGet },
): Promise<{ items: BroadcastItem[]; units: number; pages: number; error?: { status: number | null; reason: string } }> {
  const get = opts.get ?? defaultGet;
  const headers = { 'x-goog-api-key': key, accept: 'application/json' };
  const publishedAfter = new Date((opts.now ?? Date.now()) - opts.days * 86400000).toISOString();
  const items: BroadcastItem[] = [];
  let units = 0;
  let pages = 0;
  let pageToken: string | null = null;
  for (let p = 0; p < Math.max(0, Math.floor(opts.maxPages)); p++) {
    if (guard.used + SEARCH_UNITS + VIDEOS_UNITS > opts.unitCap || !guard.spend(SEARCH_UNITS)) {
      // 첫 쪽부터 막힘 = quota_guard · 둘째 쪽에서 막힘 = unit_cap(덜 메움 → 그 채널은 다음 실행이 다시)
      return { items, units, pages, error: { status: null, reason: pages ? 'unit_cap' : 'quota_guard' } };
    }
    units += SEARCH_UNITS;
    let found: BroadcastItem[];
    try {
      const params: Record<string, string | number> = {
        part: 'snippet', channelId, q: opts.query, order: 'date', type: 'video', publishedAfter, maxResults: SEARCH_MAX_RESULTS,
      };
      if (pageToken) params.pageToken = pageToken;
      const json = await get(`${API}/search`, params, headers);
      found = parseSearchResponse(json);
      pageToken = typeof json?.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : null;
    } catch (e) {
      const err = apiErrorOf(e);
      if (err.reason === 'quotaExceeded' || err.reason === 'dailyLimitExceeded') guard.stopped = true;
      return { items, units, pages, error: err };
    }
    pages++;
    if (found.length && guard.spend(VIDEOS_UNITS)) {
      units += VIDEOS_UNITS;
      try {
        const full = parseVideosResponse(
          await get(`${API}/videos`, { part: 'snippet', id: found.map((it) => it.videoId).join(','), maxResults: 50 }, headers),
        );
        for (const it of found) {
          const d = full.get(it.videoId);
          if (d) it.description = d;
        }
      } catch {
        /* 짧은 설명으로 계속 */
      }
    }
    items.push(...found);
    if (!pageToken) break;
  }
  return { items, units, pages };
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
  /** NEWS-Q12 ■2: 채널별 읽은 쪽 수 · 덮은 날 수(가장 오래된 영상) */
  /** NEWS-Q13 ■3: gap = 이어지지 못한 날 수 · judged = 이 채널 영상을 끊김 없이 다 판정(이어짐 기준이 되는 조건) */
  cover?: Record<string, { pages: number; days: number | null; gap?: number | null; judged?: boolean }>;
}

export function emptyApiRecord(mode: 'on' | 'off', unitsBefore = 0): BroadcastApiRecord {
  return {
    mode, calls: 0, units: 0, unitsToday: unitsBefore, items: 0, newItems: 0, keywordPass: 0,
    channels: [], apiOnly: [], quotaStopped: false, errors: [],
  };
}
