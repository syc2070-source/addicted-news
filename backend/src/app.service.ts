import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { BroadcastFeedStatus } from './crawler/broadcast_feeds';
import { lastCrawlRun, LastRunPublic, recentCrawlRuns, RunPublic } from './crawler/crawl_runs';
import { alertFactsOf, evaluateRunAlerts, RunAlert } from './crawler/run_alerts';
import { columnExists, tableExists } from './crawler/schema_probe';
import { buildAllSources } from './crawler/sourceConfig';
import { youtubeApiMode } from './crawler/youtube_api';

const STARTED_AT = new Date().toISOString();
const LAST_RUN_TTL_MS = 60_000;

export type Health = { ok: true; commit: string; startedAt: string };
/** NEWS-Q4 ■4: 묶음 열(묶음 SQL 3) 인식 · 피드 건강(설정 기준 막힌 피드 수) */
export type HealthSchema = { cluster_columns: boolean | null };
export type HealthFeeds = { blocked_from_host: number; blocked: number; substitutes: number };
/** NEWS-Q5 ■1: alerts = 마지막 실행의 경보(코드·값 · 없으면 [] · DB 못 닿으면 null) */
export type HealthWithRun = Health & {
  lastRun: LastRunPublic | null;
  schema: HealthSchema;
  feeds: HealthFeeds | null;
  alerts: RunAlert[] | null;
  broadcast: HealthBroadcast;
};
/** NEWS-Q6 ■4: 방송 되짚기(YouTube Data API) — 열쇠 유무(on|off)와 마지막 실행 되짚기 수 */
export type HealthBroadcast = {
  api: 'on' | 'off';
  lastRun: {
    mode: 'on' | 'off'; items: number | null; newItems: number | null; keywordPass: number | null;
    units: number | null; quotaStopped: boolean;
  } | null;
  /** NEWS-Q8 ■2: 마지막 실행의 방송 채널별 읽기 결과(ok/404/500/api_quota · via api/rss · 항목 · 시각 · 기록 없으면 null) */
  feeds: BroadcastFeedStatus[] | null;
};

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
          value = await recentCrawlRuns(q, lim, {
            clusterStatsColumn: await columnExists(q, 'crawl_runs', 'cluster_stats'),
            rejectReasons: await tableExists(q, 'rejected_articles'),
          });
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

  private alertsCache: {
    at: number; value: RunAlert[] | null; api: Record<string, unknown> | null; feeds: BroadcastFeedStatus[] | null;
  } | null = null;

  /**
   * NEWS-Q5 ■1: 마지막 실행의 경보. 수집기가 저장한 per_source.__run.alerts 가 있으면 그대로,
   * 없는 옛 실행은 최근 6 행 숫자로 같은 규칙을 다시 센다(429 칸은 기록이 없어 건너뜀). 60초 기억.
   */
  async alerts(now = Date.now()): Promise<RunAlert[] | null> {
    if (this.alertsCache && now - this.alertsCache.at < LAST_RUN_TTL_MS) return this.alertsCache.value;
    let value: RunAlert[] | null = null;
    let api: Record<string, unknown> | null = null;
    let feeds: BroadcastFeedStatus[] | null = null;
    try {
      if (this.dataSource?.isInitialized) {
        const q = (sql: string, params?: unknown[]) => this.dataSource!.query(sql, params);
        if (await tableExists(q, 'crawl_runs')) {
          const runs = await recentCrawlRuns(q, 6);
          const stored = runs[0]?.progress?.alerts;
          value = Array.isArray(stored) ? (stored as RunAlert[]) : evaluateRunAlerts(runs.map(alertFactsOf));
          const a = runs[0]?.progress?.broadcastApi;
          api = a && typeof a === 'object' ? (a as Record<string, unknown>) : null;
          feeds = runs[0]?.broadcast?.feeds ?? null;
        }
      }
    } catch {
      value = null;
    }
    this.alertsCache = { at: now, value, api, feeds };
    return value;
  }

  /**
   * NEWS-Q6 ■4: 방송 되짚기 — api = 이 서비스 env 에 YOUTUBE_API_KEY 가 있나(on|off · 값 0) ·
   * 마지막 실행의 되짚기 수(영상 · RSS 에 없던 것 · 핵심어 통과 · 단위 · 할당량 멈춤). 기록 없으면 null.
   */
  async broadcast(env: NodeJS.ProcessEnv = process.env): Promise<HealthBroadcast> {
    await this.alerts();
    const a = this.alertsCache?.api ?? null;
    const n = (k: string) => (a && typeof a[k] === 'number' ? (a[k] as number) : null);
    return {
      api: youtubeApiMode(env),
      lastRun: a
        ? { mode: a.mode === 'on' ? 'on' : 'off', items: n('items'), newItems: n('newItems'), keywordPass: n('keywordPass'),
          units: n('units'), quotaStopped: a.quotaStopped === true }
        : null,
      feeds: this.alertsCache?.feeds ?? null,
    };
  }

  async getHealthWithRun(env: NodeJS.ProcessEnv = process.env): Promise<HealthWithRun> {
    let lastRun: LastRunPublic | null = null;
    try {
      lastRun = await this.lastRun();
    } catch {
      lastRun = null;
    }
    return {
      ...this.getHealth(env), lastRun, schema: await this.schema(), feeds: blockedFeeds(), alerts: await this.alerts(),
      broadcast: await this.broadcast(env),
    };
  }
}
