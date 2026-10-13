import { digestPerSource, sourceGroupOf } from './crawl_runs';
import { AlertFacts, alertLine, evaluateRunAlerts, kstDay } from './run_alerts';

const facts = (over: Partial<AlertFacts> = {}): AlertFacts => ({
  startedAt: '2026-10-14T03:00:00Z',
  durationSec: 1800,
  timedOut: false,
  reachedOf: '110/105',
  broadcastExpected: true,
  broadcastChannelsRead: 9,
  worldSaved: 3,
  urlResolveFail: 0,
  deepseekCalls: 120,
  saved: 25,
  ...over,
});

describe('run_alerts — 실행 끝 경보(NEWS-Q5 ■1 · LLM 0)', () => {
  it('멀쩡한 실행 = 경보 0 · 한 줄 없음', () => {
    expect(evaluateRunAlerts([facts(), facts({ startedAt: '2026-10-13T03:00:00Z' })])).toEqual([]);
    expect(alertLine('중독뉴스', [])).toBeNull();
    expect(evaluateRunAlerts([])).toEqual([]);
  });

  it('소요 ≥ 50분 · 전체 상한 · 방송 0 · 저장 0 · 구글 링크 실패 ≥ 10 (경계값 포함)', () => {
    const a = evaluateRunAlerts([facts({ durationSec: 3000, timedOut: true, reachedOf: '90/105', broadcastChannelsRead: 0, saved: 0, urlResolveFail: 10 })]);
    expect(a.map((x) => x.code)).toEqual(['slow_run', 'timed_out', 'broadcast_zero', 'url_resolve_fail', 'saved_zero']);
    expect(a.find((x) => x.code === 'timed_out')!.value).toBe('90/105');
    expect(evaluateRunAlerts([facts({ durationSec: 2999, urlResolveFail: 9 })])).toEqual([]);
    // 방송을 돌리지 않은 좁힌 실행 · 429 기록이 없는 옛 실행은 그 규칙 건너뜀
    expect(evaluateRunAlerts([facts({ broadcastExpected: false, broadcastChannelsRead: 0, urlResolveFail: null })])).toEqual([]);
    const line = alertLine('중독뉴스', a)!;
    expect(line).toContain('중독뉴스 수집 경보 5');
    expect(line).toContain('소요 50분(≥50)');
    expect(line).toContain('구글 링크 해석 실패 10(≥10)');
  });

  it('세계신문 저장 0 은 앞 KST 날짜의 마지막 실행도 0 일 때만(같은 날 2회는 이틀로 안 셈)', () => {
    const today0 = facts({ worldSaved: 0 });
    const todayEarlier0 = facts({ startedAt: '2026-10-13T21:00:00Z', worldSaved: 0 }); // KST 10-14 06:00
    const yesterday0 = facts({ startedAt: '2026-10-13T03:00:00Z', worldSaved: 0 });
    const yesterday2 = facts({ startedAt: '2026-10-13T03:00:00Z', worldSaved: 2 });
    expect(kstDay(todayEarlier0.startedAt)).toBe('2026-10-14');
    expect(evaluateRunAlerts([today0, todayEarlier0]).map((x) => x.code)).toEqual([]);
    expect(evaluateRunAlerts([today0, todayEarlier0, yesterday0]).map((x) => x.code)).toEqual(['world_zero_2d']);
    expect(evaluateRunAlerts([today0, yesterday2, yesterday0]).map((x) => x.code)).toEqual([]);
  });

  it('DeepSeek ≥ 380 은 같은 KST 날짜 실행의 합 · per_source 무리별 합과 세계신문 저장(옛 행에도)', () => {
    const am = facts({ startedAt: '2026-10-13T21:00:00Z', deepseekCalls: 200 });
    expect(evaluateRunAlerts([facts({ deepseekCalls: 180 }), am])).toEqual([{ code: 'deepseek_high', value: 380, limit: 380 }]);
    expect(evaluateRunAlerts([facts({ deepseekCalls: 379 }), facts({ startedAt: '2026-10-13T03:00:00Z', deepseekCalls: 300 })])).toEqual([]);

    expect(sourceGroupOf('wp-google-site-clarin')).toBe('world');
    expect(sourceGroupOf('kr-google-drug')).toBe('google');
    expect(sourceGroupOf('broadcast:ytn')).toBe('broadcast');
    const d = digestPerSource({
      'wp-wpr-001': { read: 10, candidates: 2, dup: 1, calls: 2, saved: 1, archived: 0, rejected: 1 },
      'wp-google-site-clarin': { read: 5, saved: 2 },
      'kr-press-한겨레': { read: 8, saved: 3, timeout: true },
      'broadcast:ytn': { read: 4, failed: 'x' },
      __run: { lastId: 'kr-press-한겨레' },
    }).sources;
    expect(d.worldSaved).toBe(3);
    expect(d.groups.world).toMatchObject({ sources: 2, read: 15, saved: 3, rejected: 1 });
    expect(d.groups.kr_press).toMatchObject({ sources: 1, timeouts: 1 });
    expect(d.groups.broadcast).toMatchObject({ sources: 1, failed: 1 });
    expect(d.groups.__run).toBeUndefined();
  });
});
