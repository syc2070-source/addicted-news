// ============================================================
// broadcast_episode.ts (NEWS-Q12 ■1) — 같은 편 묶기(LLM 0).
// 방송 관문이 yes(실림)로 본 편 가운데 예고·10분 컷·관련 클립·#shorts 는 본편 하나만 실리고 나머지는 보관층으로 접는다.
//  · 클립 = 제목에 클립 표지(분야 설정 sources.broadcast.clip_markers · 낱말 경계 — 「복수를 예고하는」은 표지 아님)
//  · 같은 회차 = 같은 프로그램 ∧ 게시일 ±episode_days(7일) ∧ (회차 제목 핵심이 맞음 ∨ 클립 설명이 본편 제목 핵심을 품음)
//  · 본편 고르기 = 클립 표지 없는 것 · [full]/풀버전 먼저 · 그다음 이른 것(본편이 클립보다 먼저 방송)
//  · 이미 실린 본편(DB · 지난 실행)이 있으면 이번 것은 모두 보관.
// 행을 고치지 않는다(앞으로만) · 스키마 0 · 묶음 표시는 보관층(포털 비노출) = 「접힘」.
// ============================================================

export interface EpisodeItem {
  title: string;
  description?: string;
  /** 같은 프로그램(articles.source = 프로그램 이름) */
  program: string;
  /** ISO 또는 YYYY-MM-DD */
  publishedAt: string;
}

export const DEFAULT_CLIP_MARKERS = [
  '예고',
  '예고편',
  '티저',
  '10분 컷',
  '10분컷',
  '#shorts',
  '#short',
  '선공개',
  '미리보기',
  '하이라이트',
  'teaser',
  'trailer',
  'shorts',
];
export const DEFAULT_EPISODE_DAYS = 7;

const HANGUL = /[가-힣]/;
const FULL_MARK = /\[\s*full\s*\]|풀버전|full\s*ver/i;

/** 한글 표지 뒤 한 칸 띄고 오면 문장으로 읽히는 말(「예고 없이」·「하이라이트 없는」·「예고한」 꼴) */
const SENTENCE_NEXT = /^\s+(없|하|했|한|된|되|대로|조차)/;

/**
 * 표지가 낱말 경계에 있나(앞뒤가 한글 음절이 아님 · 영문 표지는 앞뒤가 영문자가 아님).
 * 한글 표지 뒤에 한 칸 띄고 문장을 잇는 말(SENTENCE_NEXT)이 오면 표지 아님 — 「예고 없이 찾아온」은 본편,
 * 「[예고]」·「스파이 전쟁 예고」·「1457회 예고 KBS」·「추적60분 예고 마약에 빠진 10대」는 표지.
 */
function hasMarker(title: string, marker: string): boolean {
  const t = title.toLowerCase();
  const m = marker.toLowerCase();
  const hangulMarker = HANGUL.test(m);
  let at = t.indexOf(m);
  while (at >= 0) {
    const before = t[at - 1] ?? '';
    const rest = t.slice(at + m.length);
    const word = hangulMarker ? HANGUL : /[a-z]/;
    // 「1518회 예고」처럼 숫자·회 뒤는 경계로 친다(회차 표기)
    const beforeOk = !word.test(before) || (hangulMarker && before === '회');
    const afterOk =
      !word.test(rest[0] ?? '') && !(hangulMarker && SENTENCE_NEXT.test(rest));
    if (beforeOk && afterOk) return true;
    at = t.indexOf(m, at + 1);
  }
  return false;
}

/** 예고·클립 표지가 있는 제목인가. */
export function isClipTitle(
  title: string,
  markers: string[] = DEFAULT_CLIP_MARKERS,
): boolean {
  return markers.some((m) => m && hasMarker(title, m));
}

/**
 * 회차 제목 핵심: [괄호]·(괄호) 와 「 | 」·「 - 」 뒤(프로그램·방송일 꼬리)를 떼고 따옴표·문장부호를 뺀 글.
 * 「[PD수첩 1518회 예고] 도박소년이 된 내 아들 - PD수첩, MBC 260811 방송」 → 「도박소년이 된 내 아들」
 */
export function episodeCore(title: string): string {
  let t = title
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/#\S+/g, ' ');
  t = t.split(/\s[|ㅣ｜]\s?|\s-\s|\s–\s/)[0];
  t = t.replace(/["'“”‘’「」『』<>《》…?!.,:;~·]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}

/**
 * generic = 겹침 셈에서 빼는 흔한 낱말(분야 설정 sources.broadcast.episode_generic_words) — 분야 방송 제목에 늘 나오는
 * 낱말이 겹친다고 같은 회차는 아니다(「청소년 도박 ○○ 실태」 ≠ 「청소년 마약 ○○ 실태」).
 */
function tokens(s: string, generic: ReadonlySet<string>): Set<string> {
  return new Set(
    s
      .split(' ')
      .map(squash)
      .filter((w) => w.length >= 2 && !generic.has(w)),
  );
}

/** 두 회차 제목 핵심이 같은 회차로 볼 만큼 맞나(흔한 낱말 뺀 낱말 반 이상 겹침 · 또는 한쪽이 다른 쪽을 품음 · 6자 이상). */
export function coresMatch(
  a: string,
  b: string,
  generic: ReadonlySet<string> = new Set(),
): boolean {
  const sa = squash(a);
  const sb = squash(b);
  if (sa.length >= 6 && sb.length >= 6 && (sa.includes(sb) || sb.includes(sa)))
    return true;
  const ta = tokens(a, generic);
  const tb = tokens(b, generic);
  if (ta.size < 2 || tb.size < 2) return false;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter) >= 0.5;
}

function dayOf(s: string): number {
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00+09:00` : s);
  return Number.isNaN(t) ? NaN : t / 86400000;
}

/** 클립(또는 다른 본편 후보) c 가 본편 m 과 같은 회차인가. */
export function sameEpisode(
  c: EpisodeItem,
  m: EpisodeItem,
  days = DEFAULT_EPISODE_DAYS,
  generic: ReadonlySet<string> = new Set(),
): boolean {
  if (c.program !== m.program) return false;
  const dc = dayOf(c.publishedAt);
  const dm = dayOf(m.publishedAt);
  if (!Number.isFinite(dc) || !Number.isFinite(dm) || Math.abs(dc - dm) > days)
    return false;
  // 1부·2부 · 1518회·1519회 처럼 회차 표기가 둘 다 있고 다르면 다른 편
  for (const re of [/(\d+)\s*부(?![가-힣])/, /(\d+)\s*회(?![가-힣])/]) {
    const a = re.exec(c.title)?.[1];
    const b = re.exec(m.title)?.[1];
    if (a && b && a !== b) return false;
  }
  const cc = episodeCore(c.title);
  const mc = episodeCore(m.title);
  if (coresMatch(cc, mc, generic)) return true;
  // 관련 클립: 제목은 다르지만 설명이 본편 제목 핵심을 품음(6자 이상)
  const sm = squash(mc);
  return sm.length >= 6 && squash(c.description || '').includes(sm);
}

export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

/** 이미 실린 본편(같은 프로그램 · 게시일 from~to · 방송 · 실림층 · 숨김 아님). 읽기만 · 실패면 [](묶기 없이 옛 동작). */
export async function existingEpisodeMains(
  query: QueryFn,
  program: string,
  from: string,
  to: string,
  cols: { deletedAt: boolean },
): Promise<EpisodeItem[]> {
  try {
    const rows = await query(
      // published_at 은 글(varchar) 또는 date — ::text 앞 10자로 읽고 견줌(어느 꼴이든 · 시간대로 하루 밀리지 않음)
      `SELECT title, left(published_at::text, 10) AS published_at FROM articles
        WHERE source = $1 AND source_type = 'broadcast' AND COALESCE(tier, 'publish') = 'publish'
          AND NOT blocked${cols.deletedAt ? ' AND deleted_at IS NULL' : ''}
          AND left(published_at::text, 10) >= $2 AND left(published_at::text, 10) <= $3
        ORDER BY id LIMIT 200`,
      [program, from, to],
    );
    return (
      (rows || []) as Array<{ title?: unknown; published_at?: unknown }>
    ).map((r) => ({
      title: typeof r.title === 'string' ? r.title : '',
      program,
      publishedAt:
        typeof r.published_at === 'string' ? r.published_at.slice(0, 10) : '',
    }));
  } catch {
    return [];
  }
}

/**
 * 설정 sources.broadcast.archive_ids 의 실린 방송 행을 보관층으로(Q12 전에 실린 예고·클립 정리 · 오너 지시).
 * 이 id · 방송 · 실림층인 행만 · 이미 보관이면 0(몇 번 돌아도 같음) · 실패면 [](크롤 계속).
 */
export async function archiveListedBroadcasts(
  query: QueryFn,
  ids: number[],
): Promise<number[]> {
  const want = ids.filter((n) => Number.isInteger(n) && n > 0);
  if (!want.length) return [];
  try {
    const rows = (await query(
      `UPDATE articles SET tier = 'archive'
        WHERE id = ANY($1::int[]) AND source_type = 'broadcast' AND COALESCE(tier, 'publish') = 'publish'
        RETURNING id`,
      [want],
    )) as Array<{ id?: unknown }>;
    return (rows || []).map((r) => Number(r.id)).filter(Number.isFinite);
  } catch {
    return [];
  }
}

/** 날짜 글(YYYY-MM-DD) ± n 일. */
export function shiftYmd(ymd: string, days: number): string {
  const t = Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t)
    ? ymd
    : new Date(t + days * 86400000).toISOString().slice(0, 10);
}

export type EpisodeRole = 'main' | 'clip' | 'episode_dup';

/**
 * 실림 후보(같은 실행 · 한 프로그램 또는 여럿) → 각자의 역할.
 * main = 실림 · clip = 클립 표지(보관) · episode_dup = 이미 실린 본편이나 이번 본편과 같은 회차(보관).
 * existing = 이미 실린 본편(DB · 지난 실행).
 */
export function foldEpisodes<T extends EpisodeItem>(
  items: T[],
  existing: EpisodeItem[] = [],
  opts: { markers?: string[]; days?: number; generic?: string[] } = {},
): EpisodeRole[] {
  const markers = opts.markers ?? DEFAULT_CLIP_MARKERS;
  const days = opts.days ?? DEFAULT_EPISODE_DAYS;
  const generic = new Set((opts.generic ?? []).map(squash));
  const roles: EpisodeRole[] = items.map((it) =>
    isClipTitle(it.title, markers) ? 'clip' : 'main',
  );
  // 본편 후보 순서: [full]/풀버전 먼저 · 그다음 이른 것
  const order = items
    .map((it, i) => i)
    .filter((i) => roles[i] === 'main')
    .sort((a, b) => {
      const fa = FULL_MARK.test(items[a].title) ? 0 : 1;
      const fb = FULL_MARK.test(items[b].title) ? 0 : 1;
      return (
        fa - fb || dayOf(items[a].publishedAt) - dayOf(items[b].publishedAt)
      );
    });
  // Q12 전에 실린 예고·클립은 본편으로 치지 않는다(옛 예고가 진짜 본편을 보관층으로 미는 것 막음)
  const mains: EpisodeItem[] = existing.filter(
    (e) => !isClipTitle(e.title, markers),
  );
  for (const i of order) {
    if (
      mains.some(
        (m) =>
          sameEpisode(items[i], m, days, generic) ||
          sameEpisode(m, items[i], days, generic),
      )
    ) {
      roles[i] = 'episode_dup';
    } else {
      mains.push(items[i]);
    }
  }
  return roles;
}
