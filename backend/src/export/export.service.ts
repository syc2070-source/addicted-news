// ============================================================
// export.service.ts (NEWS-Q10 ■3) — 읽기 전용 내보내기 문 v0(GET /api/export/articles · docs/EXPORT_V0.md).
// Statory(11월 서재 입구 · ECO-LINK1)가 게재·보관 기사의 목록 칸만 읽는다. 본문·요약·개인정보 0 · 쓰기 0.
// 열쇠 = env EXPORT_READ_KEY — 없으면 문이 없는 셈(404 = 기본 꺼짐) · 틀리면 401.
// 묶음 SQL 열(tier · source_grade · cluster_id · deleted_at · published_ts)은 있을 때만 읽는다(스키마 변경 0).
// ============================================================
import { createHash, timingSafeEqual } from 'crypto';
import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { fieldProfile } from '../crawler/field_profile';
import { columnExists, QueryFn } from '../crawler/schema_probe';
import { broadcastEnglishNames } from '../crawler/broadcast';
import {
  keywordGroupNames,
  keywordGroupsOf,
  OTHER_GROUP,
  subtypeIdsOfGroups,
} from '../crawler/keyword_groups';

export const EXPORT_PAGE = 200;

export type ExportKind = 'article' | 'broadcast' | 'all';
export type ExportTier = 'publish' | 'archive' | 'all';

export interface ExportQuery {
  since: string | null;
  kind: ExportKind;
  tier: ExportTier;
  /** 앞 쪽의 마지막 id(id 는 들어온 차례로 늘어남 = 쪽 넘김 열쇠) */
  cursor: number | null;
}

/** 내보내는 칸 전부(이것 말고는 0). */
export interface ExportArticle {
  id: number;
  title: string;
  source: string;
  publishedAt: string;
  publishedTs: string | null;
  sourceUrl: string;
  field: string;
  category: string;
  clusterId: string | null;
  tier: 'publish' | 'archive';
  sourceGrade: string | null;
  /** NEWS-Q12 ■4: 출처 종류(articles.source_type · broadcast · kr_press · world_press …) — 없으면 null */
  sourceType: string | null;
  /** NEWS-Q12 ■4: 하위 분야 영문 id(gambling · alcohol · drugs · tobacco · gaming · digital · work · food · ai · shopping) — 기타 = [] */
  subtype: string[];
  /** NEWS-Q12 ■4: 방송 프로그램 영어 이름(방송이 아니거나 모르면 null) */
  sourceEn: string | null;
}

export interface ExportPage {
  field: string;
  version: 'v0';
  limit: number;
  items: ExportArticle[];
  /** 다음 쪽 열쇠(없으면 끝) — 그대로 ?cursor= 로 */
  nextCursor: string | null;
}

/** 열쇠 판정: 설정 없음 = off(404) · 틀림 = denied(401) · 맞음 = ok. 길이·내용 모두 같은 시간에 비교(해시). */
export function checkExportKey(
  env: NodeJS.ProcessEnv,
  given: string | undefined,
): 'off' | 'denied' | 'ok' {
  const want = (env.EXPORT_READ_KEY || '').trim();
  if (!want) return 'off';
  const h = (s: string) => createHash('sha256').update(s).digest();
  return given && timingSafeEqual(h(given.trim()), h(want)) ? 'ok' : 'denied';
}

/** 요청 머리에서 열쇠(x-export-key 또는 Authorization: Bearer). 주소(?key=)로는 받지 않는다(로그에 남음). */
export function keyFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const x = one(headers['x-export-key']);
  if (x) return x;
  const auth = one(headers['authorization']);
  const m = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null;
  return m ? m[1] : undefined;
}

export function encodeCursor(id: number): string {
  return Buffer.from(`id:${id}`, 'utf8').toString('base64url');
}

/** 쿼리 글 → 판정된 값. 틀린 값은 Error(부르는 쪽이 400). */
export function parseExportQuery(q: {
  since?: string;
  kind?: string;
  tier?: string;
  cursor?: string;
}): ExportQuery {
  let since: string | null = null;
  if (q.since) {
    if (
      !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/i.test(
        q.since,
      )
    ) {
      throw new Error(
        'since = ISO 날짜(2026-10-01) 또는 시각대 있는 ISO 시각(2026-10-01T00:00:00+09:00)',
      );
    }
    const t = Date.parse(
      q.since.length === 10 ? `${q.since}T00:00:00+09:00` : q.since,
    );
    if (!Number.isFinite(t)) throw new Error('since 가 날짜가 아님');
    since = new Date(t).toISOString();
  }
  const kind = (q.kind || 'all') as ExportKind;
  if (!['article', 'broadcast', 'all'].includes(kind))
    throw new Error('kind = article | broadcast | all');
  const tier = (q.tier || 'all') as ExportTier;
  if (!['publish', 'archive', 'all'].includes(tier))
    throw new Error('tier = publish | archive | all');
  let cursor: number | null = null;
  if (q.cursor) {
    const m = /^id:(\d{1,15})$/.exec(
      Buffer.from(q.cursor, 'base64url').toString('utf8'),
    );
    if (!m)
      throw new Error('cursor 가 맞지 않음(앞 응답의 nextCursor 를 그대로)');
    cursor = Number(m[1]);
  }
  return { since, kind, tier, cursor };
}

type Cols = {
  tier: boolean;
  sourceGrade: boolean;
  clusterId: boolean;
  deletedAt: boolean;
  publishedTs: boolean;
};

/** SELECT 한 줄(열 있을 때만 · 값은 모두 $n 매개변수). */
export function buildExportSql(
  q: ExportQuery,
  cols: Cols,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = ['blocked = false'];
  if (cols.deletedAt) where.push('deleted_at IS NULL');
  if (q.kind === 'broadcast') where.push(`source_type = 'broadcast'`);
  if (q.kind === 'article')
    where.push(`(source_type IS NULL OR source_type <> 'broadcast')`);
  if (cols.tier) {
    if (q.tier === 'all')
      where.push(`COALESCE(tier, 'publish') IN ('publish', 'archive')`);
    else where.push(`COALESCE(tier, 'publish') = ${p(q.tier)}`);
  } else if (q.tier === 'archive') {
    where.push('false'); // 열이 없으면 publish 만 있는 셈
  }
  if (q.since) where.push(`created_at >= ${p(q.since)}::timestamptz`);
  if (q.cursor != null) where.push(`id > ${p(q.cursor)}`);
  const sql =
    // keywords(짧은 꼬리표)는 subtype 셈에만 쓰고 내보내지 않는다 · 본문·요약은 읽지도 않음
    `SELECT id, title, source, published_at, source_url, category, source_type, keywords` +
    `${cols.publishedTs ? ', published_ts' : ', NULL AS published_ts'}` +
    `${cols.tier ? ', tier' : ', NULL AS tier'}` +
    `${cols.sourceGrade ? ', source_grade' : ', NULL AS source_grade'}` +
    `${cols.clusterId ? ', cluster_id' : ', NULL AS cluster_id'}` +
    ` FROM articles WHERE ${where.join(' AND ')} ORDER BY id ASC LIMIT ${p(EXPORT_PAGE + 1)}`;
  return { sql, params };
}

const iso = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  if (!(v instanceof Date) && typeof v !== 'string' && typeof v !== 'number')
    return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/** 행 → 묶음 이름(제목 + 꼬리표 · 방송 관문 하위 주제가 꼬리표에 있으면 그것도) → 영문 id. 요약·본문은 쓰지 않는다. */
export function subtypeOfRow(r: Record<string, any>): string[] {
  // keywords = typeorm simple-array(쉼표로 이은 글) · 배열로 와도 받음
  const kw: unknown[] = Array.isArray(r.keywords)
    ? r.keywords
    : typeof r.keywords === 'string'
      ? r.keywords.split(',')
      : [];
  const tags = kw.filter((k): k is string => typeof k === 'string');
  const groups = keywordGroupsOf(String(r.title ?? ''), tags.join(' ')).filter(
    (g) => g !== OTHER_GROUP,
  );
  const names = keywordGroupNames();
  for (const k of tags) {
    if (typeof k === 'string' && names.includes(k) && !groups.includes(k))
      groups.push(k);
  }
  return subtypeIdsOfGroups(groups);
}

export function exportRowOf(
  r: Record<string, any>,
  field: string,
  englishNames: Record<string, string> = {},
): ExportArticle {
  const publishedAt =
    r.published_at instanceof Date
      ? r.published_at.toISOString().slice(0, 10)
      : String(r.published_at ?? '');
  return {
    id: Number(r.id),
    title: String(r.title ?? ''),
    source: String(r.source ?? ''),
    publishedAt,
    publishedTs: iso(r.published_ts),
    sourceUrl: String(r.source_url ?? ''),
    field,
    category: String(r.category ?? ''),
    clusterId: r.cluster_id == null ? null : String(r.cluster_id),
    tier: r.tier === 'archive' ? 'archive' : 'publish',
    sourceGrade: r.source_grade == null ? null : String(r.source_grade),
    sourceType: r.source_type == null ? null : String(r.source_type),
    subtype: subtypeOfRow(r),
    sourceEn:
      r.source_type === 'broadcast'
        ? (englishNames[String(r.source ?? '')] ?? null)
        : null,
  };
}

@Injectable()
export class ExportService {
  private cols: { at: number; value: Cols } | null = null;

  constructor(@Optional() private readonly dataSource?: DataSource) {}

  private async columns(query: QueryFn, now = Date.now()): Promise<Cols> {
    if (this.cols && now - this.cols.at < 10 * 60_000) return this.cols.value;
    const [tier, sourceGrade, clusterId, deletedAt, publishedTs] =
      await Promise.all(
        [
          'tier',
          'source_grade',
          'cluster_id',
          'deleted_at',
          'published_ts',
        ].map((c) => columnExists(query, 'articles', c)),
      );
    const value = { tier, sourceGrade, clusterId, deletedAt, publishedTs };
    this.cols = { at: now, value };
    return value;
  }

  async page(q: ExportQuery): Promise<ExportPage> {
    const field = fieldProfile().field;
    const out: ExportPage = {
      field,
      version: 'v0',
      limit: EXPORT_PAGE,
      items: [],
      nextCursor: null,
    };
    if (!this.dataSource?.isInitialized) return out;
    const query: QueryFn = (sql, params) => this.dataSource!.query(sql, params);
    const { sql, params } = buildExportSql(q, await this.columns(query));
    const rows = await query(sql, params);
    const more = rows.length > EXPORT_PAGE;
    const shown = rows.slice(0, EXPORT_PAGE);
    const en = broadcastEnglishNames();
    out.items = shown.map((r) => exportRowOf(r, field, en));
    const last = shown[shown.length - 1];
    if (more && last) out.nextCursor = encodeCursor(Number(last.id));
    return out;
  }
}
