// ============================================================
// summary_widget.ts (NEWS-Q21 ■1 · CTO 10-29) — 요약에 매체 화면 글(위젯 · 안내)이 들어온 것을 거름(규칙 · LLM 0).
// 실측(10-29 공개 글): 「가. 가. 기사의 본문 내용은 이 글자크기로 변경됩니다.」 · 「… 글자크기 설정. 가.」 ·
//   「입력 2026.10.19 14:43. 글자 크기. 프린트.」 · 「<저작권자 © … 무단전재 및 재배포 금지>」.
// 요약 문장 하나라도 위젯이면 → 본문(raw_body)의 첫 두 문장(위젯 · 제목 되풀이 · 짧은 조각 뺌)으로 바꿈 ·
// 본문에도 쓸 문장이 없으면 요약 비움(null) → TOP 자격 0(isTopSummaryOk).
// 「공유 · 댓글 · 구독 · 광고」 같은 낱말은 기사 문장에도 흔해서(「연구 결과를 공유했다」 · 「도박 광고 금지」)
// 짧은 조각(글자 WEAK_MAX_CHARS 이하)일 때만 위젯으로 본다.
// 이미 저장된 글: 실행 시작 쓸기(sweepWidgetSummaries) · 손으로는 `npx ts-node src/crawler/summary_widget_run.ts [--apply]`.
// 이 파일은 순수 함수 + 쓸기만(공개 API 의 TOP 자격도 씀 · DB 연결 · env 0).
// ============================================================
import type { QueryFn } from './broadcast_episode';

/** 문장 어디에 있어도 위젯 · 안내 글(사이트별 흔한 꼴) */
export const WIDGET_STRONG: RegExp[] = [
  /글자\s?크기/,
  /본문\s?내용은\s?이/,
  /무단\s?전재|재배포\s?금지|저작권자\s?[©ⓒ(]/,
  /기사\s?(듣기|읽어\s?주기|스크랩|저장|공유)/,
  /(페이스북|트위터|카카오톡|카카오스토리|네이버\s?밴드|URL|링크)\s?(으로\s?)?(공유|복사)/i,
  /^(입력|발행일|등록|수정)\s?:?\s?\d{4}[.\-/]/,
  /스크롤\s?이동|상태바/,
  /[\w.-]+@[\w-]+\.[a-z.]{2,}/i,
];

/** 짧은 조각일 때만 위젯(기사 문장에도 흔한 낱말 · 「경험을 공유하기 위해」 「도박 광고 금지」) */
export const WIDGET_WEAK: string[] = [
  '공유', '댓글', '구독', '광고', '프린트', '스크랩', '인쇄', '설정', '좋아요', '닫기', '바로가기', '확대', '축소', '목록', '이전', '다음',
];
export const WEAK_MAX_CHARS = 12;
/** 본문에서 요약으로 쓸 문장의 최소 글자(한글 · 영문 · 숫자) */
export const BODY_MIN_CHARS = 10;

function letters(s: string): string {
  return String(s || '').replace(/[^\p{L}\p{N}]/gu, '');
}

/** 줄 → 문장(마침표 · 물음표 · 느낌표 뒤 빈칸 · 또는 빈칸 없이 바로 한글 — 「진행합니다.이번」) · 빈 것 뺌 */
export function sentencesOf(text: string): string[] {
  return String(text || '')
    .replace(/\r/g, '')
    // 폭 0 빈칸 · BOM(매체 본문에 섞임 — 「=​부안해양경찰서」)
    .replace(/[​-‍⁠﻿]/g, '')
    .split('\n')
    .flatMap((ln) => ln.trim().split(/(?<=[.!?。！？])(?:\s+|(?=[가-힣]))/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isWidgetSentence(s: string): boolean {
  const t = String(s || '').trim();
  if (!t) return false;
  if (WIDGET_STRONG.some((re) => re.test(t))) return true;
  // 짧은 조각 규칙은 마침표로 끝난 조각만(티저 220자 · 요약 400자 자름 끝의 「이」 「다만」 같은 잘린 꼬리는 아님)
  if (!/[^.]\.$|^\.$/.test(t)) return false;
  const core = letters(t);
  // 「가.」 「가. 가.」 = 글자 크기 단추
  if (/^가+$/.test(core)) return true;
  // 위젯 조각은 이름꼴(「프린트.」 「이미지 확대.」) — 「…확대한다.」 「…공유했어요.」 같은 서술 끝은 기사 문장
  if (/[다요]\.$/.test(t)) return false;
  return core.length <= WEAK_MAX_CHARS && WIDGET_WEAK.some((w) => t.includes(w));
}

/** 요약 문장 하나라도 위젯 · 안내 글이면 true */
export function isWidgetSummary(summary: string | null | undefined): boolean {
  return sentencesOf(summary || '').some(isWidgetSentence);
}

/** TOP 자격: 요약이 있고 위젯 글이 아님 */
export function isTopSummaryOk(summary: string | null | undefined): boolean {
  return !!String(summary || '').trim() && !isWidgetSummary(summary);
}

function isTitleEcho(s: string, title: string): boolean {
  const t = letters(title);
  const c = letters(s);
  if (!t || !c) return false;
  const bare = letters(String(title || '').split(/\s[-–—]\s+/)[0]);
  if (c === t || c === bare) return true;
  const head = bare.slice(0, 20);
  return head.length >= 10 && c.startsWith(head);
}

/**
 * 본문에서만 거르는 사진 설명 · 날짜 줄(요약 판정에는 안 씀 — 기사 요약 문장이 이 꼴로 끝나도 위젯은 아님).
 * 실측(10-29 쓸기 DRY_RUN): 「[경륜경정총괄본부 제공].」 「사진=서울올림픽기념체육진흥공단.」 「(출처: …) / 2026.10.15.」
 *   「왼쪽부터 김보준 세종경찰청장, …」 「승인 2026.10.23 18:12.」 「… 안내 이미지.」 「수원법원종합청사 전경.」
 */
const BODY_CAPTION: RegExp[] = [
  /^[[<(（【].{0,40}(제공|출처|사진)[^\]>)）】]*[\]>)）】]\.?$/,
  /^\/?사진\s?(제공)?\s?[=:]|사진\s?=|\(출처\s?:|\/\s?\d{4}[.\-]\d{1,2}[.\-]\d{1,2}\.?$/,
  /^(왼쪽|오른쪽|사진\s?왼쪽)\s?(부터|에서)/,
  /^(승인|업데이트|최종\s?수정)\s?:?\s?\d{4}[.\-/]/,
  /(사진|이미지|전경|모습|그래픽|제공)\]?\.?$/,
];

/** 기자 이름표(「매일일보 = 김길수 기자 |」 「[이데일리 강민구 기자]」 「(수원=연합뉴스) 김솔 기자 =」) — 문장 앞 50자 안이면 그 앞까지 뗌 */
const BYLINE_BRACKET = /^[[【][^\]】]{0,25}(기자|특파원)[\]】]\s*/;
// 이름표 뒤 기호는 매체마다 다름(= · | · ｜ · │ …) → 낱말 아닌 기호 하나
const BYLINE_MARK = /[가-힣]{2,4}\s*(기자|특파원)\s*[^\s\p{L}\p{N}.,]\s*/u;

function stripByline(s: string): string {
  let t = s.replace(BYLINE_BRACKET, '');
  const m = t.slice(0, 50).match(BYLINE_MARK);
  if (m && m.index !== undefined) t = t.slice(m.index + m[0].length);
  return t.trim();
}

/** 본문 첫 n 문장(위젯 · 사진 설명 · 제목 되풀이 · 짧은 조각 뺌 · 기자 이름표 뗌) · 없으면 '' */
export function bodyLeadSentences(body: string | null | undefined, title: string, n = 2): string {
  const out: string[] = [];
  for (const raw of sentencesOf(body || '')) {
    if (out.length >= n) break;
    const s = stripByline(raw);
    if (isWidgetSentence(s) || BODY_CAPTION.some((re) => re.test(s)) || isTitleEcho(s, title)) continue;
    if (letters(s).length < BODY_MIN_CHARS) continue;
    out.push(/[.!?。！？]$/.test(s) ? s : s + '.');
  }
  return out.join('\n');
}

export interface WidgetFix {
  changed: boolean;
  summary: string | null;
  teaser: string | null;
}

/**
 * 요약이 위젯 글이면 본문 첫 두 문장으로 · 본문에도 없으면 null(TOP 자격 0).
 * 티저는 위젯이거나 요약을 바꿨으면 새 요약 한 줄(220자) · 아니면 그대로.
 */
export function fixWidgetSummary(
  summary: string | null | undefined,
  teaser: string | null | undefined,
  body: string | null | undefined,
  title: string,
): WidgetFix {
  const s = summary ?? null;
  const t = teaser ?? null;
  const badSummary = isWidgetSummary(s);
  const badTeaser = isWidgetSummary(t);
  if (!badSummary && !badTeaser) return { changed: false, summary: s, teaser: t };
  const next = badSummary ? bodyLeadSentences(body, title) || null : s;
  const flat = next ? next.replace(/\s+/g, ' ').slice(0, 220) : null;
  const nextTeaser = badTeaser || (badSummary && t !== null) ? flat : t;
  return { changed: next !== s || nextTeaser !== t, summary: next, teaser: nextTeaser };
}

export interface WidgetSweep {
  checked: number;
  fixed: Array<{ id: number; tier: string; before: string; after: string | null }>;
  error?: boolean;
  errorMessage?: string;
}

/** SQL 앞거름(요약 · 티저에 이 가운데 하나) — 정밀 판정은 isWidgetSummary */
const SQL_LIKES = [
  '글자', '본문 내용은', '무단', '재배포', '저작권자', '기사 듣기', '기사듣기', '복사', '입력', '발행일', '등록', '수정', '스크롤', '상태바', '@', '가.',
  ...WIDGET_WEAK,
].map((w) => `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);

/**
 * 이미 저장된 기사(방송 아님 · 막힘 아님 · 실림 · 보관 둘 다) 가운데 요약 · 티저가 위젯 글인 것 → 본문 첫 두 문장(지움 0 · updated_at = 고친 때).
 * 몇 번 돌아도 같음(고친 요약은 위젯이 아님 · 비운 요약은 다시 안 걸림). raw_body 열이 없으면 본문 없이(요약 비움).
 */
export async function sweepWidgetSummaries(
  query: QueryFn,
  cols: { deletedAt: boolean; rawBody: boolean; tier: boolean },
  apply = true,
): Promise<WidgetSweep> {
  const out: WidgetSweep = { checked: 0, fixed: [] };
  try {
    const rows = (await query(
      `SELECT id, title, summary, teaser, ${cols.tier ? "COALESCE(tier, 'publish')" : "'publish'"} AS tier FROM articles
        WHERE (source_type IS NULL OR source_type <> 'broadcast') AND NOT blocked${cols.deletedAt ? ' AND deleted_at IS NULL' : ''}
          AND (summary LIKE ANY($1::text[]) OR teaser LIKE ANY($1::text[]))
        ORDER BY id`,
      [SQL_LIKES],
    )) as Array<{ id?: unknown; title?: unknown; summary?: unknown; teaser?: unknown; tier?: unknown }>;
    for (const r of rows || []) {
      out.checked++;
      const id = Number(r.id);
      if (!Number.isInteger(id)) continue;
      const summary = typeof r.summary === 'string' ? r.summary : null;
      const teaser = typeof r.teaser === 'string' ? r.teaser : null;
      if (!isWidgetSummary(summary) && !isWidgetSummary(teaser)) continue;
      let body: string | null = null;
      if (cols.rawBody) {
        const b = (await query(`SELECT raw_body FROM articles WHERE id = $1`, [id])) as Array<{ raw_body?: unknown }>;
        body = typeof b?.[0]?.raw_body === 'string' ? (b[0].raw_body as string) : null;
      }
      const fix = fixWidgetSummary(summary, teaser, body, typeof r.title === 'string' ? r.title : '');
      if (!fix.changed) continue;
      if (apply) {
        // 운영 DB 의 summary 열은 NOT NULL(10-29 실측 · 엔티티 표기와 다름) → 비움은 빈 글(TOP 자격 0 은 같음 · LIKE 앞거름에 다시 안 걸림)
        await query(`UPDATE articles SET summary = $1, teaser = $2, updated_at = now() WHERE id = $3`, [fix.summary ?? '', fix.teaser, id]);
      }
      out.fixed.push({ id, tier: String(r.tier || 'publish'), before: String(summary || '').slice(0, 120), after: fix.summary });
    }
  } catch (e) {
    out.error = true;
    out.errorMessage = String((e as Error)?.message || e).slice(0, 200);
  }
  return out;
}
