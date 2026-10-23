// ============================================================
// spam_publisher.ts (NEWS-Q14 ■1) — 집계기 스팸 출처 막기(설정값 · LLM 0).
// 구글뉴스 RSS 는 매체 이름을 <source> 와 제목 끝 「 - 매체」로 준다. 10-23 「… - Calgary Roughnecks」 꼴 SEO 슬롯 안내 글 42편이
// 분야 핵심어를 제목에 달고 핵심어 단계를 지나 실렸다(구글 링크가 안 풀려 도메인 막기에 닿지 않음 · 관문도 실림으로 봄).
// 출처 이름은 분야 설정 sources.spam_publishers.names(코드에 글자 0) · 거부 = 판정 호출 0 · 격리 0(블랙리스트와 같은 길).
// 이미 실린 글은 sources.spam_publishers.archive_ids 로 다음 실행 시작에 보관층으로(행 지움 0 · 출처가 맞는 행만).
// ============================================================
import { QueryFn, returnedRows } from './broadcast_episode';

/** 소문자 · 글자·숫자만(「calgaryroughnecks.com」 과 「Calgary Roughnecks」 가 같은 머리로 읽히게). */
function squash(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** 이름은 squash 4자 이상만 셈(짧은 이름이 아무 출처에나 맞지 않게). */
const MIN_NAME = 4;
/** 이름 뒤에 붙어도 같은 출처로 치는 도메인 꼬리(줄인 글 · 점 빠짐) */
const DOMAIN_REST = /^(com|net|org|ru|io|info|biz|co|kr|cokr|eu|uk|couk)$/;

/** 제목 끝 「 - 매체」(구글뉴스 꼴 · 앞뒤 띈 마지막 「 - 」 뒤 · 「horacke-noviny.com」 처럼 붙은 「-」는 이름 안). 없으면 ''. */
export function titleTail(title: string): string {
  const parts = (title || '').split(/\s[-–—]\s+/);
  return parts.length > 1 ? parts[parts.length - 1].trim() : '';
}

/**
 * 출처(피드 <source> · 제목 꼬리)가 스팸 이름에 맞으면 그 이름(설정 글 그대로) · 아니면 null.
 * 맞음 = 출처를 squash 한 글이 이름의 squash 와 같거나 그것으로 시작(「calgaryroughnecks.com」 ← 「Calgary Roughnecks」).
 * 제목 가운데 낱말은 보지 않는다 — 「캘거리 러프넥스 경기 결과 - 연합뉴스」 같은 정상 기사는 지나간다.
 */
export function spamPublisherOf(
  title: string,
  source: string | null | undefined,
  names: string[] = [],
): string | null {
  const keys = names
    .filter((n) => typeof n === 'string')
    .map((n) => [n, squash(n)] as const)
    .filter(([, k]) => k.length >= MIN_NAME);
  if (!keys.length) return null;
  const cands = [source || '', titleTail(title)]
    .map(squash)
    .filter((c) => c.length >= MIN_NAME);
  // 리뷰(Q14): 머리 맞춤은 남은 글이 도메인 꼬리일 때만(「calgaryroughnecks」+「com」) — 흔한 이름이 더해져도 「Daily」가 「Daily Mail」을 막지 않게
  for (const [name, k] of keys) {
    if (
      cands.some(
        (c) =>
          c === k || (c.startsWith(k) && DOMAIN_REST.test(c.slice(k.length))),
      )
    )
      return name;
  }
  return null;
}

export interface SpamArchiveResult {
  /** 이번에 보관층으로 옮긴 id */
  archived: number[];
  /** 목록에 있었지만 옮기지 않은 id(출처가 이름에 안 맞음 · 방송 · 이미 보관 · 없는 id) */
  skipped: number[];
  /** 리뷰(Q14): DB 오류로 못 옮김(「옮길 것 없음」과 가름) */
  error?: true;
}

/**
 * 설정 archive_ids 가운데 「기사 · 실림층 · 출처(원제 꼬리 · source)가 스팸 이름에 맞는」 행만 보관층으로(updated_at = 바뀐 때).
 * 몇 번 돌아도 같음(이미 보관이면 skipped) · 실패면 archived [] · skipped 전부 · error(크롤 계속 · 다음 실행이 다시).
 */
export async function archiveSpamArticles(
  query: QueryFn,
  ids: number[],
  names: string[],
  cols: { deletedAt: boolean } = { deletedAt: false },
): Promise<SpamArchiveResult> {
  const want = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!want.length || !names.length) return { archived: [], skipped: [] };
  // 리뷰(Q14): 숨긴 행(deleted_at)은 건드리지 않음
  const live = cols.deletedAt ? ' AND deleted_at IS NULL' : '';
  try {
    const rows = (await query(
      `SELECT id, title, original_title, source FROM articles
        WHERE id = ANY($1::int[]) AND source_type IS DISTINCT FROM 'broadcast' AND COALESCE(tier, 'publish') = 'publish'${live}`,
      [want],
    )) as Array<{
      id?: unknown;
      title?: unknown;
      original_title?: unknown;
      source?: unknown;
    }>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const match = (rows || [])
      .filter(
        (r) =>
          spamPublisherOf(
            str(r.original_title) || str(r.title),
            str(r.source),
            names,
          ) !== null || spamPublisherOf(str(r.title), null, names) !== null,
      )
      .map((r) => Number(r.id))
      .filter(Number.isFinite);
    let archived: number[] = [];
    if (match.length) {
      const res = await query(
        `UPDATE articles SET tier = 'archive', updated_at = now()
          WHERE id = ANY($1::int[]) AND source_type IS DISTINCT FROM 'broadcast' AND COALESCE(tier, 'publish') = 'publish'${live}
          RETURNING id`,
        [match],
      );
      archived = returnedRows<{ id?: unknown }>(res)
        .map((r) => Number(r.id))
        .filter(Number.isFinite);
    }
    const moved = new Set(archived);
    return { archived, skipped: want.filter((id) => !moved.has(id)) };
  } catch {
    return { archived: [], skipped: want, error: true };
  }
}
