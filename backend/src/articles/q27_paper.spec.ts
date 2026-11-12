// NEWS-Q27 — 오너 11-12 미리보기 다시 봄: 남색 로고체 제호 · 라파뉴스 걷어 냄(연계만) · 위 띠 링크 진하게 · 구간 바탕 번갈아 · 오른쪽 단 맞춤.
import * as fs from 'fs';
import * as path from 'path';

const FRONT = path.join(__dirname, '../../../frontend');
const read = (p: string) => fs.readFileSync(path.join(FRONT, p), 'utf8');
interface Rules {
  contrast(a: string, b: string): number;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require(path.join(FRONT, 'assets/paper/paper_rules.js')) as Rules &
  Record<string, unknown>;

const js = read('assets/paper/paper.js');
const css = read('assets/paper/paper.css');
const html = read('preview/paper/index.html');
const token = (n: string) =>
  (new RegExp(`--${n}: (#[0-9a-f]{6});`).exec(css) || [])[1];
// 미디어 질의 블록 하나의 본문
const media = (q: string) => {
  const i = css.indexOf(`@media (${q}) {`);
  if (i < 0) return '';
  const j = css.indexOf('\n}', i);
  return css.slice(i, j);
};

describe('NEWS-Q27 결정 1 — 제호 = 중독사회 머리의 남색 로고체', () => {
  it('남색 칸 = 중독사회 머리 바탕 실측값(#1f3850 = --blue-deep) · 흰 글자 · 명암비 4.5 이상', () => {
    expect(token('logo-bg')).toBe('#1f3850');
    expect(token('logo-bg')).toBe(token('blue-deep'));
    expect(token('logo-ink')).toBe('#ffffff');
    expect(R.contrast(token('logo-ink'), token('logo-bg'))).toBeGreaterThan(
      12,
    );
  });
  // 글자 모양(고딕 글자)은 NEWS-Q28 결정 1 로 바뀜 — 휴먼옛체 윤곽 그림(q28 시험). 남색 칸 · 크기 · 새 글꼴 파일 0 은 그대로.
  it('옛 그림(logo.png · 중독사회 그림)을 늘려 쓰지 않음 · 새 글꼴 파일 0', () => {
    expect(js).toContain('<a class="brand mastBrand logoBox" href="/preview/paper/">');
    expect(js).not.toMatch(/logo\.png|logo-dark-ink/);
    expect(html.match(/<link rel="stylesheet"/g)).toHaveLength(3);
    expect(html).toContain('/assets/fonts/noto-serif-kr/font.css');
  });
  it('크기: 칸 높이 1440 = 96px · 390 = 60px · 가운데', () => {
    expect(css).toMatch(/\.mast \.logoBox \{[^}]*height: 96px;/);
    expect(media('max-width: 599px')).toMatch(
      /\.mast \.logoBox \{ height: 60px;/,
    );
    expect(css).toMatch(/\.mastInner \{[^}]*justify-content: center;/);
  });
});

describe('NEWS-Q27 결정 2 — 라파뉴스 구간과 딸린 길 걷어 냄 · 위 띠 링크 둘은 남김', () => {
  it('대문 · 규칙 · 글에서 라파뉴스 구간이 없음', () => {
    expect(js).not.toMatch(/raphaBlock|raphaSlot|raphaLoad|rapha-videos/);
    expect(R.raphaVideos).toBeUndefined();
    expect(css).not.toContain('raphaGrid');
    const text = JSON.parse(read('messages/preview/paper.ko.json')) as Record<
      string,
      unknown
    >;
    expect(text.rapha).toBeUndefined();
  });
  it('백엔드 길(GET /articles/rapha-videos) · 채널 파일 · 읽기 코드 없음', () => {
    const ctl = fs.readFileSync(
      path.join(__dirname, 'articles.controller.ts'),
      'utf8',
    );
    expect(ctl).not.toMatch(/rapha-videos|rapha_videos|raphaVideos/);
    expect(fs.existsSync(path.join(__dirname, 'rapha_videos.ts'))).toBe(false);
    expect(
      fs.existsSync(path.join(__dirname, '../../data/rapha_youtube.json')),
    ).toBe(false);
    // 옛 라파뉴스 쪽(/rapha.html · GET /articles/rapha = 관리자가 고른 기사)은 다른 기능 — 그대로
    expect(ctl).toContain("@Get('rapha')");
  });
  it('라파공동체로 가는 길 = 위 띠 링크 둘(누리집 · 유튜브) · 새 창', () => {
    const text = JSON.parse(read('messages/preview/paper.ko.json')) as {
      outs: { list: Array<{ label: string; url: string; kind?: string }> };
    };
    const rapha = text.outs.list.filter((o) => o.label === '라파공동체');
    expect(rapha.map((o) => o.url)).toEqual([
      'https://raphacom.org/',
      'https://www.youtube.com/channel/UC-v25CDSY82CAd36pJIvmMw',
    ]);
    expect(js).toMatch(
      /function outLinks[\s\S]*?target="_blank" rel="noopener noreferrer"/,
    );
  });
});

describe('NEWS-Q27 결정 3 — 위 띠 관련 사이트 글자 진하게', () => {
  const rule = (sel: string) =>
    new RegExp(`(?:^|\\n)${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`).exec(
      css,
    )?.[1] ||
    '';
  it('링크 = 본문 글자색 · 굵기 600 · 15px · 흰 바탕 명암비 7 이상', () => {
    const l = rule('.outLink');
    expect(l).toContain('color: var(--text)');
    expect(l).toContain('font-weight: 600');
    expect(l).toContain('font-size: 0.9375rem');
    expect(R.contrast(token('text'), token('bg'))).toBeGreaterThanOrEqual(7);
  });
  it('390 의 접힌 「관련 사이트 ▾」도 같은 진하기 · 머리말은 그보다 흐리게', () => {
    const f = rule('.outsFold summary');
    expect(f).toContain('color: var(--text)');
    expect(f).toContain('font-weight: 600');
    expect(rule('.outsLabel')).toContain('color: var(--muted)');
    expect(R.contrast(token('muted'), token('bg'))).toBeLessThan(
      R.contrast(token('text'), token('bg')),
    );
    expect(rule('.outKind')).toContain('color: var(--text)');
  });
});

// 구간 전체 색 띠는 NEWS-Q28 결정 3 으로 걷음(기사 칸마다 바탕 — q28 시험). 연한 미색 이름 · 명암 · 분야 점 색은 그대로.
describe('NEWS-Q27 결정 4 — 연한 미색 · 명암 · 분야 점 색', () => {
  it('연한 미색(--warm-bg) = #fbf7f0 · 강조 칸 색과 다름', () => {
    expect(token('warm-bg')).toBe('#fbf7f0');
    expect(token('warm-bg')).not.toBe(token('emph-bg'));
    expect(css).toMatch(/\.page \{ overflow-x: clip;/);
  });
  it('새 바탕 둘 위 글자 · 흐린 글자 · 링크 · 나라 글자 명암비 4.5 이상 · 분야 점 색 그대로', () => {
    for (const bg of ['emph-bg', 'warm-bg'])
      for (const fg of ['text', 'muted', 'link', 'accent'])
        expect(R.contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
    expect(
      [
        'alcohol',
        'gambling',
        'drug',
        'smartphone',
        'game',
        'tobacco',
        'none',
      ].map((t) => token(`type-${t}`)),
    ).toEqual([
      '#2a78d6',
      '#d9571f',
      '#128a60',
      '#6250d6',
      '#d4557f',
      '#008300',
      '#847f74',
    ]);
  });
});

// 칸을 주요 뉴스 높이까지 늘림(flex)은 NEWS-Q28 결정 4 로 거둠(q28 시험). 풀이 줄 늘림은 그대로.
describe('NEWS-Q27 결정 5 — 1440 오른쪽 단: 풀이 줄 늘림(새 내용 0)', () => {
  it('풀이 줄 = 기본 4 + 남는 높이만큼 · 풀이 전체 줄 수를 넘지 않음 · 두 단일 때만', () => {
    expect(js).toContain('var ENC_LINES = 4;');
    expect(css).toMatch(/\.encDef \{[^}]*-webkit-line-clamp: 4;/);
    expect(js).toMatch(
      /var n = Math\.min\(all, ENC_LINES \+ Math\.max\(0, Math\.floor\(slack \/ lh\)\)\);/,
    );
    expect(js).toContain("window.matchMedia('(min-width: 1100px)')");
    // NEWS-Q28 리뷰 2-8: 같은 줄에서 자리 잡기 높이도 끔 → 그다음 줄이 fitEnc()
    expect(js).toMatch(/slot\.innerHTML = encBody\(items\);[^\n]*\n\s*fitEnc\(\);/);
  });
});
