// ============================================================
// topic_exclude.ts (NEWS-Q18 ■2 · 오너 결정 10-26) — 관문 앞 주제 거름(규칙 · LLM 0).
// 「음주운전 기사는 분야 기사가 아님」: 제목 + 요약에 must(음주운전) ∧ context(단속·캠페인·사고 …) 가운데 하나가 있고
// except(치료 · 재활 · 의존 등 분야 낱말 · 분야 설정에 둠) 가 하나도 없으면 거부(사유 코드 = rule.id).
// 애매하면 통과(관문이 판정) — except 낱말이 하나라도 있으면 거르지 않는다.
// 이미 실린 기사: 다음 실행 시작에 같은 규칙으로 보관층으로(행 지움 0 · keep_ids = 되돌림 · 몇 번 돌아도 같음).
// 규칙 낱말은 분야 설정 gate.topic_exclude(코드 변경 없이 조정).
// ============================================================
import { QueryFn, returnedRows } from './broadcast_episode';

export interface TopicExcludeRule {
  /** 거부 사유 코드(rejected_articles.reject_reason) */
  id: string;
  /** 하나라도 있어야(예: 음주운전) */
  must: string[];
  /** must 와 함께 하나라도 있어야(예: 단속 · 캠페인 · 사고) */
  context: string[];
  /** 하나라도 있으면 거르지 않음(예: 치료 · 재활) */
  except: string[];
  /** 이미 실린 기사 보관에서 뺄 id · 이 규칙에 걸리는 보관 행이면 실림으로 되돌림(keep 이 앞섬) */
  keep_ids?: number[];
  /**
   * 리뷰(Q18): 쓸기는 이 시각 앞에 저장된 행만(관문 앞 거름이 생기기 전 · 한 번 메우기).
   * 그 뒤 행은 관문 앞 거름(제목 + 본문 앞부분)이 이미 봤으므로 요약 글로 다시 보지 않음(두 글이 달라 오락가락하지 않게).
   */
  sweep_created_before?: string;
}

function hasAny(text: string, words: string[]): string | null {
  for (const w of words) if (w && text.includes(w)) return w;
  return null;
}

/** 걸리면 규칙 id · 아니면 null. text = 제목 + 요약(본문 앞부분). */
export function topicExcludeHit(title: string, text: string, rules: TopicExcludeRule[] = []): string | null {
  const t = `${title || ''}\n${text || ''}`;
  for (const r of rules) {
    if (!r?.id || !r.must?.length) continue;
    if (!hasAny(t, r.must)) continue;
    if (r.context?.length && !hasAny(t, r.context)) continue;
    if (hasAny(t, r.except || [])) continue;
    return r.id;
  }
  return null;
}

export interface TopicExcludeSweep {
  checked: number;
  archived: Array<{ id: number; rule: string; title: string }>;
  restored: number[];
  error?: boolean;
}

/**
 * 이미 실린 기사(방송 아님 · 실림층 · 막힘 아님) 가운데 규칙에 걸리는 것 → 보관층(updated_at = 옮긴 때) · keep_ids 는 빼고,
 * keep_ids 가운데 이 규칙에 걸리는 보관 행은 실림으로 되돌림. 실패면 그때까지 한 것 + error.
 */
export async function sweepTopicExcluded(
  query: QueryFn,
  rules: TopicExcludeRule[] = [],
  cols: { deletedAt: boolean },
): Promise<TopicExcludeSweep> {
  const out: TopicExcludeSweep = { checked: 0, archived: [], restored: [] };
  const live = rules.filter((r) => r?.id && r.must?.length);
  if (!live.length) return out;
  const likes = [...new Set(live.flatMap((r) => r.must))].map((w) => `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const keep = new Set(live.flatMap((r) => r.keep_ids || []).filter((n) => Number.isInteger(n) && n > 0));
  try {
    const rows = (await query(
      `SELECT id, title, summary, COALESCE(tier, 'publish') AS tier, floor(extract(epoch FROM created_at::timestamptz) * 1000)::bigint AS created FROM articles
        WHERE (source_type IS NULL OR source_type <> 'broadcast') AND NOT blocked${cols.deletedAt ? ' AND deleted_at IS NULL' : ''}
          AND (title LIKE ANY($1::text[]) OR summary LIKE ANY($1::text[]))
        ORDER BY id`,
      [likes],
    )) as Array<{ id?: unknown; title?: unknown; summary?: unknown; tier?: unknown; created?: unknown }>;
    for (const r of rows || []) {
      out.checked++;
      const id = Number(r.id);
      if (!Number.isInteger(id)) continue;
      const title = typeof r.title === 'string' ? r.title : '';
      const created = Number(r.created);
      // 규칙마다 쓸기 마감(sweep_created_before) 앞 행만 · 마감 없거나 created 를 모르면 봄
      const inScope = live.filter((x) => {
        const cut = x.sweep_created_before ? Date.parse(x.sweep_created_before) : NaN;
        return !Number.isFinite(cut) || !Number.isFinite(created) || created < cut;
      });
      const hit = topicExcludeHit(title, typeof r.summary === 'string' ? r.summary : '', inScope);
      if (!hit) continue;
      if (keep.has(id)) {
        if (r.tier === 'archive') {
          const res = await query(
            `UPDATE articles SET tier = 'publish', updated_at = now() WHERE id = $1 AND tier = 'archive' RETURNING id`,
            [id],
          );
          if (returnedRows(res).length) out.restored.push(id);
        }
        continue;
      }
      if (r.tier !== 'publish') continue;
      const res = await query(
        `UPDATE articles SET tier = 'archive', updated_at = now()
          WHERE id = $1 AND COALESCE(tier, 'publish') = 'publish' AND (source_type IS NULL OR source_type <> 'broadcast') RETURNING id`,
        [id],
      );
      if (returnedRows(res).length) out.archived.push({ id, rule: hit, title: title.slice(0, 120) });
    }
  } catch {
    out.error = true;
  }
  return out;
}
