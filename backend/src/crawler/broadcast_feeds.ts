// ============================================================
// broadcast_feeds.ts (NEWS-Q8 ■2) — 방송 채널별 마지막 읽기 결과(health · health/runs 의 broadcast.feeds[]).
// 수집기가 채널마다 한 줄을 per_source.__run.broadcastFeeds 에 남긴다. 그 칸이 없는 옛 실행은
// failed_feeds · 되짚기 기록(broadcastApi) · per_source 읽은 수로 같은 꼴을 다시 만든다(시각 = 실행 시작 · recorded false).
// 운영 수치만 — 공개 목록 화면은 이 칸을 쓰지 않는다.
// ============================================================
import type { ChannelPlan } from './youtube_api';

export interface BroadcastFeedStatus {
  /** 채널 outlet_id */
  id: string;
  /** 한 낱말 결과: ok(어느 길로든 읽음) · RSS 상태 코드(404·500·ERR) · api_quota · api_error */
  result: string;
  /** 읽은 길: api(되짚기만) · rss · rss+api · none(못 읽음) */
  via: 'api' | 'rss' | 'rss+api' | 'none';
  /** RSS: ok · 상태 코드 · skip(묻지 않음) */
  rss: string;
  /** 되짚기 API: ok · quota(할당량) · error · skip(오늘 이미 · 묻지 않음) · off(열쇠 없음) */
  api: 'ok' | 'quota' | 'error' | 'skip' | 'off';
  /** 이번에 읽은 영상 수(RSS + 되짚기 새 것) */
  items: number;
  /** 읽은 시각(ISO) */
  at: string | null;
  /** false = 옛 실행 기록으로 다시 만든 줄 */
  recorded: boolean;
}

const QUOTA_REASONS = /quota|dailyLimitExceeded/i;

function resultOf(via: BroadcastFeedStatus['via'], rss: string, api: BroadcastFeedStatus['api']): string {
  if (via !== 'none') return 'ok';
  if (api === 'quota') return 'api_quota';
  if (rss !== 'ok' && rss !== 'skip') return rss;
  return api === 'error' ? 'api_error' : 'none';
}

function viaOf(rss: string, api: BroadcastFeedStatus['api']): BroadcastFeedStatus['via'] {
  if (rss === 'ok' && api === 'ok') return 'rss+api';
  if (rss === 'ok') return 'rss';
  if (api === 'ok') return 'api';
  return 'none';
}

/** 수집기에서 채널 하나를 읽은 뒤 한 줄(newsCrawler.crawlBroadcastSources). */
export function feedStatusOf(o: {
  id: string;
  plan: ChannelPlan;
  hasKey: boolean;
  rssTried: boolean;
  rssFailed: string | null;
  apiError?: { status: number | null; reason: string } | null;
  items: number;
  at: Date;
}): BroadcastFeedStatus {
  const rss = !o.rssTried ? 'skip' : o.rssFailed ? o.rssFailed : 'ok';
  let api: BroadcastFeedStatus['api'];
  if (!o.hasKey) api = 'off';
  else if (!o.plan.api) api = o.plan.reason === 'quota' ? 'quota' : 'skip';
  else if (o.apiError) api = QUOTA_REASONS.test(o.apiError.reason) ? 'quota' : 'error';
  else api = 'ok';
  const via = viaOf(rss, api);
  return { id: o.id, result: resultOf(via, rss, api), via, rss, api, items: o.items, at: o.at.toISOString(), recorded: true };
}

/**
 * 실행 한 행 → 방송 채널 줄들. 수집기가 남긴 broadcastFeeds 가 있으면 그대로,
 * 없으면 failed_feeds("broadcast:<id> [404]") · broadcastApi(channels·errors·mode) · per_source 읽은 수로 다시 만든다.
 */
export function broadcastFeedsOf(run: {
  startedAt: string | null;
  failedFeeds: string[];
  progress: { broadcastFeeds?: unknown; broadcastApi?: unknown } | null;
  perSource: Record<string, { read?: unknown; failed?: unknown } | null | undefined>;
}): BroadcastFeedStatus[] {
  const stored = run.progress?.broadcastFeeds;
  if (Array.isArray(stored)) return stored as BroadcastFeedStatus[];
  const rssCode = new Map<string, string>();
  for (const f of run.failedFeeds) {
    if (!f.startsWith('broadcast:')) continue;
    const id = f.slice('broadcast:'.length).split(' ')[0];
    rssCode.set(id, f.match(/\[(\w+)\]/)?.[1] || 'ERR');
  }
  const ids = new Set<string>(rssCode.keys());
  for (const k of Object.keys(run.perSource)) if (k.startsWith('broadcast:')) ids.add(k.slice('broadcast:'.length));
  const a = (run.progress?.broadcastApi || null) as { mode?: string; channels?: string[]; errors?: string[] } | null;
  const out: BroadcastFeedStatus[] = [];
  for (const id of [...ids].sort()) {
    const rss = rssCode.get(id) ?? 'ok';
    let api: BroadcastFeedStatus['api'];
    const err = (Array.isArray(a?.errors) ? a.errors : []).find((e) => String(e).startsWith(`${id}:`));
    if (!a || a.mode !== 'on') api = 'off';
    else if (err) api = QUOTA_REASONS.test(String(err)) ? 'quota' : 'error';
    else if (Array.isArray(a.channels) && a.channels.includes(id)) api = 'ok';
    else api = 'skip';
    const via = viaOf(rss, api);
    const st = run.perSource[`broadcast:${id}`];
    out.push({
      id, result: resultOf(via, rss, api), via, rss, api,
      items: st && !st.failed ? Number(st.read || 0) : 0,
      at: run.startedAt, recorded: false,
    });
  }
  return out;
}
