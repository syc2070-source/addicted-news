// ============================================================
// crawl_schedule.ts (NEWS-Q4 ■1·■2) — 수집 순서·시간 상한(LLM 0 · DB 쓰기 0 · 순수 함수 + 읽기 하나).
//  · 소스 읽기(피드 가져오기·해석·원문 추출) = 동시 4 · 소스별 상한 60초 · 구글뉴스 검색 피드 120초(NEWS-Q6 ■3)
//    (넘으면 그때까지 읽은 것만 · 같은 실행 재시도 0).
//    판정(DeepSeek)·저장은 소스 순서대로 하나씩(하루 상한 400 · 중복 검사 순서 보존) — runSources 의 consume.
//  · 시작점 순환: 지난 실행이 마지막으로 마친 소스 다음부터 한 바퀴(crawl_runs.per_source.__run.lastId).
//  · 전체 상한 55분(CRAWL_TIMEOUT_MS 가 그보다 짧으면 55분으로 올리고 로그 한 줄 — NEWS-Q5 ■3).
//  · 막힌 피드(blocked): Render 망에서만 막힘(blocked_from_host) = 주 1회(KST 월요일) · 어디서나 403 = 월 1회(KST 1일)만
//    원 피드를 다시 해 본다. 그 밖의 날은 건너뛰고 대체 피드(구글뉴스 site: 검색)가 읽는다.
// ============================================================
import type { BackfillRecord, BroadcastApiRecord } from './youtube_api';
import type { BroadcastFeedStatus } from './broadcast_feeds';
import type { BroadcastGateStats } from './broadcast_gate';
import type { GroupCounts } from './keyword_groups';

export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

export const SOURCE_CONCURRENCY = 4;
export const SOURCE_CAP_MS = 60_000;
/** NEWS-Q6 ■3: 구글뉴스 검색 피드만 120초(항목마다 원문 링크 풀기·본문 추출이 붙어 60초에 절반이 끊겼다 — 10-14 14/28). */
export const GOOGLE_SEARCH_CAP_MS = 120_000;

/** 소스별 읽기 상한: 구글뉴스 검색 피드 120초 · 나머지 60초. */
export function sourceCapMs(s: { url?: string | null }): number {
  return /^https?:\/\/news\.google\.com\/rss\/search/i.test(s.url || '') ? GOOGLE_SEARCH_CAP_MS : SOURCE_CAP_MS;
}
export const DEFAULT_CRAWL_MINUTES = 55;
/** 방송 9채널 몫(맨 앞) */
export const BROADCAST_SHARE_MS = 5 * 60_000;
/** per_source 안 실행 기록 열쇠(소스 id 와 겹치지 않음) */
export const RUN_KEY = '__run';

/**
 * 전체 상한(ms). NEWS-Q5 ■3: env CRAWL_TIMEOUT_MS 가 없거나 틀리면 55분, 55분보다 짧으면 55분으로 올리고 로그 한 줄,
 * 더 길면 그 값. (서비스가 Blueprint 로 묶여 있지 않아 push 로 대시보드 env 가 바뀌지 않는다 — 옛 값이 남아 있어도 55분.)
 */
export function crawlTimeoutMs(env: NodeJS.ProcessEnv = process.env, log: (msg: string) => void = () => {}): number {
  const floor = DEFAULT_CRAWL_MINUTES * 60_000;
  const raw = Number(env.CRAWL_TIMEOUT_MS);
  if (env.CRAWL_TIMEOUT_MS == null || env.CRAWL_TIMEOUT_MS === '') return floor;
  if (!Number.isFinite(raw) || raw <= 0) {
    log(`[crawl] CRAWL_TIMEOUT_MS 값이 틀림 — 전체 상한 ${DEFAULT_CRAWL_MINUTES}분`);
    return floor;
  }
  if (raw < floor) {
    log(`[crawl] CRAWL_TIMEOUT_MS ${Math.round(raw / 60_000)}분 < ${DEFAULT_CRAWL_MINUTES}분 — ${DEFAULT_CRAWL_MINUTES}분으로 올림`);
    return floor;
  }
  return raw;
}

// ---------- 시작점 순환 ----------
export function rotateSources<T extends { id: string }>(list: T[], lastId: string | null | undefined): { order: T[]; startIndex: number } {
  if (!list.length || !lastId) return { order: [...list], startIndex: 0 };
  const i = list.findIndex((s) => s.id === lastId);
  if (i < 0) return { order: [...list], startIndex: 0 };
  const start = (i + 1) % list.length;
  return { order: [...list.slice(start), ...list.slice(0, start)], startIndex: start };
}

// ---------- 막힌 피드 ----------
export interface BlockedInfo {
  /** blocked_from_host = Render 망에서만 막힘(이 PC 성공) · blocked_everywhere = 어디서나 403 */
  kind: 'blocked_from_host' | 'blocked_everywhere';
  retry: 'weekly' | 'monthly';
  since?: string;
  /** 이 PC 에서 마지막으로 성공 확인한 날(blocked_from_host) */
  local_ok?: string;
  /** 대체 피드 id */
  substitute?: string;
  /** NEWS-Q13 ■6: 기록으로 남은 재시도 결과(KST 날짜) — 실행 기록과 합쳐 「잇달아 성공」을 센다 */
  retry_log?: Array<{ date: string; ok: boolean }>;
  /** NEWS-Q13 ■6: 재시도가 이만큼 잇달아 성공하면 원 피드 = 주 피드 · 대체 = 예비(기본 2) */
  promote_after?: number;
}

function kstParts(now: number): { weekday: number; day: number } {
  const d = new Date(now + 9 * 3600 * 1000);
  return { weekday: d.getUTCDay(), day: d.getUTCDate() };
}

/** 원 피드를 오늘 다시 해 볼 날인가(주 1회 = KST 월요일 · 월 1회 = KST 1일). */
export function blockedRetryDue(b: Pick<BlockedInfo, 'retry'>, now = Date.now()): boolean {
  const { weekday, day } = kstParts(now);
  return b.retry === 'weekly' ? weekday === 1 : day === 1;
}

export interface SourcePlan<T> {
  /** 오늘 돌 순서(순환 + 막힌 피드 중 오늘 안 할 것 뺌) */
  order: T[];
  startIndex: number;
  startId: string | null;
  /** 막힌 피드 — 오늘 건너뜀 */
  skipped: T[];
  /** 막힌 피드 — 오늘 다시 해 봄 */
  retrying: T[];
}

/** 정렬된 소스 → 오늘 순서(시작점 순환은 전체 목록 기준 · 그다음 막힌 피드 거름). */
export function planSources<T extends { id: string; blocked?: Pick<BlockedInfo, 'retry'> | null }>(
  sorted: T[],
  lastId: string | null | undefined,
  now = Date.now(),
  /** NEWS-Q13 ■6: 주 피드로 오른 막힌 피드(날마다 돎 · 재시도 아님) */
  promoted: ReadonlySet<string> = new Set(),
): SourcePlan<T> {
  const { order, startIndex } = rotateSources(sorted, lastId);
  const skipped: T[] = [];
  const retrying: T[] = [];
  const kept: T[] = [];
  for (const s of order) {
    if (!s.blocked || promoted.has(s.id)) { kept.push(s); continue; }
    if (blockedRetryDue(s.blocked, now)) { retrying.push(s); kept.push(s); } else skipped.push(s);
  }
  return { order: kept, startIndex, startId: kept[0]?.id ?? null, skipped, retrying };
}

// ---------- 동시 읽기 + 순서대로 판정 ----------
export type ReadOutcome<V> =
  | { status: 'ok'; value: V; ms: number }
  | { status: 'timeout'; value: V | null; ms: number }
  | { status: 'error'; error: unknown; ms: number };

export interface ReadCtx<V> {
  /** 이 소스 읽기 상한 시각(ms) — 항목 사이에서 보고 넘으면 그때까지 것만 돌려준다 */
  deadlineAt: number;
  /** 상한을 넘겨 버려진 읽기면 true(그 뒤 공유 상태를 건드리지 말 것) */
  cancelled(): boolean;
  /** 지금까지 읽은 것(상한에 걸리면 이것을 판정으로 넘김) */
  partial(v: V): void;
}

export interface RunSourcesOptions<T, V> {
  concurrency?: number;
  capMs?: number;
  /** 소스마다 다른 상한(있으면 capMs 보다 먼저) — NEWS-Q6 ■3 */
  capFor?: (item: T) => number;
  /** 판정이 밀릴 때 앞서 읽어 둘 소스 수(기본 concurrency × 2) */
  maxAhead?: number;
  /** 새 읽기를 시작해도 되나(전체 상한) */
  canStart?: () => boolean;
  read: (item: T, ctx: ReadCtx<V>) => Promise<V>;
  /** 소스 순서대로 하나씩. false = 여기서 멈춤(전체 상한) */
  consume: (item: T, outcome: ReadOutcome<V>, index: number) => Promise<boolean>;
  now?: () => number;
}

export interface RunSourcesResult {
  /** 판정까지 마친 소스 수(앞에서부터) */
  consumed: number;
  /** consume 이 멈춤을 알렸거나 canStart 가 막아 다 못 돌았음 */
  stopped: boolean;
}

/**
 * 읽기는 동시에 최대 concurrency 개(소스별 capMs 상한), 판정은 목록 순서대로 하나씩.
 * 결과(판정 순서·후보)는 읽기가 끝나는 순서와 무관하다.
 */
export async function runSources<T, V>(items: T[], o: RunSourcesOptions<T, V>): Promise<RunSourcesResult> {
  const conc = Math.max(1, o.concurrency ?? SOURCE_CONCURRENCY);
  const capAll = o.capMs ?? SOURCE_CAP_MS;
  const ahead = Math.max(conc, o.maxAhead ?? conc * 2);
  const now = o.now ?? Date.now;
  const canStart = o.canStart ?? (() => true);
  const slots: Array<Promise<ReadOutcome<V>> | null> = items.map(() => null);
  let running = 0;
  let next = 0;
  let consumed = 0;
  let stopped = false;

  function fill(): void {
    while (!stopped && running < conc && next < items.length && next < consumed + ahead && canStart()) {
      slots[next] = startOne(next);
      next++;
    }
  }

  function startOne(i: number): Promise<ReadOutcome<V>> {
    running++;
    const t0 = now();
    const cap = o.capFor ? o.capFor(items[i]) : capAll;
    let last: V | null = null;
    let done = false;
    const ctx: ReadCtx<V> = { deadlineAt: t0 + cap, cancelled: () => done, partial: (v) => { last = v; } };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<ReadOutcome<V>>((res) => {
      timer = setTimeout(() => res({ status: 'timeout', value: last, ms: now() - t0 }), cap);
    });
    const work = Promise.resolve().then(() => o.read(items[i], ctx)).then(
      (value): ReadOutcome<V> => (now() > ctx.deadlineAt ? { status: 'timeout', value, ms: now() - t0 } : { status: 'ok', value, ms: now() - t0 }),
      (error): ReadOutcome<V> => ({ status: 'error', error, ms: now() - t0 }),
    );
    return Promise.race([work, timeout]).then((r) => {
      done = true;
      if (timer) clearTimeout(timer);
      running--;
      // 자리가 나면 바로 다음 소스 읽기(판정을 기다리지 않음)
      fill();
      return r;
    });
  }

  for (let i = 0; i < items.length; i++) {
    fill();
    if (!slots[i]) {
      // 읽기를 시작하지 못함(전체 상한) → 멈춤
      stopped = true;
      break;
    }
    const outcome = await slots[i]!;
    slots[i] = null;
    const go = await o.consume(items[i], outcome, i);
    consumed++;
    if (!go) { stopped = true; break; }
  }
  // 멈춘 뒤 아직 도는 읽기는 기다리지 않는다(결과 버림 · cancelled() 는 끝날 때 true).
  return { consumed, stopped: stopped || consumed < items.length };
}

// ---------- 실행 기록(per_source.__run) ----------
export interface RunProgress {
  /** 이번 순서의 첫 소스 · 위치 */
  startId: string | null;
  startIndex: number;
  /** 판정까지 마친 마지막 소스(다음 실행은 그 다음부터) */
  lastId: string | null;
  reached: number;
  total: number;
  timedOut: boolean;
  /** 상한에 걸린 단계: broadcast | articles | statory | null */
  stoppedAt: string | null;
  /** 소스별 60초 상한에 걸린 소스 */
  timeouts: string[];
  /** 막힌 피드 — 오늘 건너뜀(대체 피드가 읽음) */
  blockedSkipped: string[];
  /** 막힌 피드 — 오늘 다시 해 봄(주·월 1회) 결과 */
  blockedRetried: Array<{ id: string; ok: boolean; status?: string }>;
  blockedFromHost: number;
  broadcastFirst: boolean;
  broadcastMs: number | null;
  concurrency: number;
  sourceCapSec: number;
  /** NEWS-Q6 ■3: 구글뉴스 검색 피드 상한(초) */
  googleCapSec?: number;
  deadlineMin: number;
  /** NEWS-Q5 ■1: 구글 링크 해석 실패 수 · 실행 끝 경보(run_alerts) */
  urlResolveFail?: number;
  /** NEWS-Q10 ■2: 스팸 낱말 하나 ∧ 제목 핵심어라 떨어뜨리지 않고 관문으로 보낸 후보 수 */
  spamToGate?: number;
  alerts?: Array<{ code: string; value: number | string; limit?: number }>;
  /** NEWS-Q6 ■4: 방송 되짚기(YouTube Data API) 기록 */
  broadcastApi?: BroadcastApiRecord;
  /** NEWS-Q7 ■3: 놓친 날 되짚기(이번 실행이 메운 결손 실행 · 범위 · 더한 소스 수) */
  missedLookback?: { covers: string[]; after: string; before: string; sources: number };
  /** NEWS-Q8 ■2: 방송 채널별 마지막 읽기 결과(health broadcast.feeds[]) */
  broadcastFeeds?: BroadcastFeedStatus[];
  /** NEWS-Q11 ■2: 방송 전용 관문 수(publish · archive · 거부 사유별 · 하위 주제) */
  broadcastGate?: BroadcastGateStats;
  /** NEWS-Q11 ■3: 핵심어 묶음별 후보·저장·보관·거부 */
  keywordGroups?: GroupCounts;
  /** NEWS-Q12 ■2: 보도 날짜가 30일 넘게 오래돼 실림 대신 보관한 기사 수 */
  oldDatedArchived?: number;
  /** NEWS-Q12 ■3: 본문 추출이 거듭 멈춰 이번 실행에서 건너뛴 호스트 · 건너뛴 수 */
  bodyBreaker?: { tripped: string[]; skipped: Record<string, number> };
  /** NEWS-Q12 ■1: 설정 archive_ids 로 이번 실행이 보관층으로 옮긴 방송 id */
  broadcastArchivedIds?: number[];
  /** NEWS-Q13 ■2: 설정 keep_ids 로 이번 실행이 실림으로 되돌린 방송 id */
  broadcastRestoredIds?: number[];
  /** NEWS-Q13 ■6: 주 피드로 오른 막힌 피드 · 그 날마다 결과 · 원 피드 성공이라 판정 안 한 예비 피드 */
  blockedPromoted?: string[];
  blockedPrimary?: Array<{ id: string; ok: boolean }>;
  standbySkipped?: string[];
  /** NEWS-Q13 ■3: 100일 한 번 메우기(설정 backfill_search_once · done = 끝) */
  broadcastBackfill?: BackfillRecord;
  /** NEWS-Q14 ■1: 설정 spam_publishers.archive_ids 로 이번 실행이 보관층으로 옮긴 id · 옮기지 않은 수(이미 보관 · 출처 안 맞음) */
  spamArchivedIds?: number[];
  spamArchiveSkipped?: number;
  /** DB 오류로 못 옮김(다음 실행이 다시) */
  spamArchiveError?: boolean;
  /** NEWS-Q14 ■1: 스팸 출처라 거부한 항목 수(출처 이름별 · 판정 호출 0) */
  spamRejected?: Record<string, number>;
  /** NEWS-Q14 ■3: 단락기로 본문을 못 읽어 RSS 요약으로 판정한 수 · 요약이 짧아 옛 규칙(본문 부실)으로 건너뛴 수 */
  breakerSummary?: { judged: number; thin: number };
  /** NEWS-Q14 ■4: 영상 길이 읽기(videos.list contentDetails) — 부른 수 · 단위 · 길이 읽은 영상 · 길이로 본편/클립이 된 수 · 멈춘 까닭 */
  broadcastDuration?: { calls: number; units: number; videos: number; mainByLength: number; clipByLength: number; stopped?: string };
}

export function emptyProgress(total: number, deadlineMs: number): RunProgress {
  return {
    startId: null, startIndex: 0, lastId: null, reached: 0, total, timedOut: false, stoppedAt: null,
    timeouts: [], blockedSkipped: [], blockedRetried: [], blockedFromHost: 0,
    broadcastFirst: true, broadcastMs: null, oldDatedArchived: 0, spamRejected: {}, breakerSummary: { judged: 0, thin: 0 },
    concurrency: SOURCE_CONCURRENCY, sourceCapSec: SOURCE_CAP_MS / 1000, googleCapSec: GOOGLE_SEARCH_CAP_MS / 1000, deadlineMin: Math.round(deadlineMs / 60_000),
  };
}

/** 지난 실행(읽기 전용 제외)이 마지막으로 마친 소스 id. 표·기록이 없거나 실패면 null(처음부터). */
export async function lastRunLastSourceId(query: QueryFn, field: string): Promise<string | null> {
  try {
    const rows = await query(
      `SELECT per_source FROM crawl_runs WHERE read_only = false AND field = $1 ORDER BY started_at DESC LIMIT 1`,
      [field],
    );
    const raw = rows?.[0]?.per_source;
    const ps = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const id = ps?.[RUN_KEY]?.lastId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}
