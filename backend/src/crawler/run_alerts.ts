// ============================================================
// run_alerts.ts (NEWS-Q5 ■1) — 실행 끝 경보 규칙(LLM 0 · 순수 함수).
// 수집이 상한에 걸리거나 방송·세계 저장이 0 이면 사람 없이도 알게 한다:
//   수집기 = 실행 끝에 계산 → crawl_runs.per_source.__run.alerts 에 저장 + Discord 한 줄(웹훅 없으면 로그).
//   /api/health = 마지막 실행의 저장된 경보(옛 실행은 행 숫자로 다시 계산 · 429 칸은 기록이 없어 건너뜀).
// ============================================================
import type { RunPublic } from './crawl_runs';

export interface RunAlert {
  code: AlertCode;
  value: number | string;
  limit?: number;
}

export type AlertCode =
  | 'slow_run'
  | 'timed_out'
  | 'broadcast_zero'
  | 'world_zero_2d'
  | 'url_resolve_fail'
  | 'deepseek_high'
  | 'saved_zero';

/** 소요 50분 이상 */
export const ALERT_SLOW_SEC = 50 * 60;
/** 구글 링크 해석 실패(대개 429) 10건 이상 */
export const ALERT_URL_FAIL = 10;
/** DeepSeek 하루 호출 380 이상(상한 400 의 95%) */
export const ALERT_DEEPSEEK_DAY = 380;

/** 경보 판단에 쓰는 실행 한 번의 숫자. */
export interface AlertFacts {
  startedAt: string;
  durationSec: number | null;
  timedOut: boolean;
  /** 순서·상한 기록이 있으면 '닿음/전체' */
  reachedOf: string | null;
  /** 방송을 돌린 실행인가(좁힌 실행은 false) */
  broadcastExpected: boolean;
  broadcastChannelsRead: number;
  worldSaved: number;
  /** NEWS-Q14 ■2: 세계신문 보관층 저장 수(없는 옛 사실 = 0) — 경보는 실림 + 보관이 0 일 때만 */
  worldArchived?: number;
  /** 구글 링크 해석 실패 수(옛 실행은 기록 없음 = null → 규칙 건너뜀) */
  urlResolveFail: number | null;
  deepseekCalls: number;
  saved: number;
}

/** KST 날짜(YYYY-MM-DD). */
export function kstDay(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** /api/health/runs 한 행 → 경보 숫자. */
export function alertFactsOf(r: RunPublic): AlertFacts {
  const p = r.progress;
  return {
    startedAt: r.startedAt,
    durationSec: r.durationSec,
    timedOut: r.timedOut,
    reachedOf: p ? `${p.reached}/${p.total - (p.blockedSkipped?.length || 0)}` : null,
    broadcastExpected: p?.broadcastFirst !== false,
    broadcastChannelsRead: r.sources.broadcastChannelsRead,
    worldSaved: r.sources.worldSaved,
    worldArchived: r.sources.worldArchived ?? 0,
    urlResolveFail: typeof p?.urlResolveFail === 'number' ? p.urlResolveFail : null,
    deepseekCalls: r.deepseekCalls,
    saved: r.saved,
  };
}

/**
 * 경보 규칙. runs = 최근 실행(새것 먼저 · [0] 이 판단 대상).
 * 「이틀 연속」은 [0] 과 그보다 앞 KST 날짜의 마지막 실행을 본다(하루 2회 cron 이어도 날짜 기준).
 * DeepSeek 는 [0] 과 같은 KST 날짜 실행의 합.
 */
export function evaluateRunAlerts(runs: AlertFacts[]): RunAlert[] {
  const cur = runs[0];
  if (!cur) return [];
  const day = kstDay(cur.startedAt);
  const out: RunAlert[] = [];
  if (cur.durationSec != null && cur.durationSec >= ALERT_SLOW_SEC) {
    out.push({ code: 'slow_run', value: cur.durationSec, limit: ALERT_SLOW_SEC });
  }
  if (cur.timedOut) out.push({ code: 'timed_out', value: cur.reachedOf ?? 1 });
  if (cur.broadcastExpected && cur.broadcastChannelsRead === 0) out.push({ code: 'broadcast_zero', value: 0 });
  const prevDay = runs.slice(1).find((r) => kstDay(r.startedAt) < day);
  // NEWS-Q14 ■2: 세계 「실림 + 보관」 이 이틀 0 일 때만(사건 보관 규칙으로 실림 0 · 보관 있음 = 수집은 됨 → 울리지 않음)
  const worldKept = (f: AlertFacts) => f.worldSaved + (f.worldArchived ?? 0);
  if (worldKept(cur) === 0 && prevDay && worldKept(prevDay) === 0) {
    out.push({ code: 'world_zero_2d', value: 0, limit: 2 });
  }
  if (cur.urlResolveFail != null && cur.urlResolveFail >= ALERT_URL_FAIL) {
    out.push({ code: 'url_resolve_fail', value: cur.urlResolveFail, limit: ALERT_URL_FAIL });
  }
  const dayCalls = runs.filter((r) => kstDay(r.startedAt) === day).reduce((n, r) => n + r.deepseekCalls, 0);
  if (dayCalls >= ALERT_DEEPSEEK_DAY) out.push({ code: 'deepseek_high', value: dayCalls, limit: ALERT_DEEPSEEK_DAY });
  if (cur.saved === 0) out.push({ code: 'saved_zero', value: 0 });
  return out;
}

const LABEL: Record<AlertCode, string> = {
  slow_run: '소요',
  timed_out: '전체 상한 걸림',
  broadcast_zero: '방송 읽힘 0',
  world_zero_2d: '세계신문 실림+보관 0 이틀 연속',
  url_resolve_fail: '구글 링크 해석 실패',
  deepseek_high: 'DeepSeek 하루',
  saved_zero: '저장 0',
};

function show(a: RunAlert): string {
  if (a.code === 'slow_run') return `${LABEL[a.code]} ${Math.floor(Number(a.value) / 60)}분(≥${(a.limit ?? 0) / 60})`;
  if (a.code === 'timed_out') return `${LABEL[a.code]}(${a.value})`;
  if (a.limit != null && a.code !== 'world_zero_2d') return `${LABEL[a.code]} ${a.value}(≥${a.limit})`;
  return LABEL[a.code];
}

/** Discord·로그 한 줄. 경보가 없으면 null. */
export function alertLine(prefix: string, alerts: RunAlert[]): string | null {
  if (!alerts.length) return null;
  return `🚨 ${prefix} 수집 경보 ${alerts.length}: ${alerts.map(show).join(' · ')}`;
}
