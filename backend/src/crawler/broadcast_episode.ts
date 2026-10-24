// ============================================================
// broadcast_episode.ts (NEWS-Q12 ■1) — 같은 편 묶기(LLM 0).
// 방송 관문이 yes(실림)로 본 편 가운데 예고·10분 컷·관련 클립·#shorts 는 본편 하나만 실리고 나머지는 보관층으로 접는다.
//  · 클립 = 제목에 클립 표지(분야 설정 sources.broadcast.clip_markers · 낱말 경계 — 「복수를 예고하는」은 표지 아님)
//  · 같은 회차 = 같은 프로그램 ∧ 게시일 ±episode_days(7일) ∧ (회차 제목 핵심이 맞음 ∨ 클립 설명이 본편 제목 핵심을 품음)
//  · 본편 고르기 = 클립 표지 없는 것 · [full]/풀버전 먼저 · 그다음 이른 것(본편이 클립보다 먼저 방송)
//  · 이미 실린 본편(DB · 지난 실행)이 있으면 이번 것은 모두 보관.
// 행을 고치지 않는다(앞으로만) · 스키마 0 · 묶음 표시는 보관층(포털 비노출) = 「접힘」.
// ============================================================
import {
  OTHER_GROUP,
  keywordGroupNames,
  keywordGroupsOf,
} from './keyword_groups';

export interface EpisodeItem {
  title: string;
  description?: string;
  /** 같은 프로그램(articles.source = 프로그램 이름) */
  program: string;
  /** ISO 또는 YYYY-MM-DD */
  publishedAt: string;
  /** NEWS-Q13 ■2: 하위 주제(핵심어 묶음 · 방송 관문 subtopic) — 관련 클립 묶기에만 */
  groups?: string[];
  /** NEWS-Q14 ■4: 유튜브 영상 id · 길이(초 · videos.list contentDetails · 못 읽으면 없음 = 제목 규칙만) */
  videoId?: string;
  durationSec?: number;
}

/** NEWS-Q14 ■4 · Q15 ■2: 길이 규칙 — 본편 = 방송 꼬리 ∨ 길이 ≥ mainMinSec · 클립 = 길이 ≤ clipMaxSec(shortClip · 0 · 없음 = 끔) */
export interface LengthRule {
  mainMinSec?: number;
  clipMaxSec?: number;
}

/** 유튜브 주소 → 영상 id(watch?v= · youtu.be/ · shorts/) · 없으면 ''. */
export function videoIdOfUrl(url: string): string {
  const m =
    /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})(?![\w-])/.exec(
      url || '',
    );
  return m ? m[1] : '';
}

/**
 * 길이로 짧은 영상인가 — 길이를 읽었고 clipMaxSec 이하(NEWS-Q15 ■2 CTO 판정: 쇼츠 상한 180초까지 · 「미만」 → 「이하」).
 * 클립으로 칠지는 shortClip(제목에 [full] · 방송 꼬리가 있으면 본편).
 */
export function shortByLength(it: EpisodeItem, rule: LengthRule = {}): boolean {
  return (
    Number(rule.clipMaxSec) > 0 &&
    typeof it.durationSec === 'number' &&
    it.durationSec > 0 &&
    it.durationSec <= Number(rule.clipMaxSec)
  );
}

/** 이 길이 이하는 방송 꼬리가 있어도 클립(Q14 의 「60초 미만 = 클립」을 꼬리로 풀지 않음 · 예고에도 꼬리가 붙음) */
export const TAIL_CLIP_MAX_SEC = 60;

/**
 * NEWS-Q15 ■2: 길이로 클립 — 짧은 영상(≤ clipMaxSec) ∧ 제목에 [full]/풀버전 없음 ∧ (60초 이하 ∨ 방송 꼬리 없음).
 * 61~180초는 방송 꼬리(본편 표시)가 있으면 본편(CTO 판정) · 60초 이하는 꼬리가 있어도 클립(리뷰: 꼬리 붙은 예고·쇼츠).
 */
export function shortClip(
  it: EpisodeItem,
  rule: LengthRule = {},
  evidence: string[] = DEFAULT_MAIN_EVIDENCE,
): boolean {
  if (!shortByLength(it, rule) || FULL_MARK.test(it.title)) return false;
  return (
    (it.durationSec ?? 0) <= TAIL_CLIP_MAX_SEC ||
    !hasMainEvidence(it.title, evidence)
  );
}

/** 길이로 본편인가 — 길이를 읽었고 mainMinSec 이상일 때만. */
export function longByLength(it: EpisodeItem, rule: LengthRule = {}): boolean {
  return (
    Number(rule.mainMinSec) > 0 &&
    typeof it.durationSec === 'number' &&
    it.durationSec >= Number(rule.mainMinSec)
  );
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

function kstDay(s: string): number {
  return Math.floor((dayOf(s) * 86400000 + 9 * 3600000) / 86400000);
}

/** 1부·2부 · 1518회·1519회 처럼 회차 표기가 둘 다 있고 다르면 다른 편. */
export function episodeNumbersConflict(a: string, b: string): boolean {
  for (const re of [/(\d+)\s*부(?![가-힣])/, /(\d+)\s*회(?![가-힣])/]) {
    const x = re.exec(a)?.[1];
    const y = re.exec(b)?.[1];
    if (x && y && x !== y) return true;
  }
  return false;
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
  if (episodeNumbersConflict(c.title, m.title)) return false;
  const cc = episodeCore(c.title);
  const mc = episodeCore(m.title);
  if (coresMatch(cc, mc, generic)) return true;
  // 관련 클립: 제목은 다르지만 설명이 본편 제목 핵심을 품음(6자 이상)
  const sm = squash(mc);
  return sm.length >= 6 && squash(c.description || '').includes(sm);
}

export const DEFAULT_RELATED_DAYS = 3;

/**
 * 본편 표시(방송 꼬리): 「… 방송」 · 「260811 방송」 · 「1518회」 · 「2026년 8월 11일」 · 「(26.10.11)」 · [full] · 풀버전.
 * 관련 클립 묶기에서 본편 노릇은 이 표시가 있는 것만 · 이 표시가 있는 것은 관련 클립이 되지 않는다
 * (표시 없는 쇼츠가 본편보다 먼저 올라와도 본편을 보관으로 밀지 않게 — 리뷰 1).
 */
export const DEFAULT_MAIN_EVIDENCE = [
  '(?<!생)방송\\s*$',
  '(?<!생)방송\\s*[|)\\]]',
  '\\d{6}\\s*방송',
  // 회차는 세·네 자리만(1518회 · 356회) — 「3회 연속」·「5회 투약」은 본편 표시 아님
  '(?<!\\d)\\d{3,4}\\s*회(?![가-힣])',
  '\\d{4}년\\s*\\d{1,2}월\\s*\\d{1,2}일',
  '\\(\\d{2}\\.\\d{1,2}\\.\\d{1,2}\\.?\\)',
  '\\[\\s*full\\s*\\]',
  '풀버전',
];

export function hasMainEvidence(
  title: string,
  evidence: string[] = DEFAULT_MAIN_EVIDENCE,
): boolean {
  return evidence.some((p) => {
    try {
      return new RegExp(p, 'i').test(title);
    } catch {
      return false;
    }
  });
}

/** NEWS-Q14 ■4: 본편 표시 — 제목 방송 꼬리 ∨ 길이 ≥ mainMinSec(길이를 읽었을 때만). */
export function isMainItem(
  it: EpisodeItem,
  evidence: string[] = DEFAULT_MAIN_EVIDENCE,
  rule: LengthRule = {},
): boolean {
  return hasMainEvidence(it.title, evidence) || longByLength(it, rule);
}

/**
 * NEWS-Q13 ■2: 관련 클립 c 가 본편 m 에 딸렸나(제목·설명이 본편과 달라 sameEpisode 가 못 잡는 것 · LLM 0).
 * 다섯 조건 모두: 단독 채널(호출하는 쪽이 본다) ∧ m 은 실린 본편(본편 표시 있음 · c 는 표시 없음)
 * ∧ c 게시가 m 뒤 0~related_days 일(한국 날짜 · 같은 날이면 m 보다 늦게) ∧ 하위 주제(묶음 · 기타 뺌) 겹침 ∧ 회차 표기 충돌 없음.
 */
export function relatedClip(
  c: EpisodeItem,
  m: EpisodeItem,
  relatedDays = DEFAULT_RELATED_DAYS,
  evidence: string[] = DEFAULT_MAIN_EVIDENCE,
  rule: LengthRule = {},
): boolean {
  if (c.program !== m.program || FULL_MARK.test(c.title)) return false;
  // NEWS-Q14 ■4: 본편 표시 = 방송 꼬리 ∨ 길이 ≥ 20분(길이를 읽었을 때)
  if (!isMainItem(m, evidence, rule) || isMainItem(c, evidence, rule))
    return false;
  // 한국 날짜로 견줌(본편 밤 10시 · 클립 다음 날 = 1일)
  const gap = kstDay(c.publishedAt) - kstDay(m.publishedAt);
  if (!Number.isFinite(gap)) return false;
  if (gap < 0 || gap > relatedDays) return false;
  // 같은 날이면 본편보다 늦게 올라온 것만(시각이 있을 때)
  if (gap === 0 && dayOf(c.publishedAt) < dayOf(m.publishedAt)) return false;
  const gm = new Set(meaningfulGroups(m.groups));
  if (!meaningfulGroups(c.groups).some((g) => gm.has(g))) return false;
  return !episodeNumbersConflict(c.title, m.title);
}

function meaningfulGroups(groups: string[] | undefined): string[] {
  return (groups || []).filter((g) => g && g !== OTHER_GROUP);
}

/**
 * typeorm(postgres) query 는 UPDATE·DELETE … RETURNING 을 [행들, 바뀐 수] 로 돌려준다(SELECT 는 행들).
 * 둘 다 행들로 — Q12 broadcastArchivedIds 가 [] 로 남은 까닭(행은 옮겨졌음).
 */
export function returnedRows<T>(res: unknown): T[] {
  if (
    Array.isArray(res) &&
    res.length === 2 &&
    Array.isArray(res[0]) &&
    typeof res[1] === 'number'
  )
    return res[0] as T[];
  return Array.isArray(res) ? (res as T[]) : [];
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
      `SELECT title, source_url, keywords::text AS keywords, left(published_at::text, 10) AS published_at FROM articles
        WHERE source = $1 AND source_type = 'broadcast' AND COALESCE(tier, 'publish') = 'publish'
          AND NOT blocked${cols.deletedAt ? ' AND deleted_at IS NULL' : ''}
          AND left(published_at::text, 10) >= $2 AND left(published_at::text, 10) <= $3
        ORDER BY id LIMIT 200`,
      [program, from, to],
    );
    const names = new Set(keywordGroupNames());
    return (
      (rows || []) as Array<{
        title?: unknown;
        source_url?: unknown;
        keywords?: unknown;
        published_at?: unknown;
      }>
    ).map((r) => {
      // NEWS-Q14 ■4: 길이를 함께 읽을 수 있게 영상 id(없으면 제목 규칙만)
      const videoId = videoIdOfUrl(
        typeof r.source_url === 'string' ? r.source_url : '',
      );
      const title = typeof r.title === 'string' ? r.title : '';
      // keywords = simple-array(쉼표 글) — 저장 때 붙인 방송 관문 subtopic 이 들어 있다
      const tagged = (typeof r.keywords === 'string' ? r.keywords : '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => names.has(s));
      return {
        title,
        program,
        publishedAt:
          typeof r.published_at === 'string' ? r.published_at.slice(0, 10) : '',
        groups: [...new Set([...tagged, ...keywordGroupsOf(title)])],
        ...(videoId ? { videoId } : {}),
      };
    });
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
    const res = await query(
      // NEWS-Q14 ■5: updated_at = 층이 바뀐 때(공개 보관 목록 changedAt)
      `UPDATE articles SET tier = 'archive', updated_at = now()
        WHERE id = ANY($1::int[]) AND source_type = 'broadcast' AND COALESCE(tier, 'publish') = 'publish'
        RETURNING id`,
      [want],
    );
    return returnedRows<{ id?: unknown }>(res)
      .map((r) => Number(r.id))
      .filter(Number.isFinite);
  } catch {
    return [];
  }
}

/** 설정 archive_ids 가운데 keep_ids 에 없는 것(되돌림이 앞섬 · 둘 다 있는 id 를 오가며 옮기지 않게). */
export function listedArchiveIds(
  archive: number[] = [],
  keep: number[] = [],
): number[] {
  const k = new Set(keep);
  return archive.filter((id) => !k.has(id));
}

/**
 * NEWS-Q13 ■2: 설정 sources.broadcast.keep_ids — 자동 묶기가 보관층으로 보낸 방송을 실림으로 되돌림(오너 손 · 이 id · 방송 · 보관층만).
 * 몇 번 돌아도 같음 · 실패면 [].
 */
export async function restoreKeptBroadcasts(
  query: QueryFn,
  ids: number[],
): Promise<number[]> {
  const want = ids.filter((n) => Number.isInteger(n) && n > 0);
  if (!want.length) return [];
  try {
    const res = await query(
      `UPDATE articles SET tier = 'publish', updated_at = now()
        WHERE id = ANY($1::int[]) AND source_type = 'broadcast' AND tier = 'archive'
        RETURNING id`,
      [want],
    );
    return returnedRows<{ id?: unknown }>(res)
      .map((r) => Number(r.id))
      .filter(Number.isFinite);
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

export type EpisodeRole = 'main' | 'clip' | 'episode_dup' | 'related';

/**
 * 실림 후보(같은 실행 · 한 프로그램 또는 여럿) → 각자의 역할.
 * main = 실림 · clip = 클립 표지(보관) · episode_dup = 이미 실린 본편이나 이번 본편과 같은 회차(보관)
 * · related = 단독 채널에서 본편 뒤 0~relatedDays 일 · 하위 주제 겹치는 관련 클립(보관 · NEWS-Q13 ■2 · solo 일 때만).
 * existing = 이미 실린 본편(DB · 지난 실행).
 */
export function foldEpisodes<T extends EpisodeItem>(
  items: T[],
  existing: EpisodeItem[] = [],
  opts: {
    markers?: string[];
    days?: number;
    generic?: string[];
    solo?: boolean;
    relatedDays?: number;
    mainEvidence?: string[];
    /** NEWS-Q14 ■4: 길이 규칙(길이를 읽은 항목만 · 없으면 제목 규칙만) */
    length?: LengthRule;
  } = {},
): EpisodeRole[] {
  const markers = opts.markers ?? DEFAULT_CLIP_MARKERS;
  const days = opts.days ?? DEFAULT_EPISODE_DAYS;
  const generic = new Set((opts.generic ?? []).map(squash));
  const lengthRule = opts.length ?? {};
  const evidence = opts.mainEvidence ?? DEFAULT_MAIN_EVIDENCE;
  // NEWS-Q14 ■4 · Q15 ■2: 길이 ≤ clip_max_seconds(180초 · 쇼츠) = 클립 · 단 제목에 [full]/풀버전 · 방송 꼬리가 있으면 본편
  const roles: EpisodeRole[] = items.map((it) =>
    isClipTitle(it.title, markers) || shortClip(it, lengthRule, evidence)
      ? 'clip'
      : 'main',
  );
  // 본편 후보 순서: [full]/풀버전 먼저 · 본편 표시(방송 꼬리 · 길이 ≥ 20분) 있는 것 · 그다음 이른 것
  // (NEWS-Q13 반박 리뷰: 표시 없는 클립이 먼저 올라와도 본편이 episode_dup 으로 밀리지 않게)
  // 리뷰(Q14): 길이로만 본편인 것(꼬리 없는 20분+ 「몰아보기」 등)은 제목 꼬리 본편보다 뒤 — 진짜 본편이 episode_dup 으로 밀리지 않게
  // 반박 리뷰(Q14): [full] 이어도 짧은 영상(≤ clip_max_seconds)이면 0 순위 아님 · 같은 순위는 길이 긴 것 먼저(꼬리 붙은 6분 클립이 60분 본편보다 먼저 서지 않게)
  const rank = (i: number) =>
    FULL_MARK.test(items[i].title) && !shortByLength(items[i], lengthRule)
      ? 0
      : hasMainEvidence(items[i].title, evidence)
        ? 1
        : longByLength(items[i], lengthRule)
          ? 2
          : 3;
  const order = items
    .map((it, i) => i)
    .filter((i) => roles[i] === 'main')
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (items[b].durationSec ?? 0) - (items[a].durationSec ?? 0) ||
        dayOf(items[a].publishedAt) - dayOf(items[b].publishedAt),
    );
  // Q12 전에 실린 예고·클립은 본편으로 치지 않는다(옛 예고가 진짜 본편을 보관층으로 미는 것 막음)
  const mains: EpisodeItem[] = existing.filter(
    // 반박(Q15): 60초 이하 옛 행은 [full] 이어도 본편으로 치지 않음(Q14 규칙 그대로)
    (e) =>
      !isClipTitle(e.title, markers) &&
      !shortClip(e, lengthRule, evidence) &&
      !(
        shortByLength(e, lengthRule) &&
        (e.durationSec ?? 0) <= TAIL_CLIP_MAX_SEC
      ),
  );
  for (const i of order) {
    // 리뷰 · 반박(Q14): 본편 표시(꼬리 ∨ 20분+)가 있는 이번 후보는, 길이를 읽어 20분 미만으로 확인된 옛 실린 행에 밀려 보관되지 않는다.
    // 옛 행 길이를 모르면(열쇠 없음 · 상한 · id 없음) 옛 규칙 그대로 막음(꼬리 붙은 클립이 꼬리 없는 옛 본편과 함께 실리지 않게).
    const candMain = isMainItem(items[i], evidence, lengthRule);
    const weakOld = (m: EpisodeItem) =>
      existing.includes(m) &&
      Number(lengthRule.mainMinSec) > 0 &&
      typeof m.durationSec === 'number' &&
      m.durationSec > 0 &&
      !longByLength(m, lengthRule);
    if (
      mains.some(
        (m) =>
          !(candMain && weakOld(m)) &&
          (sameEpisode(items[i], m, days, generic) ||
            sameEpisode(m, items[i], days, generic)),
      )
    ) {
      roles[i] = 'episode_dup';
    } else if (
      opts.solo &&
      mains.some((m) =>
        relatedClip(
          items[i],
          m,
          opts.relatedDays,
          opts.mainEvidence,
          lengthRule,
        ),
      )
    ) {
      // 관련 클립은 본편 목록에 넣지 않는다(클립 둘째가 첫째에 딸리지 않게 · 본편에만 견줌)
      roles[i] = 'related';
    } else {
      mains.push(items[i]);
    }
  }
  return roles;
}
