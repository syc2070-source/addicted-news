// NEWS-Q28 — 오너 11-12 미리보기 세 번째: 제호 = 휴먼옛체 윤곽 그림 · 신문의 범위(띠와 줄이 기사 폭에서 끝남) · 기사 칸마다 바탕 · 중독백과 칸 글자 키움.
import * as fs from 'fs';
import * as path from 'path';

const FRONT = path.join(__dirname, '../../../frontend');
const read = (p: string) => fs.readFileSync(path.join(FRONT, p), 'utf8');
interface Rules {
  contrast(a: string, b: string): number;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require(path.join(FRONT, 'assets/paper/paper_rules.js')) as Rules;

const js = read('assets/paper/paper.js');
const css = read('assets/paper/paper.css');
const html = read('preview/paper/index.html');
const svg = read('assets/paper/masthead.svg');
const token = (n: string) =>
  (new RegExp(`--${n}: (#[0-9a-f]{6});`).exec(css) || [])[1];
// 줄 첫머리의 규칙 하나(미디어 질의 안이면 두 칸 들여 씀)
const rule = (sel: string, indent = '') =>
  new RegExp(
    `(?:^|\\n)${indent}${sel.replace(/[.()]/g, (c) => '\\' + c)} \\{([^}]*)\\}`,
  ).exec(css)?.[1] || '';
// min-width: 600px 블록 전부(둘 · 머리 쪽과 바닥글 쪽)
const wide = () => {
  const out: string[] = [];
  let i = css.indexOf('@media (min-width: 600px) {');
  while (i >= 0) {
    out.push(css.slice(i, css.indexOf('\n}', i)));
    i = css.indexOf('@media (min-width: 600px) {', i + 1);
  }
  return out.join('\n');
};

describe('NEWS-Q28 결정 1 — 제호 = 휴먼옛체 윤곽 그림 + 남색 칸 + 흰 글자', () => {
  it('그림은 윤곽(path)만 — 글자(text) · 글꼴 이름 · 글꼴 파일 참조 0 · 흰 글자 · 바탕 없음(칸이 남색)', () => {
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="/);
    expect(svg).toContain('<path fill="#ffffff" d="M');
    expect(svg).not.toMatch(/<text|font-family|@font-face|\.ttf|\.woff|<rect|<image/i);
    expect(svg.length).toBeLessThan(30000);
    // 두 줄 비(가로 : 세로) — 원본 40 : 23 · 글자마다 한 칸 · 자간 -20% 로 뜬 값
    const vb = /viewBox="([\d.-]+) ([\d.-]+) ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(Number(vb[3]) / Number(vb[4])).toBeGreaterThan(2.6);
    expect(Number(vb[3]) / Number(vb[4])).toBeLessThan(2.8);
    // <img> width/height 비 = viewBox 비(불러오기 전후 자리 흔들림 0 · 리뷰 2-2)
    const wh = /class="logoImg"[^>]*width="(\d+)" height="(\d+)"/.exec(js)!;
    expect(
      Math.abs(Number(wh[1]) / Number(wh[2]) - Number(vb[3]) / Number(vb[4])),
    ).toBeLessThan(0.005);
  });
  it('글꼴 파일은 저장소에 없음 · 웹 글꼴로 싣지 않음', () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [e.name],
      );
    const names = walk(FRONT);
    expect(names.filter((n) => /^HM[KF]MOLD/i.test(n))).toEqual([]);
    expect(names.filter((n) => /\.(ttf|otf|ttc)$/i.test(n))).toEqual([]);
    // 설명 글에는 이름이 나오지만 글꼴로 부르지는 않음
    expect(css).not.toMatch(/font-family:[^;]*(휴먼옛체|HMKMOLD|Yet R)|@font-face/);
    expect(html.match(/<link rel="stylesheet"/g)).toHaveLength(3);
  });
  it('제호 = 쪽의 h1 안 그림 한 장 · 읽는 이용 글(alt) = 「중독뉴스 addiction news」 · 남색 칸 크기 그대로(96 · 60)', () => {
    expect(js).toContain(
      '<h1 class="mastTitle"><a class="brand mastBrand logoBox" href="/preview/paper/"><img class="logoImg" src="/assets/paper/masthead.svg?v=q28" alt="\' + esc(M.brand + \' \' + M.brandEn) + \'"',
    );
    const text = JSON.parse(read('messages/preview/paper.ko.json')) as {
      brand: string;
      brandEn: string;
    };
    expect(`${text.brand} ${text.brandEn}`).toBe('중독뉴스 addiction news');
    expect(rule('.mast .logoBox')).toMatch(/height: 96px;[^]*background: var\(--logo-bg\)/);
    expect(rule('.mast .logoImg')).toContain('height: 68px');
    expect(rule('.mast .logoImg', '  ')).toContain('height: 42px');
    expect(token('logo-bg')).toBe('#1f3850');
    expect(css).toContain(
      '@media (forced-colors: active) { .mast .logoBox { forced-color-adjust: none; } }',
    );
    // 앞 판의 고딕 글자 제호는 내림
    expect(js).not.toMatch(/<span class="brandKo">/);
    expect(css).not.toMatch(/\.mast \.brandKo/);
  });
});

describe('NEWS-Q28 결정 2 — 신문의 범위 = 기사 폭 하나', () => {
  it('신문 폭 = 본문 안쪽 폭(1240 - 24 × 2 = 1192)', () => {
    expect(css).toContain('--news-w: min(1192px, calc(100% - 48px));');
    expect(rule('.paper')).toContain('max-width: 1240px');
    expect(rule('.paper')).toContain('padding: var(--space-3) var(--space-3)');
  });
  it('위 띠 아래 줄 · 제호 아래 줄 · 남색 메뉴 띠 · 바닥글 바탕이 신문 폭 안에서 끝남(600 이상)', () => {
    const w = wide();
    expect(w).toContain('.topBar { border-bottom: 0; }');
    expect(w).toMatch(/\.topInner \{ width: var\(--news-w\);[^}]*border-bottom: 1px solid var\(--line\);/);
    expect(w).toContain('.mast { border-bottom: 0; }');
    expect(w).toMatch(/\.mastInner \{ width: var\(--news-w\);[^}]*border-bottom: 3px double var\(--line-strong\);/);
    expect(w).toContain('.page .head { background: transparent; border-bottom: 0; }');
    expect(w).toMatch(/\.page \.headInner \{ width: var\(--news-w\);[^}]*background: var\(--blue-deep\);/);
    expect(w).toContain('.bottom { background: transparent; padding: 0; }');
    expect(w).toMatch(/\.bottomInner \{ width: var\(--news-w\);[^}]*background: var\(--blue-deep\);/);
    // 바닥글 덮어쓰기는 바닥 규칙 뒤(같은 무게면 뒤가 이김)
    expect(css.indexOf('.bottom { background: transparent')).toBeGreaterThan(
      css.indexOf('.bottom { background: var(--blue-deep)'),
    );
  });
  it('머리띠 head.css(운영 대문과 한 벌)는 건드리지 않음 · 노란 미리보기 띠는 그대로', () => {
    const head = read('assets/home/head.css');
    expect(head).not.toContain('news-w');
    expect(head).toContain('.head { background: var(--blue-deep);');
    expect(rule('.band')).toContain('background: var(--blue-accent)');
    expect(wide()).not.toContain('.band');
  });
});

describe('NEWS-Q28 결정 3 — 기사 칸마다 바탕(구간 전체 색 띠 걷음)', () => {
  const cells: Array<[string, string]> = [
    ['.leadStory', 'cell-lead'],
    ['.sub', 'cell-lead'],
    ['.todayCell', 'cell-today'],
    ['.col li', 'cell-gray'],
    ['.abroadRow', 'cell-green'],
  ];
  it('구간 색 띠 0', () => {
    expect(js).not.toMatch(/class="[^"]*\btint\b/);
    expect(css).not.toMatch(/\.tint|100vmax/);
  });
  it('칸 = 연한 바탕 · 둥근 모 · 안쪽 여백 · 칸 사이 흰색(밑줄 없음)', () => {
    for (const [sel, tok] of cells) {
      const r = rule(sel);
      expect(r).toContain(`background: var(--${tok})`);
      expect(r).toContain('border-radius: var(--radius)');
      expect(r).toMatch(/padding: \S/);
      expect(r).not.toContain('border-bottom');
    }
    expect(rule('.subs')).toContain('gap: var(--space-2)');
    expect(rule('.todayGrid')).toContain('gap: 12px');
    expect(rule('.col ul')).toContain('gap: var(--space-1)');
    expect(rule('.abroadGrid')).toContain('gap: 12px var(--space-2)');
  });
  it('색 넷: 주요 뉴스 = 연한 파랑(#f4f7fa) · 오늘 = 연한 미색(#fbf7f0) · 분야별 = 아주 연한 회색 · 해외 = 아주 연한 녹색 — 서로 다름', () => {
    expect(css).toContain('--cell-lead: var(--emph-bg);');
    expect(css).toContain('--cell-today: var(--warm-bg);');
    expect(token('emph-bg')).toBe('#f4f7fa');
    expect(token('warm-bg')).toBe('#fbf7f0');
    expect(token('cell-gray')).toBe('#f3f3f2');
    expect(token('cell-green')).toBe('#eff6f0');
    const four = [token('emph-bg'), token('warm-bg'), token('cell-gray'), token('cell-green')];
    expect(new Set(four).size).toBe(4);
    // 녹색 쪽: G 가 R · B 보다 큼 · 회색: R ≈ G ≈ B
    const g = token('cell-green').match(/[0-9a-f]{2}/g)!.map((h) => parseInt(h, 16));
    expect(g[1]).toBeGreaterThan(g[0]);
    expect(g[1]).toBeGreaterThan(g[2]);
    const y = token('cell-gray').match(/[0-9a-f]{2}/g)!.map((h) => parseInt(h, 16));
    expect(Math.max(...y) - Math.min(...y)).toBeLessThanOrEqual(2);
  });
  it('칸 바탕 넷 위 글자 · 흐린 글자 · 링크 · 나라 글자 명암비 4.5 이상', () => {
    for (const bg of ['emph-bg', 'warm-bg', 'cell-gray', 'cell-green'])
      for (const fg of ['text', 'muted', 'link', 'accent'])
        expect(R.contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('NEWS-Q28 결정 4 — 중독백과 칸: 글자 키움 · 늘이지 않음 · 빈 곳 0', () => {
  it('표제어 30 → 36px · 풀이 16 → 18px · 줄 간격 1.9 · 390 표제어는 앞 판 크기', () => {
    expect(rule('.encTerm')).toContain('font-size: 2.25rem');
    expect(rule('.encDef')).toContain('font-size: 1.125rem; line-height: 1.9;');
    expect(rule('.encTerm', '  ')).toContain('font-size: 1.875rem');
  });
  it('칸을 주요 뉴스 높이까지 늘이지 않음(Q27 flex 거둠) · 강조 칸 색 · 위 남색 줄 그대로', () => {
    expect(rule('.enc.emph')).not.toContain('flex');
    expect(rule('.enc.emph')).toContain('border-top: 4px solid var(--emph-edge)');
    expect(css).not.toMatch(/\.enc\.emph \{ flex/);
    expect(js).not.toMatch(/enc\.style\.flex/);
  });
  it('불러온 뒤에는 자리 잡기 높이를 끔(내용보다 높은 칸 0) · 풀이 줄 = 남는 높이만큼 · 새 내용 0', () => {
    // 모든 폭에서(1100 아래 · 빈 목록 포함) 내용이 들어오면 끔(리뷰 2-8)
    expect(js).toContain(
      "if (slot) { slot.innerHTML = encBody(items); slot.style.minHeight = '0'; }",
    );
    expect(js).not.toMatch(/slot\.style\.minHeight = '';/);
    expect(js).toMatch(
      /var n = Math\.min\(all, ENC_LINES \+ Math\.max\(0, Math\.floor\(slack \/ lh\)\)\);/,
    );
  });
});

describe('NEWS-Q28 — 운영 대문 · 미리보기 표시 그대로', () => {
  it('미리보기 noindex · v=q28 · 운영 대문 글 묶음과 따로', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('paper.css?v=q28');
    expect(html).toContain('paper.js?v=q28');
    expect(read('index.html')).not.toMatch(/assets\/paper\//);
  });
});
