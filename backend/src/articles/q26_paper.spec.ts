// NEWS-Q26 — 오너 11-12 미리보기 고침: 배치 · 기획(공개 호 · 없으면 숨김) · 지난 방송 단추 · 제호 · 바깥 링크 · 강조 칸 색.
// NEWS-Q27: 라파뉴스(영상 목록 길 · 규칙 · 시험)는 결정 2 로 걷어 냄(태그 pre-remove-rapha-news-20261112) · 제호 값은 q27_paper.spec 이 잰다.
import * as fs from 'fs';
import * as path from 'path';

const FRONT = path.join(__dirname, '../../../frontend');
const read = (p: string) => fs.readFileSync(path.join(FRONT, p), 'utf8');

type Feature = { title: string; summary: string; date: string; url: string };
interface Rules {
  featureIssues(data: unknown, max?: number): Feature[];
  contrast(a: string, b: string): number;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require(path.join(FRONT, 'assets/paper/paper_rules.js')) as Rules;

const issue = (n: number) => ({
  title: `중독 주간 ${n}호`,
  summary: `${n}호 요약`,
  date: `2026-11-${String(10 + n).padStart(2, '0')}`,
  url: `https://www.statory.org/ko/lab/addiction/weekly/${n}`,
});

describe('NEWS-Q26 기획 — Statory 랩 공개 호(결정 3)', () => {
  it('호 0 → 빈 목록(구간 숨김)', () => {
    expect(R.featureIssues([])).toEqual([]);
    expect(R.featureIssues({ items: [] })).toEqual([]);
  });
  it('호 1 → 한 줄', () => {
    const out = R.featureIssues({ items: [issue(1)] });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      title: '중독 주간 1호',
      summary: '1호 요약',
      date: '2026-11-11',
      url: 'https://www.statory.org/ko/lab/addiction/weekly/1',
    });
  });
  it('호 5 → 최신 차례 다섯', () => {
    const out = R.featureIssues([
      issue(2),
      issue(5),
      issue(1),
      issue(4),
      issue(3),
    ]);
    expect(out.map((x) => x.title)).toEqual([
      '중독 주간 5호',
      '중독 주간 4호',
      '중독 주간 3호',
      '중독 주간 2호',
      '중독 주간 1호',
    ]);
  });
  it('읽기 실패(null · 엉뚱한 꼴) → 빈 목록', () => {
    expect(R.featureIssues(null)).toEqual([]);
    expect(R.featureIssues('oops')).toEqual([]);
    expect(R.featureIssues({ error: 'x' })).toEqual([]);
  });
  it('Statory 밖 링크 · 제목 · 날짜 빠진 호는 뺌', () => {
    const bad = [
      { ...issue(1), url: 'https://evil.example/statory.org/' },
      { ...issue(2), url: 'http://statory.org/x' },
      { ...issue(3), title: '' },
      { ...issue(4), date: '어제' },
      issue(5),
    ];
    expect(R.featureIssues(bad).map((x) => x.title)).toEqual(['중독 주간 5호']);
  });
  it('대문: 호가 없으면 구간을 그리지 않음 · 지금은 읽을 길 없음(주소 비움) · 중독이슈는 부르지 않음(코드는 남김)', () => {
    const js = read('assets/paper/paper.js');
    expect(js).toMatch(
      /function featureBlock\(data\) \{\s*var list = R\.featureIssues\(data, 6\);\s*if \(!list\.length\) return '';/,
    );
    expect(js).toContain("var FEATURE_SOURCE = '';");
    expect(js).toContain('function issuesBlock(');
    expect(js).not.toMatch(/issuesBlock\(shownIssues/);
    expect(js).not.toContain('R.buildIssues(');
    expect(read('assets/paper/paper_rules.js')).toContain(
      'function issueName(',
    );
    expect(js).not.toMatch(/준비 중/);
  });
});

describe('NEWS-Q26 배치 · 방송 · 제호 · 바깥 링크(결정 1 · 2 · 4 · 5 · 6)', () => {
  const js = read('assets/paper/paper.js');
  const css = read('assets/paper/paper.css');
  const text = JSON.parse(read('messages/preview/paper.ko.json')) as {
    outs: {
      label: string;
      list: Array<{ label: string; url: string; kind?: string }>;
    };
    broadcast: { older: string };
  };

  it('오른쪽 단 = 오늘의 중독백과 강조 칸 하나 · 오늘 들어온 기사는 주요 뉴스 바로 아래(네 칸 × 두 줄 = 여덟)', () => {
    expect(js).toMatch(
      /'<aside class="frontSide">' \+ encBlock\(\) \+ '<\/aside><\/div>' \+\s+todayBlock\(plain\) \+/,
    );
    expect(js).toContain('var TODAY_FIRST = 8;');
    expect(css).toMatch(
      /\.todayGrid \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
    );
    expect(css).toMatch(/\.encSlot \{ min-height: 300px/);
  });

  it('지난 방송: 처음엔 단추 하나(닫힌 details) · 누르면 해마다 목록', () => {
    expect(js).toContain('<details class="past"><summary class="pastBtn">');
    expect(js).not.toContain('<details class="past" open');
    expect(js).not.toContain('<details class="year">');
    expect(text.broadcast.older).toBe('지난 방송 보기 ({n}편)');
  });

  it('제호 = 쪽의 h1 · 옛 그림(logo.png)을 늘려 쓰지 않음 (모양은 NEWS-Q28 휴먼옛체 윤곽 그림 — q28 시험)', () => {
    expect(js).toContain(
      '<h1 class="mastTitle"><a class="brand mastBrand logoBox" href="/preview/paper/"><img class="logoImg" src="/assets/paper/masthead.svg',
    );
    expect(js).not.toContain('logo.png');
    expect(read('assets/home/home.js')).toContain('<a class="brand" href="');
  });

  it('바깥 링크 다섯 = 찾은 주소만 · https · 새 창 · 899 아래는 「관련 사이트」 하나로 접음', () => {
    const urls = text.outs.list.map((o) => o.url);
    expect(urls).toEqual([
      'https://www.addictionsociety.net',
      'https://statory.org',
      'https://www.youtube.com/channel/UCNLL7-k2it9ngjN9BUma4Og',
      'https://raphacom.org/',
      'https://www.youtube.com/channel/UC-v25CDSY82CAd36pJIvmMw',
    ]);
    expect(text.outs.label).toBe('관련 사이트');
    expect(js).toMatch(
      /outLinks[\s\S]*target="_blank" rel="noopener noreferrer"/,
    );
    expect(css).toMatch(
      /@media \(max-width: 899px\) \{\s*\.outs \{ display: none; \}\s*\.outsFold \{ display: block; \}/,
    );
  });
});

describe('NEWS-Q26 강조 칸 색(결정 7)', () => {
  const css = read('assets/paper/paper.css');
  const js = read('assets/paper/paper.js');
  const token = (n: string) =>
    (new RegExp(`--${n}: (#[0-9a-f]{6});`).exec(css) || [])[1];

  it('이름 하나(--emph-bg) = 오너가 고른 중독이슈 칸 색 · 글자 · 흐린 글자 · 링크 명암비 4.5 이상', () => {
    expect(token('emph-bg')).toBe('#f4f7fa');
    for (const n of ['text', 'muted', 'link', 'emph-edge']) {
      expect(R.contrast(token(n), token('emph-bg'))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
  it('쓰는 곳 셋(중독백과 · 기획 · 지난 방송 펼친 칸)뿐 · 본문 기사 목록에는 안 씀', () => {
    const uses = js.match(/class="[^"]*\bemph\b[^"]*"/g) || [];
    expect(uses.sort()).toEqual(
      [
        'class="enc emph"',
        'class="featureItem emph"',
        'class="pastBody emph"',
      ].sort(),
    );
  });
});
