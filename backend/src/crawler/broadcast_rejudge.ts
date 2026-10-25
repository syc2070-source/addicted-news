// ============================================================
// broadcast_rejudge.ts (NEWS-Q16 ■2 · CTO 판정 Q15 ②) — 방송 관문 한 번 다시 판정(설정 sources.broadcast.rejudge_once).
// Q15 「언급」 보관 4 편(6224 국과수 독살 · 6211 검찰 개혁 · 6226 파출소 · 6227 응급구조사)을 no 예시를 더한 관문으로 다시 묻는다.
//  · 편당 DeepSeek 1번(관문 그대로) · yes = 보관 → 실림(updated_at = 층이 바뀐 때) · partial · no = 보관 그대로(지움 0 · 막음 0)
//  · 판정 없음(호출 실패)이 하나라도 있으면 done = false → 다음 실행이 다시(REJUDGE_MAX_TRIES 번까지)
//  · 결과 = progress.broadcastRejudge {id · done · try · results[{id · before · fit · subtopic · moved}]}
// ============================================================
import { QueryFn, returnedRows } from './broadcast_episode';
import { BroadcastVerdict, buildBroadcastGateUser, parseBroadcastVerdict } from './broadcast_gate';
import { parseBroadcastRawBody } from './broadcast_aired';

export const REJUDGE_MAX_TRIES = 3;

export interface RejudgeResult {
  id: number;
  /** 다시 묻기 전 층 */
  before: string;
  fit: 'yes' | 'partial' | 'no' | null;
  subtopic?: string;
  /** 실림으로 옮김 */
  moved: boolean;
}

export interface RejudgeRecord {
  id: string;
  done: boolean;
  try: number;
  results: RejudgeResult[];
  /** 방송 · 막힘 아님 행이 없어 묻지 못한 id */
  missing: number[];
}

/** runs 에 같은 id 로 done 인 실행이 있나 · 해 본 수. 실패면 done(다시 묻지 않음 = 덜 씀). */
export async function rejudgeStateFromRuns(query: QueryFn, field: string, id: string): Promise<{ done: boolean; tries: number }> {
  try {
    const rows = await query(
      `SELECT per_source->'__run'->'broadcastRejudge' AS r FROM crawl_runs
        WHERE field = $1 AND per_source->'__run'->'broadcastRejudge'->>'id' = $2`,
      [field, id],
    );
    let done = false;
    let tries = 0;
    for (const row of rows || []) {
      let r: { done?: unknown } | null = null;
      try {
        r = typeof row.r === 'string' ? JSON.parse(row.r) : row.r;
      } catch {
        r = null;
      }
      if (!r) continue;
      tries++;
      if (r.done === true) done = true;
    }
    return { done: done || tries >= REJUDGE_MAX_TRIES, tries };
  } catch {
    return { done: true, tries: 0 };
  }
}

export type AskFn = (system: string, user: string) => Promise<Record<string, unknown> | null>;

/** 설정 id 들을 한 번씩 다시 판정. ask 가 null 을 주면 그 편은 fit null(다음 실행이 다시). */
export async function rejudgeBroadcasts(
  query: QueryFn,
  rec: Pick<RejudgeRecord, 'id' | 'try'>,
  ids: number[],
  system: string,
  ask: AskFn,
  cols: { deletedAt: boolean; rawBody?: boolean },
): Promise<RejudgeRecord> {
  const out: RejudgeRecord = { id: rec.id, try: rec.try, done: false, results: [], missing: [] };
  const want = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!want.length) {
    out.done = true;
    return out;
  }
  let rows: Array<{ id?: unknown; title?: unknown; source?: unknown; raw_body?: unknown; tier?: unknown }> = [];
  try {
    rows = (await query(
      // raw_body 열이 없는 DB 면 설명 없이(제목만) 묻는다
      `SELECT id, title, source, ${cols.rawBody === false ? 'NULL AS raw_body' : 'raw_body'}, COALESCE(tier, 'publish') AS tier FROM articles
        WHERE id = ANY($1::int[]) AND source_type = 'broadcast' AND NOT blocked${cols.deletedAt ? ' AND deleted_at IS NULL' : ''}
        ORDER BY id`,
      [want],
    )) || [];
  } catch {
    return out;
  }
  const seen = new Set<number>();
  for (const r of rows) {
    const id = Number(r.id);
    if (!Number.isInteger(id)) continue;
    seen.add(id);
    const before = typeof r.tier === 'string' ? r.tier : 'publish';
    const title = typeof r.title === 'string' ? r.title : '';
    const { description } = parseBroadcastRawBody(typeof r.raw_body === 'string' ? r.raw_body : '');
    let verdict: BroadcastVerdict | null = null;
    try {
      verdict = parseBroadcastVerdict(await ask(system, buildBroadcastGateUser({ title, description }, String(r.source ?? ''))));
    } catch {
      verdict = null;
    }
    const res: RejudgeResult = { id, before, fit: verdict?.topic ?? null, moved: false };
    if (verdict) res.subtopic = verdict.subtopic;
    if (verdict?.topic === 'yes' && before === 'archive') {
      try {
        const moved = await query(
          `UPDATE articles SET tier = 'publish', updated_at = now()
            WHERE id = $1 AND source_type = 'broadcast' AND tier = 'archive' RETURNING id`,
          [id],
        );
        res.moved = returnedRows(moved).length > 0;
      } catch {
        res.moved = false;
      }
    }
    out.results.push(res);
  }
  out.missing = want.filter((id) => !seen.has(id));
  out.done = out.results.every((r) => r.fit !== null);
  return out;
}
