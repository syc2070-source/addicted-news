// ============================================================
// tier.ts (NEWS-Q2 ■6) — 관문 두 층.
//  publish = 지금 기준(분야 설정 gate.publish: fit·비사건·확신도)
//  archive = 관련은 있으나 확신 낮음 · 사건·사고 · 분류 불일치 중 분야 핵심어 있음(설정 gate.* = 'archive' 일 때)
//  reject  = 무관 · 판정 없음(DeepSeek 실패 → fail-closed) → rejected_articles(지금처럼)
// tier 열(묶음 SQL 2)이 없으면 크롤러는 archive 를 reject 로 낮춘다(옛 동작 = publish 만 저장).
// ============================================================
import type { Judgment } from './judge_article';
import type { FieldProfile } from './field_profile';

export type Tier = 'publish' | 'archive' | 'reject';

export interface TierDecision {
  tier: Tier;
  /** reject·archive 사유(rejected_articles.reject_reason 꼴과 같은 낱말) */
  reason: string | null;
}

export function decideTier(
  j: Judgment,
  opts: { keywordIncident: boolean; hasKeyword: boolean; gate: FieldProfile['gate'] },
): TierDecision {
  const g = opts.gate;
  const complete = j.categoryFit !== undefined && j.isIncident !== undefined && j.confidence !== undefined;
  if (!complete) return { tier: 'reject', reason: 'judgment_missing' };
  const archiveIf = (rule: string, reason: string): TierDecision =>
    rule === 'archive' && opts.hasKeyword ? { tier: 'archive', reason } : { tier: 'reject', reason };

  if (opts.keywordIncident) return archiveIf(g.incident, 'keyword_incident');
  if (j.isIncident === true) return archiveIf(g.incident, 'is_incident');

  const p = g.publish;
  if (j.categoryFit === p.category_fit && j.isIncident === p.is_incident && j.confidence === p.confidence) {
    return { tier: 'publish', reason: null };
  }
  if (j.categoryFit === true) return archiveIf(g.low_confidence, `low_confidence:${j.confidence}`);
  // category_fit=false: 확신도 high 면 무관(reject). 애매하면 분류 불일치 → 핵심어 있을 때 보관.
  if (j.confidence !== 'high') return archiveIf(g.category_mismatch_with_keyword, 'category_fit_false');
  return { tier: 'reject', reason: 'category_fit_false' };
}

/** tier 열이 없을 때(옛 동작): archive 는 저장하지 않고 거부로. */
export function effectiveTier(d: TierDecision, tierColumn: boolean): TierDecision {
  if (d.tier === 'archive' && !tierColumn) return { tier: 'reject', reason: d.reason };
  return d;
}
