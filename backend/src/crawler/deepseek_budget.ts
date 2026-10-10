// ============================================================
// deepseek_budget.ts (NEWS-Q2 ■2·■8) — 하루 DeepSeek 호출 상한 · 비용 추정.
// 상한 = env DEEPSEEK_DAILY_CAP ?? 분야 설정 gate.deepseek_daily_cap ?? 400 (API 요청 수, 재시도 포함).
// 오늘(KST) 이미 쓴 수는 crawl_runs 표(묶음 SQL 2)가 있을 때만 더한다 — 없으면 이번 실행만 센다.
// 단가: 기본 deepseek-v4-flash 공개 가격 $0.14/M 입력 · $0.28/M 출력(2026-10 3자 출처, 공식 표 미확인)
//   → env DEEPSEEK_PRICE_IN_PER_M / DEEPSEEK_PRICE_OUT_PER_M 로 바꿀 수 있다.
// ============================================================
export const DEFAULT_DAILY_CAP = 400;
/** 기사 하나가 쓰는 최소 호출(요약 1 + 판정 1). 이만큼 남아 있어야 새 기사를 시작한다. */
export const CALLS_PER_ARTICLE = 2;

export function dailyCap(env: NodeJS.ProcessEnv, profileCap?: number): number {
  const v = Number(env.DEEPSEEK_DAILY_CAP ?? profileCap ?? DEFAULT_DAILY_CAP);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DAILY_CAP;
}

export function priceOf(env: NodeJS.ProcessEnv): { inPerM: number; outPerM: number } {
  return {
    inPerM: Number(env.DEEPSEEK_PRICE_IN_PER_M ?? 0.14),
    outPerM: Number(env.DEEPSEEK_PRICE_OUT_PER_M ?? 0.28),
  };
}

export function estimateCostUsd(promptTokens: number, completionTokens: number, price: { inPerM: number; outPerM: number }): number {
  return Math.round(((promptTokens / 1e6) * price.inPerM + (completionTokens / 1e6) * price.outPerM) * 1e6) / 1e6;
}

export class DeepseekBudget {
  private logged = false;
  constructor(readonly cap: number, readonly usedBefore: number) {}

  /** 지금까지 이번 실행 호출 수(calls)로 새 기사를 시작할 수 있나. */
  canStart(callsThisRun: number): boolean {
    return this.usedBefore + callsThisRun + CALLS_PER_ARTICLE <= this.cap;
  }

  /** 상한 도달 로그는 한 번만. 처음이면 true. */
  markExhausted(): boolean {
    if (this.logged) return false;
    this.logged = true;
    return true;
  }

  get exhausted(): boolean {
    return this.logged;
  }
}

/** 오늘(KST) 이미 쓴 호출 수 — crawl_runs 가 없거나 읽기 실패면 0. */
export async function usedTodayFromRuns(query: (sql: string) => Promise<any[]>): Promise<number> {
  try {
    const rows = await query(
      `SELECT COALESCE(SUM(deepseek_calls), 0)::int AS n FROM crawl_runs
        WHERE (started_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date`,
    );
    return Number(rows?.[0]?.n || 0);
  } catch {
    return 0;
  }
}
