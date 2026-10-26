import { passesBroadcastKeywordGate } from './broadcast';
import {
  broadcastGateSystem,
  buildBroadcastGateUser,
  decideBroadcastGate,
  emptyBroadcastGateStats,
  parseBroadcastVerdict,
} from './broadcast_gate';
import { fieldProfile, setFieldProfileForTest } from './field_profile';

// NEWS-Q11 ■2: 방송 전용 관문 — 핵심어 ∧ 한 질문 → yes publish · partial archive · no reject(topic_fit_false)
describe('broadcast_gate — 방송 전용 관문(NEWS-Q11 ■2)', () => {
  afterEach(() => setFieldProfileForTest(null));

  it('PD수첩 08-11 「도박소년이 된 내 아들」은 핵심어 관문을 지난다(→ 한 질문)', () => {
    expect(
      passesBroadcastKeywordGate({
        title:
          '[PD수첩] "도박소년이 된 내 아들" - 2026년 8월 11일 밤 10시 20분 방송',
        description: '청소년 온라인 도박의 실태를 추적했다.',
      }),
    ).toBe(true);
  });

  it('판정 → 층: yes = publish · partial = archive · no = reject(topic_fit_false) · 판정 없음 = 건너뜀', () => {
    const yes = parseBroadcastVerdict({
      fit: 'yes',
      subtopic: '도박',
      summary: '청소년 도박 실태',
    });
    expect(yes).toEqual({
      topic: 'yes',
      subtopic: '도박',
      summary: '청소년 도박 실태',
    });
    expect(decideBroadcastGate(yes)).toEqual({
      action: 'publish',
      subtopic: '도박',
    });
    expect(
      decideBroadcastGate(
        parseBroadcastVerdict({ fit: 'partial', subtopic: '약물' }),
      ),
    ).toEqual({
      action: 'archive',
      subtopic: '약물',
    });
    expect(
      decideBroadcastGate(
        parseBroadcastVerdict({ fit: 'NO', subtopic: '없음' }),
      ),
    ).toEqual({
      action: 'reject',
      reason: 'topic_fit_false',
      subtopic: '기타',
    });
    expect(
      decideBroadcastGate(
        parseBroadcastVerdict({ fit: 'maybe', subtopic: '도박' }),
      ),
    ).toEqual({
      action: 'skip',
      reason: 'judgment_missing',
    });
    expect(decideBroadcastGate(parseBroadcastVerdict(null))).toEqual({
      action: 'skip',
      reason: 'judgment_missing',
    });
  });

  it('하위 주제는 설정 묶음 이름으로 맞춘다(「게임 중독」→ 게임·디지털 · 모르면 기타)', () => {
    expect(
      parseBroadcastVerdict({ fit: 'yes', subtopic: '알코올' })!.subtopic,
    ).toBe('알코올');
    expect(
      parseBroadcastVerdict({ fit: 'yes', subtopic: '도박 문제' })!.subtopic,
    ).toBe('도박');
    expect(
      parseBroadcastVerdict({ fit: 'yes', subtopic: '우주' })!.subtopic,
    ).toBe('기타');
    expect(parseBroadcastVerdict({ fit: 'true', subtopic: '' })!.topic).toBe(
      'yes',
    );
  });

  it('시스템 지시 = 설정 문구 + 하위 주제 후보 + JSON 꼴 · 설정이 없으면 null(판정 0 · fail-closed)', () => {
    const sys = broadcastGateSystem()!;
    expect(sys).toContain(fieldProfile().prompts.broadcast_gate!.slice(0, 20));
    expect(sys).toContain('subtopic 후보: 도박 · 알코올');
    expect(sys).toContain('"fit":"yes|partial|no"');
    setFieldProfileForTest({
      ...fieldProfile(),
      prompts: { ...fieldProfile().prompts, broadcast_gate: undefined },
    });
    expect(broadcastGateSystem()).toBeNull();
  });

  it('질문 본문 = 프로그램 · 제목 · 설명(2,500 자까지)', () => {
    const u = buildBroadcastGateUser(
      { title: '제목', description: 'x'.repeat(3000) },
      'PD수첩',
    );
    expect(u.startsWith('프로그램: PD수첩\n제목: 제목')).toBe(true);
    expect(u.length).toBeLessThan(2600);
    expect(
      buildBroadcastGateUser({ title: 't', description: '' }, 'p'),
    ).toContain('(설명 없음)');
    expect(emptyBroadcastGateStats().reject).toEqual({
      no_keyword: 0,
      topic_fit_false: 0,
      duplicate: 0,
      judgment_missing: 0,
      topic_exclude: 0,
    });
  });
});
