// ============================================================
// broadcast_archive_list.ts (NEWS-Q14 ■5 · SOC 판정 ③) — 공개 방송 보관 목록(읽기만 · LLM 0).
// SOC(R13) 연대기가 「어느 방송이 실림에서 빠졌나」를 짐작 대신 목록으로 맞추게 한다.
// 칸 = id · news_id(NEWS-Q17) · tier · changedAt(층이 바뀐 때 = updated_at) · videoId(유튜브 영상 id · NEWS-Q15 ■1) 만 — 제목·내용·주소·열쇠 0.
// NEWS-Q15 ■1 CTO 판정(10-24): 보관층은 전 기간(120일 제한 없음) · 지운 편(deleted_at 있는 방송 행)은 tier 'deleted'(전 기간) ·
//   실림(?tier=all)만 최근 120일.
// NEWS-Q16 ■4 (SOC-R14 C3): 실림(?tier=all)도 전 기간 — 120일 제한 때문에 오래 숨겼던 편이 복원(keep_ids)돼도 목록에 못 돌아오던 것.
//   days = null(전 기간) · 이 목록은 방송만(기사 목록은 그대로).
// NEWS-Q17 ■3 (11월 중독사회 읽음 · v1): 항목에 news_id(= id · 중독뉴스 기사 id · 세 사이트 연계에서 어느 사이트 id 인지 밝힘) 더함 ·
//   행 한도(5,000) 없앰 — 10-26 실측 전 기간 59 행 · 하루 몇 행씩 늘어 수천에 닿으려면 몇 해 · truncated 는 꼴이 틀려 건너뛴 행이 있을 때만 true.
// changedAt: Q14 부터 층을 옮기는 SQL(archive_ids · keep_ids · 스팸)이 updated_at 을 함께 바꾼다.
//   관문·묶기로 처음부터 보관층에 저장된 행은 저장 때 · 그 앞(Q12 archive_ids 등)에 옮긴 행은 마지막 고친 때 ·
//   지운 편은 updated_at 과 deleted_at 가운데 늦은 때.
// ============================================================
import { videoIdOfUrl } from './broadcast_episode';
import { redactPublic } from './public_redact';

export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

/** NEWS-Q16 ■4: 날 수 제한 없음(실림 · 보관 · 지운 편 모두 전 기간) — 응답 days = null */
export const ARCHIVE_LIST_DAYS = null;

export type ArchiveListTier = 'archive' | 'publish' | 'deleted';

export interface ArchiveListItem {
  id: number;
  /** NEWS-Q17 ■3: 중독뉴스 기사 id(= id · 값 같음) */
  news_id: number;
  tier: ArchiveListTier;
  changedAt: string;
  /** 유튜브 영상 id(11자 · 주소에서 뽑음 · 못 뽑으면 null) */
  videoId: string | null;
}

export interface ArchiveList {
  kind: 'broadcast';
  /** archive = 보관 + 지운 편(기본 · 전 기간) · all = 그에 더해 실림(NEWS-Q16 ■4 · 전 기간 · keep_ids 로 되돌린 편도 보임) */
  tier: 'archive' | 'all';
  /** 날 수 제한(NEWS-Q16 ■4 부터 null = 전 기간 · Q14~Q15 는 실림에만 120) */
  days: number | null;
  generatedAt: string;
  /** tier 열이 없는 DB(묶음 SQL 전) · DB 못 닿음 = false · items [] */
  available: boolean;
  count: number;
  /** 다 실었나의 반대 — NEWS-Q17 ■3 부터 행 한도 없음 · 꼴이 틀려 건너뛴 행이 있을 때만 true(Q14~Q16 은 5,000 넘으면 true) */
  truncated: boolean;
  items: ArchiveListItem[];
}

export function parseArchiveTier(v?: string): 'archive' | 'all' {
  return v === 'all' ? 'all' : 'archive';
}

const VIDEO_ID = /^[\w-]{11}$/;

/**
 * 리뷰(Q15): 공개 가림. 겉 칸은 redactPublic · 항목은 만들 때부터 안전한 값만(정수 · 층 이름 · ISO 시각 · 11자 영상 id)이라
 * 꼴을 다시 확인해 둔다 — redactPublic 의 열쇠 꼴(sk-… · eyJ… 8자+)이 「sk-」로 시작하는 진짜 영상 id 를 지우지 않게.
 */
export function redactArchiveList(list: ArchiveList): ArchiveList {
  return {
    ...redactPublic({ ...list, items: [] }),
    items: list.items.map((it) => ({
      id: it.id,
      news_id: it.id,
      tier: it.tier,
      changedAt: redactPublic(it.changedAt),
      videoId: it.videoId && VIDEO_ID.test(it.videoId) ? it.videoId : null,
    })),
  };
}

/**
 * 방송 행 목록 — 보관(전 기간) · 지운 편(deleted_at 열 있을 때 · 전 기간 · tier deleted) · tier=all 이면 실림(전 기간 · NEWS-Q16 ■4).
 * blocked 행은 뺌 · id 차례 · 실패면 null.
 */
export async function broadcastArchiveList(
  query: QueryFn,
  opts: { tier: 'archive' | 'all'; deletedAt: boolean },
): Promise<{ items: ArchiveListItem[]; truncated: boolean } | null> {
  const del = opts.deletedAt;
  // 층: 지운 편(층이 무엇이든 deleted) · 보관 · tier=all 이면 실림
  const tierExpr = del
    ? `CASE WHEN deleted_at IS NOT NULL THEN 'deleted' ELSE COALESCE(tier, 'publish') END`
    : `COALESCE(tier, 'publish')`;
  const changedExpr = del
    ? `GREATEST(updated_at::timestamptz, deleted_at::timestamptz)`
    : `updated_at::timestamptz`;
  const conds = [
    ...(del ? ['deleted_at IS NOT NULL'] : []),
    `tier = 'archive'`,
    ...(opts.tier === 'all' ? [`COALESCE(tier, 'publish') = 'publish'`] : []),
  ];
  try {
    const rows = (await query(
      // 바뀐 때 = epoch 밀리초(서버 시간대·글 꼴에 기대지 않음) · source_url 은 영상 id 를 뽑는 데만 쓰고 내보내지 않음
      `SELECT id, source_url, ${tierExpr} AS tier, floor(extract(epoch FROM ${changedExpr}) * 1000)::bigint AS changed
         FROM articles
        WHERE source_type = 'broadcast'
          AND NOT blocked
          AND (${conds.join(' OR ')})
        ORDER BY id`,
      [],
    )) as Array<{
      id?: unknown;
      source_url?: unknown;
      tier?: unknown;
      changed?: unknown;
    }>;
    const out: ArchiveListItem[] = [];
    // 반박(Q17): 꼴이 틀려 건너뛴 행이 있으면 「다 실었다」고 말하지 않음(truncated true) — 받는 쪽이 빠진 id 를 숨김으로 읽지 않게
    let skipped = 0;
    for (const r of rows || []) {
      const id = Number(r.id);
      const t =
        r.changed === null || r.changed === undefined || r.changed === ''
          ? NaN
          : Number(r.changed);
      if (!Number.isInteger(id) || !Number.isFinite(t)) {
        skipped++;
        continue;
      }
      const vid = videoIdOfUrl(
        typeof r.source_url === 'string' ? r.source_url : '',
      );
      out.push({
        id,
        news_id: id,
        tier:
          r.tier === 'deleted'
            ? 'deleted'
            : r.tier === 'archive'
              ? 'archive'
              : 'publish',
        changedAt: new Date(t).toISOString(),
        videoId: vid || null,
      });
    }
    // NEWS-Q17 ■3: 한도 없음 → 잘림 없음(건너뛴 행이 있을 때만 true) · id 오름차순
    return { items: out.sort((a, b) => a.id - b.id), truncated: skipped > 0 };
  } catch {
    return null;
  }
}
