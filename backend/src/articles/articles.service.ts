// backend/src/articles/articles.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, LessThan, Like, Not, Or, Repository } from 'typeorm';
import { Article } from './article.entity';
import { columnExists } from '../crawler/schema_probe';
import { fieldProfile } from '../crawler/field_profile';
import { ClusterInfo, clusterDocs, clusterRules, docTs, leadOf, paraOf, pickRepresentative } from '../crawler/event_cluster';
import { GroupMode, LightRow, groupIds, membersOf, rankTop, rankTopWeighted, shownId, visibleSql } from './cluster_view';

/** 카테고리 slug → 이름(분야 설정 categories.slugs · NEWS-Q2 ■1). */
export function categoryKeyFor(slug: string): string {
  return fieldProfile().categories.slugs[slug] || slug;
}

/** 공개 목록 종류: 기본은 기사만, 방송은 ?kind=broadcast 로만(NEWS-Q1 ■4ⓓ). */
export type ArticleKind = 'article' | 'broadcast';

export function parseKind(value?: string): ArticleKind {
  return value === 'broadcast' ? 'broadcast' : 'article';
}

/** 관문 층: 기본 publish, 보관은 ?tier=archive 로만(NEWS-Q2 ■6). */
export type ArticleTier = 'publish' | 'archive';

export function parseTier(value?: string): ArticleTier {
  return value === 'archive' ? 'archive' : 'publish';
}

export interface VisibleOpts {
  kind: ArticleKind;
  deletedAtAvailable: boolean;
  tier?: ArticleTier;
  tierAvailable?: boolean;
}

/**
 * 공개 조회 공통 조건.
 *  · blocked=false (기존)
 *  · 종류: 방송 = source_type 'broadcast', 기사 = 그 밖(NULL 포함)
 *  · deleted_at 열이 있으면 deleted_at IS NULL 만(soft 삭제 숨김, NEWS-Q1 ■1ⓑ)
 *  · tier 열이 있으면 요청한 층만(기본 publish). 열이 없으면 publish 만 있는 셈 → archive 요청은 빈 결과.
 */
export function visibleWhere(extra: FindOptionsWhere<Article>, opts: VisibleOpts): FindOptionsWhere<Article> {
  const where: FindOptionsWhere<Article> = {
    ...extra,
    blocked: false,
    sourceType: opts.kind === 'broadcast' ? 'broadcast' : Or(IsNull(), Not('broadcast')),
  };
  if (opts.deletedAtAvailable) where.deletedAt = IsNull();
  const tier = opts.tier || 'publish';
  if (opts.tierAvailable) where.tier = tier;
  else if (tier === 'archive') where.id = LessThan(0);
  return where;
}

/** 「최신」 표시(NEWS-Q2 ■7): 보도 시각(없으면 보도 날짜 KST 0시)이 freshness_hours 안이면 true. 지우지 않는다. */
export function isFresh(publishedTs: Date | null | undefined, publishedAt: string | Date | null | undefined, hours: number, now = new Date()): boolean {
  let t = publishedTs ? new Date(publishedTs).getTime() : NaN;
  if (Number.isNaN(t) && publishedAt) {
    // published_at 은 DB 에서 date 로 읽혀 Date 가 올 수 있다(API 응답 꼴 2026-10-09T00:00:00.000Z).
    const ymd = (publishedAt instanceof Date ? publishedAt.toISOString() : String(publishedAt)).slice(0, 10);
    t = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? Date.parse(`${ymd}T00:00:00+09:00`) : Date.parse(String(publishedAt));
  }
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= hours * 3600 * 1000 && t <= now.getTime() + 3600 * 1000;
}

type Flags = { deletedAt: boolean; tier: boolean; publishedTs: boolean; sourceGrade: boolean; clusterId: boolean };

/** NEWS-Q3: 묶음 계산 기억(10분). 열(cluster_id) 없으면 최근 7일을 응답 때 계산한다. */
export const CLUSTER_TTL_MS = 10 * 60 * 1000;
export const CLUSTER_COMPUTE_DAYS = 7;
/** 묶음 단위 목록에서 훑는 최대 행 수(새 것부터). */
const GROUP_SCAN_MAX = 4000;

interface ClusterState {
  at: number;
  mode: 'column' | 'computed';
  index: Map<number, ClusterInfo>;
  light: Map<number, LightRow>;
}

type Decorated = Article & {
  publishedTs: Date | null;
  sourceGrade: string | null;
  isFresh: boolean;
  clusterId?: string | null;
  clusterSize?: number;
  representative?: boolean;
  clusterMembers?: LightRow[];
  topWindow?: '72h' | '7d';
};

@Injectable()
export class ArticlesService implements OnModuleInit {
  private readonly logger = new Logger(ArticlesService.name);
  private flags: Flags = { deletedAt: false, tier: false, publishedTs: false, sourceGrade: false, clusterId: false };
  private cluster: ClusterState | null = null;
  private clusterLoading: Promise<ClusterState> | null = null;

  constructor(
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
  ) {}

  async onModuleInit() {
    await this.refreshSchemaFlags();
  }

  /** 묶음 SQL 열이 섰는지 확인(시작할 때 한 번). 확인 실패는 "없음"(옛 동작). */
  async refreshSchemaFlags() {
    const q = (sql: string, params?: unknown[]) => this.articleRepo.query(sql, params);
    const [deletedAt, tier, publishedTs, sourceGrade, clusterId] = await Promise.all([
      columnExists(q, 'articles', 'deleted_at'),
      columnExists(q, 'articles', 'tier'),
      columnExists(q, 'articles', 'published_ts'),
      columnExists(q, 'articles', 'source_grade'),
      columnExists(q, 'articles', 'cluster_id'),
    ]);
    this.flags = { deletedAt, tier, publishedTs, sourceGrade, clusterId };
    this.logger.log(
      `articles 열: deleted_at ${deletedAt ? '있음(soft 삭제 숨김)' : '없음'} · tier ${tier ? '있음(보관 숨김)' : '없음'} · ` +
      `published_ts ${publishedTs ? '있음' : '없음'} · source_grade ${sourceGrade ? '있음' : '없음'} · ` +
      `cluster_id ${clusterId ? '있음(저장된 묶음)' : '없음(응답 때 최근 7일 계산)'}`,
    );
  }

  private where(extra: FindOptionsWhere<Article> = {}, kind: ArticleKind = 'article', tier: ArticleTier = 'publish') {
    return visibleWhere(extra, {
      kind, tier, deletedAtAvailable: this.flags.deletedAt, tierAvailable: this.flags.tier,
    });
  }

  // ---------- NEWS-Q3: 사건 묶음 ----------
  private q(sql: string, params?: unknown[]): Promise<any[]> {
    return this.articleRepo.query(sql, params);
  }

  private lightOf(r: any): LightRow {
    const publishedAt = r.published_at instanceof Date ? r.published_at.toISOString() : String(r.published_at ?? '');
    const publishedTs = r.published_ts ? new Date(r.published_ts) : null;
    return {
      id: Number(r.id),
      title: r.title,
      source: r.source,
      sourceUrl: r.source_url,
      publishedAt,
      publishedTs,
      sourceGrade: r.source_grade ?? null,
      category: r.category ?? null,
      ts: docTs(publishedTs, publishedAt),
    };
  }

  /** 최근 7일 공개 기사(가벼운 칸 + 묶기 재료). */
  private async recentRows(days: number): Promise<any[]> {
    const f = this.flags;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const ymd = since.toISOString().slice(0, 10);
    const cols = [
      'id', 'title', 'original_title', 'summary', 'teaser', 'source', 'source_url', 'published_at', 'category',
      f.publishedTs ? 'published_ts' : 'NULL AS published_ts',
      f.sourceGrade ? 'source_grade' : 'NULL AS source_grade',
      f.clusterId ? 'cluster_id, cluster_size' : 'NULL AS cluster_id, 1 AS cluster_size',
    ].join(', ');
    const timeCond = f.publishedTs
      ? `(published_ts >= $1 OR (published_ts IS NULL AND published_at::text >= $2))`
      : `published_at::text >= $2`;
    return this.q(`SELECT ${cols} FROM articles WHERE ${visibleSql(f)} AND ${timeCond} ORDER BY id DESC LIMIT 3000`, [since, ymd]);
  }

  private async buildClusterState(): Promise<ClusterState> {
    const prof = fieldProfile();
    const rows = await this.recentRows(CLUSTER_COMPUTE_DAYS);
    const light = new Map<number, LightRow>(rows.map((r) => [Number(r.id), this.lightOf(r)]));
    let mode: ClusterState['mode'] = 'computed';
    let index = new Map<number, ClusterInfo>();

    if (this.flags.clusterId) {
      // 저장된 묶음(수집기가 최근 30일을 채움). 아직 비어 있으면 계산 길로.
      const f = this.flags;
      const stored: any[] = await this.q(
        `SELECT id, title, source, source_url, published_at, category, cluster_id, cluster_size,
                ${f.publishedTs ? 'published_ts' : 'NULL AS published_ts'}, ${f.sourceGrade ? 'source_grade' : 'NULL AS source_grade'}
           FROM articles WHERE ${visibleSql(f)} AND cluster_id IS NOT NULL AND cluster_size > 1
          ORDER BY id DESC LIMIT 5000`,
      ).catch(() => []);
      if (stored.length) {
        mode = 'column';
        const byCluster = new Map<string, LightRow[]>();
        for (const r of stored) {
          const lr = this.lightOf(r);
          light.set(lr.id, lr);
          const k = String(r.cluster_id);
          (byCluster.get(k) || byCluster.set(k, []).get(k)!).push(lr);
        }
        for (const [clusterId, members] of byCluster) {
          if (members.length < 2) continue;
          const docs = members.map((m) => ({ id: m.id, title: m.title, ts: m.ts, grade: m.sourceGrade }));
          const sorted = [...members].sort((a, b) => a.ts - b.ts || a.id - b.id);
          const info: ClusterInfo = {
            clusterId,
            size: members.length,
            representativeId: pickRepresentative(docs).id,
            memberIds: sorted.map((m) => m.id),
          };
          for (const m of members) index.set(m.id, info);
        }
      }
    }
    if (mode === 'computed') {
      index = clusterDocs(
        rows.map((r) => ({
          id: Number(r.id),
          title: r.title,
          altTitle: r.original_title,
          lead: leadOf(r.summary || r.teaser),
          para: paraOf(r.summary || r.teaser),
          ts: light.get(Number(r.id))!.ts,
          grade: r.source_grade ?? null,
        })),
        { fieldStopwords: prof.keywords.dup_stopwords, ignoreLeads: [prof.prompts.fallback_summary_line] },
      );
    }
    return { at: Date.now(), mode, index, light };
  }

  /** 묶음 상태(10분 기억 · 동시에 여럿이 불러도 한 번만 계산). 실패하면 빈 묶음(옛 꼴로 보임). */
  async clusterState(): Promise<ClusterState> {
    if (this.cluster && Date.now() - this.cluster.at < CLUSTER_TTL_MS) return this.cluster;
    if (!this.clusterLoading) {
      this.clusterLoading = this.buildClusterState()
        .catch((e) => {
          this.logger.warn(`묶음 계산 실패(묶지 않고 보임): ${(e as Error).message}`);
          return { at: Date.now(), mode: 'computed' as const, index: new Map(), light: new Map() };
        })
        .then((s) => {
          this.cluster = s;
          this.clusterLoading = null;
          return s;
        });
    }
    return this.clusterLoading;
  }

  /** 응답에 publishedTs·sourceGrade(열 있을 때)·isFresh 칸을 붙인다. */
  private async decorate<T extends Article>(items: T[]): Promise<Decorated[]> {
    const hours = fieldProfile().freshness_hours;
    const extra = new Map<number, { ts: Date | null; grade: string | null }>();
    if ((this.flags.publishedTs || this.flags.sourceGrade) && items.length) {
      try {
        const rows: Array<{ id: number; published_ts: Date | null; source_grade: string | null }> = await this.articleRepo.query(
          `SELECT id, ${this.flags.publishedTs ? 'published_ts' : 'NULL AS published_ts'},
                  ${this.flags.sourceGrade ? 'source_grade' : 'NULL AS source_grade'}
             FROM articles WHERE id = ANY($1::int[])`,
          [items.map((a) => a.id)],
        );
        for (const r of rows) extra.set(Number(r.id), { ts: r.published_ts, grade: r.source_grade });
      } catch (e) {
        this.logger.warn(`published_ts·source_grade 읽기 실패(날짜로 대신): ${(e as Error).message}`);
      }
    }
    return items.map((a) => {
      const x = extra.get(a.id);
      const p = x?.ts ?? null;
      return Object.assign(a, { publishedTs: p, sourceGrade: x?.grade ?? null, isFresh: isFresh(p, a.publishedAt, hours) });
    });
  }

  private async decorateOne<T extends Article>(a: T | null) {
    if (!a) return a;
    const [d] = await this.decorate([a]);
    return d;
  }

  /** 묶음 칸(clusterId·clusterSize·representative)을 붙인다(group=none 에도 · 접지는 않음). */
  private withClusterFields(items: Decorated[], st: ClusterState): Decorated[] {
    for (const a of items) {
      const info = st.index.get(a.id);
      a.clusterId = info && info.size > 1 ? info.clusterId : null;
      a.clusterSize = info?.size || 1;
      a.representative = !info || info.size < 2 || info.representativeId === a.id;
    }
    return items;
  }

  /**
   * 묶음 단위 목록(■2·■3): 조건에 맞는 id 를 새 것부터 훑어 묶음으로 접고, 페이지만큼 대표를 읽는다.
   * 반환 items 마다 clusterMembers(같은 소식 · 매체별 제목·시각·원문) 를 붙인다.
   */
  private async groupedPage(
    where: FindOptionsWhere<Article> | FindOptionsWhere<Article>[],
    page: number,
    limit: number,
  ): Promise<{ items: Decorated[]; total: number; rows: number; folded: number }> {
    const st = await this.clusterState();
    const idRows = await this.articleRepo.find({
      select: { id: true },
      where,
      order: { publishedAt: 'DESC', id: 'DESC' },
      take: GROUP_SCAN_MAX,
    });
    const groups = groupIds(idRows.map((r) => r.id), st.index);
    const pageGroups = groups.slice((page - 1) * limit, (page - 1) * limit + limit);
    const shown = pageGroups.map((g) => shownId(g));
    const rows = shown.length ? await this.articleRepo.findBy({ id: In(shown) }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = shown.map((id) => byId.get(id)).filter((a): a is Article => !!a);
    const items = this.withClusterFields(await this.decorate(ordered), st);
    pageGroups.forEach((g, i) => {
      const a = items.find((x) => x.id === shown[i]);
      if (!a) return;
      a.clusterMembers = membersOf(g.info, a.id, st.light);
      if (g.info) {
        a.clusterSize = g.info.size;
        a.representative = g.info.representativeId === a.id;
      }
    });
    // NEWS-Q11 ■1: 목록 요약 — 기사 행 수(훑은 만큼) · 묶음에 접힌 수(대표 한 줄 뒤로 들어간 기사)
    return { items, total: groups.length, rows: idRows.length, folded: idRows.length - groups.length };
  }

  /** NEWS-Q11 ■1: 페이지 응답의 요약 칸(묶음 단위면 접힌 수 · 아니면 접지 않음 = 0). */
  private pageSummary(r: { total: number; rows?: number; folded?: number }, grouped: boolean) {
    return grouped ? { rows: r.rows ?? r.total, folded: r.folded ?? 0 } : { rows: r.total, folded: 0 };
  }

  private async plainList(where: FindOptionsWhere<Article> | FindOptionsWhere<Article>[], take: number, skip = 0) {
    const [items, total] = await this.articleRepo.findAndCount({
      where,
      order: { publishedAt: 'DESC', id: 'DESC' },
      skip,
      take,
    });
    const st = await this.clusterState();
    return { items: this.withClusterFields(await this.decorate(items), st), total };
  }

  /** 묶음으로 접을지: 기사 · publish 층 · group=cluster 일 때만(방송·보관은 옛 꼴). */
  private grouping(kind: ArticleKind, tier: ArticleTier, group: GroupMode): boolean {
    return group === 'cluster' && kind === 'article' && tier === 'publish';
  }

  // 최신 기사
  async getLatest(limit: number, kind: ArticleKind = 'article', tier: ArticleTier = 'publish', group: GroupMode = 'cluster') {
    const where = this.where({}, kind, tier);
    if (this.grouping(kind, tier, group)) return (await this.groupedPage(where, 1, limit)).items;
    return (await this.plainList(where, limit)).items;
  }

  /**
   * TOP 뉴스(NEWS-Q3 ■2 · NEWS-Q18 ■3): 분야 설정 top_rank 무게 점수 큰 순(동점 = 새 보도) · top_rank 가 없으면 옛 규칙(cluster_size 큰 순).
   * 72시간 안 묶음이 3 개보다 적으면 최근 7일로 넓히고 topWindow='7d' 로 표시. 관리자가 고른 isTop 은 72시간 안 것만 맨 앞에.
   */
  async getTopNews() {
    const st = await this.clusterState();
    const manual = (await this.decorate(await this.articleRepo.find({
      where: this.where({ isTop: true }),
      order: { publishedAt: 'DESC' },
      take: 3,
    }))).filter((a) => a.isFresh);
    // NEWS-Q18 ■3: 분야 설정 top_rank 가 있으면 무게 규칙(전국 매체 · 기관 발표 · 지역 캠페인 · 같은 소식 건수) · 없으면 옛 규칙(묶음 크기)
    const rule = fieldProfile().top_rank;
    const picks = rule ? rankTopWeighted(st.light, st.index, Date.now(), rule, 3) : rankTop(st.light, st.index, Date.now(), 3);
    const ids = picks.map((p) => p.id).filter((id) => !manual.some((m) => m.id === id));
    const rows = ids.length ? await this.articleRepo.findBy({ id: In(ids) }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const auto = await this.decorate(ids.map((id) => byId.get(id)).filter((a): a is Article => !!a));
    const window = picks[0]?.window || '72h';
    const out = this.withClusterFields([...manual, ...auto].slice(0, 3), st);
    for (const a of out) {
      const info = st.index.get(a.id) || null;
      a.clusterMembers = membersOf(info && info.size > 1 ? info : null, a.id, st.light);
      a.topWindow = manual.includes(a) ? '72h' : window;
    }
    return out;
  }

  // 기획기사
  async getFeatured() {
    return this.decorate(await this.articleRepo.find({
      where: this.where({ isFeature: true }),
      order: { publishedAt: 'DESC' },
      take: 5,
    }));
  }

  // 라파뉴스
  async getRaphaNews() {
    return this.decorate(await this.articleRepo.find({
      where: this.where({ isRapha: true }),
      order: { publishedAt: 'DESC' },
      take: 2,
    }));
  }

  // 이슈: 관리자가 고른 isIssue · 없으면 묶음 단위 최신(같은 소식은 한 줄)
  async getIssueNews(limit: number = 5, group: GroupMode = 'cluster') {
    const picked = await this.articleRepo.find({
      where: this.where({ isIssue: true }),
      order: { publishedAt: 'DESC' },
      take: limit,
    });
    if (picked.length) return this.withClusterFields(await this.decorate(picked), await this.clusterState());
    return this.getLatest(limit, 'article', 'publish', group);
  }

  // 카테고리별 기사
  async getByCategory(slug: string, limit: number, kind: ArticleKind = 'article', tier: ArticleTier = 'publish', group: GroupMode = 'cluster') {
    const where = this.where({ category: categoryKeyFor(slug) }, kind, tier);
    if (this.grouping(kind, tier, group)) return (await this.groupedPage(where, 1, limit)).items;
    return (await this.plainList(where, limit)).items;
  }

  // 카테고리별 기사 (페이징)
  async getByCategoryPaged(
    slug: string, page: number, limit: number, kind: ArticleKind = 'article', tier: ArticleTier = 'publish', group: GroupMode = 'cluster',
  ) {
    const where = this.where({ category: categoryKeyFor(slug) }, kind, tier);
    const grouped = this.grouping(kind, tier, group);
    const r = grouped ? await this.groupedPage(where, page, limit) : await this.plainList(where, limit, (page - 1) * limit);
    const { items, total } = r;
    return {
      items, total, page, limit, totalPages: Math.ceil(total / limit), group: grouped ? 'cluster' : 'none',
      ...this.pageSummary(r, grouped),
    };
  }

  // 기사 검색
  async search(q: string, limit: number, kind: ArticleKind = 'article', tier: ArticleTier = 'publish', group: GroupMode = 'cluster') {
    if (!q || q.trim().length < 2) {
      return [];
    }
    const where = [
      this.where({ title: Like(`%${q}%`) }, kind, tier),
      this.where({ summary: Like(`%${q}%`) }, kind, tier),
    ];
    if (this.grouping(kind, tier, group)) return (await this.groupedPage(where, 1, limit)).items;
    return (await this.plainList(where, limit)).items;
  }

  // 최신 기사 (페이징) — 기본 묶음 단위(group=cluster) · group=none 은 옛 꼴(랩·Statory 입구)
  async getLatestPaged(page: number, limit: number, kind: ArticleKind = 'article', tier: ArticleTier = 'publish', group: GroupMode = 'cluster') {
    const where = this.where({}, kind, tier);
    const grouped = this.grouping(kind, tier, group);
    const r = grouped ? await this.groupedPage(where, page, limit) : await this.plainList(where, limit, (page - 1) * limit);
    const { items, total } = r;
    return {
      items, total, page, limit, totalPages: Math.ceil(total / limit), group: grouped ? 'cluster' : 'none',
      ...this.pageSummary(r, grouped),
    };
  }

  /** 묶음 한 개(■3): id = 묶음 열쇠(cluster_id) 또는 묶음 안 아무 기사 id. 대표 + 매체 목록. */
  async getCluster(id: number) {
    const st = await this.clusterState();
    let info: ClusterInfo | null = st.index.get(id) || null;
    if (!info) {
      for (const v of st.index.values()) if (v.clusterId === String(id)) { info = v; break; }
    }
    const repId = info && info.size > 1 ? info.representativeId : id;
    const rep = await this.getOne(repId);
    if (!rep) return null;
    const light = info && info.size > 1
      ? info.memberIds.map((m) => st.light.get(m)).filter((r): r is LightRow => !!r)
      : [];
    // NEWS-Q4 ■3: 기사마다 같은 사건으로 본 근거(jaccard·noun·entity · 가장 이른 기사 = seed). 화면은 쓰지 않음.
    const rules = await this.memberRules(light.map((m) => m.id)).catch(() => new Map<number, string>());
    const members = light.map((m) => ({ ...m, rule: rules.get(m.id) ?? null }));
    return {
      clusterId: info && info.size > 1 ? info.clusterId : null,
      clusterSize: info?.size || 1,
      representative: rep,
      members,
      mode: st.mode,
    };
  }

  /** 묶음 기사들의 근거(묶음 하나 · 작은 읽기). */
  private async memberRules(ids: number[]): Promise<Map<number, string>> {
    if (ids.length < 2) return new Map();
    const prof = fieldProfile();
    const rows: any[] = await this.q(
      `SELECT id, title, original_title, summary, teaser, published_at,
              ${this.flags.publishedTs ? 'published_ts' : 'NULL AS published_ts'}
         FROM articles WHERE id = ANY($1::int[])`,
      [ids],
    );
    return clusterRules(
      rows.map((r) => ({
        id: Number(r.id), title: r.title, altTitle: r.original_title,
        lead: leadOf(r.summary || r.teaser), para: paraOf(r.summary || r.teaser),
        ts: docTs(r.published_ts, r.published_at),
      })),
      { fieldStopwords: prof.keywords.dup_stopwords, ignoreLeads: [prof.prompts.fallback_summary_line] },
    );
  }

  // 기사 상세 (종류·층 무관 · soft 삭제는 숨김)
  async getOne(id: number) {
    const where: FindOptionsWhere<Article> = { id, blocked: false };
    if (this.flags.deletedAt) where.deletedAt = IsNull();
    return this.decorateOne(await this.articleRepo.findOne({ where }));
  }
}
