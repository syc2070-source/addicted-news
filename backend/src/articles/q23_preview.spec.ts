// NEWS-Q23 ■2 · Q24 ■3 — 대문 한 벌(frontend/assets/home)과 미리보기: 색인 금지 · 글은 messages · 운영 수·로그 0 · 옛 대문 보관.
import * as fs from 'fs';
import * as path from 'path';

const FRONT = path.join(__dirname, '../../../frontend');
const read = (p: string) => fs.readFileSync(path.join(FRONT, p), 'utf8');
type Messages = Record<string, Record<string, string> | string>;

describe('NEWS-Q23 · Q24 대문', () => {
  const previewHtml = read('preview/home/index.html');
  const liveHtml = read('index.html');
  const js = read('assets/home/home.js');
  const css = read('assets/home/home.css');
  const previewText = JSON.parse(read('messages/preview/ko.json')) as Messages;
  const liveText = JSON.parse(read('messages/ko.json')) as Messages;

  it('미리보기만 noindex · 운영 대문 · 소개는 색인 열림', () => {
    expect(previewHtml).toContain(
      '<meta name="robots" content="noindex, nofollow">',
    );
    expect(liveHtml).not.toContain('noindex');
    expect(read('about.html')).not.toContain('noindex');
    expect(read('_legacy/index.html')).toContain('noindex');
  });

  it('운영 대문 = B 고정 · 글은 messages/ko.json · 미리보기 글 파일을 읽지 않음(코드 한 벌)', () => {
    expect(liveHtml).toContain('<body data-home="live">');
    expect(liveHtml).toContain('class="page planB"');
    expect(liveHtml).toContain('/assets/home/home.js');
    expect(previewHtml).toContain('/assets/home/home.js');
    expect(js).toContain(
      "LIVE ? '/messages/ko.json' : '/messages/preview/ko.json'",
    );
    expect(liveHtml).not.toContain('main.js');
    expect(liveHtml).not.toContain('style.css');
    expect(previewHtml).not.toContain('main.js');
  });

  it('옛 대문 · main.js · style.css 는 _legacy 에 보관 · 안쪽 쪽은 그 자리를 부름', () => {
    expect(read('_legacy/assets/js/main.js')).toContain('initMainPage');
    expect(read('_legacy/assets/css/style.css').length).toBeGreaterThan(1000);
    expect(read('_legacy/index.html')).toContain('_legacy/assets/js/main.js');
    for (const p of ['category.html', 'feature.html', 'rapha.html']) {
      expect(read(p)).toContain('src="_legacy/assets/js/main.js"');
    }
    for (const p of [
      'category.html',
      'feature.html',
      'rapha.html',
      'reports.html',
    ]) {
      expect(read(p)).toContain('href="_legacy/assets/css/style.css"');
    }
  });

  it('구간 순서 = TOP → 오늘 → 중독이슈 → 방송 → 세계 → 연대기 → 바닥', () => {
    const order =
      /topSection\(top\) \+ todaySection\(counts\) \+ issueSection\(issue, top\) \+\s+broadcastSection\(casts\) \+ worldSection\(grouped\) \+ chronicleSection\(casts\) \+\s+'<\/main>' \+ bottomHtml\(version\)/;
    expect(js).toMatch(order);
  });

  it('큰 수 = 전용 수 API(목록 행으로 세지 않음)', () => {
    expect(js).toContain("api('/articles/today-counts')");
    expect(js).not.toContain('group=none&kind');
    expect(js).not.toContain('sameDay');
  });

  it('두 안: 미리보기 기본 A · ?v=b 면 B', () => {
    expect(js).toContain(".get('v') === 'b'");
    expect(css).toContain('.page.planB');
  });

  it('손님 화면에 운영 수·로그 0(수집 소스 수 · 차단 · 수동 확인 · 건강 API)', () => {
    for (const text of [
      JSON.stringify(previewText),
      JSON.stringify(liveText),
    ]) {
      for (const word of [
        '수집 소스',
        '소스 수',
        '차단',
        '수동 확인',
        '실패',
        '로그',
      ]) {
        expect(text).not.toContain(word);
      }
    }
    expect(js).not.toContain('/api/health');
  });

  it('js 가 부르는 글 열쇠는 글 파일에 모두 있음(band 는 미리보기만 · about 은 운영만)', () => {
    const keys = [...js.matchAll(/\bM\.([a-z]+)\.([a-zA-Z0-9]+)/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(keys.length).toBeGreaterThan(20);
    const has = (t: Messages, group: string, key: string) =>
      typeof (t[group] as Record<string, string>)?.[key] === 'string';
    for (const [group, key] of keys) {
      if (group !== 'band') expect(has(liveText, group, key)).toBe(true);
      expect(has(previewText, group, key)).toBe(true);
    }
    expect(has(liveText, 'nav', 'about')).toBe(true);
    for (const t of [
      'alcohol',
      'gambling',
      'drug',
      'smartphone',
      'game',
      'tobacco',
      'none',
    ]) {
      expect((liveText.types as Record<string, string>)[t]).toBeTruthy();
    }
  });

  it('토큰 = 중독사회 v4 값 그대로(파랑 판 · 유형 색 6)', () => {
    for (const v of [
      '--blue-0: #2b4763',
      '--blue-deep: #1f3850',
      '--blue-card: #22394f',
      '--blue-accent: #ffcf7a',
      '--blue-link: #bfe6ff',
    ]) {
      expect(css).toContain(v);
    }
    for (const v of [
      '#82cefd',
      '#ffb45c',
      '#4fe3b3',
      '#ccb2ff',
      '#f87bab',
      '#a8e063',
    ]) {
      expect(css).toContain(v);
    }
  });

  it('흰 바탕 유형 점 = 바탕 · 카드 둘 다 3:1 넘음', () => {
    const lum = (hex: string) => {
      const ch = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const planB = css.slice(css.indexOf('.page.planB {'));
    const colors = [...planB.matchAll(/--type-[a-z]+: (#[0-9a-f]{6});/g)].map(
      (m) => m[1],
    );
    expect(colors).toHaveLength(7);
    for (const c of colors) {
      expect(ratio(c, '#ffffff')).toBeGreaterThan(3);
      expect(ratio(c, '#f4f7fa')).toBeGreaterThan(3);
    }
  });

  it('글꼴 = 저장소 파일 · Google Fonts 고리 0 · OFL 글 있음', () => {
    const fontCss = read('assets/fonts/noto-serif-kr/font.css');
    expect(fontCss).toContain("font-family: 'Noto Serif KR'");
    expect(fontCss).not.toContain('https://');
    expect(read('assets/fonts/noto-serif-kr/OFL.txt')).toContain(
      'SIL OPEN FONT LICENSE',
    );
    const files = [...fontCss.matchAll(/url\(([0-9]+\.woff2)\)/g)].map(
      (m) => m[1],
    );
    expect(files.length).toBeGreaterThan(100);
    for (const f of files) {
      expect(
        fs.existsSync(path.join(FRONT, 'assets/fonts/noto-serif-kr', f)),
      ).toBe(true);
    }
    for (const html of [previewHtml, liveHtml, read('about.html')]) {
      expect(html).not.toContain('fonts.googleapis.com');
      expect(html).toContain('/assets/fonts/noto-serif-kr/font.css');
    }
  });

  it('소개 쪽 글 = 지시서 그대로', () => {
    const about = read('about.html');
    const flat = about.replace(/<[^>]+>/g, '');
    expect(flat).toContain(
      '중독뉴스는 한국과 세계의 중독 소식을 날마다 모아 한 자리에서 보여 주는 곳입니다. 기사와 방송을 자동으로 모으고, 중독이 주제인 것만 골라 싣습니다. 글을 고쳐 쓰지 않으며, 모든 소식은 원문으로 이어집니다.',
    );
    expect(flat).toContain(
      '싣는 것: 국내 매체 기사 · 방송(다큐·탐사) · 세계 소식 · 중독이슈(같은 소식 묶음) · 연대기',
    );
    expect(flat).toContain(
      '고르는 법: 자동으로 모은 뒤 규칙과 관문으로 거릅니다. 음주운전 단속·캠페인처럼 중독이 주제가 아닌 소식은 싣지 않습니다.',
    );
    expect(flat).toContain(
      '함께 보는 곳: 중독사회 addictionsociety.net · Statory statory.org',
    );
    expect(flat).toContain('문의: 010-8476-1057 · syc2070@gmail.com');
  });
});
