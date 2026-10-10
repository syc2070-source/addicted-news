// NEWS-Q1 ■1 — cleanup fail-closed: 판정 실패·휴리스틱·열 없음은 삭제 0, AI 판정만 soft 삭제.
import { runCleanup, Row, JudgeFn } from './judge_cleanup';
import { cleanupMode, hardDeleteEnabled, isCandidate, isDeletionBasis } from './cleanup_policy';
import type { QueryFn } from './schema_probe';

function row(id: number, title = `기사 ${id}`): Row {
  return { id, title, summary: null, category: '도박중독', source: 'x', published_at: '2026-10-01', created_at: null };
}

/** 가짜 DB: 모든 SQL 을 기록하고, 열 존재·대상·쓰기에 응답한다. */
function fakeDb(opts: { deletedAt: boolean; rows: Row[] }) {
  const sql: string[] = [];
  const query: QueryFn = async (text, params) => {
    sql.push(text);
    if (text.includes('information_schema.columns')) {
      return params?.[1] === 'deleted_at' && opts.deletedAt ? [{ '?column?': 1 }] : [];
    }
    if (/^\s*SELECT id, title/.test(text)) return opts.rows as unknown as Array<Record<string, unknown>>;
    if (/^\s*(UPDATE|DELETE)/.test(text)) {
      const ids = (params?.[0] as number[]) ?? [];
      return ids.map((id) => ({ id }));
    }
    return [];
  };
  const writes = () => sql.filter((s) => /^\s*(UPDATE|DELETE)/.test(s));
  return { query, sql, writes };
}

const quiet = () => undefined;

describe('cleanup fail-closed (runCleanup)', () => {
  it('AI 판정 실패·시간초과·빈 응답 → 건너뜀, 삭제 0', async () => {
    const db = fakeDb({ deletedAt: true, rows: [row(1), row(2)] });
    const judge: JudgeFn = async () => ({ via: 'failed' });
    const r = await runCleanup({ query: db.query, judge, apply: true, hardDelete: false, log: quiet });
    expect(r.failedSkips).toBe(2);
    expect(r.candidates).toHaveLength(0);
    expect(db.writes()).toEqual([]);
    expect(r.softDeleted + r.hardDeleted).toBe(0);
  });

  it('휴리스틱(키워드)만 → 후보 표시만, 삭제 0', async () => {
    const db = fakeDb({ deletedAt: true, rows: [row(3)] });
    const judge: JudgeFn = async () => ({ isIncident: true, via: 'keyword' });
    const r = await runCleanup({ query: db.query, judge, apply: true, hardDelete: false, log: quiet });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ basis: 'heuristic', deletable: false, reason: 'incident' });
    expect(db.writes()).toEqual([]);
  });

  it('AI 「삭제」 판정 → deleted_at 만 찍음(DELETE 없음)', async () => {
    const db = fakeDb({ deletedAt: true, rows: [row(4), row(5)] });
    const judge: JudgeFn = async (r) =>
      r.id === 4 ? { categoryFit: false, isIncident: false, via: 'deepseek' } : { categoryFit: true, isIncident: false, via: 'deepseek' };
    const r = await runCleanup({ query: db.query, judge, apply: true, hardDelete: false, log: quiet });
    expect(r.mode).toBe('soft_delete');
    expect(r.softDeleted).toBe(1);
    expect(db.writes()).toHaveLength(1);
    expect(db.writes()[0]).toMatch(/UPDATE articles SET deleted_at = now\(\)/);
    expect(db.sql.some((s) => /DELETE FROM/.test(s))).toBe(false);
  });

  it('deleted_at 열 없음 → 후보 목록만, 삭제 0 (--apply 라도)', async () => {
    const db = fakeDb({ deletedAt: false, rows: [row(6)] });
    const judge: JudgeFn = async () => ({ isIncident: true, via: 'deepseek' });
    const lines: string[] = [];
    const r = await runCleanup({ query: db.query, judge, apply: true, hardDelete: false, log: (l) => lines.push(l) });
    expect(r.mode).toBe('candidates_only');
    expect(r.candidates).toHaveLength(1);
    expect(db.writes()).toEqual([]);
    // 후보 목록은 로그에 남는다(id·제목·사유·AI/휴리스틱)
    expect(lines.some((l) => /\[cleanup-candidate\] id=6 basis=ai reason=incident/.test(l))).toBe(true);
    // 열이 없으면 대상 SQL 에 deleted_at 을 쓰지 않는다
    expect(db.sql.find((s) => /SELECT id, title/.test(s))).not.toMatch(/deleted_at/);
  });

  it('--apply 없음(DRY RUN) → 삭제 0 · 열이 있으면 이미 숨긴 기사는 대상 제외', async () => {
    const db = fakeDb({ deletedAt: true, rows: [row(7)] });
    const judge: JudgeFn = async () => ({ isIncident: true, via: 'deepseek' });
    const r = await runCleanup({ query: db.query, judge, apply: false, hardDelete: false, log: quiet });
    expect(r.mode).toBe('candidates_only');
    expect(db.writes()).toEqual([]);
    expect(db.sql.find((s) => /SELECT id, title/.test(s))).toMatch(/AND deleted_at IS NULL/);
  });

  it('하드 삭제는 CLEANUP_HARD_DELETE=1 일 때만 (기본 꺼짐)', async () => {
    expect(hardDeleteEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(hardDeleteEnabled({ CLEANUP_HARD_DELETE: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(hardDeleteEnabled({ CLEANUP_HARD_DELETE: '1' } as NodeJS.ProcessEnv)).toBe(true);
    const db = fakeDb({ deletedAt: false, rows: [row(8)] });
    const judge: JudgeFn = async () => ({ isIncident: true, via: 'deepseek' });
    const r = await runCleanup({ query: db.query, judge, apply: true, hardDelete: true, log: quiet });
    expect(r.hardDeleted).toBe(1);
    expect(db.writes()[0]).toMatch(/^DELETE FROM articles/);
  });
});

describe('cleanup_policy', () => {
  it('삭제 근거 = DeepSeek 실제 판정뿐', () => {
    expect(isDeletionBasis({ isIncident: true, via: 'deepseek' })).toBe(true);
    expect(isDeletionBasis({ isIncident: true, via: 'keyword' })).toBe(false);
    expect(isDeletionBasis({ isIncident: true, via: 'failed' })).toBe(false);
    expect(isCandidate({ isIncident: true, via: 'keyword' })).toBe(true);
    expect(isCandidate({ isIncident: true, via: 'failed' })).toBe(false);
  });
  it('모드 표', () => {
    expect(cleanupMode({ apply: false, deletedAtAvailable: true, hardDelete: true })).toBe('candidates_only');
    expect(cleanupMode({ apply: true, deletedAtAvailable: false, hardDelete: false })).toBe('candidates_only');
    expect(cleanupMode({ apply: true, deletedAtAvailable: true, hardDelete: false })).toBe('soft_delete');
    expect(cleanupMode({ apply: true, deletedAtAvailable: false, hardDelete: true })).toBe('hard_delete');
  });
});
