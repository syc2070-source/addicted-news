export interface ExportSql {
  query(sql: string, parameters?: unknown[]): Promise<any[]>;
}

export interface ArticleExportFooter {
  stream: 'articles';
  notice: 'cursor';
  source: 'addicted_news';
  rows: number;
  since: string | null;
  next_since: string | null;
}

export function normalizeSince(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error('--since must be an ISO timestamp with a timezone');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('--since is not a valid timestamp');
  return date.toISOString();
}

export function parseExportArgs(args: string[]): { since: string | null; out: string } {
  let since: string | null = null;
  let out = '';
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--since', '--out'].includes(key) || seen.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: export:articles -- --since <ISO> --out <folder> (since optional for first export)');
    }
    seen.add(key);
    const value = args[++i];
    if (key === '--since') since = normalizeSince(value);
    else out = value;
  }
  if (!out.trim()) throw new Error('--out is required');
  return { since, out };
}

/** Read-only snapshot. All DB columns stay snake_case; the migration-pending body is NULL.
 * Inclusive since deliberately resends boundary rows. Consumers upsert by source row id.
 * The paging cursor retains PostgreSQL microseconds; only the resumable ISO watermark
 * is rounded down to JS milliseconds, so a boundary can be repeated but not skipped.
 */
export async function exportArticleLines(
  db: ExportSql,
  writeLine: (line: string) => Promise<void>,
  options: { since?: string | null; pageSize?: number },
): Promise<ArticleExportFooter> {
  const since = options.since ? normalizeSince(options.since) : null;
  const pageSize = options.pageSize ?? 500;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5000) throw new Error('Invalid export page size');
  let transaction = false;
  try {
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaction = true;
    const snapshot = await db.query('SELECT CURRENT_TIMESTAMP::text AS cutoff');
    const cutoff = new Date(snapshot[0]?.cutoff).toISOString();
    if (since && since > cutoff) throw new Error('--since is after the database snapshot');
    let cursorTime: string | null = null;
    let cursorId: number | null = null;
    let rows = 0;
    let nextSince = since;
    while (true) {
      const page = await db.query(
        `SELECT row_to_json(a) AS article, a.updated_at::timestamptz::text AS cursor_updated_at
         FROM public.articles a
         WHERE ($1::timestamptz IS NULL OR a.updated_at >= $1::timestamptz)
           AND a.updated_at <= $2::timestamptz
           AND ($3::timestamptz IS NULL OR (a.updated_at, a.id) > ($3::timestamptz, $4::integer))
         ORDER BY a.updated_at ASC, a.id ASC LIMIT $5`,
        [since, cutoff, cursorTime, cursorId, pageSize],
      );
      if (!page.length) break;
      for (const record of page) {
        const article = record.article;
        if (!article || typeof article !== 'object' || !Number.isSafeInteger(article.id)) {
          throw new Error('Article export row has no valid id');
        }
        const rowTime = String(record.cursor_updated_at ?? '');
        const date = new Date(rowTime);
        if (!rowTime || !Number.isFinite(date.getTime())) throw new Error('Article export row has no valid updated_at');
        if (cursorTime === rowTime && cursorId !== null && article.id <= cursorId) {
          throw new Error('Article export cursor did not advance');
        }
        await writeLine(JSON.stringify({ ...article, raw_body: article.raw_body ?? null }));
        cursorTime = rowTime;
        cursorId = article.id;
        nextSince = date.toISOString();
        rows++;
      }
      if (page.length < pageSize) break;
    }
    await db.query('COMMIT');
    transaction = false;
    const footer: ArticleExportFooter = {
      stream: 'articles', notice: 'cursor', source: 'addicted_news', rows, since, next_since: nextSince,
    };
    await writeLine(JSON.stringify(footer));
    return footer;
  } catch (error) {
    if (transaction) {
      try { await db.query('ROLLBACK'); } catch { /* Preserve the original failure; no footer. */ }
    }
    throw error;
  }
}
