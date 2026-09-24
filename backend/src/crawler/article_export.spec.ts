import { exportArticleLines, parseExportArgs } from './article_export';

describe('article JSONL export (stub database, no .env/network)', () => {
  const since = '2026-09-24T01:00:00.000Z';
  function fixture(pages: any[][]) {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT CURRENT_TIMESTAMP')) return [{ cutoff: '2026-09-24T04:00:00Z' }];
      if (sql.includes('row_to_json')) return pages.shift() ?? [];
      return [];
    });
    const lines: string[] = [];
    return { db: { query }, lines, write: async (line: string) => { lines.push(line); } };
  }

  it('retains every column and paginates equal timestamps by id without dropping microseconds', async () => {
    const t = '2026-09-24 02:00:00.123456+00';
    const f = fixture([
      [{ article: { id: 4, updated_at: t, raw_body: '原文\nsecond line', future_column: 7, blocked: true }, cursor_updated_at: t }],
      [{ article: { id: 5, updated_at: t, summary: '요약' }, cursor_updated_at: t }],
      [],
    ]);
    const footer = await exportArticleLines(f.db, f.write, { since, pageSize: 1 });
    expect(JSON.parse(f.lines[0])).toEqual({ id: 4, updated_at: t, raw_body: '原文\nsecond line', future_column: 7, blocked: true });
    expect(JSON.parse(f.lines[1]).raw_body).toBeNull();
    expect(footer).toEqual({ stream: 'articles', notice: 'cursor', source: 'addicted_news', rows: 2, since, next_since: '2026-09-24T02:00:00.123Z' });
    const pageCalls = f.db.query.mock.calls.filter((c) => c[0].includes('row_to_json')) as unknown as Array<[string, unknown[]]>;
    expect(pageCalls[0][0]).toContain('a.updated_at >= $1');
    // A timestamp-without-time-zone column must use the DB session timezone,
    // not the desktop's timezone, when producing the resumable watermark.
    expect(pageCalls[0][0]).toContain('a.updated_at::timestamptz::text');
    expect(pageCalls[1][1].slice(2, 4)).toEqual([t, 4]);
    expect(pageCalls[2][1].slice(2, 4)).toEqual([t, 5]);
    expect(JSON.parse(f.lines.at(-1)!)).toEqual(footer);
  });

  it('emits a zero-row footer without advancing an empty export watermark', async () => {
    const f = fixture([[]]);
    expect(await exportArticleLines(f.db, f.write, { since })).toMatchObject({ rows: 0, since, next_since: since });
    expect(f.lines).toHaveLength(1);
    expect(f.db.query).toHaveBeenCalledWith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  });

  it('does not emit a success footer after a database failure', async () => {
    const f = fixture([]);
    f.db.query.mockImplementation(async (sql) => {
      if (sql.includes('row_to_json')) throw new Error('stub read failure');
      if (sql.startsWith('SELECT CURRENT_TIMESTAMP')) return [{ cutoff: '2026-09-24T04:00:00Z' }];
      return [];
    });
    await expect(exportArticleLines(f.db, f.write, { since })).rejects.toThrow('stub read failure');
    expect(f.lines).toEqual([]);
    expect(f.db.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('rolls back without a footer when an output write fails', async () => {
    const f = fixture([[{ article: { id: 1 }, cursor_updated_at: '2026-09-24 11:00:00.123456+09' }]]);
    const write = jest.fn(async (_line: string) => { throw new Error('stub disk full'); });
    await expect(exportArticleLines(f.db, write, { since })).rejects.toThrow('stub disk full');
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).not.toContain('"notice":"cursor"');
    expect(f.db.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('rejects a stalled keyset instead of creating an endless export', async () => {
    const row = { article: { id: 1 }, cursor_updated_at: '2026-09-24T02:00:00Z' };
    const f = fixture([[row], [row]]);
    await expect(exportArticleLines(f.db, f.write, { pageSize: 1 })).rejects.toThrow('did not advance');
    expect(f.lines.some((line) => line.includes('"notice":"cursor"'))).toBe(false);
  });

  it('validates CLI arguments before any connection or output', () => {
    expect(parseExportArgs(['--out', 'inbox'])).toEqual({ out: 'inbox', since: null });
    expect(parseExportArgs(['--since', '2026-09-24T10:00:00+09:00', '--out', 'inbox']).since).toBe(since);
    expect(() => parseExportArgs(['--since', '2026-09-24', '--out', 'inbox'])).toThrow('ISO');
    expect(() => parseExportArgs(['--out'])).toThrow('Usage');
    expect(() => parseExportArgs(['--out', 'a', '--out', 'b'])).toThrow('Usage');
  });
});
