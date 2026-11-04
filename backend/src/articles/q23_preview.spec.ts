// NEWS-Q23 ■2 — 대문 미리보기(frontend/preview/home): 색인 금지 · 글은 messages/preview · 운영 수·로그 0 · 운영 대문과 나눔.
import * as fs from 'fs';
import * as path from 'path';

const FRONT = path.join(__dirname, '../../../frontend');
const read = (p: string) => fs.readFileSync(path.join(FRONT, p), 'utf8');

describe('NEWS-Q23 대문 미리보기', () => {
  const html = read('preview/home/index.html');
  const js = read('preview/home/home.js');
  const css = read('preview/home/home.css');
  const messages = JSON.parse(read('messages/preview/ko.json')) as Record<string, Record<string, string> | string>;

  it('noindex: 쪽 meta(운영 설정 vercel.json 은 손대지 않음)', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('운영 대문은 미리보기 자산을 싣지 않고 · 미리보기는 운영 main.js 를 싣지 않음', () => {
    const live = read('index.html');
    expect(live).not.toContain('preview/home');
    expect(live).not.toContain('messages/preview');
    expect(read('assets/js/main.js')).not.toContain('messages/preview');
    expect(html).not.toContain('main.js');
    expect(html).not.toContain('assets/css/style.css');
  });

  it('구간 순서 = TOP → 오늘 → 중독이슈 → 방송 → 세계 → 연대기 → 바닥', () => {
    const order = /topSection\(top\) \+ todaySection\(plain, casts\) \+ issueSection\(issue, top\) \+\s+broadcastSection\(casts\) \+ worldSection\(grouped\) \+ chronicleSection\(casts\) \+\s+'<\/main>' \+ bottomHtml\(version\)/;
    expect(js).toMatch(order);
  });

  it('두 안: 기본 A · ?v=b 면 B', () => {
    expect(js).toContain(".get('v') === 'b'");
    expect(css).toContain('.page.planB');
  });

  it('손님 화면에 운영 수·로그 0(수집 소스 수 · 차단 · 수동 확인 · 건강 API)', () => {
    const text = JSON.stringify(messages);
    for (const word of ['수집 소스', '소스 수', '차단', '수동 확인', '실패', '로그']) expect(text).not.toContain(word);
    expect(js).not.toContain('/api/health');
  });

  it('js 가 부르는 글 열쇠는 messages 에 모두 있음', () => {
    const keys = [...js.matchAll(/\bM\.([a-z]+)\.([a-zA-Z0-9]+)/g)].map((m) => [m[1], m[2]]);
    expect(keys.length).toBeGreaterThan(20);
    for (const [group, key] of keys) {
      expect(typeof (messages[group] as Record<string, string>)?.[key]).toBe('string');
    }
    for (const t of ['alcohol', 'gambling', 'drug', 'smartphone', 'game', 'tobacco', 'none']) {
      expect((messages.types as Record<string, string>)[t]).toBeTruthy();
    }
  });

  it('토큰 = 중독사회 v4 값 그대로(파랑 판 · 유형 색 6)', () => {
    for (const v of ['--blue-0: #2b4763', '--blue-deep: #1f3850', '--blue-card: #22394f', '--blue-accent: #ffcf7a', '--blue-link: #bfe6ff']) {
      expect(css).toContain(v);
    }
    for (const v of ['#82cefd', '#ffb45c', '#4fe3b3', '#ccb2ff', '#f87bab', '#a8e063']) expect(css).toContain(v);
  });
});
