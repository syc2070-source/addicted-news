// ============================================================
// cleanup_policy.ts (NEWS-Q1 ■1) — 정리 작업의 삭제 규칙(fail-closed).
//  · 삭제 근거는 DeepSeek 의 실제 판정뿐. 판정 실패·시간초과·빈 응답 → 건너뜀.
//  · 휴리스틱(키워드)은 "후보 표시"만 — 삭제 근거가 되지 않는다.
//  · 삭제는 soft(deleted_at) 만. deleted_at 열이 없으면 후보 목록만 남기고 삭제 0.
//  · 하드 삭제는 CLEANUP_HARD_DELETE=1 일 때만(기본 꺼짐, NEWS-Q1 에서 켜지 않음).
// ============================================================
import { shouldDelete, type Judgment } from './judge_article';

export type JudgeVia = 'deepseek' | 'keyword' | 'failed';
export type JudgedRow = Judgment & { via: JudgeVia };
export type CleanupMode = 'candidates_only' | 'soft_delete' | 'hard_delete';

export function hardDeleteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLEANUP_HARD_DELETE === '1';
}

export function cleanupMode(opts: { apply: boolean; deletedAtAvailable: boolean; hardDelete: boolean }): CleanupMode {
  if (!opts.apply) return 'candidates_only';
  if (opts.hardDelete) return 'hard_delete';
  return opts.deletedAtAvailable ? 'soft_delete' : 'candidates_only';
}

/** 후보 표시 여부(AI 든 휴리스틱이든). 판정 실패는 후보도 아님. */
export function isCandidate(j: JudgedRow): boolean {
  if (j.via === 'failed') return false;
  return shouldDelete(j);
}

/** 실제 삭제(soft/hard) 근거 = DeepSeek 실제 판정만. */
export function isDeletionBasis(j: JudgedRow): boolean {
  return j.via === 'deepseek' && shouldDelete(j);
}

export function candidateReason(j: Judgment): string {
  return j.isIncident === true ? 'incident' : 'category_fit=false';
}
