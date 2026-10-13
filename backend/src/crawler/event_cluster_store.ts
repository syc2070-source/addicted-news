// ============================================================
// event_cluster_store.ts (NEWS-Q3 ■1) — 수집기의 사건 묶음 DB 쪽.
//  · loadClusterPool: 최근 저장분(보도 72h + 묶음 창 36h)을 묶음 기억에 넣는다 → 새 후보가 같은 사건이면
//    DeepSeek 관문을 건너뛰고 대표의 tier·분류를 상속한다(읽기만).
//  · backfillClusters: 묶음 SQL 3(cluster_id·cluster_size) 있을 때만, 최근 30일 publish 기사를 다시 묶어
//    바뀐 행의 cluster_id·cluster_size 두 열만 고친다(다른 열 0 · 지우기 0).
// ============================================================
import { ClusterPool, clusterDocs, docTs, leadOf, paraOf } from './event_cluster';
import type { SchemaFlags } from './schema_probe';

export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

export interface PoolData {
  tier: 'publish' | 'archive' | 'reject';
  category: string;
  /** 거부 사유(대표가 거부일 때) */
  reason?: string | null;
  /** 저장된 기사면 id */
  articleId?: number | null;
}

export const POOL_HOURS = 72 + 36;
export const BACKFILL_DAYS = 30;

function baseCond(flags: Pick<SchemaFlags, 'deletedAt'>): string {
  const parts = [`blocked = false`, `(source_type IS NULL OR source_type <> 'broadcast')`];
  if (flags.deletedAt) parts.push('deleted_at IS NULL');
  return parts.join(' AND ');
}

export interface ClusterTextOpts {
  fieldStopwords: string[];
  ignoreLeads: string[];
}

export async function loadClusterPool(
  query: QueryFn,
  flags: Pick<SchemaFlags, 'deletedAt' | 'tier' | 'publishedTs'>,
  text: ClusterTextOpts,
  now = Date.now(),
): Promise<ClusterPool<PoolData>> {
  const pool = new ClusterPool<PoolData>({ fieldStopwords: text.fieldStopwords, ignoreLeads: text.ignoreLeads });
  const since = new Date(now - POOL_HOURS * 3600 * 1000);
  const rows = await query(
    `SELECT id, title, original_title, summary, published_at, category,
            ${flags.publishedTs ? 'published_ts' : 'NULL AS published_ts'},
            ${flags.tier ? 'tier' : `'publish' AS tier`}
       FROM articles
      WHERE ${baseCond(flags)} AND created_at >= $1
        ${flags.tier ? `AND tier IN ('publish', 'archive')` : ''}
      ORDER BY id ASC LIMIT 2000`,
    [since],
  );
  for (const r of rows) {
    const ts = docTs(r.published_ts, r.published_at);
    if (!Number.isFinite(ts)) continue;
    pool.add(
      { id: Number(r.id), title: r.title, altTitle: r.original_title, lead: leadOf(r.summary), para: paraOf(r.summary), ts, grade: null },
      { tier: r.tier === 'archive' ? 'archive' : 'publish', category: r.category, articleId: Number(r.id) },
    );
  }
  return pool;
}

export interface BackfillClusterResult {
  rows: number;
  clusters: number;
  updated: number;
}

/** 최근 30일 publish 기사 다시 묶기 → cluster_id·cluster_size 가 달라진 행만 고친다. */
export async function backfillClusters(
  query: QueryFn,
  flags: Pick<SchemaFlags, 'deletedAt' | 'tier' | 'publishedTs' | 'sourceGrade' | 'cluster'>,
  text: ClusterTextOpts,
  days = BACKFILL_DAYS,
  now = Date.now(),
): Promise<BackfillClusterResult | null> {
  if (!flags.cluster) return null;
  const since = new Date(now - days * 24 * 3600 * 1000);
  const ymd = since.toISOString().slice(0, 10);
  const timeCond = flags.publishedTs
    ? `(published_ts >= $1 OR (published_ts IS NULL AND published_at::text >= $2))`
    : `published_at::text >= $2`;
  const rows = await query(
    `SELECT id, title, original_title, summary, teaser, published_at, cluster_id, cluster_size,
            ${flags.publishedTs ? 'published_ts' : 'NULL AS published_ts'},
            ${flags.sourceGrade ? 'source_grade' : 'NULL AS source_grade'}
       FROM articles
      WHERE ${baseCond(flags)} ${flags.tier ? `AND tier = 'publish'` : ''} AND ${timeCond}
      ORDER BY id ASC LIMIT 5000`,
    [since, ymd],
  );
  const docs = rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    altTitle: r.original_title,
    lead: leadOf(r.summary || r.teaser),
    para: paraOf(r.summary || r.teaser),
    ts: docTs(r.published_ts, r.published_at),
    grade: r.source_grade ?? null,
  }));
  const index = clusterDocs(docs, text);
  const ids: number[] = [];
  const cids: string[] = [];
  const sizes: number[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const info = index.get(Number(r.id));
    if (!info) continue;
    if (info.size > 1) seen.add(info.clusterId);
    const cid = info.size > 1 ? info.clusterId : String(r.id);
    if (String(r.cluster_id ?? '') === cid && Number(r.cluster_size ?? 0) === info.size) continue;
    ids.push(Number(r.id));
    cids.push(cid);
    sizes.push(info.size);
  }
  let updated = 0;
  for (let i = 0; i < ids.length; i += 500) {
    await query(
      `UPDATE articles AS a SET cluster_id = v.cid, cluster_size = v.sz
         FROM unnest($1::int[], $2::text[], $3::int[]) AS v(id, cid, sz)
        WHERE a.id = v.id`,
      [ids.slice(i, i + 500), cids.slice(i, i + 500), sizes.slice(i, i + 500)],
    );
    updated += Math.min(500, ids.length - i);
  }
  return { rows: rows.length, clusters: seen.size, updated };
}

/** 절감 비율(%): 관문을 건너뛴 기사 / (건너뛴 기사 + DeepSeek 로 판정한 기사). */
export function savedPct(skipped: number, judged: number): number {
  const d = skipped + judged;
  return d > 0 ? Math.round((skipped / d) * 1000) / 10 : 0;
}
