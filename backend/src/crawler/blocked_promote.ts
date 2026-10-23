// ============================================================
// blocked_promote.ts (NEWS-Q13 ■6) — 막힌 피드 되살리기(설정값 자동 규칙 · LLM 0).
// 막힌 피드(blocked)의 주·월 재시도가 promote_after(기본 2)번 잇달아 성공하면 원 피드를 날마다 도는 주 피드로 올리고,
// 대체 피드(blocked.substitute)는 「원 피드가 이번 실행에서 실패한 날만」 판정하는 예비로 남긴다(끄지 않음).
// 재시도 기록 = 설정 blocked.retry_log(기록으로 남은 날) + crawl_runs per_source.__run.blockedRetried(실행이 남긴 것).
// 주 피드로 오른 뒤 원 피드가 demote_after(기본 3)번 잇달아 실패하면 옛 규칙(주·월 1회 재시도)으로 돌아간다.
// ============================================================

export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

export const PROMOTE_AFTER = 2;
export const DEMOTE_AFTER = 3;

export interface Attempt {
  /** KST 날짜 YYYY-MM-DD */
  date: string;
  ok: boolean;
  /** retry = 막힌 피드 재시도 · primary = 주 피드로 오른 뒤 날마다 */
  kind: 'retry' | 'primary';
}

export type AttemptLog = Record<string, Attempt[]>;

function kstDate(iso: string | Date): string {
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  return Number.isFinite(t)
    ? new Date(t + 9 * 3600000).toISOString().slice(0, 10)
    : '';
}

/** 최근 실행의 재시도·주 피드 기록(id → 시도들 · 오래된 것 먼저). 실패면 {}(옛 규칙 그대로). */
export async function attemptsFromRuns(
  query: QueryFn,
  field: string,
): Promise<AttemptLog> {
  try {
    const rows = (await query(
      `SELECT started_at, per_source->'__run'->'blockedRetried' AS r, per_source->'__run'->'blockedPrimary' AS p
         FROM crawl_runs WHERE field = $1 AND read_only = false ORDER BY started_at DESC LIMIT 60`,
      [field],
    )) as Array<{ started_at: unknown; r: unknown; p: unknown }>;
    const out: AttemptLog = {};
    for (const row of [...(rows || [])].reverse()) {
      const date = kstDate(
        row.started_at instanceof Date
          ? row.started_at
          : String(row.started_at),
      );
      if (!date) continue;
      for (const [col, kind] of [
        ['r', 'retry'],
        ['p', 'primary'],
      ] as const) {
        const cell = row[col];
        const raw: unknown = typeof cell === 'string' ? JSON.parse(cell) : cell;
        for (const a of Array.isArray(raw)
          ? (raw as Array<{ id?: unknown; ok?: unknown } | null>)
          : []) {
          if (!a || typeof a.id !== 'string') continue;
          (out[a.id] ||= []).push({ date, ok: a.ok === true, kind });
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 설정 retry_log + 실행 기록 → 날짜 차례(같은 날 같은 종류는 실행 기록이 앞섬 · 한 번만). */
export function mergeAttempts(
  logged: Array<{ date: string; ok: boolean }> | undefined,
  fromRuns: Attempt[] | undefined,
): Attempt[] {
  const byKey = new Map<string, Attempt>();
  for (const a of logged || []) {
    if (a && /^\d{4}-\d{2}-\d{2}$/.test(a.date))
      byKey.set(`${a.date}:retry`, {
        date: a.date,
        ok: a.ok === true,
        kind: 'retry',
      });
  }
  for (const a of fromRuns || []) byKey.set(`${a.date}:${a.kind}`, a);
  return [...byKey.values()].sort(
    (x, y) => x.date.localeCompare(y.date) || (x.kind === 'retry' ? -1 : 1),
  );
}

/**
 * 이 막힌 피드가 오늘 주 피드인가 — 시도를 날짜 차례로 밟는 상태 기계.
 * 막힘: 재시도 성공이 promote_after 번 잇달면 → 주 피드(실패 하나면 셈 0).
 * 주 피드: 날마다 시도가 demote_after 번 잇달아 실패하면 → 막힘(셈 0 부터 다시 · 강등 뒤 성공 하나로 다시 오르지 않음).
 * 기록 창(최근 실행 60)의 첫 시도가 primary 면 창 앞에서 이미 주 피드였던 것(오래된 재시도가 창 밖으로 빠져도 그대로).
 */
export function isPromoted(
  attempts: Attempt[],
  promoteAfter = PROMOTE_AFTER,
  demoteAfter = DEMOTE_AFTER,
): boolean {
  // primary 기록은 주 피드일 때만 생긴다 → 첫 primary 에서 주 피드로 시작(그 앞 재시도는 창 밖으로 빠졌을 수 있음 · 설정 retry_log 가 늘 앞에 붙음)
  const firstPrimary = attempts.findIndex((a) => a.kind === 'primary');
  let promoted = firstPrimary >= 0;
  let okRun = 0;
  let failRun = 0;
  for (const a of firstPrimary >= 0 ? attempts.slice(firstPrimary) : attempts) {
    if (!promoted) {
      if (a.kind !== 'retry') continue;
      okRun = a.ok ? okRun + 1 : 0;
      if (okRun >= promoteAfter) {
        promoted = true;
        failRun = 0;
      }
    } else {
      if (a.kind !== 'primary') continue;
      failRun = a.ok ? 0 : failRun + 1;
      if (failRun >= demoteAfter) {
        promoted = false;
        okRun = 0;
      }
    }
  }
  return promoted;
}

export interface PromotionPlan {
  /** 오늘 주 피드로 도는 막힌 피드 id */
  promoted: Set<string>;
  /** 대체 피드 id → 원 피드 id(원 피드가 이번 실행에서 실패한 날만 판정) */
  standby: Map<string, string>;
}

export function planPromotion(
  sources: Array<{
    id: string;
    blocked?: {
      substitute?: string;
      retry_log?: Array<{ date: string; ok: boolean }>;
      promote_after?: number;
    } | null;
  }>,
  log: AttemptLog,
): PromotionPlan {
  const promoted = new Set<string>();
  const standby = new Map<string, string>();
  for (const s of sources) {
    if (!s.blocked) continue;
    if (
      !isPromoted(
        mergeAttempts(s.blocked.retry_log, log[s.id]),
        s.blocked.promote_after ?? PROMOTE_AFTER,
      )
    )
      continue;
    promoted.add(s.id);
    if (s.blocked.substitute) standby.set(s.blocked.substitute, s.id);
  }
  return { promoted, standby };
}

/** 오늘 순서: 예비(대체) 피드는 원 피드 뒤로(차례대로 판정하므로 원 피드 결과를 보고 판정할지 정함). */
export function standbyLast<T extends { id: string }>(
  order: T[],
  standby: Map<string, string>,
): T[] {
  if (!standby.size) return order;
  return [
    ...order.filter((s) => !standby.has(s.id)),
    ...order.filter((s) => standby.has(s.id)),
  ];
}
