// ============================================================
// broadcast_archive_list.ts (NEWS-Q14 ■5 · SOC 판정 ③) — 공개 방송 보관 목록(읽기만 · LLM 0).
// SOC(R13) 연대기가 「어느 방송이 실림에서 빠졌나」를 짐작 대신 목록으로 맞추게 한다.
// 칸 = id · tier · changedAt(층이 바뀐 때 = updated_at) 만 — 제목·내용·주소·열쇠 0.
// changedAt: Q14 부터 층을 옮기는 SQL(archive_ids · keep_ids · 스팸)이 updated_at 을 함께 바꾼다.
//   관문·묶기로 처음부터 보관층에 저장된 행은 저장 때 · 그 앞(Q12 archive_ids 등)에 옮긴 행은 마지막 고친 때.
// ============================================================
export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

export const ARCHIVE_LIST_DAYS = 120;
export const ARCHIVE_LIST_MAX = 5000;

export interface ArchiveListItem {
  id: number;
  tier: 'archive' | 'publish';
  changedAt: string;
}

export interface ArchiveList {
  kind: 'broadcast';
  /** archive = 보관층만(기본) · all = 실림 포함(keep_ids 로 되돌린 편도 보임) */
  tier: 'archive' | 'all';
  days: number;
  generatedAt: string;
  /** tier 열이 없는 DB(묶음 SQL 전) · DB 못 닿음 = false · items [] */
  available: boolean;
  count: number;
  /** 최대 5,000 에 닿아 오래된 id 가 잘렸나 */
  truncated: boolean;
  items: ArchiveListItem[];
}

export function parseArchiveTier(v?: string): 'archive' | 'all' {
  return v === 'all' ? 'all' : 'archive';
}

/** 최근 days 일 안에 층이 바뀐(또는 그 층으로 저장된) 방송 행 — id 차례 · 숨김(deleted_at) · blocked 뺌. 실패면 null. */
export async function broadcastArchiveList(
  query: QueryFn,
  opts: { tier: 'archive' | 'all'; days?: number; deletedAt: boolean },
): Promise<ArchiveListItem[] | null> {
  const days = Math.max(
    1,
    Math.min(ARCHIVE_LIST_DAYS, Math.floor(opts.days ?? ARCHIVE_LIST_DAYS)),
  );
  try {
    const rows = (await query(
      // 바뀐 때 = epoch 밀리초(서버 시간대·글 꼴에 기대지 않음)
      `SELECT id, COALESCE(tier, 'publish') AS tier, floor(extract(epoch FROM updated_at::timestamptz) * 1000)::bigint AS changed
         FROM articles
        WHERE source_type = 'broadcast'
          AND ${opts.tier === 'all' ? `COALESCE(tier, 'publish') IN ('archive', 'publish')` : `tier = 'archive'`}
          AND NOT blocked${opts.deletedAt ? ' AND deleted_at IS NULL' : ''}
          AND updated_at >= now() - ($1::int * interval '1 day')
        ORDER BY updated_at DESC, id DESC LIMIT ${ARCHIVE_LIST_MAX}`,
      [days],
    )) as Array<{ id?: unknown; tier?: unknown; changed?: unknown }>;
    const out: ArchiveListItem[] = [];
    for (const r of rows || []) {
      const id = Number(r.id);
      const t =
        r.changed === null || r.changed === undefined || r.changed === ''
          ? NaN
          : Number(r.changed);
      if (!Number.isInteger(id) || !Number.isFinite(t)) continue;
      out.push({
        id,
        tier: r.tier === 'archive' ? 'archive' : 'publish',
        changedAt: new Date(t).toISOString(),
      });
    }
    // 리뷰(Q14): 넘치면 최근에 바뀐 것을 남기고(updated_at DESC LIMIT) 내보낼 때는 id 오름차순
    return out.sort((a, b) => a.id - b.id);
  } catch {
    return null;
  }
}
