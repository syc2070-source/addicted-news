import { deepseekDown, noteDeepseekResult, DEEPSEEK_DOWN_AFTER, DEEPSEEK_TIMEOUT_MS } from './deepseek_summary';

// NEWS-Q6 ⓑ′: 10-15 DeepSeek 가 응답 없이 멈춰 방송 판정 4번이 62분을 잡았다.
describe('DeepSeek 멈춤 차단기', () => {
  beforeEach(() => noteDeepseekResult(null));

  it('요청당 60초(SDK 기본 10분 대신)', () => {
    expect(DEEPSEEK_TIMEOUT_MS).toBe(60_000);
  });

  it('연결 실패·5xx 연속 3회면 멈춤 · 4xx 는 세지 않고 · 성공 한 번이면 다시 셈', () => {
    noteDeepseekResult({});               // 시간 초과(status 없음)
    noteDeepseekResult({ status: 400 });  // 요청 하나의 문제 — 안 셈
    noteDeepseekResult({ status: 503 });
    expect(deepseekDown()).toBe(false);
    noteDeepseekResult({ status: undefined });
    expect(DEEPSEEK_DOWN_AFTER).toBe(3);
    expect(deepseekDown()).toBe(true);
    noteDeepseekResult(null);
    expect(deepseekDown()).toBe(false);
  });
});
