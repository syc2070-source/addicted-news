import { oldDatedTier } from './tier';
import { HostBreaker, hostOf } from './host_breaker';
import { subtypeIdsOf, subtypeIdsOfGroups } from './keyword_groups';
import { broadcastEnglishNames, loadBroadcastSources } from './broadcast';
import { exportRowOf, subtypeOfRow } from '../export/export.service';
import { fieldProfile } from './field_profile';

// NEWS-Q12 ■2 오래된 보도 날짜 = 보관 · ■3 본문 추출 단락기 · ■4 내보내기 칸(sourceType · subtype[] · sourceEn)
describe('NEWS-Q12 ■2 — 보도 날짜가 30일 넘게 오래된 기사 = 보관(앞으로만)', () => {
  const NOW = Date.parse('2026-10-22T03:00:00Z'); // KST 10-22 12:00
  const o = { days: 30, now: NOW, broadcast: false, tierColumn: true };

  it('설정값 30 · 31일 전 = 보관 · 30일 전 = 실림 그대로', () => {
    expect(fieldProfile().gate.old_dated_archive_days).toBe(30);
    expect(oldDatedTier('publish', '2026-09-21', o)).toEqual({
      tier: 'archive',
      demoted: true,
    });
    expect(oldDatedTier('publish', '2026-09-22', o)).toEqual({
      tier: 'publish',
      demoted: false,
    });
    expect(oldDatedTier('publish', '2024-11-03', o).tier).toBe('archive');
  });

  it('방송 · tier 열 없음 · 설정 없음 · 이미 보관 · 날짜 없음 = 그대로', () => {
    expect(
      oldDatedTier('publish', '2026-08-11', { ...o, broadcast: true }).tier,
    ).toBe('publish');
    expect(
      oldDatedTier('publish', '2026-08-11', { ...o, tierColumn: false }).tier,
    ).toBe('publish');
    expect(
      oldDatedTier('publish', '2026-08-11', { ...o, days: undefined }).tier,
    ).toBe('publish');
    expect(oldDatedTier('archive', '2026-08-11', o)).toEqual({
      tier: 'archive',
      demoted: false,
    });
    expect(oldDatedTier('publish', null, o).tier).toBe('publish');
    expect(oldDatedTier('publish', 'x', o).tier).toBe('publish');
  });
});

describe('NEWS-Q12 ■3 — 본문 추출 단락기(호스트별 · 실행 하나)', () => {
  it('느리고 빈 본문 2번 = 그 호스트 건너뜀 · 다른 호스트·빠른 실패는 그대로 · 본문 얻으면 다시 0', () => {
    const b = new HostBreaker(7000, 2);
    const u = 'https://www.pressian.com/pages/articles/1';
    expect(hostOf(u)).toBe('pressian.com');
    expect(b.skip(u)).toBe(false);
    b.record(u, 24000, 0);
    expect(b.skip(u)).toBe(false);
    b.record('https://pressian.com/pages/articles/2', 16000, 0);
    expect(b.skip('https://pressian.com/pages/articles/3')).toBe(true);
    expect(b.skip('https://pressian.com/pages/articles/4')).toBe(true);
    expect(b.skipped).toEqual({ 'pressian.com': 2 });
    expect(b.tripped()).toEqual(['pressian.com']);
    expect(b.skip('https://www.donga.com/news/1')).toBe(false);
    b.record('https://www.donga.com/news/1', 300, 0); // 빠른 실패(본문 없음)는 세지 않음
    b.record('https://www.donga.com/news/2', 9000, 0);
    b.record('https://www.donga.com/news/3', 9000, 1500); // 본문 얻음 → 0
    b.record('https://www.donga.com/news/4', 9000, 0);
    expect(b.skip('https://www.donga.com/news/5')).toBe(false);
    expect(b.skip('not a url')).toBe(false);
  });
});

describe('NEWS-Q12 ■4 — 내보내기 sourceType · subtype[] · sourceEn', () => {
  it('묶음 → 영문 id 10(게임·디지털 = 둘 다 · 기타 = 빈 배열 · 겹침 없음)', () => {
    expect(subtypeIdsOfGroups(['도박'])).toEqual(['gambling']);
    expect(subtypeIdsOfGroups(['게임·디지털', '도박', '도박'])).toEqual([
      'gaming',
      'digital',
      'gambling',
    ]);
    expect(subtypeIdsOfGroups(['기타'])).toEqual([]);
    const ids = new Set(
      Object.entries(fieldProfile().keywords.group_ids || {})
        .filter(([k]) => !k.startsWith('_'))
        .flatMap(([, v]) => (Array.isArray(v) ? v : [v])),
    );
    expect([...ids].sort()).toEqual(
      [
        'ai',
        'alcohol',
        'digital',
        'drugs',
        'food',
        'gambling',
        'gaming',
        'shopping',
        'tobacco',
        'work',
      ].sort(),
    );
    expect(subtypeIdsOf('청소년 도박 중독 늘어')).toEqual(['gambling']);
    expect(subtypeIdsOf('오늘의 날씨')).toEqual([]);
  });

  it('행 → subtype(제목 + 꼬리표 · 방송 하위 주제 꼬리표) · 요약은 쓰지 않음', () => {
    expect(
      subtypeOfRow({ title: '청소년 금연 캠프', keywords: '금연,청소년' }),
    ).toEqual(['tobacco']);
    expect(
      subtypeOfRow({
        title: '모두가 자식의 폰과 싸우고 있다',
        keywords: '스마트폰,게임·디지털',
      }),
    ).toEqual(['gaming', 'digital']);
    expect(
      subtypeOfRow({ title: '제목', keywords: null, summary: '도박 중독' }),
    ).toEqual([]);
  });

  it('방송 9 채널 모두 영어 이름 · 방송 행만 sourceEn · sourceType 그대로', () => {
    const sources = loadBroadcastSources();
    expect(sources).toHaveLength(9);
    expect(sources.every((s) => !!s.programEn)).toBe(true);
    const en = broadcastEnglishNames(sources);
    expect(en['MBC PD수첩']).toBe('MBC PD Notebook');
    const bc = exportRowOf(
      {
        id: 1,
        title: '[PD수첩] 도박소년이 된 내 아들',
        source: 'MBC PD수첩',
        source_type: 'broadcast',
        keywords: '도박,도박',
        published_at: '2026-08-11',
      },
      'addiction',
      en,
    );
    expect(bc).toMatchObject({
      sourceType: 'broadcast',
      subtype: ['gambling'],
      sourceEn: 'MBC PD Notebook',
    });
    const art = exportRowOf(
      {
        id: 2,
        title: '음주 운전 단속',
        source: 'MBC PD수첩',
        source_type: 'kr_press',
        keywords: null,
      },
      'addiction',
      en,
    );
    expect(art).toMatchObject({
      sourceType: 'kr_press',
      subtype: ['alcohol'],
      sourceEn: null,
    });
    expect(
      exportRowOf({ id: 3, title: 't', source: 's' }, 'addiction', en)
        .sourceType,
    ).toBeNull();
  });
});
