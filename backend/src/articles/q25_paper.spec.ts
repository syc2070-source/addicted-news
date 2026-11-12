// NEWS-Q25 — 신문 대문 미리보기(/preview/paper): 규칙(이슈 · 이름 · 나라 · 오늘 · 방송 해마다) · 색인 금지 · 운영 대문 그대로.
import * as fs from 'fs';
import * as path from 'path';

const FRONT = path.join(__dirname, '../../../frontend');
const read = (p: string) => fs.readFileSync(path.join(FRONT, p), 'utf8');

type Member = {
  id: number;
  title: string;
  source: string;
  publishedAt?: string;
  publishedTs?: string;
};
type Item = Member & {
  createdAt?: string;
  isForeign?: boolean;
  category?: string;
  sourceUrl?: string;
  clusterId?: string | null;
  clusterMembers?: Member[];
};
type Issue = {
  id: number;
  name: string;
  rule: string;
  outlets: number;
  size: number;
};
interface Rules {
  cleanTitle(t: string): string;
  bareTitle(t: string): string;
  issueName(
    titles: string[],
    max?: number,
  ): { name: string; rule: 'common' | 'lead' };
  buildIssues(
    items: Item[],
    now: number,
    opts?: { days?: number; minOutlets?: number; minIssues?: number },
  ): Issue[];
  todayArticles(items: Item[]): { day: string; items: Item[] };
  categoryColumns(
    items: Item[],
    cats: string[],
    n: number,
    skip?: Record<number, number>,
  ): Record<string, Item[]>;
  countryOf(a: { source?: string; sourceUrl?: string }): string;
  broadcastBlocks(
    items: Item[],
    n: number,
  ): { head: Item[]; years: { year: string; items: Item[] }[]; total: number };
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require(path.join(FRONT, 'assets/paper/paper_rules.js')) as Rules;

const NOW = Date.parse('2026-11-11T19:00:00+09:00');
const day = (d: string) => `2026-11-${d}T03:10:00.000Z`;
function cluster(id: number, d: string, titles: [string, string][]): Item {
  const lead = titles[0];
  return {
    id,
    title: lead[0],
    source: lead[1],
    createdAt: day(d),
    publishedAt: day(d),
    clusterId: String(id),
    clusterMembers: titles.map(([title, source], i) => ({
      id: id * 10 + i,
      title,
      source,
      publishedAt: day(d),
    })),
  };
}

describe('NEWS-Q25 신문 대문 규칙', () => {
  it('이슈 이름: 공통 낱말 · 매체 꼬리 · 따옴표 · 말줄임 뗌 · 24자 안', () => {
    const r = R.issueName([
      '청소년 도박·마약 자진신고 받는다…경찰 "처벌보다 치유 우선" - 연합뉴스',
      '경찰, 청소년 도박·마약 자진신고 기간 운영 - 뉴시스',
      "청소년 도박 마약 자진신고하면 '치유' 우선 - 국민일보",
    ]);
    expect(r.rule).toBe('common');
    expect(r.name).toContain('청소년');
    expect(r.name).toContain('자진신고');
    expect(r.name.length).toBeLessThanOrEqual(24);
    expect(r.name).not.toMatch(/["'“”‘’…]|연합뉴스|뉴시스/);
  });

  it('이슈 이름: 조사로 낱말을 자르지 않음(어린이 · 릴레이)', () => {
    const r = R.issueName([
      '강북구, 어린이 대상 흡연 인형극 개최',
      '강북구 어린이 흡연 예방 인형극',
      '강북구, 어린이 흡연 인형극 열어',
    ]);
    expect(r.name).toContain('어린이');
    expect(r.name).not.toMatch(/어린(?!이)/);
  });

  it('이슈 이름: 공통 낱말이 둘 미만이면 대표 제목을 24자 안으로', () => {
    const r = R.issueName([
      '가나다라 마바사 아자차카 타파하 가나다라마바사아자차카타파하',
      '전혀 다른 제목 하나',
      '또 다른 이야기',
    ]);
    expect(r.rule).toBe('lead');
    expect(r.name.length).toBeLessThanOrEqual(24);
  });

  it('이슈 = 14일 안 · 매체 셋 이상 · 셋 미만이면 접음(낱개 기사를 이슈로 부르지 않음)', () => {
    const three = (id: number, d: string) =>
      cluster(id, d, [
        [`도박 예방 캠페인 ${id} 열려 - 가`, '가'],
        [`도박 예방 캠페인 ${id} 개최 - 나`, '나'],
        [`도박 예방 캠페인 ${id} 진행 - 다`, '다'],
      ]);
    const two = cluster(9, '10', [
      ['음주 예방 교육 - 가', '가'],
      ['음주 예방 교육 - 나', '나'],
    ]);
    const old = { ...three(8, '01'), createdAt: '2026-10-20T03:00:00.000Z' };
    const single: Item = {
      id: 7,
      title: '낱개 기사',
      source: '라',
      createdAt: day('11'),
    };
    expect(
      R.buildIssues([three(1, '11'), three(2, '10'), two, old, single], NOW),
    ).toEqual([]);
    const got = R.buildIssues(
      [three(1, '11'), three(2, '10'), three(3, '09'), two, old, single],
      NOW,
    );
    expect(got.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(got.every((x) => x.outlets >= 3 && x.name.length > 0)).toBe(true);
  });

  it('오늘 들어온 기사 = 가장 늦은 수집 날(KST)의 기사만', () => {
    const t = R.todayArticles([
      { id: 1, title: 'a', source: 's', createdAt: '2026-11-11T03:10:00.000Z' },
      { id: 2, title: 'b', source: 's', createdAt: '2026-11-10T03:10:00.000Z' },
      { id: 3, title: 'c', source: 's', createdAt: '2026-11-10T16:30:00.000Z' }, // KST 11-11 01:30
    ]);
    expect(t.day).toBe('2026-11-11');
    expect(t.items.map((a) => a.id).sort()).toEqual([1, 3]);
  });

  it('분야 단: 국내만 · 분야마다 n 개 · 위에 보인 것 뺌', () => {
    const items: Item[] = [
      { id: 1, title: 'a', source: 's', category: '도박중독' },
      { id: 2, title: 'b', source: 's', category: '도박중독', isForeign: true },
      { id: 3, title: 'c', source: 's', category: '도박중독' },
      { id: 4, title: 'd', source: 's', category: '중독정책' },
    ];
    const c = R.categoryColumns(
      items,
      ['도박중독', '중독정책', '게임·디지털중독'],
      5,
      { 3: 1 },
    );
    expect(c['도박중독'].map((a) => a.id)).toEqual([1]);
    expect(c['중독정책'].map((a) => a.id)).toEqual([4]);
    expect(c['게임·디지털중독']).toEqual([]);
  });

  it('나라: 매체 표 → 주소 꼬리 → 미국 호출부호 · 모르면 빈 값', () => {
    expect(
      R.countryOf({
        source: 'La Tercera',
        sourceUrl: 'https://www.latercera.com/x',
      }),
    ).toBe('칠레');
    expect(
      R.countryOf({ source: 'X', sourceUrl: 'https://www.ctvnews.ca/a' }),
    ).toBe('캐나다');
    expect(
      R.countryOf({
        source: 'X',
        sourceUrl: 'https://www.independent.co.uk/a',
      }),
    ).toBe('영국');
    expect(
      R.countryOf({ source: 'KVUE', sourceUrl: 'https://www.kvue.com/a' }),
    ).toBe('미국');
    expect(
      R.countryOf({
        source: 'WSYX',
        sourceUrl: 'https://abc6onyourside.com/a',
      }),
    ).toBe('미국');
    expect(
      R.countryOf({ source: 'Some Blog', sourceUrl: 'https://someblog.com/a' }),
    ).toBe('');
    // 리뷰 1: 호출부호 짐작이 남의 나라를 「미국」으로 만들지 않음
    for (const [source, url] of [
      ['KBS World', 'https://world.kbs.co.kr/a'],
      ['WHO', 'https://www.who.int/a'],
      ['WWF', 'https://wwf.org/a'],
      ['KPMG', 'https://kpmg.com/a'],
    ]) {
      expect(R.countryOf({ source, sourceUrl: url })).toBe('');
    }
  });

  it('대표가 매체 목록에도 들어 있어도 제목을 한 번만 셈 · 빈 매체 칸에 안 깨짐', () => {
    const lead: Item = {
      id: 1,
      title: '가나 다라 마바 사아 - 갑',
      source: '갑',
      createdAt: day('11'),
    };
    lead.clusterMembers = [
      { id: 1, title: lead.title, source: '갑' },
      { id: 2, title: '가나 소식 - 을', source: '을' },
      { id: 3, title: '전혀 다른 말 - 병', source: '병' },
      null as unknown as Member,
    ];
    const make = (id: number): Item => ({
      ...lead,
      id,
      clusterMembers: lead.clusterMembers!.map((m) =>
        m && m.id === 1 ? { ...m, id } : m,
      ),
    });
    const got = R.buildIssues([make(1), make(4), make(5)], NOW);
    expect(got).toHaveLength(3);
    expect(got[0].size).toBe(3);
    expect(got[0].name).not.toBe('가나 다라 마바 사아');
  });

  it('방송 한 구간: 원 방송일 새것 먼저 · 앞 n 편 + 나머지 해마다', () => {
    const b = R.broadcastBlocks(
      [
        { id: 1, title: 'a', source: 's', publishedAt: '2017-06-19' },
        { id: 2, title: 'b', source: 's', publishedAt: '2026-11-08' },
        { id: 3, title: 'c', source: 's', publishedAt: '2023-01-28' },
        { id: 4, title: 'd', source: 's', publishedAt: '2017-04-02' },
      ],
      1,
    );
    expect(b.head.map((a) => a.id)).toEqual([2]);
    expect(b.years.map((y) => [y.year, y.items.length])).toEqual([
      ['2023', 1],
      ['2017', 2],
    ]);
    expect(b.total).toBe(4);
  });
});

describe('NEWS-Q25 신문 대문 미리보기 쪽', () => {
  const html = read('preview/paper/index.html');
  const js = read('assets/paper/paper.js');
  const text = JSON.parse(read('messages/preview/paper.ko.json')) as Record<
    string,
    unknown
  >;

  it('미리보기만 noindex · 운영 대문은 새 파일을 부르지 않음', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    const live = read('index.html');
    expect(live).not.toContain('/assets/paper/');
    expect(live).toContain('/assets/home/home.js');
  });

  // NEWS-Q26(오너 11-12)이 차례를 바꿈: 오늘의 중독백과가 오른쪽 단 맨 위 · 오늘 들어온 기사는 주요 뉴스 아래 · 중독이슈 대신 기획(q26_paper.spec 이 자세히 잼)
  it('구간 차례 = 주요 뉴스(머리 + 버금) | 오늘의 중독백과 → 오늘 들어온 기사 → 분야 단 → 기획 → 해외 → 방송 하나(NEWS-Q26 차례)', () => {
    expect(js).toMatch(
      /leadBlock\(lead, subs\)[\s\S]*encBlock\(\)[\s\S]*todayBlock\(plain\) \+\s*columnsBlock\(grouped, skip\) \+ featureBlock\(feature\) \+ abroadBlock\(grouped, skip\) \+ broadcastBlock\(casts\)/,
    );
    expect(js).not.toContain('chronicleSection');
  });

  it('낱말: 「주요 뉴스」 · 「오늘 들어온 기사」 · 영어 표제 0 · 옛 표제 0', () => {
    const all = JSON.stringify(text);
    expect(all).toContain('"주요 뉴스"');
    expect(all).toContain('"오늘 들어온 기사"');
    expect(all).not.toMatch(
      /TOP NEWS|지금 가장 무게 있는 소식|방송으로 거슬러 보기|세계의 중독 소식/,
    );
    const titles = Object.values(text)
      .filter(
        (v): v is Record<string, unknown> =>
          !!v && typeof v === 'object' && !Array.isArray(v),
      )
      .map((v) => v.title)
      .filter((t): t is string => typeof t === 'string');
    expect(titles.length).toBeGreaterThanOrEqual(6);
    for (const t of titles) expect(t).not.toMatch(/[A-Za-z]{2,}/);
  });

  it('자료는 공개 GET 만(쓰기 · 다른 곳 호출 0) · 백과 자리를 미리 잡음', () => {
    expect(js).not.toMatch(/method\s*:/);
    const calls = js.match(/api\('([^']+)'\)/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/api\('\/(articles|encyclopedia)/);
    expect(read('assets/paper/paper.css')).toMatch(
      /\.encSlot \{ min-height: \d+px/,
    );
  });

  it('옛 Safari 가 못 읽는 뒤 보기 정규식 0(리뷰 2)', () => {
    expect(js).not.toMatch(/\(\?<[=!]/);
    expect(read('assets/paper/paper_rules.js')).not.toMatch(/\(\?<[=!]/);
  });

  it('그림 없는 머리기사는 글만 넓게(빈 판 0)', () => {
    expect(js).toContain("pic ? ' hasPic' : ' noPic'");
    expect(read('assets/paper/paper.css')).toContain(
      '.leadStory.noPic { grid-template-columns: minmax(0, 1fr); }',
    );
  });
});
