import { fieldProfile, topicTitleWords } from './field_profile';
import { sweepTopicExcludedBroadcasts, topicExcludeHit } from './topic_exclude';
import { originalAirDate } from './broadcast_aired';
import { emptyBroadcastGateStats } from './broadcast_gate';
import { LightRow, rankTopWeighted, scoreTopGroup } from '../articles/cluster_view';

const sqlOf = (q: jest.Mock, i = 0) => String((q.mock.calls as unknown[][])[i][0]);

// ---------- ■2 예외 낱말 손질 ----------
describe('NEWS-Q19 ■2 — 예외 낱말: 「재범」 뺌 · 「치료」는 치료명령 · 치료 조건부 · 치료 프로그램 꼴만', () => {
  const rules = fieldProfile().gate.topic_exclude!;
  const hit = (title: string, text = '') => topicExcludeHit(title, text, rules);

  it('설정: 재범 · 홑 「치료」 없음 · 치료명령 꼴 · 중독 · 알코올 사용장애 · 의존 그대로', () => {
    const ex = rules[0].except;
    expect(ex).not.toContain('재범');
    expect(ex).not.toContain('치료');
    expect(ex).toEqual(expect.arrayContaining(['치료명령', '치료 명령', '치료 조건부', '치료 프로그램', '중독', '알코올 사용장애', '의존']));
  });

  it('이제 걸림: 요약에 「재범」 · 홑 「치료」만 있는 단속 · 사고 기사(Q18 통과 5151 꼴)', () => {
    expect(hit('버스·택시 음주운전 취소 급증…1년새 85.2% 증가', '면허 취소가 늘고 재범률도 높아졌다')).toBe('not_addiction_drunk_driving');
    expect(hit('음주운전 사고로 중상…병원 치료 중', '사고 차량 운전자 적발')).toBe('not_addiction_drunk_driving');
  });

  it('그대로 통과: 치료명령 · 치료 조건부 기소유예 · 치료 프로그램 · 중독 · 의존', () => {
    expect(hit('음주운전 재범자 치료명령 확대', '단속만으로는 부족')).toBeNull();
    expect(hit('음주운전 치료 조건부 기소유예 첫 적용', '처벌 대신')).toBeNull();
    expect(hit('음주운전 단속 걸린 운전자, 치료 프로그램 이수')).toBeNull();
    expect(hit('상습 음주운전 뒤엔 알코올 의존', '단속')).toBeNull();
    // 리뷰: 같은 뜻 꼴(치료감호 · 치료 의무 · 알코올 치료)
    expect(hit('음주운전 재범자 치료 의무화 법안… 면허 취소')).toBeNull();
    expect(hit('음주운전 3회 50대, 치료감호 청구', '구속')).toBeNull();
    expect(hit('알코올 치료 받아야 면허 재취득', '음주운전 단속')).toBeNull();
  });
});

// ---------- ■3 TOP 상수 ----------
describe('NEWS-Q19 ■3 — TOP: 전국 +1 · 제목 분야 핵심어 없으면 −1(기존 목록 재사용)', () => {
  const rule = { ...fieldProfile().top_rank!, topic_words: topicTitleWords() };
  const now = Date.parse('2026-10-26T13:00:00+09:00');
  const row = (id: number, title: string, source: string, hoursAgo: number, grade: string | null = 'press'): LightRow => ({
    id, title, source, sourceUrl: '', publishedAt: '', publishedTs: null, sourceGrade: grade, category: null, ts: now - hoursAgo * 3600000,
  });

  it('설정: 전국 +1 · off_topic_penalty −1 · 나머지 그대로', () => {
    const r = fieldProfile().top_rank!;
    expect([r.national_bonus, r.off_topic_penalty, r.institution_bonus, r.local_penalty, r.per_report, r.report_cap]).toEqual([1, -1, 2, -2, 0.5, 2]);
  });

  it('핵심어 = keywords.strong + core + groups(소문자 · 겹침 뺌) · categories.keywords 의 넓은 낱말은 아님', () => {
    const p = fieldProfile();
    const w = topicTitleWords(p);
    expect(new Set(w).size).toBe(w.length);
    expect(w).toEqual(expect.arrayContaining([p.keywords.core[0].toLowerCase(), (p.keywords.strong.ko as string[])[0].toLowerCase()]));
    for (const g of Object.entries(p.keywords.groups || {})) {
      if (g[0].startsWith('_') || !Array.isArray(g[1])) continue;
      expect(w).toEqual(expect.arrayContaining(g[1].map((x) => x.toLowerCase())));
    }
    for (const broad of ['정책', '정부', '교육']) expect(w).not.toContain(broad);
  });

  it('느슨한 전국 기사(10-25 이인선 의원 교육정책)는 0 점 · 분야 제목 전국 기사는 +1', () => {
    const loose = row(1, '이인선 의원, “졸속 교육정책 바로잡고 교육 정상화에 최선”', '프레시안', 5);
    expect(scoreTopGroup([loose], loose, 1, rule)).toMatchObject({ national: true, offTopic: true, score: 0 });
    const fit = row(2, '23조원대 불법 도박사이트 공급조직 적발 - 연합뉴스', 'Google News (KR)', 5);
    expect(scoreTopGroup([fit], fit, 1, rule)).toMatchObject({ national: true, offTopic: false, score: 1 });
    // 영문 핵심어는 소문자로 맞춤
    const en = row(3, 'Opioid Overdose deaths fall', 'Reuters', 5);
    expect(scoreTopGroup([en], en, 1, rule).offTopic).toBe(false);
  });

  it('반박 리뷰: 「 - 매체」 꼬리는 핵심어로 안 셈 · 묶음 안 다른 제목에 핵심어 있으면 감점 0 · TOP 전용 낱말(해악 감소 · 날록손)', () => {
    const tail = row(1, '군민 체육대회 성황 - 전남인터넷신문', '전남인터넷신문', 2);
    expect(scoreTopGroup([tail], tail, 1, rule).offTopic).toBe(true);
    const shown = row(2, '서울역 광장 출입 제한', '경향신문', 2);
    const other = row(3, '서울역 광장 음주 금지 구역 지정', '지역일보', 2);
    expect(scoreTopGroup([shown, other], shown, 2, rule).offTopic).toBe(false);
    for (const t of ['해악 감소의 사례', '날록손 키트 무료 배포']) {
      const r = row(4, t, 'X', 1);
      expect(scoreTopGroup([r], r, 1, rule).offTopic).toBe(false);
    }
  });

  it('topic_words 가 비거나 off_topic_penalty 가 없으면 감점 0(옛 호출 그대로)', () => {
    const r = row(1, '교육정책 바로잡기', '프레시안', 5);
    expect(scoreTopGroup([r], r, 1, { ...rule, topic_words: [] }).offTopic).toBe(false);
    expect(scoreTopGroup([r], r, 1, { ...rule, off_topic_penalty: 0 }).offTopic).toBe(false);
  });

  it('고르기: 핵심어 없는 전국 단독 기사가 Q18 에선 1위 · Q19 에선 두 곳이 쓴 분야 기사 뒤로', () => {
    const light = new Map<number, LightRow>([
      [1, row(1, '이인선 의원, 졸속 교육정책 바로잡고', '프레시안', 1)],
      [2, row(2, '라오스, 전자담배 반입 금지', '뉴스트래블', 3)],
      [4, row(4, '라오스, 전자담배 반입 금지', '여행신문', 3)],
      [3, row(3, '청년층 약물 정보 AI 이용', 'EurekAlert!', 4, 'academic')],
    ]);
    const info = { clusterId: 'lao', size: 2, representativeId: 2, memberIds: [2, 4] };
    const index = new Map([[2, info], [4, info]]);
    const q18 = { ...rule, national_bonus: 2, off_topic_penalty: 0 };
    expect(rankTopWeighted(light, index, now, q18, 3).map((p) => p.id)).toEqual([1, 3, 2]);
    expect(rankTopWeighted(light, index, now, rule, 3).map((p) => p.id)).toEqual([3, 2, 1]);
  });
});

// ---------- ■4 방송 관문 ----------
describe('NEWS-Q19 ■4 — 방송도 음주운전 주제 거름 · 편집본 = 가장 이른 방송일', () => {
  const rules = fieldProfile().gate.topic_exclude!;

  it('방송 관문 질문: no 예시 ⑤ 음주운전 단속·사고 특집 한 줄 · 「음주운전 중심 = partial 이상」 문구 뺌', () => {
    const s = fieldProfile().prompts.broadcast_gate!;
    expect(s).toMatch(/no 예시 다섯/);
    expect(s).toMatch(/⑤ 음주운전 단속·사고 특집\(단속 현장·사고 피해·처벌이 중심 — 운전자의 알코올 의존·치료를 다루지 않음\) = 중독 아님\./);
    expect(s).not.toMatch(/과다복용·음주운전·주취 응급/);
    expect(s).toMatch(/급성 알코올 중독·과다복용·주취 응급이 편의 중심이면/);
  });

  it('관문 수에 topic_exclude 칸', () => {
    expect(emptyBroadcastGateStats().reject).toMatchObject({ topic_exclude: 0, topic_fit_false: 0 });
  });

  it('이미 실린 방송 쓸기: 제목 + raw_body 설명으로 판정 · 실림만 보관(updated_at) · keep 되돌림 · 방송 행만 · 지움 0', async () => {
    const r = [{ ...rules[0], keep_ids: [40] }];
    const body = (desc: string) => `프로그램: X\n채널: Y (c)\n게시 시각: 2026-08-04T00:00:00Z\n영상: https://youtu.be/a\n\n${desc}`;
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT')) {
        return [
          { id: 10, title: '휴가철 하룻밤에 음주운전 320건 적발', raw_body: body('음주단속 현장'), tier: 'publish' },
          { id: 11, title: '수유3파출소 24시', raw_body: body('음주운전 신고 · 단속 · 알코올 중독 상담 연계'), tier: 'publish' },
          { id: 12, title: '음주운전 사고 특집', raw_body: body(''), tier: 'archive' },
          { id: 40, title: '음주운전 단속 현장', raw_body: body(''), tier: 'archive' },
          // 프로그램 머리(채널 이름 등)는 설명이 아님
          { id: 13, title: '음주운전', raw_body: '프로그램: 단속\n\n', tier: 'publish' },
        ];
      }
      return [[{ id: params?.[0] }], 1];
    });
    const sw = await sweepTopicExcludedBroadcasts(query, r, { deletedAt: true, rawBody: true });
    expect(sw).toEqual({ checked: 5, archived: [{ id: 10, rule: 'not_addiction_drunk_driving', title: '휴가철 하룻밤에 음주운전 320건 적발' }], restored: [40] });
    const sel = sqlOf(query);
    expect(sel).toMatch(/source_type = 'broadcast' AND NOT blocked AND deleted_at IS NULL/);
    expect(sel).toMatch(/raw_body LIKE ANY/);
    const writes = (query.mock.calls as unknown[][]).slice(1).map((c) => String(c[0]));
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatch(/SET tier = 'archive', updated_at = now\(\)[\s\S]*source_type = 'broadcast'/);
    expect(writes[1]).toMatch(/SET tier = 'publish', updated_at = now\(\)[\s\S]*source_type = 'broadcast'/);
    for (const w of writes) expect(w).not.toMatch(/DELETE/);
  });

  it('raw_body 가 없는 행은 건너뜀(관문 앞이 본 설명을 모름 · 제목만으로 보관 0) · 오류면 error', async () => {
    const query = jest.fn(async (sql: string) =>
      sql.startsWith('SELECT') ? [{ id: 1, title: '음주운전 사고 특집 단속', raw_body: null, tier: 'publish' }] : [[], 0],
    );
    const sw = await sweepTopicExcludedBroadcasts(query, rules, { deletedAt: false, rawBody: false });
    expect(sw).toEqual({ checked: 1, archived: [], restored: [] });
    expect(sqlOf(query)).toMatch(/NULL AS raw_body/);
    expect(sqlOf(query)).not.toMatch(/raw_body LIKE/);
    expect(query).toHaveBeenCalledTimes(1);
    expect(await sweepTopicExcludedBroadcasts(jest.fn().mockRejectedValue(new Error('x')), rules, { deletedAt: false, rawBody: true })).toEqual({
      checked: 0, archived: [], restored: [], error: true,
    });
  });

  it('편집본(설명에 방송 줄 여럿) = 가장 이른 방송일 · 제목 날짜가 먼저', () => {
    const desc = [
      '※ 이 영상은 2026년 2월 11일에 방송된 ＜PD로그＞의 일부입니다.',
      '※ 이 영상은 2013년 12월 31일에 방송된 ＜특집다큐＞의 일부입니다.',
      '※ 이 영상은 2022년 7월 2일에 방송된 ＜극한직업＞의 일부입니다.',
    ].join('\n');
    expect(originalAirDate('음주단속 현장', desc, '2026-08-04', 30)).toMatchObject({ aired: '2013-12-31', from: 'description', reupload: true });
    expect(originalAirDate('추적60분 20170619 방송', desc, '2026-08-04', 30)).toMatchObject({ aired: '2017-06-19', from: 'title' });
    // 리뷰: 「방송일 :」 이름표가 지나가는 옛 편 언급보다 먼저
    const labeled = '방송일 : 2024.03.01\n2016년 5월 3일 방송된 「앞 편」에서 소개한 가족';
    expect(originalAirDate('다큐', labeled, '2026-08-04', 30)).toMatchObject({ aired: '2024-03-01' });
  });
});
