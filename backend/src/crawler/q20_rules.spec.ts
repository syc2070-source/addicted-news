import * as fs from 'fs';
import * as path from 'path';
import { fieldProfile, topicTitleWords } from './field_profile';
import { DEEPSEEK_SDK_MAX_RETRIES } from './deepseek_summary';
import type { ClusterInfo } from './event_cluster';
import { LightRow, eventKey, hasWordAt, rankTopWeighted, scoreTopGroup } from '../articles/cluster_view';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// ---------- ■2 기관 낱말 경계 ----------
describe('NEWS-Q20 ■2 — 기관 낱말은 낱말 경계로(Q19 판정 ⑤)', () => {
  it('앞이 한글 · 영문 · 숫자면 아님 · 뒤 조사는 됨 · 「…부」+「터」 = 조사 「부터」라 아님', () => {
    expect(hasWordAt('용인시, 도박 예방교육부터 시작', '교육부')).toBe(false);
    expect(hasWordAt('예방 교육부터 바꿔야', '교육부')).toBe(false);
    expect(hasWordAt('교육부, 학교 도박 예방 강화', '교육부')).toBe(true);
    expect(hasWordAt('교육부는 18일 발표했다', '교육부')).toBe(true);
    expect(hasWordAt('[속보]교육부 발표', '교육부')).toBe(true);
    expect(hasWordAt('보건복지부 발표', '복지부')).toBe(false);
    expect(hasWordAt('보건복지부 발표', '보건복지부')).toBe(true);
    expect(hasWordAt('WHOLE foods', 'WHO')).toBe(false);
    expect(hasWordAt('WHO 보고서', 'WHO')).toBe(true);
    expect(hasWordAt('美연구팀 “전자담배…”', '연구팀')).toBe(true);
    // 같은 낱말이 둘이면 뒤 것도 봄
    expect(hasWordAt('예방교육부터 교육부까지', '교육부')).toBe(true);
    expect(hasWordAt('', '교육부')).toBe(false);
    expect(hasWordAt('교육부', '')).toBe(false);
  });

  it('Q19 의 용인 기사 꼴: 기관 +2 없음 · 지역 감점 그대로', () => {
    const rule = { ...fieldProfile().top_rank!, topic_words: topicTitleWords() };
    const r: LightRow = {
      id: 1, title: '용인시, 청소년 도박 예방교육부터 상담까지 지원', source: '지역일보', sourceUrl: '', publishedAt: '',
      publishedTs: null, sourceGrade: 'press', category: null, ts: 0,
    };
    expect(scoreTopGroup([r], r, 1, rule)).toMatchObject({ institution: false, local: true });
    const ok = { ...r, id: 2, title: '교육부, 청소년 도박 예방교육 의무화' };
    expect(scoreTopGroup([ok], ok, 1, rule)).toMatchObject({ institution: true, local: false });
  });

  it('반박 리뷰: 이름 뒤에 붙는 낱말(학회 · 연구팀 · 연구진)은 suffix 목록 · 부분 맞춤 그대로 +2', () => {
    const p = fieldProfile().top_rank!;
    expect(p.institution_suffix_words).toEqual(['학회', '연구진', '연구팀']);
    for (const w of p.institution_suffix_words!) expect(p.institution_words).not.toContain(w);
    const rule = { ...p, topic_words: topicTitleWords() };
    for (const title of ['한국중독정신의학회 “도박 중독 치료 공백”', '서울대연구팀, 청소년 전자담배 사용 분석', '국제공동연구진 “대마 사용 늘어”']) {
      const r: LightRow = { id: 3, title, source: 'X', sourceUrl: '', publishedAt: '', publishedTs: null, sourceGrade: 'press', category: null, ts: 0 };
      expect({ title, inst: scoreTopGroup([r], r, 1, rule).institution }).toEqual({ title, inst: true });
    }
  });
});

// ---------- ■2 한 사건 한 자리 ----------
describe('NEWS-Q20 ■2 — 한 사건 한 자리(묶음 id)', () => {
  const now = Date.parse('2026-10-28T13:00:00+09:00');
  const rule = { ...fieldProfile().top_rank!, topic_words: topicTitleWords() };
  const row = (id: number, title: string, source: string, hoursAgo: number): LightRow => ({
    id, title, source, sourceUrl: '', publishedAt: '', publishedTs: null, sourceGrade: 'press', category: null, ts: now - hoursAgo * 3600000,
  });

  it('eventKey = 2건 이상 묶음이면 묶음 id · 아니면 기사 id', () => {
    const info: ClusterInfo = { clusterId: '77', size: 2, representativeId: 1, memberIds: [1, 2] };
    const solo: ClusterInfo = { clusterId: '9', size: 1, representativeId: 9, memberIds: [9] };
    const idx = new Map<number, ClusterInfo>([[1, info], [2, info], [9, solo]]);
    expect([eventKey(1, idx), eventKey(2, idx), eventKey(9, idx), eventKey(5, idx)]).toEqual(['c77', 'c77', 'a9', 'a5']);
  });

  it('같은 묶음 기사 셋이 다 높은 점수여도 TOP 엔 한 자리 · 고른 것마다 event 가 다름', () => {
    const a = row(1, '복지부, 도박 중독 치유 예산 확대 - 연합뉴스', '연합뉴스', 2);
    const b = row(2, '복지부 도박 중독 치유 예산 늘린다 - 뉴스1', '뉴스1', 3);
    const c = row(3, '복지부, 도박 치유 예산 확대 발표 - 뉴시스', '뉴시스', 4);
    const d = row(4, '청소년 게임 중독 상담 늘어', '지역일보', 5);
    const e = row(5, '마약 사범 검거 늘어', '지역일보', 6);
    const info: ClusterInfo = { clusterId: '500', size: 3, representativeId: 1, memberIds: [1, 2, 3] };
    const light = new Map([a, b, c, d, e].map((r) => [r.id, r]));
    const index = new Map<number, ClusterInfo>([[1, info], [2, info], [3, info]]);
    const picks = rankTopWeighted(light, index, now, rule, 3);
    expect(picks).toHaveLength(3);
    expect(new Set(picks.map((p) => p.event)).size).toBe(3);
    expect(picks.filter((p) => [1, 2, 3].includes(p.id))).toHaveLength(1);
    expect(picks[0].event).toBe('c500');
  });

  it('getTopNews: 손으로 고른 TOP 과 같은 묶음 자동 고름은 뺌(코드 자리)', () => {
    const src = read('backend', 'src', 'articles', 'articles.service.ts');
    expect(src).toMatch(/eventKey\(m\.id, st\.index\)/);
    expect(src).toMatch(/!taken\.has\(eventKey\(id, st\.index\)\)/);
  });
});

// ---------- ■5 DeepSeek ----------
describe('NEWS-Q20 ■5 — DeepSeek: 웹 검색 · 가져오기 도구 0 · 같은 오류 재시도 ≤1', () => {
  const srcDir = path.join(__dirname, '..');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.ts') && !f.name.endsWith('.spec.ts')) files.push(p);
    }
  };
  walk(srcDir);

  it('backend/src 어디에도 tools · tool_choice · functions · web_search 요청 칸 없음', () => {
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      expect({ f, hit: /\btool_choice\b|\btools\s*:|\bfunctions\s*:|web_search|function_call/.test(s) }).toEqual({ f, hit: false });
    }
  });

  it('SDK 재시도 0 · 호출 함수는 2회 고리(재시도 1) 그대로', () => {
    expect(DEEPSEEK_SDK_MAX_RETRIES).toBe(0);
    const s = read('backend', 'src', 'crawler', 'deepseek_summary.ts');
    expect(s).toMatch(/maxRetries: DEEPSEEK_SDK_MAX_RETRIES/);
    expect(s.match(/for \(let attempt = 1; attempt <= 2; attempt\+\+\)/g)).toHaveLength(3);
  });

  it('번역 씨앗 스크립트도 시도 2 · SDK 재시도 0 · 도구 없음', () => {
    const py = read('backend', 'encyclopedia', 'seed', 'translate_en', 'translate_deepseek.py');
    expect(py).toMatch(/^MAX_RETRY = 2$/m);
    expect(py).toMatch(/max_retries=0/);
    expect(py).not.toMatch(/tools\s*=|tool_choice|web_search/);
  });
});

// ---------- ■1 · ■4 바닥글 ----------
describe('NEWS-Q20 ■1 · ■4 — 바닥글 판 표시 · 발행 표기', () => {
  const pages = ['index.html', 'category.html', 'feature.html', 'rapha.html', 'reports.html'];

  it('발행 표기는 config.js 한 곳(ko · en) · 쪽마다 같은 ko 기본 글 · 저작권 줄 그대로', () => {
    const cfg = read('frontend', 'assets', 'js', 'config.js');
    expect(cfg).toContain("ko: '발행: Statory · 라파중독연구소'");
    expect(cfg).toContain("en: 'Published by Statory · Rapha Addiction Institute'");
    for (const p of pages) {
      const html = read('frontend', p);
      expect(html).toContain('<span class="footer-publisher-name">발행: Statory · 라파중독연구소</span>');
      expect(html).not.toContain('발행처 · 라파중독연구소');
      expect(html).toContain('<p>&copy; 2026 중독뉴스. All rights reserved.</p>');
      expect(html).toContain('<p class="footer-build" id="footer-build"></p>');
      expect(html.indexOf('assets/js/config.js')).toBeLessThan(html.indexOf('assets/js/footer.js'));
    }
  });

  it('version.json = 짧은 해시 + KST 시각 · assets 밖(하루 기억 밖)', () => {
    const v = JSON.parse(read('frontend', 'version.json')) as { commit: string; built: string };
    expect(v.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(v.built).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+09:00$/);
    const vercel = JSON.parse(read('frontend', 'vercel.json')) as { headers: Array<{ source: string }> };
    expect(vercel.headers.map((h) => h.source)).toEqual(['/assets/(.*)']);
    expect(read('frontend', 'assets', 'js', 'footer.js')).toContain("fetch('version.json', { cache: 'no-store' })");
  });
});
