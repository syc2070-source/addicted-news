import { fieldProfile } from './field_profile';
import { sweepTopicExcluded, topicExcludeHit } from './topic_exclude';
import { FeedStatusBreaker } from './host_breaker';
import { LightRow, rankTop, rankTopWeighted, scoreTopGroup } from '../articles/cluster_view';
import type { ClusterInfo } from './event_cluster';

const sqlOf = (q: jest.Mock, i = 0) => String((q.mock.calls as unknown[][])[i][0]);

// ---------- ■2 음주운전 거름 ----------
describe('NEWS-Q18 ■2 — 음주운전 단속·캠페인·사고 = 관문 앞 거부(LLM 0 · 애매하면 통과)', () => {
  const rules = fieldProfile().gate.topic_exclude!;
  const hit = (title: string, text = '') => topicExcludeHit(title, text, rules);

  it('설정: 규칙 하나 · 사유 코드 · keep_ids 빈 목록', () => {
    expect(rules.map((r) => r.id)).toEqual(['not_addiction_drunk_driving']);
    expect(rules[0].keep_ids).toEqual([]);
  });

  it('걸림: 캠페인 · 일제 단속 · 사망 사고 · 면허 취소 통계 · 띄어 쓴 「음주 운전」', () => {
    expect(hit('보령해경, “숙취 운전도 음주운전” 출근길 예방 캠페인 개최')).toBe('not_addiction_drunk_driving');
    expect(hit('들뜬 휴가철, 음주운전 우려…31일 전국 일제단속')).toBe('not_addiction_drunk_driving');
    expect(hit('만취 20대 운전자, 오토바이 들이받아…60대 사망', '음주운전 사고로 60대가 숨졌다')).toBe('not_addiction_drunk_driving');
    expect(hit('버스·택시 음주운전 취소 급증…1년새 85.2% 증가', '면허 취소 처분이 늘었다')).toBe('not_addiction_drunk_driving');
    expect(hit('광주~부산 만취 상태로 음주 운전한 미군, 벌금형', '법원은 처벌로 벌금형을 선고')).toBe('not_addiction_drunk_driving');
  });

  it('통과(관문이 판정): 치료 · 재활 · 상습 · 알코올 중독 · 의존 · 마약 투약 · 절주 · 무알코올 · 맥락 없음 · 음주운전 없음', () => {
    expect(hit('음주운전 재범자 치료명령 확대', '단속만으로는 부족')).toBeNull();
    expect(hit('상습 음주운전자 알코올 중독 재활 프로그램', '단속 강화와 함께')).toBeNull();
    expect(hit("'음주운전 적발' 기사, 마약 투약 후 버스 몰았다", '적발')).toBeNull();
    expect(hit('음복 한 잔도 음주운전…추석 술자리에 등장한 무알코올 맥주', '단속')).toBeNull();
    expect(hit('음주운전 판사 감형 논란')).toBeNull();
    expect(hit('부천시, 금주의 길 알코올 교육 운영', '캠페인')).toBeNull();
    expect(hit('알코올 사용장애 치료 신약 임상', '사고 위험')).toBeNull();
  });

  it('이미 실린 기사 쓸기: 걸리는 실림 행만 보관(updated_at) · keep_ids 는 빼고 되돌림 · 방송 · 막힘 · 지운 편 뺌 · 지움 0', async () => {
    const r = [{ ...rules[0], keep_ids: [30] }];
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT')) {
        return [
          { id: 10, title: '해경 음주운전 예방 캠페인', summary: '', tier: 'publish' },
          { id: 11, title: '음주운전 재범자 치료명령 확대', summary: '단속', tier: 'publish' },
          { id: 12, title: '음주운전 일제 단속', summary: '', tier: 'archive' },
          { id: 30, title: '음주운전 단속 통계', summary: '', tier: 'archive' },
        ];
      }
      return [[{ id: params?.[0] }], 1];
    });
    const sw = await sweepTopicExcluded(query, r, { deletedAt: true });
    expect(sw).toEqual({ checked: 4, archived: [{ id: 10, rule: 'not_addiction_drunk_driving', title: '해경 음주운전 예방 캠페인' }], restored: [30] });
    const sel = sqlOf(query);
    expect(sel).toMatch(/source_type IS NULL OR source_type <> 'broadcast'\) AND NOT blocked AND deleted_at IS NULL/);
    expect((query.mock.calls as unknown[][])[0][1]).toEqual([['%음주운전%', '%음주 운전%', '%만취운전%', '%만취 운전%', '%숙취운전%', '%숙취 운전%']]);
    const writes = (query.mock.calls as unknown[][]).slice(1).map((c) => String(c[0]));
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatch(/SET tier = 'archive', updated_at = now\(\)[\s\S]*COALESCE\(tier, 'publish'\) = 'publish'/);
    expect(writes[1]).toMatch(/SET tier = 'publish', updated_at = now\(\) WHERE id = \$1 AND tier = 'archive'/);
    for (const w of writes) expect(w).not.toMatch(/DELETE/);
    expect(await sweepTopicExcluded(jest.fn().mockRejectedValue(new Error('x')), r, { deletedAt: false })).toEqual({
      checked: 0, archived: [], restored: [], error: true,
    });
    expect(await sweepTopicExcluded(query, [], { deletedAt: false })).toEqual({ checked: 0, archived: [], restored: [] });
  });

  it('반박 리뷰 예: 술 문제 · 단주 · 알코올 사용 장애(띄어 씀) · 재범 정책 · 졸피뎀 운전 = 통과 / 송치 · 집행유예 · 뺑소니 · 만취운전 구속 = 걸림', () => {
    expect(hit('음주운전 재범자 절반은 술 문제…전문가 "처벌만으론 못 막아"')).toBeNull();
    expect(hit('"음주운전 재범 막으려면 단주 모임 연계해야"', '처벌')).toBeNull();
    expect(hit('술 마시면 운전대 잡는 남편…"알코올 사용 장애 의심해야"', '음주운전 사고')).toBeNull();
    expect(hit('음주운전 차량 시동잠금장치 의무화 1년', '단속')).toBeNull();
    expect(hit('졸피뎀 복용 후 운전 사고', '음주운전처럼 처벌해야')).toBeNull();
    expect(hit('음주운전 혐의 배우 A씨 송치')).toBe('not_addiction_drunk_driving');
    expect(hit('음주운전 30대 징역형 집행유예')).toBe('not_addiction_drunk_driving');
    expect(hit('음주운전 뺑소니 20대 체포')).toBe('not_addiction_drunk_driving');
    expect(hit('만취운전 30대 구속')).toBe('not_addiction_drunk_driving');
  });

  it('쓸기는 sweep_created_before 앞에 저장된 행만(관문 앞 거름 뒤 행은 다시 보지 않음)', async () => {
    const r = [{ ...rules[0], sweep_created_before: '2026-10-27T00:00:00+09:00' }];
    const before = Date.parse('2026-10-26T10:00:00+09:00');
    const after = Date.parse('2026-10-27T12:30:00+09:00');
    const query = jest.fn(async (sql: string, params?: unknown[]) =>
      sql.startsWith('SELECT')
        ? [
            { id: 1, title: '음주운전 일제 단속', summary: '', tier: 'publish', created: String(before) },
            { id: 2, title: '음주운전 일제 단속', summary: '', tier: 'publish', created: String(after) },
          ]
        : [[{ id: params?.[0] }], 1],
    );
    const sw = await sweepTopicExcluded(query, r, { deletedAt: false });
    expect(sw.archived.map((a) => a.id)).toEqual([1]);
    expect(sqlOf(query)).toMatch(/created_at/);
    expect(rules[0].sweep_created_before).toBe('2026-10-27T00:00:00+09:00');
  });

  it('관문 질문(기사)에 no 예시 하나만 더함', () => {
    const s = fieldProfile().prompts.judge_system;
    expect(s).toMatch(/예\) "음주운전 단속·캠페인·사고 기사" → 중독 아님 → category_fit=false 종료/);
  });
});

// ---------- ■4 503 단락기 ----------
describe('NEWS-Q18 ■4 — 같은 호스트 503 이 5 번 잇달아면 이번 실행 나머지 건너뜀', () => {
  it('5 번째 503 에 열림 · 다른 결과가 끼면 0 부터 · 다른 호스트는 그대로 · 건너뛴 수', () => {
    const b = new FeedStatusBreaker();
    const g = (n: number) => `https://news.google.com/rss/search?q=${n}`;
    for (let i = 0; i < 4; i++) b.record(g(i), 503);
    b.record(g(9), 200);
    for (let i = 0; i < 4; i++) b.record(g(i), 503);
    expect(b.skip(g(20))).toBe(false);
    b.record(g(5), 503);
    expect([b.skip(g(21)), b.skip(g(22)), b.skip('https://rss.donga.com/total.xml')]).toEqual([true, true, false]);
    expect(b.tripped()).toEqual(['news.google.com']);
    expect(b.skipped).toEqual({ 'news.google.com': 2 });
    const c = new FeedStatusBreaker();
    for (let i = 0; i < 5; i++) c.record(g(i), 502);
    expect(c.skip(g(1))).toBe(false);
  });
});

// ---------- ■3 TOP 무게 ----------
describe('NEWS-Q18 ■3 — TOP = 무게(전국 · 기관 · 지역 캠페인 · 같은 소식 건수)', () => {
  const rule = fieldProfile().top_rank!;
  const now = Date.parse('2026-10-26T13:00:00+09:00');
  const row = (id: number, title: string, source: string, hoursAgo: number, grade: string | null = 'press'): LightRow => ({
    id, title, source, sourceUrl: '', publishedAt: '', publishedTs: null, sourceGrade: grade, category: null, ts: now - hoursAgo * 3600000,
  });

  it('설정 상수(전국 +1(Q19 · Q18 은 +2) · 기관 +2 · 지역 −2 · 건수 0.5 · 상한 2)', () => {
    expect([rule.national_bonus, rule.institution_bonus, rule.local_penalty, rule.per_report, rule.report_cap]).toEqual([1, 2, -2, 0.5, 2]);
    expect(rule.national_sources).toEqual(expect.arrayContaining(['연합뉴스', '뉴시스', '동아일보']));
  });

  it('점수: 지역 캠페인 4건 묶음 < 장관 · 전국 매체 · 단독 연구', () => {
    const camp = row(1, '봉화군보건소, 찾아가는 금연서비스 운영 - 산청인터넷신문', '산청인터넷신문', 2);
    expect(scoreTopGroup([camp], camp, 4, rule)).toEqual({ national: false, institution: false, local: true, offTopic: false, reports: 1.5, score: -0.5 });
    const min = row(2, '원민경 성평등가족부 장관, 도박문제예방치유원 방문', '뉴스핌', 5);
    expect(scoreTopGroup([min], min, 6, rule).score).toBe(5);
    // 리뷰: 「장관」 낱말만으로는 기관 아님(부처 이름이 있어야)
    const bare = row(5, '원민경 장관, 치유원 방문', '뉴스핌', 5);
    expect(scoreTopGroup([bare], bare, 6, rule).score).toBe(3);
    // 구글뉴스(출처 이름 없음)는 제목 끝 「 - 매체」로 전국 매체를 앎 · 학술 등급 = 기관
    const g = row(3, '불법 도박사이트 공급조직 적발 - 연합뉴스', 'Google News (KR)', 3);
    expect(scoreTopGroup([g], g, 1, rule).national).toBe(true);
    const sci = row(4, '수면용 젤리 대마 성분 내성', 'ScienceDaily', 1, 'academic');
    expect(scoreTopGroup([sci], sci, 1, rule)).toMatchObject({ institution: true, score: 2 });
  });

  it('고르기: 묶음 크기 순(옛)과 달리 무게 순 · 대표가 지역 매체면 묶음 안 전국 매체 기사를 보임 · 동점 = 최신', () => {
    const light = new Map<number, LightRow>();
    const index = new Map<number, ClusterInfo>();
    const add = (rows: LightRow[], cid?: string) => {
      for (const r of rows) light.set(r.id, r);
      if (cid) {
        const info: ClusterInfo = { clusterId: cid, size: rows.length, representativeId: rows[0].id, memberIds: rows.map((r) => r.id) };
        for (const r of rows) index.set(r.id, info);
      }
    };
    add([1, 2, 3, 4].map((i) => row(i, '봉화군보건소, 찾아가는 금연서비스 운영', `지역${i}`, 2)), 'camp');
    add([row(10, '복지부, 도박 치유 예산 확대 - 지역일보', '지역일보', 10), row(11, '복지부, 도박 치유 예산 확대', '연합뉴스', 9)], 'mof');
    add([row(20, '청소년 게임 이용 조사 결과', '뉴시스', 1)]);
    add([row(30, '청소년 게임 이용 조사 결과 2', '뉴스1', 3)]);
    const neu = rankTopWeighted(light, index, now, rule, 3);
    expect(neu.map((p) => p.id)).toEqual([11, 20, 30]);
    expect(neu[0].score.score).toBe(3.5);
    expect(rankTop(light, index, now, 3)[0].id).toBe(1);
  });

  it('반박 리뷰: 사설은 기관 가점 0 · 넓은 낱말(정부 · UN · 국립) 뺌 · 기관 발표면 지역 감점 0 · 머리 「OO군,」 = 지역 · 동점 = 묶음 큰 것', () => {
    const one = (title: string, source = '지역일보', grade: string | null = 'press') => {
      const r = row(1, title, source, 1, grade);
      return scoreTopGroup([r], r, 1, rule);
    };
    expect(one('[사설] 복지부 마약 대책 실효성 의문').institution).toBe(false);
    expect(one('정부에 베팅하라', 'La Tercera').institution).toBe(false);
    expect(one('FUNDING CUTS HIT clinics', 'Reuters').institution).toBe(false);
    expect(one('국립대 축제서 주류 판매 논란').institution).toBe(false);
    expect(one('복지부, 마약 치료보호기관 운영 확대 - 연합뉴스', 'Google News (KR)')).toMatchObject({ institution: true, local: false, score: 3 });
    expect(one('국회서 도박 대책 토론회 개최')).toMatchObject({ institution: true, local: false });
    expect(one('익산시, 청소년 도박 예방 교육 실시')).toMatchObject({ local: true, score: -2 });
    const light = new Map<number, LightRow>([
      [1, row(1, '청소년 게임 조사 A', '뉴시스', 1)],
      [2, row(2, '청소년 게임 조사 B', '뉴스1', 5)],
      [3, row(3, '청소년 게임 조사 B', '뉴스1', 6)],
      [4, row(4, '청소년 게임 조사 C', '연합뉴스', 7)],
    ]);
    const index = new Map<number, ClusterInfo>();
    const info: ClusterInfo = { clusterId: 'b', size: 2, representativeId: 2, memberIds: [2, 3] };
    index.set(2, info);
    index.set(3, info);
    // A(1 · 1시간 전) · B(1 + 0.5 · 묶음 2) · C(1) → B 먼저 · 그다음 동점 A · C 는 최신 순
    expect(rankTopWeighted(light, index, now, rule, 3).map((p) => p.id)).toEqual([2, 1, 4]);
  });

  it('창: 72시간 안 묶음이 3 개보다 적으면 7일로', () => {
    const light = new Map<number, LightRow>([
      [1, row(1, '장관 발표', '연합뉴스', 5)],
      [2, row(2, '국회 법안', '뉴시스', 100)],
      [3, row(3, '연구원 조사', '뉴스1', 120)],
    ]);
    const picks = rankTopWeighted(light, new Map(), now, rule, 3);
    expect([picks.length, picks[0].window]).toEqual([3, '7d']);
  });
});
