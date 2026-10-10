// ============================================================
// row_extras.ts (NEWS-Q2 ■5·■6·■7·■3) — 묶음 SQL 2 의 열(tier·published_ts·source_grade·url_resolve)을
// 새 행에 뒤이어 채운다. 엔티티에서는 insert:false 라 INSERT 에 섞이지 않고, 열이 선 것만 UPDATE 한다.
// archive 행인데 tier 기록이 실패하면 공개되지 않게 blocked=true 로 막는다(fail-closed).
// ============================================================
import type { SchemaFlags } from './schema_probe';
import type { Tier } from './tier';
import type { SourceGrade } from './field_profile';
import type { UrlResolveState } from './url_resolve';

export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

export interface RowExtras {
  tier: Tier;
  publishedTs: Date | null;
  sourceGrade: SourceGrade | null;
  urlResolve: UrlResolveState | null;
}

/** 열이 선 것만 SET 절로. 쓸 것이 없으면 null. */
export function buildExtrasUpdate(
  id: number,
  x: RowExtras,
  flags: Pick<SchemaFlags, 'tier' | 'publishedTs' | 'sourceGrade' | 'urlResolve'>,
): { sql: string; params: unknown[] } | null {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (col: string, v: unknown, cast = '') => {
    params.push(v);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (flags.tier && x.tier !== 'publish') add('tier', x.tier);
  if (flags.publishedTs && x.publishedTs) add('published_ts', x.publishedTs);
  if (flags.sourceGrade && x.sourceGrade) add('source_grade', x.sourceGrade);
  if (flags.urlResolve && x.urlResolve) add('url_resolve', JSON.stringify(x.urlResolve), '::jsonb');
  if (!sets.length) return null;
  return { sql: `UPDATE articles SET ${sets.join(', ')} WHERE id = $1`, params };
}

export async function writeRowExtras(
  query: QueryFn,
  id: number | null,
  x: RowExtras,
  flags: SchemaFlags,
  warn: (s: string) => void = console.warn,
  sourceUrl?: string,
): Promise<void> {
  if (id == null && sourceUrl) {
    const rows = await query(`SELECT id FROM articles WHERE source_url = $1 ORDER BY id DESC LIMIT 1`, [sourceUrl]).catch(() => []);
    id = rows?.[0]?.id != null ? Number(rows[0].id) : null;
  }
  if (id == null) {
    if (x.tier === 'archive') warn('[row-extras] 새 행 id 를 못 얻음 — archive 표시 불가');
    return;
  }
  const u = buildExtrasUpdate(id, x, flags);
  if (!u) return;
  try {
    await query(u.sql, u.params);
  } catch (e) {
    warn(`[row-extras] id=${id} 열 채우기 실패: ${(e as Error).message}`);
    if (x.tier === 'archive') {
      // 보관 행이 publish(기본값)로 공개되지 않게 막는다.
      await query(`UPDATE articles SET blocked = true, blocked_reason = 'tier_write_failed' WHERE id = $1`, [id]).catch(() => undefined);
    }
  }
}
