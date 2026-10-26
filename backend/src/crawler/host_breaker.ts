// ============================================================
// host_breaker.ts (NEWS-Q12 ■3) — 원문 본문 추출 단락기(실행 하나 동안만).
// 프레시안·동아 대체 피드(구글뉴스 site: 검색)는 구글 응답이 1초 안인데도 6일째 소스 상한 120초에 걸렸다:
// 항목마다 원문 호스트로 본문 추출(링크 풀기 + 두 UA · 각 8초)을 하는데 그 호스트가 Render 망에서 멈춘다(원 피드가 막힌 까닭과 같음).
// 같은 호스트에서 「느리고(slowMs 넘음) 빈 본문」이 strikes 번 나면 이번 실행 남은 항목은 본문 추출을 건너뛴다(제목·스니펫으로 판정).
// 상한 120초는 그대로 · 설정 변경 0 · 다음 실행은 다시 시도.
// ============================================================

export const BREAKER_SLOW_MS = 7000;
export const BREAKER_STRIKES = 2;

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

export class HostBreaker {
  private strikes = new Map<string, number>();
  /** 이번 실행에서 건너뛴 추출 수(호스트별) */
  readonly skipped: Record<string, number> = {};

  constructor(
    readonly slowMs = BREAKER_SLOW_MS,
    readonly maxStrikes = BREAKER_STRIKES,
  ) {}

  /** 이 호스트는 본문 추출을 건너뛸까(건너뛰면 수를 센다). */
  skip(url: string): boolean {
    const h = hostOf(url);
    if (!h || (this.strikes.get(h) || 0) < this.maxStrikes) return false;
    this.skipped[h] = (this.skipped[h] || 0) + 1;
    return true;
  }

  /** 추출 한 번의 결과(걸린 시간 · 본문 길이)를 적는다. 본문을 얻으면 그 호스트는 다시 0. */
  record(url: string, ms: number, bodyLen: number): void {
    const h = hostOf(url);
    if (!h) return;
    if (bodyLen > 0) this.strikes.set(h, 0);
    else if (ms >= this.slowMs)
      this.strikes.set(h, (this.strikes.get(h) || 0) + 1);
  }

  /** 끊긴 호스트(기록용). */
  tripped(): string[] {
    return [...this.strikes.entries()]
      .filter(([, n]) => n >= this.maxStrikes)
      .map(([h]) => h);
  }
}

/**
 * NEWS-Q18 ■4: 피드 읽기 단락기(실행 하나 동안만) — 같은 호스트의 피드 읽기가 status(503) 로 maxRun(5) 번 잇달아 실패하면
 * 이번 실행의 나머지 그 호스트 피드는 읽지 않고 건너뛴다(10-26: 구글뉴스 41 곳 503 · 소요 1,529초). 경보 0 · 다음 실행은 다시 시도.
 * 503 이 아닌 결과(성공 · 다른 오류)가 오면 그 호스트 줄은 0 으로.
 */
export const FEED_BREAKER_STATUS = 503;
export const FEED_BREAKER_RUN = 5;

export class FeedStatusBreaker {
  private run = new Map<string, number>();
  private open = new Set<string>();
  /** 이번 실행에서 건너뛴 피드 수(호스트별) */
  readonly skipped: Record<string, number> = {};

  constructor(
    readonly status = FEED_BREAKER_STATUS,
    readonly maxRun = FEED_BREAKER_RUN,
  ) {}

  /** 이 피드를 건너뛸까(건너뛰면 수를 센다). */
  skip(url: string): boolean {
    const h = hostOf(url);
    if (!h || !this.open.has(h)) return false;
    this.skipped[h] = (this.skipped[h] || 0) + 1;
    return true;
  }

  /** 피드 읽기 한 번의 결과(실패면 HTTP 상태 · 성공이면 null 이 아닌 200 등). */
  record(url: string, status: number | null): void {
    const h = hostOf(url);
    if (!h) return;
    if (status === this.status) {
      const n = (this.run.get(h) || 0) + 1;
      this.run.set(h, n);
      if (n >= this.maxRun) this.open.add(h);
    } else this.run.set(h, 0);
  }

  tripped(): string[] {
    return [...this.open];
  }
}
