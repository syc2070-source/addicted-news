// ============================================================
// rapha_videos.ts (NEWS-Q26 결정 6) — 라파뉴스: 라파공동체 유튜브 최신 영상.
// 이미 있는 유튜브 길(broadcast.ts 의 공개 RSS 읽기 · 풀기)에 채널 하나를 더한다.
//  · 방송 관문(핵심어 · DeepSeek) 0 · DB 쓰기 0 · LLM 0 · 열쇠 0.
//  · 읽은 것은 30분 들고 있다(대문이 열릴 때마다 유튜브를 두드리지 않게) · 실패하면 앞서 읽은 것 · 그것도 없으면 빈 목록.
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import {
  BroadcastItem,
  BroadcastSource,
  feedUrlFor,
  fetchBroadcastItems,
} from '../crawler/broadcast';

export interface RaphaChannel {
  channelTitle: string;
  channelId: string;
  channelUrl: string;
}

export interface RaphaVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  url: string;
  thumbnailUrl: string | null;
}

export interface RaphaVideosResponse {
  ok: boolean;
  channelTitle: string;
  channelUrl: string;
  fetchedAt: string | null;
  items: RaphaVideo[];
}

export const RAPHA_CACHE_MS = 30 * 60 * 1000;
export const RAPHA_MAX = 15;

export function loadRaphaChannel(
  file = path.join(__dirname, '../../data/rapha_youtube.json'),
  read: (f: string) => string = (f) => fs.readFileSync(f, 'utf8'),
): RaphaChannel | null {
  try {
    const raw = JSON.parse(read(file)) as Record<string, unknown>;
    const id = typeof raw.channel_id === 'string' ? raw.channel_id : '';
    if (!/^UC[\w-]{22}$/.test(id)) return null;
    return {
      channelTitle:
        typeof raw.channel_title === 'string' ? raw.channel_title : '',
      channelId: id,
      channelUrl: `https://www.youtube.com/channel/${id}`,
    };
  } catch {
    return null;
  }
}

function toVideo(it: BroadcastItem): RaphaVideo {
  return {
    videoId: it.videoId,
    title: it.title,
    publishedAt: it.publishedAt,
    url: it.url,
    thumbnailUrl: it.thumbnailUrl,
  };
}

type Fetcher = (source: BroadcastSource) => Promise<BroadcastItem[]>;

/** 실패한 뒤 다시 묻기까지 쉬는 틈(리뷰: 유튜브가 막힌 동안 묻기를 거듭하지 않게). */
export const RAPHA_BACKOFF_MS = 5 * 60 * 1000;

/**
 * 채널 하나 · 30분 들고 있기 · 동시에 여러 번 물어도 유튜브에는 한 번만.
 * 들고 있는 것이 있으면 곧바로 그것을 주고 새로 읽기는 뒤에서 한다(리뷰: 유튜브가 늦을 때 대문 요청이 기다리지 않게).
 * 실패하면 RAPHA_BACKOFF_MS 동안 다시 묻지 않음 · 빈 피드(200 · 0 편)는 앞서 읽은 것을 지우지 않음.
 */
export class RaphaVideos {
  private cache: { at: number; items: RaphaVideo[] } | null = null;
  private inflight: Promise<void> | null = null;
  private failedAt: number | null = null;
  private lastOk = true;

  constructor(
    private readonly channel: RaphaChannel | null = loadRaphaChannel(),
    private readonly fetcher: Fetcher = (s) =>
      fetchBroadcastItems(s, RAPHA_MAX, 2, (n) => 500 * n),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 뒤에서 도는 새로 읽기가 끝날 때까지(시험용). */
  settle(): Promise<void> {
    return this.inflight || Promise.resolve();
  }

  private refresh(ch: RaphaChannel): Promise<void> {
    if (this.inflight) return this.inflight;
    if (this.failedAt !== null && this.now() - this.failedAt < RAPHA_BACKOFF_MS)
      return Promise.resolve();
    const p: Promise<void> = this.fetcher(this.sourceOf(ch))
      .then((list) => {
        const items = list.map(toVideo);
        this.cache = {
          at: this.now(),
          items: items.length || !this.cache ? items : this.cache.items,
        };
        this.failedAt = null;
        this.lastOk = true;
      })
      .catch((e: unknown) => {
        this.failedAt = this.now();
        this.lastOk = false;
        console.warn(
          `[rapha-videos] 라파공동체 RSS 읽기 실패(앞서 읽은 것 ${this.cache ? '씀' : '없음'}): ${(e as Error).message}`,
        );
      })
      .finally(() => {
        if (this.inflight === p) this.inflight = null;
      });
    this.inflight = p;
    return p;
  }

  async get(limit = 6): Promise<RaphaVideosResponse> {
    const n = Math.min(Math.max(Number(limit) || 6, 1), RAPHA_MAX);
    const ch = this.channel;
    if (!ch)
      return {
        ok: false,
        channelTitle: '',
        channelUrl: '',
        fetchedAt: null,
        items: [],
      };
    if (!this.cache) await this.refresh(ch);
    else if (this.now() - this.cache.at > RAPHA_CACHE_MS) void this.refresh(ch);
    const items = this.cache ? this.cache.items.slice(0, n) : [];
    return {
      ok: this.lastOk,
      channelTitle: ch.channelTitle,
      channelUrl: ch.channelUrl,
      fetchedAt: this.cache ? new Date(this.cache.at).toISOString() : null,
      items,
    };
  }

  private sourceOf(ch: RaphaChannel): BroadcastSource {
    return {
      outletId: 'rapha_youtube',
      program: ch.channelTitle,
      channelTitle: ch.channelTitle,
      channelId: ch.channelId,
      feedUrl: feedUrlFor(ch.channelId),
      sharedChannel: false,
      programEn: null,
      soloChannel: false,
    };
  }
}

export const raphaVideos = new RaphaVideos();
