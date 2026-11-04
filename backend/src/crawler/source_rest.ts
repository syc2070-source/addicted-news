// ============================================================
// source_rest.ts (NEWS-Q24 ■1) — 소스 「쉼」(자동 규칙 · LLM 0 · DB 쓰기 0 · 제거 0).
//  · 잇달아 REST_AFTER(7) 회차 실패한 소스 = 쉼: 소스 목록에 그대로 있고, 실패 수에서 빠지고, 「쉬는 소스 n」으로 따로 센다.
//  · 쉬는 소스는 주 1회(KST 월요일 · 막힌 피드와 같은 날) 다시 해 본다 · 잇달아 RETURN_AFTER(2)번 성공하면 저절로 돌아온다.
//  · 상태 = 표 · 설정 없이 crawl_runs.per_source 시도 기록을 밟아 다시 만든다(schema 0 · 손 설정 0).
//  · 막힌 피드(blocked)는 제 규칙이 있어 빼고, 대체 피드(substituteFor)는 막힌 피드 몫이라 빼고, 방송 채널은 RSS 와 API 두 길이라 뺀다.
//  · 망 장애 거름: 한 회차에서 시도한 소스의 절반 이상이 실패하면(소스 탓이 아님) 그 회차는 세지 않는다.
// ============================================================
import { blockedRetryDue, RUN_KEY } from './crawl_schedule';

export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

export const REST_AFTER = 7;
export const RETURN_AFTER = 2;
export const REST_HISTORY_RUNS = 60;
/** 망 장애 거름을 켤 최소 시도 수(좁힌 실행 · 적은 소스에서 잘못 켜지지 않게) */
export const MASS_FAILURE_MIN = 10;
export const MASS_FAILURE_RATIO = 0.5;

/** 소스 id → 시도 결과(오래된 것 먼저 · true = 성공). */
export type RestLog = Record<string, boolean[]>;

type StatCell = { failed?: string | null } | null | undefined;

/** per_source 한 칸 → 시도 결과(시도가 아니면 null: 막힌 피드 재시도 · 503 단락기로 안 읽음). */
export function restAttemptOf(stat: StatCell): boolean | null {
  if (!stat || typeof stat !== 'object') return null;
  const failed = typeof stat.failed === 'string' ? stat.failed : '';
  if (failed.startsWith('blocked') || failed.startsWith('breaker:'))
    return null;
  // 'judge' = 피드는 읽었고 판정 단계에서 깨짐 — 소스는 살아 있음(쉼은 피드 건강만 본다)
  return !failed || failed === 'judge';
}

/** 회차들(오래된 것 먼저) → 소스별 시도. 절반 이상 실패한 회차 · 방송 채널 · __run 은 뺀다. */
export function restLogOf(perSources: unknown[]): RestLog {
  const log: RestLog = {};
  for (const raw of perSources) {
    const ps = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<
      string,
      StatCell
    > | null;
    if (!ps || typeof ps !== 'object') continue;
    const attempts: Array<[string, boolean]> = [];
    for (const [id, stat] of Object.entries(ps)) {
      if (id === RUN_KEY || id.startsWith('broadcast:')) continue;
      const a = restAttemptOf(stat);
      if (a !== null) attempts.push([id, a]);
    }
    const failed = attempts.filter(([, ok]) => !ok).length;
    if (
      attempts.length >= MASS_FAILURE_MIN &&
      failed / attempts.length >= MASS_FAILURE_RATIO
    )
      continue;
    for (const [id, ok] of attempts) (log[id] ||= []).push(ok);
  }
  return log;
}

/** 최근 회차의 시도 기록. 실패면 {}(아무도 쉬지 않음 = 옛 동작). */
export async function restLogFromRuns(
  query: QueryFn,
  field: string,
): Promise<RestLog> {
  try {
    const rows = (await query(
      `SELECT per_source FROM crawl_runs WHERE field = $1 AND read_only = false ORDER BY started_at DESC LIMIT ${REST_HISTORY_RUNS}`,
      [field],
    )) as Array<{ per_source: unknown }>;
    return restLogOf((rows || []).map((r) => r.per_source).reverse());
  } catch {
    return {};
  }
}

/** 시도를 차례로 밟아 지금 쉬는 중인가. 도는 중: 잇단 실패 REST_AFTER → 쉼 · 쉬는 중: 잇단 성공 RETURN_AFTER → 복귀(실패 하나면 셈 0). */
export function isResting(
  attempts: boolean[],
  restAfter = REST_AFTER,
  returnAfter = RETURN_AFTER,
): boolean {
  let resting = false;
  let failRun = 0;
  let okRun = 0;
  for (const ok of attempts) {
    if (!resting) {
      failRun = ok ? 0 : failRun + 1;
      if (failRun >= restAfter) {
        resting = true;
        okRun = 0;
      }
    } else {
      okRun = ok ? okRun + 1 : 0;
      if (okRun >= returnAfter) {
        resting = false;
        failRun = 0;
      }
    }
  }
  return resting;
}

export interface RestPlan {
  /** 오늘 건너뛰는 쉬는 소스 */
  skipped: Set<string>;
  /** 오늘 다시 해 보는 쉬는 소스(주 1회) */
  retrying: Set<string>;
}

/** 오늘의 쉼 계획. 막힌 피드는 제 규칙이 있고, 대체 피드는 막힌 피드 몫을 읽어 그 자리가 비면 안 되므로 뺀다. */
export function planRest(
  sources: Array<{ id: string; blocked?: unknown; substituteFor?: unknown }>,
  log: RestLog,
  now = Date.now(),
): RestPlan {
  const skipped = new Set<string>();
  const retrying = new Set<string>();
  const due = blockedRetryDue({ retry: 'weekly' }, now);
  for (const s of sources) {
    if (s.blocked || s.substituteFor || !isResting(log[s.id] || [])) continue;
    (due ? retrying : skipped).add(s.id);
  }
  return { skipped, retrying };
}
