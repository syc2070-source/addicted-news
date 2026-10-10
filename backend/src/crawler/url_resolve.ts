// ============================================================
// url_resolve.ts (NEWS-Q2 ■3) — 구글뉴스 링크 → 원문 주소.
//  · 새 기사: 저장 전에 풀어 source_url = 원문 · google_url = 구글 링크 · outlet = 원문 도메인/피드 <source>.
//  · 기존 행: 실행마다 구글 링크 행을 오래된 순으로 최대 100건 풀어 갱신(url_resolve 열 · 묶음 SQL 2 있을 때만).
//    google_url 은 보존(없으면 옛 source_url 을 넣음) · 바꾸기 전 값은 url_resolve.prev 에 남겨 되돌릴 수 있다.
//    실패는 attempts 를 올리고 3회째면 status='failed' 로 표시(그 뒤로는 건너뜀).
// ============================================================
export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

export const RESOLVE_MAX_ATTEMPTS = 3;
export const BACKFILL_LIMIT = 100;

export function isGoogleNewsLink(url: string | null | undefined): boolean {
  try {
    return new URL(String(url || '')).hostname === 'news.google.com';
  } catch {
    return false;
  }
}

export function hostOf(url: string | null | undefined): string {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** 구글뉴스 제목 꼴 "제목 - 매체명" 의 매체명(짧을 때만). */
export function outletNameFromTitle(title: string | null | undefined): string | null {
  const t = String(title || '');
  const i = t.lastIndexOf(' - ');
  if (i <= 0) return null;
  const name = t.slice(i + 3).trim();
  return name && name.length <= 30 ? name : null;
}

export interface UrlResolveState {
  status: 'ok' | 'pending' | 'failed';
  attempts: number;
  at: string;
  prev?: { source_url: string; source: string | null; outlet_id: string | null };
}

export interface ResolveRow {
  id: number;
  source_url: string;
  google_url: string | null;
  source: string | null;
  outlet_id: string | null;
  title: string | null;
  original_title: string | null;
  url_resolve: UrlResolveState | null;
}

export interface ResolvePlan {
  id: number;
  sourceUrl: string;
  googleUrl: string | null;
  source: string | null;
  outletId: string | null;
  state: UrlResolveState;
  ok: boolean;
}

export function planResolution(row: ResolveRow, decoded: string | null, now: Date = new Date()): ResolvePlan {
  const attempts = Number(row.url_resolve?.attempts || 0) + 1;
  const at = now.toISOString();
  if (decoded && !isGoogleNewsLink(decoded) && /^https?:\/\//i.test(decoded)) {
    const host = hostOf(decoded);
    return {
      id: row.id,
      sourceUrl: decoded,
      googleUrl: row.google_url || row.source_url,
      source: outletNameFromTitle(row.original_title || row.title) || host || row.source,
      outletId: host || row.outlet_id,
      state: {
        status: 'ok', attempts, at,
        prev: { source_url: row.source_url, source: row.source, outlet_id: row.outlet_id },
      },
      ok: true,
    };
  }
  return {
    id: row.id,
    sourceUrl: row.source_url,
    googleUrl: row.google_url,
    source: row.source,
    outletId: row.outlet_id,
    state: { status: attempts >= RESOLVE_MAX_ATTEMPTS ? 'failed' : 'pending', attempts, at },
    ok: false,
  };
}

export interface BackfillResult {
  picked: number;
  ok: number;
  pending: number;
  failed: number;
}

export async function backfillGoogleUrls(opts: {
  query: QueryFn;
  decode: (url: string) => Promise<string | null>;
  limit?: number;
  gradeColumn?: boolean;
  deadline?: number;
  log?: (s: string) => void;
}): Promise<BackfillResult> {
  const log = opts.log || console.log;
  const rows: ResolveRow[] = await opts.query(
    `SELECT id, source_url, google_url, source, outlet_id, title, original_title, url_resolve FROM articles
      WHERE source_url LIKE 'https://news.google.com/%'
        AND COALESCE(url_resolve->>'status', '') <> 'failed'
      ORDER BY id ASC LIMIT $1`,
    [opts.limit ?? BACKFILL_LIMIT],
  );
  const res: BackfillResult = { picked: rows.length, ok: 0, pending: 0, failed: 0 };
  for (const row of rows) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    let decoded: string | null = null;
    try {
      decoded = await opts.decode(row.source_url);
    } catch {
      decoded = null;
    }
    const plan = planResolution(row, decoded);
    if (plan.ok) {
      await opts.query(
        `UPDATE articles SET source_url = $2, google_url = $3, source = $4, outlet_id = $5, url_resolve = $6::jsonb
           ${opts.gradeColumn ? `, source_grade = 'press'` : ''}
         WHERE id = $1`,
        [plan.id, plan.sourceUrl, plan.googleUrl, (plan.source || '').slice(0, 100), (plan.outletId || '').slice(0, 100) || null,
          JSON.stringify(plan.state)],
      );
      res.ok++;
    } else {
      await opts.query(`UPDATE articles SET url_resolve = $2::jsonb WHERE id = $1`, [plan.id, JSON.stringify(plan.state)]);
      if (plan.state.status === 'failed') res.failed++;
      else res.pending++;
    }
  }
  log(`[url-backfill] 구글 링크 ${res.picked}건 → 원문 ${res.ok} · 다음에 다시 ${res.pending} · 해석 실패 표시 ${res.failed}`);
  return res;
}
