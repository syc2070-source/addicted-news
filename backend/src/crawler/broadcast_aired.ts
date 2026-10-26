// ============================================================
// broadcast_aired.ts (NEWS-Q16 ■1 · CTO 판정 Q15 ①) — 재업로드 방송의 원 방송일(규칙 · LLM 0).
// 메우기로 들어온 다큐인사이트 실림 편 대부분이 2010~2023 방송의 재업로드(제목 꼬리 「KBS 월요기획 20170619 방송」 ·
// 「시사기획 20100413」)인데 게시일(2026)로 실렸다 → 제목 · 설명에서 원 방송일을 읽어 그 날짜로 놓는다.
//  · 재업로드 = 원 방송일이 게시일(KST)보다 minDays(설정 aired_date_min_days · 30) 넘게 앞섬 — 보통 편(밤 방송 · 다음 날 업로드)은 그대로
//  · published_at = 원 방송일 · published_ts = 비움(게시 시각으로 「새 글」 표시가 붙지 않게 · 정확한 게시 시각은 raw_body 「게시 시각」)
//  · 원 방송일 전용 열은 없음 → 묶음 SQL 초안(docs/governance/sql/DRAFT_20261025_news_q16_aired_on.sql · 적용 0) · 지금은 raw_body 머리 「원 방송일:」 줄(메타 칸)
//  · 30일 규칙(oldDatedTier)은 방송 제외 그대로 — 옛 날짜가 되어도 보관층으로 내리지 않음
// ============================================================
import { QueryFn, returnedRows } from './broadcast_episode';

export interface AiredDate {
  /** 원 방송일 YYYY-MM-DD */
  aired: string;
  /** 게시일(KST) YYYY-MM-DD */
  uploaded: string;
  /** 원 방송일이 게시일보다 minDays 넘게 앞섬 */
  reupload: boolean;
  /** 어디서 읽었나 */
  from: 'title' | 'description';
}

export const AIRED_LINE = '원 방송일:';

const MIN_YEAR = 1980;

function ymdOf(y: number, m: number, d: number): string | null {
  if (y < MIN_YEAR || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** 두 자리 해 → 네 자리(게시 해보다 뒤면 1900 년대) */
function fullYear(yy: number, uploadYear: number): number {
  const y = 2000 + yy;
  return y > uploadYear ? 1900 + yy : y;
}

type Pick = (s: string, uploadYear: number) => string | null;

// 리뷰(Q16): 날짜만 있으면 사건 날짜일 수 있다(「2014.04.16 그날」 · 「20241203 계엄」) → 모든 꼴은 바로 뒤(12자 안)에 방송·방영이 와야 함.
// 단 8자리 붙은 날짜가 제목 맨 끝이면(「시사기획 20100413」) 방송 꼬리로 봄.
const AIRED_AFTER = '[^\\n\\d]{0,12}?(?:방송|방영)';
// 「20170619 방송」 · 「2017.06.19 방송분」 · 「2017-06-19 방영」 (앞 숫자 아님)
const COMPACT: Pick = (s) => {
  const m =
    new RegExp(`(?<!\\d)((?:19|20)\\d{2})([.\\-/]?)(\\d{2})\\2(\\d{2})(?!\\d)${AIRED_AFTER}`).exec(s) ||
    /(?<!\d)((?:19|20)\d{2})()(\d{2})(\d{2})\s*$/.exec(s);
  return m ? ymdOf(+m[1], +m[3], +m[4]) : null;
};
// 「170619 방송」(6자리 + 방송)
const SIX_AIRED: Pick = (s, uy) => {
  const m = /(?<!\d)(\d{2})(\d{2})(\d{2})\s*(?:방송|방영)/.exec(s);
  return m ? ymdOf(fullYear(+m[1], uy), +m[2], +m[3]) : null;
};
// 「2017년 6월 19일 방송」
const KOREAN: Pick = (s) => {
  const m = new RegExp(`((?:19|20)\\d{2})년\\s*(\\d{1,2})월\\s*(\\d{1,2})일${AIRED_AFTER}`).exec(s);
  return m ? ymdOf(+m[1], +m[2], +m[3]) : null;
};
// 「(17.06.19) 방송」 · 제목 맨 끝 「(17.06.19)」
const PAREN: Pick = (s, uy) => {
  const m =
    new RegExp(`\\((\\d{2})\\.(\\d{1,2})\\.(\\d{1,2})\\.?\\)${AIRED_AFTER}`).exec(s) ||
    /\((\d{2})\.(\d{1,2})\.(\d{1,2})\.?\)\s*$/.exec(s);
  return m ? ymdOf(fullYear(+m[1], uy), +m[2], +m[3]) : null;
};
// 설명: 「방송일 : 2017.06.19」 · 「방영일자 2017년 6월 19일」 꼴(이름표 뒤 날짜)
const LABELED: Pick = (s, uy) => {
  const m = /(?:본방송(?:일)?|방송\s*일자?|방영\s*일자?|방송\s*날짜)\s*[:：]?\s*(?:((?:19|20)\d{2})[.\-/년\s]\s*(\d{1,2})[.\-/월\s]\s*(\d{1,2})|(\d{2})\.(\d{1,2})\.(\d{1,2}))/.exec(s);
  if (!m) return null;
  return m[1] ? ymdOf(+m[1], +m[2], +m[3]) : ymdOf(fullYear(+m[4], uy), +m[5], +m[6]);
};

const TITLE_PICKS: Pick[] = [SIX_AIRED, COMPACT, KOREAN, PAREN];
const LINE_PICKS: Pick[] = [LABELED, SIX_AIRED, COMPACT, KOREAN, PAREN];
// 리뷰(Q16): 설명에서 다른 편 · 다른 뜻의 「방송」 줄은 읽지 않음(지난 편 소개 · 방송통신위원회 · 개인방송 BJ 등)
const LINE_SKIP = /지난|이전|후속|앞선|방송통신|방송심의|방송사|방송인|개인\s*방송|인터넷\s*방송|생방송|라이브/;

function kstYmdOf(iso: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
}

/**
 * 제목 → (없으면) 설명에서 「방송·방영」 낱말이 든 줄(LINE_SKIP 뺌 · 여러 줄이면 가장 이른 날 · NEWS-Q19) → 원 방송일. 날짜 바로 뒤에 방송·방영이 오거나
 * (제목 맨 끝 8자리 · (yy.mm.dd)) · 설명 「방송일 :」 이름표 뒤여야 함. 게시일보다 뒤인 날(예정 안내)은 버림.
 * minDays 없거나 0 이면 끔(null).
 */
export function originalAirDate(
  title: string,
  description: string,
  uploadedAt: string,
  minDays?: number,
): AiredDate | null {
  if (!(Number(minDays) > 0)) return null;
  const uploaded = kstYmdOf(uploadedAt || '');
  if (!uploaded) return null;
  const uy = +uploaded.slice(0, 4);
  const tryAll = (s: string, picks: Pick[]) => {
    for (const p of picks) {
      const v = p(s, uy);
      if (v && v <= uploaded) return v;
    }
    return null;
  };
  let aired = tryAll(title || '', TITLE_PICKS);
  let from: AiredDate['from'] = 'title';
  if (!aired) {
    from = 'description';
    // NEWS-Q19 ■4(CTO 답 10-26): 편집본(여러 회차 묶음 · 「※ 이 영상은 …에 방송된 …의 일부」 여러 줄) = 가장 이른 방송일
    // 리뷰(Q19): 「방송일 :」 이름표가 있으면 그것이 먼저(다른 줄의 지나가는 옛 편 언급으로 바뀌지 않게)
    let labeled: string | null = null;
    for (const line of (description || '').split(/\r?\n/)) {
      if (!/방송|방영/.test(line) || LINE_SKIP.test(line)) continue;
      const l = tryAll(line, [LABELED]);
      if (l) {
        labeled = labeled || l;
        continue;
      }
      const v = tryAll(line, LINE_PICKS);
      if (v && (!aired || v < aired)) aired = v;
    }
    if (labeled) aired = labeled;
  }
  if (!aired) return null;
  return { aired, uploaded, reupload: daysBetween(aired, uploaded) > Number(minDays), from };
}

/** raw_body 머리에 「원 방송일:」 줄(게시 시각 줄 다음 · 이미 있으면 그대로). */
export function withAiredLine(rawBody: string, a: AiredDate): string {
  if (rawBody.includes(AIRED_LINE)) return rawBody;
  const line = `${AIRED_LINE} ${a.aired} (재업로드 · ${a.from === 'title' ? '제목' : '설명'}에서 읽음 · 게시 ${a.uploaded})`;
  const lines = rawBody.split('\n');
  const at = lines.findIndex((l) => l.startsWith('게시 시각:'));
  if (at < 0) return `${line}\n${rawBody}`;
  lines.splice(at + 1, 0, line);
  return lines.join('\n');
}

/** broadcastRawBody 꼴에서 게시 시각 · 설명(첫 빈 줄 뒤). */
export function parseBroadcastRawBody(rawBody: string): { uploadedAt: string | null; description: string } {
  const text = rawBody || '';
  const m = /^게시 시각:\s*(\S+)/m.exec(text);
  const cut = text.indexOf('\n\n');
  return { uploadedAt: m ? m[1] : null, description: cut >= 0 ? text.slice(cut + 2) : '' };
}

export interface AiredFixResult {
  checked: number;
  /** 고친 행 {id · 고치기 전 published_at · 원 방송일} */
  fixed: Array<{ id: number; from: string; to: string }>;
  error?: boolean;
}

/**
 * 이미 저장된 방송 행 가운데 재업로드인데 published_at 이 원 방송일이 아닌 행 → 원 방송일로(다음 실행 시작 · 몇 번 돌아도 같음).
 * 층 · updated_at 은 그대로(보관 목록 changedAt = 층이 바뀐 때) · 지움 0 · 실패면 그때까지 고친 것만.
 * 리뷰(Q16): skipIds(설정 aired_skip_ids · 손으로 날짜를 고친 행 등)는 건드리지 않음 · 새 행부터(id 내림차순) limit 까지 ·
 * raw_body 열이 없는 DB 면 제목 · published_at 만으로(raw_body 쓰기 0).
 */
export async function alignAiredDates(
  query: QueryFn,
  minDays: number | undefined,
  cols: { deletedAt: boolean; publishedTs: boolean; rawBody: boolean },
  skipIds: number[] = [],
  limit = 3000,
): Promise<AiredFixResult> {
  const out: AiredFixResult = { checked: 0, fixed: [] };
  if (!(Number(minDays) > 0)) return out;
  const skip = new Set(skipIds);
  try {
    const rows = (await query(
      `SELECT id, title, ${cols.rawBody ? 'raw_body' : 'NULL AS raw_body'}, left(published_at::text, 10) AS published_at FROM articles
        WHERE source_type = 'broadcast' AND NOT blocked${cols.deletedAt ? ' AND deleted_at IS NULL' : ''}
        ORDER BY id DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
    )) as Array<{ id?: unknown; title?: unknown; raw_body?: unknown; published_at?: unknown }>;
    for (const r of rows || []) {
      out.checked++;
      const id = Number(r.id);
      if (!Number.isInteger(id) || skip.has(id)) continue;
      const raw = typeof r.raw_body === 'string' ? r.raw_body : '';
      const pub = typeof r.published_at === 'string' ? r.published_at.slice(0, 10) : '';
      const body = parseBroadcastRawBody(raw);
      const a = originalAirDate(typeof r.title === 'string' ? r.title : '', body.description, body.uploadedAt || pub, minDays);
      if (!a || !a.reupload || a.aired === pub) continue;
      const sets = ['published_at = $2'];
      const params: unknown[] = [id, a.aired];
      if (cols.publishedTs) sets.push('published_ts = NULL');
      if (cols.rawBody && raw && !raw.includes(AIRED_LINE)) {
        params.push(withAiredLine(raw, a).slice(0, 6000));
        sets.push(`raw_body = $${params.length}`);
      }
      const res = await query(
        `UPDATE articles SET ${sets.join(', ')} WHERE id = $1 AND source_type = 'broadcast' RETURNING id`,
        params,
      );
      if (returnedRows(res).length) out.fixed.push({ id, from: pub, to: a.aired });
    }
  } catch {
    out.error = true;
  }
  return out;
}
