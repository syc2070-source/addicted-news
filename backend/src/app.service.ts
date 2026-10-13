import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { lastCrawlRun, LastRunPublic, recentCrawlRuns, RunPublic } from './crawler/crawl_runs';
import { columnExists, tableExists } from './crawler/schema_probe';
import { buildAllSources } from './crawler/sourceConfig';

const STARTED_AT = new Date().toISOString();
const LAST_RUN_TTL_MS = 60_000;

export type Health = { ok: true; commit: string; startedAt: string };
/** NEWS-Q4 ■4: 묶음 열(묶음 SQL 3) 인식 · 피드 건강(설정 기준 막힌 피드 수) */
export type HealthSchema = { cluster_columns: boolean | null };
export type HealthFeeds = { blocked_from_host: number; blocked: number; substitutes: number };
export type HealthWithRun = Health & { lastRun: LastRunPublic | null; schema: HealthSchema; feeds: HealthFeeds | null };

/** 설정(피드 파일·분야 설정)의 막힌 피드 수 — 한 번만 센다. */
let feedsCache: HealthFeeds | null | undefined;
function blockedFeeds(): HealthFeeds | null {
  if (feedsCache !== undefined) return feedsCache;
  try {
    const all = buildAllSources();
    feedsCache = {
      blocked_from_host: all.filter((s) => s.blocked?.kind === 'blocked_from_host').length,
      blocked: all.filter((s) => !!s.blocked).length,
      substitutes: all.filter((s) => !!s.substituteFor).length,
    };
  } catch {
    feedsCache = null;
  }
  return feedsCache;
}

@Injectable()
export class AppService {
  private cache: { at: number; value: LastRunPublic | null } | null = null;
  private schemaCache: { at: number; value: HealthSchema } | null = null;

  constructor(@Optional() private readonly dataSource?: DataSource) {}

  getHello(): string {
    return 'addicted-news api ok';
  }

  /** 프로세스 상태(NEWS-Q1 ■2). Render 가 RENDER_GIT_COMMIT 을 넣는다. 인증·비밀 0. */
  getHealth(env: NodeJS.ProcessEnv = process.env): Health {
    return { ok: true, commit: env.RENDER_GIT_COMMIT || 'local', startedAt: STARTED_AT };
  }

  /** NEWS-Q2 ■8: 마지막 수집 실행 요약(숫자만 · crawl_runs 표 있을 때 · 60초 기억). 실패해도 health 는 200. */
  async lastRun(now = Date.now()): Promise<LastRunPublic | null> {
    if (this.cache && now - this.cache.at < LAST_RUN_TTL_MS) return this.cache.value;
    let value: LastRunPublic | null = null;
    if (this.dataSource?.isInitialized) {
      const q = (sql: string, params?: unknown[]) => this.dataSource!.query(sql, params);
      if (await tableExists(q, 'crawl_runs')) value = await lastCrawlRun(q);
    }
    this.cache = { at: now, value };
    return value;
  }

  private runsCache: { at: number; n: number; value: RunPublic[] } | null = null;

  /** NEWS-Q3 ■0·■5: 최근 수집 실행 n 개(숫자 · 40분 넘김 · 실패 피드 이름 · 묶음 절감). 60초 기억. 실패해도 200 + []. */
  async recentRuns(n = 5, now = Date.now()): Promise<RunPublic[]> {
    const lim = Math.max(1, Math.min(20, Math.floor(n) || 5));
    if (this.runsCache && this.runsCache.n === lim && now - this.runsCache.at < LAST_RUN_TTL_MS) return this.runsCache.value;
    let value: RunPublic[] = [];
    try {
      if (this.dataSource?.isInitialized) {
        const q = (sql: string, params?: unknown[]) => this.dataSource!.query(sql, params);
        if (await tableExists(q, 'crawl_runs')) {
          value = await recentCrawlRuns(q, lim, { clusterStatsColumn: await columnExists(q, 'crawl_runs', 'cluster_stats') });
        }
      }
    } catch {
      value = [];
    }
    this.runsCache = { at: now, n: lim, value };
    return value;
  }

  /** NEWS-Q4 ■4: articles.cluster_id·cluster_size 둘 다 있으면 true(DB 못 닿으면 null · 60초 기억). */
  async schema(now = Date.now()): Promise<HealthSchema> {
    if (this.schemaCache && now - this.schemaCache.at < LAST_RUN_TTL_MS) return this.schemaCache.value;
    let value: HealthSchema = { cluster_columns: null };
    try {
      if (this.dataSource?.isInitialized) {
        const q = (sql: string, params?: unknown[]) => this.dataSource!.query(sql, params);
        const [id, size] = await Promise.all([columnExists(q, 'articles', 'cluster_id'), columnExists(q, 'articles', 'cluster_size')]);
        value = { cluster_columns: id && size };
      }
    } catch {
      value = { cluster_columns: null };
    }
    this.schemaCache = { at: now, value };
    return value;
  }

  async getHealthWithRun(env: NodeJS.ProcessEnv = process.env): Promise<HealthWithRun> {
    let lastRun: LastRunPublic | null = null;
    try {
      lastRun = await this.lastRun();
    } catch {
      lastRun = null;
    }
    return { ...this.getHealth(env), lastRun, schema: await this.schema(), feeds: blockedFeeds() };
  }
}
