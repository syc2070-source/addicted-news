// ============================================================
// crawl_runs.ts (NEWS-Q2 ■8) — 실행마다 한 행 집계(crawl_runs 표 · 묶음 SQL 2).
// 표가 없으면 기록하지 않는다(로그에만). 읽기 실패는 조용히 null/[].
// ============================================================
export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

export interface SourceRunStat {
  read: number;
  candidates: number;
  dup: number;
  calls: number;
  saved: number;
  archived: number;
  rejected: number;
  failed?: string;
}

export interface CrawlRunSummary {
  field: string;
  startedAt: Date;
  finishedAt: Date;
  readOnly: boolean;
  sourcesTotal: number;
  feedsOk: number;
  feedsFailed: number;
  failedFeeds: string[];
  itemsSeen: number;
  candidates: number;
  dupSkipped: number;
  deepseekCalls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  saved: number;
  archived: number;
  rejected: number;
  timedOut: boolean;
  perSource: Record<string, SourceRunStat>;
  urlBackfill: Record<string, number> | null;
}

export function emptySourceStat(): SourceRunStat {
  return { read: 0, candidates: 0, dup: 0, calls: 0, saved: 0, archived: 0, rejected: 0 };
}

/** 피드 건강 표(로그용 한 줄들). */
export function feedHealthLines(s: Pick<CrawlRunSummary, 'sourcesTotal' | 'feedsOk' | 'feedsFailed' | 'failedFeeds'>): string[] {
  const lines = [`피드 건강: 소스 ${s.sourcesTotal} · 성공 ${s.feedsOk} · 실패 ${s.feedsFailed}`];
  for (const f of s.failedFeeds) lines.push(`  ✗ ${f}`);
  return lines;
}

export async function recordCrawlRun(query: QueryFn, s: CrawlRunSummary): Promise<boolean> {
  await query(
    `INSERT INTO crawl_runs (field, started_at, finished_at, read_only, sources_total, feeds_ok, feeds_failed, failed_feeds,
       items_seen, candidates, dup_skipped, deepseek_calls, deepseek_prompt_tokens, deepseek_completion_tokens, cost_usd_est,
       saved, archived, rejected, timed_out, per_source, url_backfill)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb)`,
    [
      s.field, s.startedAt, s.finishedAt, s.readOnly, s.sourcesTotal, s.feedsOk, s.feedsFailed, JSON.stringify(s.failedFeeds),
      s.itemsSeen, s.candidates, s.dupSkipped, s.deepseekCalls, s.promptTokens, s.completionTokens, s.costUsd,
      s.saved, s.archived, s.rejected, s.timedOut, JSON.stringify(s.perSource),
      s.urlBackfill ? JSON.stringify(s.urlBackfill) : null,
    ],
  );
  return true;
}

export interface LastRunPublic {
  startedAt: string;
  finishedAt: string | null;
  feedsOk: number;
  feedsFailed: number;
  itemsSeen: number;
  dupSkipped: number;
  deepseekCalls: number;
  costUsd: number;
  saved: number;
  archived: number;
  rejected: number;
}

/** health 용 마지막 실행 요약(숫자만). 표가 없거나 실패면 null. */
export async function lastCrawlRun(query: QueryFn, field?: string): Promise<LastRunPublic | null> {
  try {
    const rows = await query(
      `SELECT started_at, finished_at, feeds_ok, feeds_failed, items_seen, dup_skipped, deepseek_calls, cost_usd_est,
              saved, archived, rejected
         FROM crawl_runs WHERE read_only = false ${field ? 'AND field = $1' : ''}
        ORDER BY started_at DESC LIMIT 1`,
      field ? [field] : [],
    );
    const r = rows?.[0];
    if (!r) return null;
    const n = (v: unknown) => Number(v || 0);
    return {
      startedAt: new Date(r.started_at).toISOString(),
      finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
      feedsOk: n(r.feeds_ok), feedsFailed: n(r.feeds_failed), itemsSeen: n(r.items_seen), dupSkipped: n(r.dup_skipped),
      deepseekCalls: n(r.deepseek_calls), costUsd: n(r.cost_usd_est),
      saved: n(r.saved), archived: n(r.archived), rejected: n(r.rejected),
    };
  } catch {
    return null;
  }
}

/** 지난 실행에서 실패한 방송 채널(outletId) — 이번 실행 맨 앞으로(■8). */
export async function lastFailedBroadcastOutlets(query: QueryFn, field: string): Promise<string[]> {
  try {
    const rows = await query(
      `SELECT failed_feeds FROM crawl_runs WHERE read_only = false AND field = $1 ORDER BY started_at DESC LIMIT 1`,
      [field],
    );
    const list: unknown = rows?.[0]?.failed_feeds;
    const arr = Array.isArray(list) ? list : typeof list === 'string' ? JSON.parse(list) : [];
    return arr
      .map((s: unknown) => String(s))
      .filter((s: string) => s.startsWith('broadcast:'))
      .map((s: string) => s.slice('broadcast:'.length).split(' ')[0]);
  } catch {
    return [];
  }
}
