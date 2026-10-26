// ============================================================
// crawl_runs.ts (NEWS-Q2 ■8) — 실행마다 한 행 집계(crawl_runs 표 · 묶음 SQL 2).
// 표가 없으면 기록하지 않는다(로그에만). 읽기 실패는 조용히 null/[].
// ============================================================
import { BroadcastFeedStatus, broadcastFeedsOf } from './broadcast_feeds';
import { groupSummary } from './keyword_groups';

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
  /** NEWS-Q3: 묶음 상속(관문 건너뜀) */
  inherited?: number;
  /** NEWS-Q4 ■1: 읽기(가져오기·해석·원문 추출) · 판정 걸린 시간(ms) */
  readMs?: number;
  judgeMs?: number;
  /** 소스별 60초 상한에 걸림 */
  timeout?: boolean;
  /** ■2: 막힌 피드 재시도 실패(실패 피드로 세지 않음) */
  blocked?: boolean;
}

/** NEWS-Q4 ■1: 순서·상한 기록 — per_source.__run 칸(묶음 SQL 0 · 기존 jsonb). crawl_schedule.RunProgress 와 같은 꼴. */
export interface RunProgressLike {
  startId: string | null;
  lastId: string | null;
  reached: number;
  total: number;
  timedOut: boolean;
  stoppedAt: string | null;
  timeouts: string[];
  blockedSkipped: string[];
  blockedRetried: Array<{ id: string; ok: boolean; status?: string }>;
  blockedFromHost: number;
  broadcastMs: number | null;
  broadcastFirst?: boolean;
  /** NEWS-Q5 ■1: 구글 링크 해석 실패 수(대개 429) · 실행 끝 경보(run_alerts) */
  urlResolveFail?: number;
  /** NEWS-Q10 ■2: 스팸 낱말 하나 ∧ 제목 핵심어 → 관문으로 보낸 후보 수 */
  spamToGate?: number;
  alerts?: Array<{ code: string; value: number | string; limit?: number }>;
  /** NEWS-Q6 ■3·■4: 구글 검색 피드 상한(초) · 방송 되짚기 기록 */
  googleCapSec?: number;
  broadcastApi?: object;
  /** NEWS-Q7 ■3: 놓친 날 되짚기 기록(covers · after · before · sources) */
  missedLookback?: object;
  /** NEWS-Q8 ■2: 방송 채널별 마지막 읽기 결과 */
  broadcastFeeds?: BroadcastFeedStatus[];
  /** NEWS-Q11 ■2·■3: 방송 전용 관문 수 · 핵심어 묶음별 수 */
  broadcastGate?: object;
  keywordGroups?: Record<string, { candidates?: number; saved?: number; archived?: number; rejected?: number }>;
  /** NEWS-Q12 ■2: 오래된 보도 날짜라 보관한 기사 수 */
  oldDatedArchived?: number;
  /** NEWS-Q12 ■3: 본문 추출 단락기 */
  bodyBreaker?: object;
  /** NEWS-Q12 ■1 · Q13 ■2: 설정 archive_ids / keep_ids 로 옮긴 방송 id */
  broadcastArchivedIds?: number[];
  broadcastRestoredIds?: number[];
  /** NEWS-Q13 ■3: 100일 한 번 메우기 기록 */
  broadcastBackfill?: object;
  /** NEWS-Q14 ■1: 스팸 출처 — 보관층으로 옮긴 id · 옮기지 않은 수 · 이름별 거부 수 */
  spamArchivedIds?: number[];
  spamArchiveSkipped?: number;
  spamArchiveError?: boolean;
  spamRejected?: Record<string, number>;
  /** NEWS-Q14 ■3 · ■4: 단락기 요약 판정 · 영상 길이 읽기 */
  breakerSummary?: object;
  broadcastDuration?: object;
  /** NEWS-Q16 ■1 · ■2: 이미 저장된 재업로드 방송을 원 방송일로 맞춘 기록 · 방송 관문 한 번 다시 판정 기록 */
  broadcastAired?: object;
  broadcastRejudge?: object;
  /** NEWS-Q18 ■2 · ■4: 주제 거름 · 503 호스트 단락기 */
  topicExcluded?: object;
  hostBreaker503?: object;
}

export const RUN_PROGRESS_KEY = '__run';

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
  /** NEWS-Q3 ■1: 묶음 상속·되짚기 숫자(crawl_runs.cluster_stats 열 · 묶음 SQL 3 있을 때만 기록) */
  clusterStats?: ClusterRunStats | null;
  /** NEWS-Q4 ■1: 순서·상한 기록(per_source.__run 로 함께 저장) */
  progress?: RunProgressLike | null;
}

export interface ClusterRunStats {
  /** 묶음 기억에 넣은 최근 저장분 */
  poolLoaded: number;
  /** 둘째 기사부터 관문 건너뛰고 대표 판정 상속(저장 후보) */
  inherited: number;
  /** 대표가 거부라 함께 거부 */
  inheritedRejected: number;
  /** 외국어 묶음 기사(번역 없이 싣지 않음 → 건너뜀) */
  foreignSkipped: number;
  /** 절감 비율 = 상속(+함께 거부·외국 건너뜀) / (그것 + DeepSeek 판정 기사 수) */
  savedPct: number;
  backfill: { rows: number; clusters: number; updated: number } | null;
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

export async function recordCrawlRun(query: QueryFn, s: CrawlRunSummary, opts: { clusterStatsColumn?: boolean } = {}): Promise<boolean> {
  const withCluster = !!opts.clusterStatsColumn;
  await query(
    `INSERT INTO crawl_runs (field, started_at, finished_at, read_only, sources_total, feeds_ok, feeds_failed, failed_feeds,
       items_seen, candidates, dup_skipped, deepseek_calls, deepseek_prompt_tokens, deepseek_completion_tokens, cost_usd_est,
       saved, archived, rejected, timed_out, per_source, url_backfill${withCluster ? ', cluster_stats' : ''})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb${withCluster ? ',$22::jsonb' : ''})`,
    [
      s.field, s.startedAt, s.finishedAt, s.readOnly, s.sourcesTotal, s.feedsOk, s.feedsFailed, JSON.stringify(s.failedFeeds),
      s.itemsSeen, s.candidates, s.dupSkipped, s.deepseekCalls, s.promptTokens, s.completionTokens, s.costUsd,
      s.saved, s.archived, s.rejected, s.timedOut,
      JSON.stringify(s.progress ? { ...s.perSource, [RUN_PROGRESS_KEY]: s.progress } : s.perSource),
      s.urlBackfill ? JSON.stringify(s.urlBackfill) : null,
      ...(withCluster ? [s.clusterStats ? JSON.stringify(s.clusterStats) : null] : []),
    ],
  );
  return true;
}

export interface RunPublic {
  startedAt: string;
  finishedAt: string | null;
  durationSec: number | null;
  timedOut: boolean;
  sourcesTotal: number;
  feedsOk: number;
  feedsFailed: number;
  failedFeeds: string[];
  itemsSeen: number;
  candidates: number;
  dupSkipped: number;
  deepseekCalls: number;
  costUsd: number;
  saved: number;
  archived: number;
  rejected: number;
  urlBackfill: Record<string, number> | null;
  clusterStats: ClusterRunStats | null;
  /** NEWS-Q4 ■1·■4: 순서·상한 기록(없던 실행은 null) */
  progress: RunProgressLike | null;
  /** NEWS-Q4: per_source 에서 뽑은 숫자(방송 읽힘 · 오래 걸린 소스 5) */
  sources: PerSourceDigest;
  /** NEWS-Q5 ■0: 그 실행 동안 격리된 거부 기사의 사유 분포(rejected_articles · 사유 앞머리별 수 · 표 없으면 null) */
  rejectReasons: Record<string, number> | null;
  /** NEWS-Q8 ■2: 방송 채널별 마지막 읽기 결과(ok/404/500/api_quota · 읽은 길 api/rss · 항목 수 · 시각) */
  broadcast: { feeds: BroadcastFeedStatus[] };
  /** NEWS-Q11 ■1: 저장 행이 목록에 보이는 꼴(묶음에 들어간 수 · 접힌 수 · 오래된 보도 날짜) — 열·표가 없으면 null */
  visibility: RunVisibility | null;
}

export interface PerSourceDigest {
  /** 방송 채널: 읽은 채널 수 / 항목 수 */
  broadcastChannelsRead: number;
  broadcastItems: number;
  /** 소스별 60초 상한에 걸린 수 */
  timeouts: number;
  /** 막힌 피드(재시도 실패 · 오늘 건너뜀) 수 */
  blocked: number;
  /** 읽기+판정 오래 걸린 소스 5(초) */
  slowest: Array<{ id: string; readSec: number; judgeSec: number }>;
  /** NEWS-Q5 ■1: 세계신문(wp-* · 대체 검색 피드 포함) 저장 수 */
  worldSaved: number;
  /** NEWS-Q14 ■2: 세계신문 보관층 저장 수(경보 world_zero_2d = 실림 + 보관) */
  worldArchived: number;
  /** NEWS-Q5 ■0: 소스 무리별 합(소스 수 · 읽음 · 후보 · 중복 · 판정 호출 · 저장/보관/거부 · 상한 · 실패) */
  groups: Record<string, SourceGroupStat>;
}

export interface SourceGroupStat {
  sources: number;
  read: number;
  candidates: number;
  dup: number;
  calls: number;
  saved: number;
  archived: number;
  rejected: number;
  timeouts: number;
  failed: number;
}

/** 소스 id → 무리(id 꼴로만 · 옛 실행 행에도 그대로 쓴다). 대체 검색 피드는 원 피드의 무리로 센다. */
export function sourceGroupOf(id: string): string {
  if (id.startsWith('broadcast:')) return 'broadcast';
  if (id.startsWith('wp-')) return 'world';
  if (id.startsWith('kr-press-')) return 'kr_press';
  if (id.startsWith('spec-')) return 'specialty';
  if (id.startsWith('inst-')) return 'institution';
  if (id.startsWith('acad-')) return 'academic';
  if (id.includes('-google-')) return 'google';
  return 'other';
}

/** per_source jsonb → 순서·상한 기록 + 숫자 요약(소스 id 와 숫자만). */
export function parsePerSource(raw: unknown): Record<string, any> {
  try {
    const ps: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return ps && typeof ps === 'object' ? (ps as Record<string, any>) : {};
  } catch {
    return {};
  }
}

export function digestPerSource(raw: unknown): { progress: RunProgressLike | null; sources: PerSourceDigest } {
  const ps = parsePerSource(raw);
  const progress = ps[RUN_PROGRESS_KEY] && typeof ps[RUN_PROGRESS_KEY] === 'object' ? (ps[RUN_PROGRESS_KEY] as RunProgressLike) : null;
  let broadcastChannelsRead = 0;
  let broadcastItems = 0;
  let timeouts = 0;
  let blocked = 0;
  let worldSaved = 0;
  let worldArchived = 0;
  const groups: Record<string, SourceGroupStat> = {};
  const timing: Array<{ id: string; readSec: number; judgeSec: number }> = [];
  for (const [id, st] of Object.entries(ps)) {
    if (id === RUN_PROGRESS_KEY || !st || typeof st !== 'object') continue;
    const gname = sourceGroupOf(id);
    const g = (groups[gname] ||= { sources: 0, read: 0, candidates: 0, dup: 0, calls: 0, saved: 0, archived: 0, rejected: 0, timeouts: 0, failed: 0 });
    g.sources++;
    for (const k of ['read', 'candidates', 'dup', 'calls', 'saved', 'archived', 'rejected'] as const) g[k] += Number(st[k] || 0);
    if (st.timeout) g.timeouts++;
    if (st.failed) g.failed++;
    if (gname === 'world') {
      worldSaved += Number(st.saved || 0);
      worldArchived += Number(st.archived || 0);
    }
    if (id.startsWith('broadcast:')) {
      if (!st.failed) { broadcastChannelsRead++; broadcastItems += Number(st.read || 0); }
      continue;
    }
    if (st.timeout) timeouts++;
    if (st.blocked) blocked++;
    if (st.readMs != null || st.judgeMs != null) {
      timing.push({ id, readSec: Math.round(Number(st.readMs || 0) / 100) / 10, judgeSec: Math.round(Number(st.judgeMs || 0) / 100) / 10 });
    }
  }
  if (progress) blocked += Array.isArray(progress.blockedSkipped) ? progress.blockedSkipped.length : 0;
  timing.sort((a, b) => b.readSec + b.judgeSec - (a.readSec + a.judgeSec));
  return { progress, sources: { broadcastChannelsRead, broadcastItems, timeouts, blocked, slowest: timing.slice(0, 5), worldSaved, worldArchived, groups } };
}

/** NEWS-Q3 ■0·■5: 최근 실행 n 개(공개 · 숫자와 실패 피드 이름만 · 열쇠·본문 0). 표가 없거나 실패면 []. */
/**
 * 실행 한 번 동안 격리된 거부 기사 사유 분포(사유의 ':' 앞머리 · 많은 순 10). 실패면 null.
 * NEWS-Q11 ■2: 방송(broadcast:…)은 둘째 마디까지(broadcast:topic_fit_false) — 앞머리만이면 왜 떨어졌는지 안 보인다.
 */
export async function rejectReasonsBetween(query: QueryFn, from: Date, to: Date): Promise<Record<string, number> | null> {
  try {
    const rows = await query(
      `SELECT CASE WHEN reject_reason LIKE 'broadcast:%' THEN 'broadcast:' || split_part(reject_reason, ':', 2)
                   ELSE split_part(reject_reason, ':', 1) END AS reason, count(*)::int AS n FROM rejected_articles
        WHERE created_at >= $1 AND created_at <= $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      [from, to],
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.reason).slice(0, 40)] = Number(r.n || 0);
    return out;
  } catch {
    return null;
  }
}

/** NEWS-Q11 ■1: 실행 하나가 저장한 행이 공개 목록에 어떻게 보이나(저장 수 ≠ 목록 줄 수의 까닭). */
export interface RunVisibility {
  /** 기사 실림(publish) · 보관(archive) · 방송(층 무관) · 숨김(차단·soft 삭제) */
  publish: number;
  archive: number;
  broadcast: number;
  hidden: number;
  /** 실림 기사 중 묶음(같은 소식 2건 이상)에 들어간 수 */
  clustered: number;
  /** 그중 목록에서 접혀 대표 한 줄 뒤로 들어간 수(근사: 묶음 든 수 − 이번 실행에서 새로 생긴 묶음 수) */
  folded: number;
  /** 실림 기사 중 보도 날짜가 실행일 7일보다 앞선 것(목록이 보도 날짜 순이라 첫 쪽에 안 보임) */
  oldDated: number;
}

export interface VisibilityColumns {
  tier: boolean;
  deletedAt: boolean;
  cluster: boolean;
}

/** 실행 시간 창에 만든 articles 행 → 보이는 꼴 수. 열(tier·deleted_at·cluster_id/size)이 없으면 그 칸은 셈에서 빠진다. 실패면 null. */
export async function runVisibility(query: QueryFn, from: Date, to: Date, cols: VisibilityColumns): Promise<RunVisibility | null> {
  try {
    const tier = cols.tier ? `COALESCE(tier, 'publish')` : `'publish'`;
    const hidden = cols.deletedAt ? `(blocked OR deleted_at IS NOT NULL)` : `blocked`;
    const csize = cols.cluster ? 'cluster_size' : '1';
    const cid = cols.cluster ? 'cluster_id' : 'NULL::bigint';
    const rows = await query(
      `WITH r AS (
         SELECT id, ${tier} AS t, COALESCE(source_type, '') = 'broadcast' AS bc, ${csize} AS csize, ${cid} AS cid,
                published_at, ${hidden} AS hidden
           FROM articles WHERE created_at >= $1 AND created_at <= $2
       ), f AS (
         SELECT ${cid} AS cid, min(id) AS first_id FROM articles
          WHERE ${cols.cluster ? 'cluster_id IN (SELECT cid FROM r WHERE cid IS NOT NULL)' : 'false'} GROUP BY 1
       ), p AS (
         SELECT r.*, f.first_id FROM r LEFT JOIN f ON f.cid = r.cid WHERE NOT r.hidden AND r.t = 'publish' AND NOT r.bc
       )
       SELECT
         (SELECT count(*) FROM p)::int AS publish,
         (SELECT count(*) FROM r WHERE NOT hidden AND t = 'archive' AND NOT bc)::int AS archive,
         (SELECT count(*) FROM r WHERE NOT hidden AND bc)::int AS broadcast,
         (SELECT count(*) FROM r WHERE hidden)::int AS hidden,
         (SELECT count(*) FROM p WHERE csize > 1)::int AS clustered,
         (SELECT count(DISTINCT cid) FROM p WHERE csize > 1 AND first_id >= (SELECT min(id) FROM r))::int AS new_clusters,
         (SELECT count(*) FROM p WHERE published_at < ($2::timestamptz AT TIME ZONE 'Asia/Seoul')::date - 7)::int AS old_dated`,
      [from, to],
    );
    const r = rows?.[0];
    if (!r) return null;
    const n = (v: unknown) => Number(v || 0);
    return {
      publish: n(r.publish), archive: n(r.archive), broadcast: n(r.broadcast), hidden: n(r.hidden),
      clustered: n(r.clustered), folded: Math.max(0, n(r.clustered) - n(r.new_clusters)), oldDated: n(r.old_dated),
    };
  } catch {
    return null;
  }
}

export async function recentCrawlRuns(
  query: QueryFn,
  n: number,
  opts: { clusterStatsColumn?: boolean; rejectReasons?: boolean; visibility?: VisibilityColumns | null } = {},
): Promise<RunPublic[]> {
  try {
    const rows = await query(
      `SELECT started_at, finished_at, timed_out, sources_total, feeds_ok, feeds_failed, failed_feeds, items_seen, candidates,
              dup_skipped, deepseek_calls, cost_usd_est, saved, archived, rejected, url_backfill, per_source
              ${opts.clusterStatsColumn ? ', cluster_stats' : ', NULL AS cluster_stats'}
         FROM crawl_runs WHERE read_only = false ORDER BY started_at DESC LIMIT $1`,
      [Math.max(1, Math.min(20, Math.floor(n) || 5))],
    );
    const num = (v: unknown) => Number(v || 0);
    const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);
    const out: RunPublic[] = [];
    for (const r of rows) {
      const s = new Date(r.started_at);
      const f = r.finished_at ? new Date(r.finished_at) : null;
      const failed = json(r.failed_feeds);
      const failedList: string[] = Array.isArray(failed) ? failed.map((x: unknown) => String(x)) : [];
      const rejectReasons = opts.rejectReasons && f ? await rejectReasonsBetween(query, s, new Date(f.getTime() + 60_000)) : null;
      const visibility = opts.visibility && f ? await runVisibility(query, s, new Date(f.getTime() + 60_000), opts.visibility) : null;
      const digest = digestPerSource(r.per_source);
      out.push({
        startedAt: s.toISOString(),
        finishedAt: f ? f.toISOString() : null,
        durationSec: f ? Math.round((f.getTime() - s.getTime()) / 1000) : null,
        timedOut: !!r.timed_out,
        sourcesTotal: num(r.sources_total), feedsOk: num(r.feeds_ok), feedsFailed: num(r.feeds_failed),
        failedFeeds: failedList.map((x) => x.slice(0, 160)),
        itemsSeen: num(r.items_seen), candidates: num(r.candidates), dupSkipped: num(r.dup_skipped),
        deepseekCalls: num(r.deepseek_calls), costUsd: num(r.cost_usd_est),
        saved: num(r.saved), archived: num(r.archived), rejected: num(r.rejected),
        urlBackfill: json(r.url_backfill),
        clusterStats: json(r.cluster_stats),
        ...digest,
        rejectReasons,
        visibility,
        broadcast: {
          feeds: broadcastFeedsOf({ startedAt: s.toISOString(), failedFeeds: failedList, progress: digest.progress, perSource: parsePerSource(r.per_source) }),
        },
      });
    }
    return out;
  } catch {
    return [];
  }
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
  /** NEWS-Q4 ■4: 소요(초) · 소스 수 · 전체 상한 걸림 · 소스 상한 걸린 수 · 막힌 피드 수 */
  durationSec: number | null;
  sourcesTotal: number;
  timedOut: boolean;
  timeouts: number;
  blocked: number;
  blockedFromHost: number | null;
  /** NEWS-Q11 ■3: 핵심어 묶음별 「후보/저장」 한 줄(기록 없는 옛 실행 = null · 보관·거부는 runs 의 progress.keywordGroups) */
  keywordGroups: Record<string, string> | null;
}

/** health 용 마지막 실행 요약(숫자만). 표가 없거나 실패면 null. */
export async function lastCrawlRun(query: QueryFn, field?: string): Promise<LastRunPublic | null> {
  try {
    const rows = await query(
      `SELECT started_at, finished_at, feeds_ok, feeds_failed, items_seen, dup_skipped, deepseek_calls, cost_usd_est,
              saved, archived, rejected, sources_total, timed_out, per_source
         FROM crawl_runs WHERE read_only = false ${field ? 'AND field = $1' : ''}
        ORDER BY started_at DESC LIMIT 1`,
      field ? [field] : [],
    );
    const r = rows?.[0];
    if (!r) return null;
    const n = (v: unknown) => Number(v || 0);
    const s = new Date(r.started_at);
    const f = r.finished_at ? new Date(r.finished_at) : null;
    const { progress, sources } = digestPerSource(r.per_source);
    return {
      startedAt: s.toISOString(),
      finishedAt: f ? f.toISOString() : null,
      feedsOk: n(r.feeds_ok), feedsFailed: n(r.feeds_failed), itemsSeen: n(r.items_seen), dupSkipped: n(r.dup_skipped),
      deepseekCalls: n(r.deepseek_calls), costUsd: n(r.cost_usd_est),
      saved: n(r.saved), archived: n(r.archived), rejected: n(r.rejected),
      durationSec: f ? Math.round((f.getTime() - s.getTime()) / 1000) : null,
      sourcesTotal: n(r.sources_total),
      timedOut: !!r.timed_out,
      timeouts: sources.timeouts,
      blocked: sources.blocked,
      blockedFromHost: progress ? n(progress.blockedFromHost) : null,
      keywordGroups: groupSummary(progress?.keywordGroups),
    };
  } catch {
    return null;
  }
}

/** 지난 실행에서 실패한 방송 채널(outletId) — 이번 실행 맨 앞으로(■8). */
export async function lastFailedBroadcastOutlets(query: QueryFn, field: string): Promise<string[]> {
  return (await lastFailedFeeds(query, field))
    .filter((s: string) => s.startsWith('broadcast:'))
    .map((s: string) => s.slice('broadcast:'.length).split(' ')[0]);
}

/** 지난 실행(읽기 전용 제외)의 실패 피드 목록 그대로(NEWS-Q6 ■4: 방송 RSS 404 판별). 없거나 실패면 []. */
export async function lastFailedFeeds(query: QueryFn, field: string): Promise<string[]> {
  try {
    const rows = await query(
      `SELECT failed_feeds FROM crawl_runs WHERE read_only = false AND field = $1 ORDER BY started_at DESC LIMIT 1`,
      [field],
    );
    const list: unknown = rows?.[0]?.failed_feeds;
    const arr = Array.isArray(list) ? list : typeof list === 'string' ? JSON.parse(list) : [];
    return arr.map((s: unknown) => String(s));
  } catch {
    return [];
  }
}
