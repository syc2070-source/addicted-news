import { fieldProfile, topicTitleWords } from './field_profile';
import type { ClusterInfo } from './event_cluster';
import { LightRow, rankTopWeighted } from '../articles/cluster_view';
import {
  bodyLeadSentences,
  fixWidgetSummary,
  isTopSummaryOk,
  isWidgetSentence,
  isWidgetSummary,
  sweepWidgetSummaries,
} from './summary_widget';

// ---------- ■1 위젯 요약 → 본문 문장 ----------
describe('NEWS-Q21 ■1 — 요약 위젯 글은 본문 첫 두 문장으로(규칙 · LLM 0)', () => {
  const TITLE = "[현장] 경륜경정총괄본부, '불법도박 감시 모니터링단' 역량 강화 온 힘 쏟다 - 오늘경제";
  const BODY = [
    '가. 가. 기사의 본문 내용은 이 글자크기로 변경됩니다.',
    "[현장] 경륜경정총괄본부, '불법도박 감시 모니터링단' 역량 강화 온 힘 쏟다",
    '국민체육진흥공단 경륜경정총괄본부는 지난 24일 광명스피돔에서 불법도박 감시 모니터링단 위촉식과 역량 강화 교육을 열었다. 모니터링단은 온라인 불법 사행 사이트를 찾아 신고한다.',
    '기자 reporter@example.com',
  ].join('\n');

  it('시험 1: 6287 꼴 위젯 요약 → 본문 첫 두 문장(위젯 · 제목 되풀이 · 기자 줄 뺌)', () => {
    const fix = fixWidgetSummary('가. 가. 기사의 본문 내용은 이 글자크기로 변경됩니다.', null, BODY, TITLE);
    expect(fix.changed).toBe(true);
    expect(fix.summary).toBe(
      '국민체육진흥공단 경륜경정총괄본부는 지난 24일 광명스피돔에서 불법도박 감시 모니터링단 위촉식과 역량 강화 교육을 열었다.\n' +
        '모니터링단은 온라인 불법 사행 사이트를 찾아 신고한다.',
    );
    expect(fix.teaser).toBeNull();
    expect(isTopSummaryOk(fix.summary)).toBe(true);
  });

  it('실측 꼴(10-29 공개 글)은 다 위젯 · 기사 문장 속 「공유 · 광고 · 확대」는 아님', () => {
    for (const s of [
      '가. 가. 기사의 본문 내용은 이 글자크기로 변경됩니다.',
      '김포시, 영유아·부모 대상 스마트폰 과의존 예방 뮤지컬 성료. 글자크기 설정. 가.',
      '입력 2026.10.19 14:43. 글자 크기. 프린트.',
      "토스, 청소년 불법도박 예방 나선다…'우리아이 지킴이' 출시. 발행일 : 2026-10-20 11:16. 토스.",
      '한국기독교중독대책연합 출범. 스크롤 이동 상태바. 더파.',
      '이미지 확대. 하루 수십만 명이 오가는 서울역 광장에서 음주가 사라질 전망이다.',
      '대응하겠다"고 전했다.<저작권자 © 스타뉴스, 무단전재 및 재배포 금지>.',
    ]) {
      expect({ s, w: isWidgetSummary(s) }).toEqual({ s, w: true });
    }
    for (const s of [
      '이번 세미나는 도박 중독의 심각성을 알리고, 당사자들의 경험을 공유하기 위해 개최되었다.',
      '같은 취지에서 온라인 베팅 광고 금지 조항도 행정적·형사적 제재 대상으로 규정했다.',
      '앞으로도 현장 중심의 예방활동을 확대하겠다고 말했다.',
      '정책 데이터를 공유하기로 했지만 경험률은 변동이 없었다.',
      'U.S. 보건당국은 펜타닐 경보를 냈다.',
      // 티저 220자 자름 끝의 잘린 꼬리는 조각 규칙에 안 걸림
      '심포지엄은 오피오이드 중독 환자 돌봄을 다뤘다. 그',
      '본문 내용은 제공되지 않아 구체적 내용은 확인되지 않았다.',
      '',
    ]) {
      expect({ s, w: isWidgetSummary(s) }).toEqual({ s, w: false });
    }
    expect(isWidgetSentence('가.')).toBe(true);
    expect(isWidgetSentence('또한')).toBe(false);
  });

  it('본문 고르기: 기자 이름표 뗌 · 사진 설명 · 날짜 줄 뺌 · 붙은 문장(「다.이번」) 나눔 · 폭 0 빈칸 지움', () => {
    const body = [
      '[경륜경정총괄본부 제공]',
      '왼쪽부터 김보준 세종경찰청장, 강재규 영업본부장.',
      '승인 2026.10.23 18:12',
      '2026년 알코올 교육 금주의 길 프로그램 안내 이미지',
      '매일일보 = 김길수 기자 ｜ 용인시센터가 13일 예방교육을 했다.이번 교육은 청소년 40명이 들었다.',
    ].join('\n');
    expect(bodyLeadSentences(body, '제목')).toBe('용인시센터가 13일 예방교육을 했다.\n이번 교육은 청소년 40명이 들었다.');
    expect(bodyLeadSentences('(수원=연합뉴스) 김솔 기자 = 마약 유통에 가담한 40대가 실형을 받았다.', '제목')).toBe(
      '마약 유통에 가담한 40대가 실형을 받았다.',
    );
    expect(bodyLeadSentences('[이데일리 강민구 기자] 토스가 지킴이 서비스를 내놨다.', '제목')).toBe('토스가 지킴이 서비스를 내놨다.');
    expect(bodyLeadSentences('부안해경은 =​22일 마약 예방 교육을 열었다고 밝혔다.', '제목')).toBe('부안해경은 =22일 마약 예방 교육을 열었다고 밝혔다.');
  });

  it('본문에도 쓸 문장이 없으면 요약 비움 · 위젯 아닌 요약은 그대로(바뀜 0)', () => {
    expect(fixWidgetSummary('글자크기 설정. 가.', '글자크기 설정. 가.', '가. 가.\n짧은 글.', '제목')).toEqual({
      changed: true,
      summary: null,
      teaser: null,
    });
    const keep = '복지부가 도박 치유 예산을 늘렸다.\n상담 인력도 확대한다.';
    expect(fixWidgetSummary(keep, '티저', 'body', '제목')).toEqual({ changed: false, summary: keep, teaser: '티저' });
    expect(bodyLeadSentences(null, '제목')).toBe('');
  });
});

// ---------- ■1 TOP 자격 ----------
describe('NEWS-Q21 ■1 — 요약이 없거나 위젯 글이면 TOP 자격 0', () => {
  const now = Date.parse('2026-10-29T13:00:00+09:00');
  const rule = { ...fieldProfile().top_rank!, topic_words: topicTitleWords() };
  const row = (id: number, title: string, source: string, hoursAgo: number, summaryOk?: boolean): LightRow => ({
    id, title, source, sourceUrl: '', publishedAt: '', publishedTs: null, sourceGrade: 'press', category: null,
    ts: now - hoursAgo * 3600000, summaryOk,
  });

  it('TOP 자격 시험 1: 혼자인 위젯 글은 빠지고 · 묶음은 요약 좋은 기사가 대신 보임 · 모르면(undefined) 옛 꼴', () => {
    const solo = row(1, '복지부, 도박 중독 치유 예산 확대', '지역일보', 1, false);
    const repBad = row(2, '경륜경정총괄본부 불법도박 감시 모니터링단 강화', '오늘경제', 2, false);
    const memberOk = row(3, '경륜경정총괄본부 불법도박 감시 모니터링단 위촉', '스타뉴스', 3, true);
    const plain = row(4, '청소년 게임 중독 상담 늘어', '지역일보', 4);
    const other = row(5, '마약 사범 검거 늘어', '지역일보', 5, true);
    const info: ClusterInfo = { clusterId: '6287', size: 2, representativeId: 2, memberIds: [2, 3] };
    const light = new Map([solo, repBad, memberOk, plain, other].map((r) => [r.id, r]));
    const index = new Map<number, ClusterInfo>([[2, info], [3, info]]);
    const ids = rankTopWeighted(light, index, now, rule, 3).map((p) => p.id);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(2);
    expect(ids).toContain(3);
    expect(ids).toContain(4);
    expect(isTopSummaryOk(null)).toBe(false);
    expect(isTopSummaryOk('  ')).toBe(false);
    expect(isTopSummaryOk('가. 가. 기사의 본문 내용은 이 글자크기로 변경됩니다.')).toBe(false);
  });
});

// ---------- ■1 이미 저장된 글 쓸기 ----------
describe('NEWS-Q21 ■1 — 실행 시작 쓸기(지움 0 · 몇 번 돌아도 같음)', () => {
  it('위젯 요약만 고치고 · 고친 뒤 다시 돌면 고칠 것 0 · apply=false 면 UPDATE 0', async () => {
    const db = new Map<number, { title: string; summary: string | null; teaser: string | null; raw_body: string }>([
      [10, { title: '부천시 금주 교육', summary: '입력 2026.10.19 14:43. 글자 크기. 프린트.', teaser: null, raw_body: '입력 2026.10.19 14:43\n부천시는 다음 달 3일부터 금주 실천 교육을 연다. 교육은 6주 동안 이어진다.' }],
      [11, { title: '복지부 예산', summary: '복지부가 도박 치유 예산을 늘렸다.', teaser: null, raw_body: '' }],
      [12, { title: '주유소 행정처분', summary: '이미지 확대. 주유소 CG. [연합뉴스TV 제공].', teaser: null, raw_body: '이미지 확대\n주유소 CG' }],
    ]);
    const updates: unknown[][] = [];
    const query = async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT id, title')) return [...db].map(([id, r]) => ({ id, title: r.title, summary: r.summary, teaser: r.teaser, tier: 'publish' }));
      if (sql.startsWith('SELECT raw_body')) return [{ raw_body: db.get(Number(params![0]))!.raw_body }];
      if (sql.startsWith('UPDATE')) {
        updates.push(params!);
        const r = db.get(Number(params![2]))!;
        r.summary = params![0] as string | null;
        r.teaser = params![1] as string | null;
        return [];
      }
      return [];
    };
    const cols = { deletedAt: true, rawBody: true, tier: true };
    const dry = await sweepWidgetSummaries(query, cols, false);
    expect(dry.fixed.map((f) => f.id)).toEqual([10, 12]);
    expect(updates).toHaveLength(0);
    const first = await sweepWidgetSummaries(query, cols);
    expect(first.fixed).toEqual([
      { id: 10, tier: 'publish', before: '입력 2026.10.19 14:43. 글자 크기. 프린트.', after: '부천시는 다음 달 3일부터 금주 실천 교육을 연다.\n교육은 6주 동안 이어진다.' },
      { id: 12, tier: 'publish', before: '이미지 확대. 주유소 CG. [연합뉴스TV 제공].', after: null },
    ]);
    // 운영 summary 열 NOT NULL → 비움은 빈 글로 씀
    expect(updates[1]).toEqual(['', null, 12]);
    expect((await sweepWidgetSummaries(query, cols)).fixed).toHaveLength(0);
    expect(updates).toHaveLength(2);
  });
});
