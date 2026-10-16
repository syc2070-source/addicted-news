// NEWS-Q7 ■3: 놓친 날 되짚기 1회 — 기사 단계를 못 돈 실행(예: 10-15 방송에서 62분 멈춤 · 기사 소스 0 닿음)이 있으면
// 다음 실행이 그 날짜 범위를 한 번 더 읽는다. LLM 0(규칙만) · 중복 검사·관문은 평소 그대로.
//
// 왜 구글 site: 검색인가: 국내지 RSS 는 몇 시간 치만 들고 있다(10-16 13시 실측: 연합 120 · 뉴시스 100 항목이 모두 10-16).
// 하루 지나면 피드에서 사라지므로 피드를 더 깊이 읽어도 못 메운다. 그래서 국내지마다 구글뉴스
// 「site:매체 (분야 검색어) after:결손 전날 before:결손 다음날」을 한 번 읽는다. 기관·학술 피드는 몇 주 치를 들고 있어 그대로.
//
// 「1회」: 이번 실행이 메운 결손 실행의 시작 시각을 progress.missedLookback.covers 에 남기고, 다음 실행은 그 실행을 다시 메우지 않는다.
import type { SourceConfig } from './sourceConfig';
import { RUN_KEY, type QueryFn } from './crawl_schedule';

/** 설정 sources.missed_day — 없으면 되짚기 끔. */
export interface MissedDayConfig {
  /** 구글뉴스 검색어(분야 낱말 · 꼴: "(낱말1 OR 낱말2)") */
  query: string;
  /** 매체 하나당 읽을 항목(기본 20) */
  max_items?: number;
  /** 이보다 오래된 결손 실행은 메우지 않음(일 · 기본 3) */
  max_days?: number;
  /** 구글뉴스 언어 꼬리(기본 hl=ko&gl=KR&ceid=KR:ko) */
  locale?: string;
}

/** 지난 실행 한 줄(읽기 전용 제외 · 최근 것 먼저). */
export interface RunBrief {
  startedAt: string;
  reached: number | null;
  total: number | null;
  timedOut: boolean;
  stoppedAt: string | null;
  /** 그 실행이 메운 결손 실행의 시작 시각들 */
  covers: string[];
}

export interface MissedPlan {
  /** 메울 결손 실행(시작 시각) */
  covers: string[];
  /** 검색 범위 KST 날짜(after 포함 · before 제외) */
  after: string;
  before: string;
}

export interface MissedLookbackRecord extends MissedPlan {
  sources: number;
}

const DAY_MS = 24 * 3600 * 1000;

function kstDate(ms: number): string {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 기사 단계를 거의 못 돈 실행인가(닿은 소스가 절반 미만이고 상한에 걸렸거나 0 닿음). 기록 없는 옛 실행은 아님. */
export function isMissedRun(r: RunBrief): boolean {
  if (r.reached == null || r.total == null || r.total <= 0) return false;
  if (r.reached === 0) return true;
  return r.reached < r.total / 2 && (r.timedOut || r.stoppedAt === 'articles');
}

/**
 * 메울 결손이 있으면 범위를 낸다. runs = 지난 실행들(최근 것 먼저 · 이번 실행 제외).
 * after = 결손 앞 마지막 정상 실행의 KST 날짜(없으면 결손 전날) · before = 가장 최근 결손 날짜 다음날.
 */
export function planMissedDay(runs: RunBrief[], now: number = Date.now(), maxDays = 3): MissedPlan | null {
  const covered = new Set(runs.flatMap((r) => r.covers));
  const pending = runs.filter(
    (r) => isMissedRun(r) && !covered.has(r.startedAt) && now - Date.parse(r.startedAt) <= maxDays * DAY_MS,
  );
  if (!pending.length) return null;
  const oldest = Math.min(...pending.map((r) => Date.parse(r.startedAt)));
  const newest = Math.max(...pending.map((r) => Date.parse(r.startedAt)));
  const goodBefore = runs.find((r) => !isMissedRun(r) && Date.parse(r.startedAt) < oldest);
  const afterMs = goodBefore ? Date.parse(goodBefore.startedAt) : oldest - DAY_MS;
  return {
    covers: pending.map((r) => r.startedAt),
    after: kstDate(afterMs),
    before: kstDate(newest + DAY_MS),
  };
}

/** 피드 주소 → site: 에 넣을 호스트(앞의 rss./feed(s)./www. 뗌). 못 읽으면 null. */
export function siteHostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(rss|feeds?|www)\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * 결손 범위 → 국내지마다 구글뉴스 site: 날짜 검색 소스 하나(id = 원 id + "-missed" · 무리는 kr_press 그대로).
 * 막힌 피드(대체 검색이 이미 when:7d 로 읽음)는 뺀다.
 */
export function missedDaySources(sources: SourceConfig[], plan: MissedPlan, cfg: MissedDayConfig): SourceConfig[] {
  const locale = cfg.locale || 'hl=ko&gl=KR&ceid=KR:ko';
  const out: SourceConfig[] = [];
  for (const s of sources) {
    if (s.sourceType !== 'kr_press' || s.blocked) continue;
    const host = siteHostOf(s.url);
    if (!host) continue;
    const q = `site:${host} ${cfg.query} after:${plan.after} before:${plan.before}`;
    out.push({
      ...s,
      id: `${s.id}-missed`,
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(q).replace(/%20/g, '+')}&${locale}`,
      format: 'rss',
      listPattern: undefined,
      jsonMap: undefined,
      maxItems: cfg.max_items ?? 20,
      substituteFor: s.id,
      maxAgeDays: undefined,
    });
  }
  return out;
}

/** 최근 실행(읽기 전용 제외)의 진행 기록 — 표·기록이 없거나 실패면 []. */
export async function recentRunBriefs(query: QueryFn, field: string, days = 4): Promise<RunBrief[]> {
  try {
    const rows = await query(
      `SELECT started_at, timed_out, per_source FROM crawl_runs
        WHERE read_only = false AND field = $1 AND started_at > now() - ($2::int * interval '1 day')
        ORDER BY started_at DESC LIMIT 20`,
      [field, days],
    );
    return (rows || []).map((row: any) => {
      const ps = typeof row.per_source === 'string' ? JSON.parse(row.per_source) : row.per_source;
      const p = ps?.[RUN_KEY] || null;
      const covers = Array.isArray(p?.missedLookback?.covers) ? p.missedLookback.covers.map(String) : [];
      return {
        startedAt: new Date(row.started_at).toISOString(),
        reached: typeof p?.reached === 'number' ? p.reached : null,
        total: typeof p?.total === 'number' ? p.total : null,
        timedOut: !!(p?.timedOut ?? row.timed_out),
        stoppedAt: typeof p?.stoppedAt === 'string' ? p.stoppedAt : null,
        covers,
      };
    });
  } catch {
    return [];
  }
}
