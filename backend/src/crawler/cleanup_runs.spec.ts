import { AppController } from '../app.controller';
import { AppService } from '../app.service';
import { cleanupRunOf, recentCleanupRuns, recordCleanupRun, safeError } from './cleanup_runs';

// NEWS-Q9 ■3: 정리 cron 결과 한 줄(crawl_runs · read_only true · per_source.__kind=cleanup) → health lastCleanup · runs?kind=cleanup
const T0 = new Date('2026-10-24T18:00:05Z');
const T1 = new Date('2026-10-24T18:07:35Z');

describe('cleanup_runs — 정리 cron 결과 한 줄(NEWS-Q9 ■3)', () => {
  it('runCleanup 결과 → 실행 시각 · 대상 · soft 삭제 · 후보 · fail-closed 분기 · 오류 null', () => {
    const run = cleanupRunOf({
      startedAt: T0, finishedAt: T1, days: 14, judgedBy: 'deepseek',
      result: {
        mode: 'soft_delete', reviewed: 412, failedSkips: 3, softDeleted: 4, hardDeleted: 0,
        candidates: [{ deletable: true }, { deletable: true }, { deletable: true }, { deletable: true }, { deletable: false }],
      },
    });
    expect(run).toEqual({
      kind: 'cleanup', startedAt: T0.toISOString(), finishedAt: T1.toISOString(), durationSec: 450,
      mode: 'soft_delete', days: 14, reviewed: 412, candidates: 5, deletable: 4, softDeleted: 4, hardDeleted: 0,
      failClosed: { judgeFailed: 3, notDeletable: 1, candidatesOnly: false },
      judgedBy: 'deepseek', error: null,
    });
  });

  it('실패해도 한 줄(mode null · 수 0 · 오류 글에서 접속 문자열·열쇠 지움)', () => {
    const run = cleanupRunOf({
      startedAt: T0, finishedAt: T1, days: 14, judgedBy: 'keyword', result: null,
      error: new Error('connect failed postgres://user:pw@db.example:5432/x password=hunter2'),
    });
    expect(run).toMatchObject({ mode: null, reviewed: 0, candidates: 0, softDeleted: 0, failClosed: { judgeFailed: 0, notDeletable: 0, candidatesOnly: false } });
    expect(run.error).toBe('connect failed <url> password=<hidden>');
    expect(safeError('x'.repeat(500))).toHaveLength(200);
  });

  it('기록: crawl_runs 있을 때만 · read_only true(수집기 읽기에서 빠짐) · deepseek_calls 열 안 씀 · 표식 kind=cleanup', async () => {
    const run = cleanupRunOf({ startedAt: T0, finishedAt: T1, days: 14, judgedBy: 'deepseek', result: null });
    const none = jest.fn(async () => []);
    expect(await recordCleanupRun(none, 'addiction', run)).toBe(false);
    expect(none).toHaveBeenCalledTimes(1); // 표 확인만 · INSERT 0

    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const q = jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return sql.includes('information_schema.tables') ? [{ x: 1 }] : [];
    });
    expect(await recordCleanupRun(q, 'addiction', run)).toBe(true);
    const ins = calls.find((c) => c.sql.startsWith('INSERT'))!;
    expect(ins.sql).toContain('read_only, per_source) VALUES ($1, $2, $3, true, $4::jsonb)');
    expect(ins.sql).not.toContain('deepseek_calls');
    expect(JSON.parse(String(ins.params![3]))).toEqual({ __kind: 'cleanup', __cleanup: run });
  });

  it('읽기: 표식으로 거른 최신 n 개 · 문자열 jsonb 도 읽음 · 실패면 []', async () => {
    const run = cleanupRunOf({ startedAt: T0, finishedAt: T1, days: 14, judgedBy: 'deepseek', result: null });
    const q = jest.fn(async (sql: string, params?: unknown[]) => {
      expect(sql).toContain(`per_source->>'__kind' = $1`);
      expect(params).toEqual(['cleanup', 20]);
      return [{ run }, { run: JSON.stringify(run) }, { run: null }];
    });
    expect(await recentCleanupRuns(q, 99)).toEqual([run, run]);
    expect(await recentCleanupRuns(async () => { throw new Error('down'); }, 5)).toEqual([]);
  });

  it('health lastCleanup = 마지막 한 줄 · /api/health/runs?kind=cleanup = 정리 줄(수집 실행 목록과 따로) · 60초 기억', async () => {
    const run = cleanupRunOf({ startedAt: T0, finishedAt: T1, days: 14, judgedBy: 'deepseek', result: null });
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('information_schema.tables')) return [{ x: 1 }];
      if (sql.includes(`'__cleanup'`)) return [{ run }];
      return [];
    });
    const svc = new AppService({ isInitialized: true, query } as any);
    const ctl = new AppController(svc);
    expect(await ctl.getRuns('3', 'cleanup')).toEqual([run]);
    expect((await ctl.getHealth()).lastCleanup).toEqual(run);
    const n = query.mock.calls.filter(([sql]) => String(sql).includes(`'__cleanup'`)).length;
    await svc.recentCleanups(1);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes(`'__cleanup'`)).length).toBe(n); // 기억
    expect(await new AppController(new AppService()).getRuns('5', 'cleanup')).toEqual([]);
  });
});
