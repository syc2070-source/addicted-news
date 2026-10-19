// ============================================================
// cleanup_runs.ts (NEWS-Q9 ■3) — 정리 cron(judge_cleanup) 결과 한 줄을 crawl_runs 에 남기고 health 로 읽는다.
// 스키마 변경 0: crawl_runs 한 행 = read_only true + per_source jsonb 표식 { __kind: 'cleanup', __cleanup: {...} }.
// 수집기 쪽 읽기(마지막 실행 · 순환 · 되짚기 · 실패 피드)는 모두 read_only = false 만 보므로 이 행을 보지 않는다.
// deepseek_calls 열은 0 으로 둔다 — 같은 날 12:00 수집기의 하루 상한(deepseek_budget)을 정리 몫이 먹지 않게(전과 같음).
// ============================================================
import type { CleanupMode } from './cleanup_policy';
import { redactPublicText } from './public_redact';
import { QueryFn, tableExists } from './schema_probe';

export const CLEANUP_KIND = 'cleanup';

export interface CleanupRunPublic {
  kind: 'cleanup';
  startedAt: string;
  finishedAt: string | null;
  durationSec: number | null;
  /** candidates_only · soft_delete · hard_delete (null = 시작 전 실패) */
  mode: CleanupMode | null;
  /** 재심사 창(최근 N일) */
  days: number;
  /** 대상(재심사한 기사 수) */
  reviewed: number;
  /** 삭제 후보(incident · category_fit=false) */
  candidates: number;
  /** 후보 중 삭제 근거(AI 판정) 있는 것 */
  deletable: number;
  softDeleted: number;
  hardDeleted: number;
  /** fail-closed 분기: 판정 실패 건너뜀 · 근거 없어 후보만 · 열 없음(후보 목록만 모드) */
  failClosed: { judgeFailed: number; notDeletable: number; candidatesOnly: boolean };
  /** 판정 길: deepseek(열쇠 있음) · keyword(열쇠 없음 = 후보 표시만) */
  judgedBy: 'deepseek' | 'keyword';
  /** 실패 한 줄(접속 문자열·열쇠 지움 · 200자) · 없으면 null */
  error: string | null;
}

/** runCleanup 결과(또는 실패) → 한 줄. */
export function cleanupRunOf(o: {
  startedAt: Date;
  finishedAt: Date;
  days: number;
  judgedBy: 'deepseek' | 'keyword';
  result: {
    mode: CleanupMode;
    reviewed: number;
    failedSkips: number;
    candidates: Array<{ deletable: boolean }>;
    softDeleted: number;
    hardDeleted: number;
  } | null;
  error?: unknown;
}): CleanupRunPublic {
  const r = o.result;
  const deletable = r ? r.candidates.filter((c) => c.deletable).length : 0;
  return {
    kind: CLEANUP_KIND,
    startedAt: o.startedAt.toISOString(),
    finishedAt: o.finishedAt.toISOString(),
    durationSec: Math.round((o.finishedAt.getTime() - o.startedAt.getTime()) / 1000),
    mode: r ? r.mode : null,
    days: o.days,
    reviewed: r ? r.reviewed : 0,
    candidates: r ? r.candidates.length : 0,
    deletable,
    softDeleted: r ? r.softDeleted : 0,
    hardDeleted: r ? r.hardDeleted : 0,
    failClosed: {
      judgeFailed: r ? r.failedSkips : 0,
      notDeletable: r ? r.candidates.length - deletable : 0,
      candidatesOnly: r ? r.mode === 'candidates_only' : false,
    },
    judgedBy: o.judgedBy,
    error: o.error == null ? null : safeError(o.error),
  };
}

/** 실패 글에서 접속 문자열·열쇠 꼴·호스트·사용자·경로를 지운다(health 는 공개 · NEWS-Q10 ■1 redactPublicText 하나로). */
export function safeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return redactPublicText(msg).slice(0, 200);
}

/** crawl_runs 한 행(표 없으면 false · 쓰기 실패는 던짐 — 부르는 쪽이 로그만 남긴다). */
export async function recordCleanupRun(query: QueryFn, field: string, run: CleanupRunPublic): Promise<boolean> {
  if (!(await tableExists(query, 'crawl_runs'))) return false;
  await query(
    `INSERT INTO crawl_runs (field, started_at, finished_at, read_only, per_source) VALUES ($1, $2, $3, true, $4::jsonb)`,
    [field, run.startedAt, run.finishedAt, JSON.stringify({ __kind: CLEANUP_KIND, __cleanup: run })],
  );
  return true;
}

/** 최근 정리 실행 n 개(최신 먼저). 표가 없거나 실패면 []. */
export async function recentCleanupRuns(query: QueryFn, n: number): Promise<CleanupRunPublic[]> {
  try {
    const rows = await query(
      `SELECT per_source->'__cleanup' AS run FROM crawl_runs
        WHERE per_source->>'__kind' = $1 ORDER BY started_at DESC LIMIT $2`,
      [CLEANUP_KIND, Math.max(1, Math.min(20, Math.floor(n) || 5))],
    );
    const out: CleanupRunPublic[] = [];
    for (const r of rows) {
      const v: unknown = typeof r.run === 'string' ? JSON.parse(r.run) : r.run;
      if (v && typeof v === 'object') out.push(v as CleanupRunPublic);
    }
    return out;
  } catch {
    return [];
  }
}
