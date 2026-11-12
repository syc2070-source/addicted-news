// NEWS-Q26 — 오너 11-12 미리보기 고침: 배치 · 기획(공개 호 · 없으면 숨김) · 지난 방송 단추 · 제호 · 바깥 링크 · 라파뉴스 · 강조 칸 색.
import * as fs from 'fs';
import * as path from 'path';
import { BroadcastItem } from '../crawler/broadcast';
import {
  RAPHA_BACKOFF_MS,
  RAPHA_CACHE_MS,
  RaphaVideos,
  loadRaphaChannel,
} from './rapha_videos';

const FRONT = path.join(__dirname, '../../../frontend');
const read = (p: string) => fs.readFileSync(path.join(FRONT, p), 'utf8');

type Feature = { title: string; summary: string; date: string; url: string };
type Video = { videoId: string; title: string; url: string; thumb: string };
interface Rules {
  featureIssues(data: unknown, max?: number): Feature[];
  raphaVideos(data: unknown, n?: number): Video[];
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

  it('제호 = 운영 대문 글자 제호(.brand · brandKo · brandEn)를 크게 · 옛 그림(logo.png) 안 씀', () => {
    expect(js).toContain(
      '<a class="brand mastBrand" href="/preview/paper/"><span class="brandKo">',
    );
    expect(js).not.toContain('logo.png');
    expect(read('assets/home/home.js')).toContain('<a class="brand" href="');
    expect(css).toMatch(
      /\.mast \.brandKo \{ font-size: 2\.75rem; font-size: clamp\(2\.75rem, [^)]+, 4\.5rem\)/,
    );
    // 옛 Safari 가 clamp 를 못 읽어도 크게(리뷰 1) · 제호는 쪽의 h1
    expect(js).toContain('<h1 class="mastTitle"><a class="brand mastBrand"');
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

describe('NEWS-Q26 라파뉴스(결정 6) — 공개 RSS · DB · LLM 0', () => {
  const item = (n: number, day: number): BroadcastItem => ({
    videoId: `vid${String(n).padStart(8, '0')}`,
    title: `영상 ${n}`,
    description: '',
    publishedAt: `2026-11-${String(day).padStart(2, '0')}T00:00:00Z`,
    url: `https://www.youtube.com/watch?v=vid${String(n).padStart(8, '0')}`,
    thumbnailUrl: null,
  });
  const ch = {
    channelTitle: '라파공동체',
    channelId: 'UC-v25CDSY82CAd36pJIvmMw',
    channelUrl: 'https://www.youtube.com/channel/UC-v25CDSY82CAd36pJIvmMw',
  };

  it('채널 = 저장소 자료 파일(찾은 곳 raphacom.org) · 모양이 틀리면 null', () => {
    expect(loadRaphaChannel()).toEqual(ch);
    expect(loadRaphaChannel('x', () => '{"channel_id":"nope"}')).toBeNull();
    expect(loadRaphaChannel('x', () => '{')).toBeNull();
  });

  it('30분 들고 있기 · 낡으면 들고 있던 것을 곧바로 주고 뒤에서 새로 읽음 · 실패 뒤 5분 쉼 · 빈 피드는 앞 목록을 지우지 않음 · 처음부터 실패면 빈 목록', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    let t = 0;
    let calls = 0;
    let mode: 'ok' | 'fail' | 'hang' | 'empty' = 'ok';
    const v = new RaphaVideos(
      ch,
      () => {
        calls++;
        if (mode === 'fail') return Promise.reject(new Error('503'));
        if (mode === 'hang')
          return new Promise<BroadcastItem[]>(() => undefined);
        if (mode === 'empty') return Promise.resolve([]);
        return Promise.resolve([item(1, 11), item(2, 10)]);
      },
      () => t,
    );
    const a = await v.get(4);
    expect(a.ok).toBe(true);
    expect(a.items.map((x) => x.title)).toEqual(['영상 1', '영상 2']);
    t += RAPHA_CACHE_MS - 1;
    await v.get(4);
    expect(calls).toBe(1);
    // 낡음 + 유튜브가 멈춤 → 요청은 기다리지 않고 들고 있던 것을 받음 · 동시에 여러 번 물어도 읽기는 하나
    t += 2;
    mode = 'hang';
    const h1 = await v.get(4);
    const h2 = await v.get(4);
    expect(h1.items).toHaveLength(2);
    expect(h2.items).toHaveLength(2);
    expect(calls).toBe(2);
    // 실패 → 앞 목록 그대로 · ok=false · 5분 동안 다시 묻지 않음
    const v2 = new RaphaVideos(
      ch,
      () => {
        calls++;
        if (mode === 'fail') return Promise.reject(new Error('503'));
        if (mode === 'empty') return Promise.resolve([]);
        return Promise.resolve([item(1, 11), item(2, 10)]);
      },
      () => t,
    );
    mode = 'ok';
    calls = 0;
    await v2.get(4);
    t += RAPHA_CACHE_MS + 1;
    mode = 'fail';
    await v2.get(4);
    await v2.settle();
    const b = await v2.get(4);
    expect(calls).toBe(2);
    expect(b.ok).toBe(false);
    expect(b.items).toHaveLength(2);
    t += RAPHA_BACKOFF_MS - 1;
    await v2.get(4);
    expect(calls).toBe(2);
    t += 2;
    mode = 'empty';
    await v2.get(4);
    await v2.settle();
    const c = await v2.get(4);
    expect(calls).toBe(3);
    expect(c.ok).toBe(true);
    expect(c.items.map((x) => x.title)).toEqual(['영상 1', '영상 2']);
    const fresh = new RaphaVideos(
      ch,
      () => Promise.reject(new Error('x')),
      () => 0,
    );
    expect((await fresh.get()).items).toEqual([]);
    warn.mockRestore();
    const none = new RaphaVideos(null, () => Promise.resolve([item(1, 1)]));
    expect(await none.get()).toMatchObject({ ok: false, items: [] });
  });

  it('대문 규칙: 실패 · 0 → 빈 목록(구간 숨김) · 새것 먼저 · 영상 주소는 유튜브만', () => {
    expect(R.raphaVideos(null)).toEqual([]);
    expect(R.raphaVideos({ items: [] })).toEqual([]);
    const out = R.raphaVideos(
      {
        items: [
          { videoId: 'aaaaaaaaaaa', title: '옛', publishedAt: '2026-11-01' },
          { videoId: 'bbbbbbbbbbb', title: '새', publishedAt: '2026-11-11' },
          { videoId: 'bad', title: '틀린 id', publishedAt: '2026-11-12' },
        ],
      },
      4,
    );
    expect(out.map((x) => x.title)).toEqual(['새', '옛']);
    expect(out[0].url).toBe('https://www.youtube.com/watch?v=bbbbbbbbbbb');
    const js = read('assets/paper/paper.js');
    expect(js).toMatch(
      /function raphaBlock\(data\) \{\s*var list = R\.raphaVideos\(data, 4\);\s*if \(!list\.length\) return '';/,
    );
  });

  it('길: GET /articles/rapha-videos 한 줄 · 방송 관문 · DB 저장소 · DeepSeek 부르지 않음', () => {
    const ctl = fs.readFileSync(
      path.join(__dirname, 'articles.controller.ts'),
      'utf8',
    );
    expect(ctl).toMatch(/@Get\('rapha-videos'\)[\s\S]*?raphaVideos\.get\(/);
    expect(ctl.indexOf("@Get('rapha-videos')")).toBeLessThan(
      ctl.indexOf("@Get(':id')"),
    );
    // 주석(「방송 관문(핵심어 · DeepSeek) 0」 같은 설명)은 빼고 코드만 잼
    const src = fs
      .readFileSync(path.join(__dirname, 'rapha_videos.ts'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(
      /Repository|deepseek|judge|decideBroadcast|passesIngestionGate/i,
    );
  });
});
