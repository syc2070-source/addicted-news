// ============================================================
// crawl_schedule.ts (NEWS-Q4 ■1·■2) — 수집 순서·시간 상한(LLM 0 · DB 쓰기 0 · 순수 함수 + 읽기 하나).
//  · 소스 읽기(피드 가져오기·해석·원문 추출) = 동시 4 · 소스별 상한 60초(넘으면 그때까지 읽은 것만 · 같은 실행 재시도 0).
//    판정(DeepSeek)·저장은 소스 순서대로 하나씩(하루 상한 400 · 중복 검사 순서 보존) — runSources 의 consume.
//  · 시작점 순환: 지난 실행이 마지막으로 마친 소스 다음부터 한 바퀴(crawl_runs.per_source.__run.lastId).
//  · 전체 상한 55분(CRAWL_TIMEOUT_MS · 옛 기본 2400000 은 「설정 안 함」으로 본다 — 대시보드에 남아 있어도 55분).
//  · 막힌 피드(blocked): Render 망에서만 막힘(blocked_from_host) = 주 1회(KST 월요일) · 어디서나 403 = 월 1회(KST 1일)만
//    원 피드를 다시 해 본다. 그 밖의 날은 건너뛰고 대체 피드(구글뉴스 site: 검색)가 읽는다.
// ============================================================
export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

export const SOURCE_CONCURRENCY = 4;
export const SOURCE_CAP_MS = 60_000;
export const DEFAULT_CRAWL_MINUTES = 55;
/** 옛 render.yaml 기본(40분). 대시보드에 그대로 남아 있으면 무시하고 55분. */
export const LEGACY_TIMEOUT_MS = 2_400_000;
/** 방송 9채널 몫(맨 앞) */
export const BROADCAST_SHARE_MS = 5 * 60_000;
/** per_source 안 실행 기록 열쇠(소스 id 와 겹치지 않음) */
export const RUN_KEY = '__run';

export function crawlTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CRAWL_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0 || raw === LEGACY_TIMEOUT_MS) return DEFAULT_CRAWL_MINUTES * 60_000;
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
): SourcePlan<T> {
  const { order, startIndex } = rotateSources(sorted, lastId);
  const skipped: T[] = [];
  const retrying: T[] = [];
  const kept: T[] = [];
  for (const s of order) {
    if (!s.blocked) { kept.push(s); continue; }
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
  const cap = o.capMs ?? SOURCE_CAP_MS;
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
  deadlineMin: number;
}

export function emptyProgress(total: number, deadlineMs: number): RunProgress {
  return {
    startId: null, startIndex: 0, lastId: null, reached: 0, total, timedOut: false, stoppedAt: null,
    timeouts: [], blockedSkipped: [], blockedRetried: [], blockedFromHost: 0,
    broadcastFirst: true, broadcastMs: null,
    concurrency: SOURCE_CONCURRENCY, sourceCapSec: SOURCE_CAP_MS / 1000, deadlineMin: Math.round(deadlineMs / 60_000),
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
