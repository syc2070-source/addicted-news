// ============================================================
// judge_article.ts (v5.4) — 판정 결과 공유 결정 로직(중복 구현 금지).
// 입구 게이트(crawler)와 안전망(judge_cleanup)이 같은 함수를 쓴다.
// DeepSeek 호출/파싱은 deepseek_summary 에 있고, 여기는 그 결과의 '결정'만 담당.
// ============================================================
import type { Confidence } from './deepseek_summary';

export type Judgment = {
  categoryFit?: boolean;
  isIncident?: boolean;
  confidence?: Confidence;
};

export function judgmentFromPack(p: {
  isIncident?: boolean;
  categoryFit?: boolean;
  confidence?: Confidence;
}): Judgment {
  return { categoryFit: p.categoryFit, isIncident: p.isIncident, confidence: p.confidence };
}

/**
 * 입구 게이트(정밀도 우선): DB 진입 허용 조건.
 * category_fit=true AND is_incident=false AND confidence=high 인 경우에만 진입.
 * (medium/low 확신도·미상 전부 거부)
 */
export function passesIngestionGate(j: Judgment): boolean {
  return j.categoryFit === true && j.isIncident === false && j.confidence === 'high';
}

/** 게이트 거부 사유(통과면 null). rejected_articles.reject_reason 에 기록. */
export function rejectReason(j: Judgment): string | null {
  if (passesIngestionGate(j)) return null;
  if (j.isIncident === true) return 'is_incident';
  if (j.categoryFit === false) return 'category_fit_false';
  if (j.categoryFit === undefined || j.isIncident === undefined) return 'judgment_missing';
  if (j.confidence !== 'high') return `low_confidence:${j.confidence ?? 'none'}`;
  return 'rejected';
}

/**
 * judge_cleanup(안전망): incident 이거나 category_fit=false 면 삭제.
 * 판정 미상은 fail-safe(삭제 안 함).
 */
export function shouldDelete(j: Judgment): boolean {
  return j.isIncident === true || j.categoryFit === false;
}
