import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FieldProfileError, fieldProfile, loadFieldProfile, setFieldProfileForTest, defaultFieldProfileName, defaultDbName,
} from './field_profile';
import { matchesFieldKeywords, hasFieldKeyword, isIncidentReport, resetFieldFilterCache } from './field_filter';
import { buildAllSources, buildSources } from './sourceConfig';
import { summarySystemKo } from './deepseek_summary';
import { judgeSystem } from './judge_prompt';
import { categoryKeyFor } from '../articles/articles.service';

// NEWS-Q2 ■1: 분야 설정 읽기 — 설정 없음 · 다른 분야 이름 · 코드에 분야 글자 0
function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'field-profile-'));
}

const OTHER = {
  field: 'testfield',
  site_name: '시험뉴스',
  database_default: 'test_db',
  freshness_hours: 24,
  categories: { list: ['가', '나'], default: '나', slugs: { ga: '가' }, keywords: { 가: ['사과'], 나: ['배'] } },
  keywords: {
    strong: { ko: ['사과'], en: ['apple'] },
    negative: { ko: ['광고'] },
    incident_patterns: ['(도난).{0,5}(체포)'],
    policy_context: ['정책'],
  },
  gate: { publish: { category_fit: true, is_incident: false, confidence: 'high' }, incident: 'archive' },
  prompts: { summary_system: '시험 요약 규칙.', judge_criteria: ' 시험 기준.\n', judge_system: '시험 판정 절차' },
  sources: {
    press_files: {},
    google_news: [{ id: 'g1', url: 'https://news.google.com/rss/search?q=apple', lang: 'en', category: '가' }],
    institutions: [
      { id: 'i1', url: 'https://example.org/feed', grade: 'institution' },
      { id: 'i2', url: 'https://example.org/dead', active: false, inactive_reason: '대체 없음' },
    ],
  },
};

describe('field_profile (NEWS-Q2 ■1)', () => {
  afterEach(() => {
    setFieldProfileForTest(null);
    resetFieldFilterCache();
  });

  it('설정 파일이 없으면 시끄럽게 실패한다(빈 설정으로 조용히 돌지 않음)', () => {
    const dir = tmpDir();
    expect(() => loadFieldProfile('nothing', dir)).toThrow(FieldProfileError);
    expect(() => loadFieldProfile(undefined, dir)).toThrow(/DEFAULT/);
  });

  it('이름은 소문자·숫자·-_ 만(경로 넘나들기 막음)', () => {
    expect(() => loadFieldProfile('../secret', tmpDir())).toThrow(/이름이 틀림/);
  });

  it('필수 칸이 빠지면 어느 칸인지 알려 준다', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'broken.json'), JSON.stringify({ field: 'broken', site_name: 'x' }));
    expect(() => loadFieldProfile('broken', dir)).toThrow(/categories.list/);
  });

  it('다른 분야 이름으로 읽으면 거름망·소스·프롬프트·분류가 그 설정을 따른다', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'testfield.json'), JSON.stringify(OTHER));
    fs.writeFileSync(path.join(dir, 'DEFAULT'), 'testfield\n');
    expect(defaultFieldProfileName(dir)).toBe('testfield');
    const p = loadFieldProfile(undefined, dir);
    expect(p.field).toBe('testfield');
    expect(p.gate.low_confidence).toBe('reject'); // 빠진 칸은 기본값
    setFieldProfileForTest(p);
    resetFieldFilterCache();

    expect(matchesFieldKeywords('사과 수확 시작', '')).toBe(true);
    expect(matchesFieldKeywords('사과 광고', '')).toBe(false);
    expect(hasFieldKeyword('Apple pie', '')).toBe(true);
    expect(isIncidentReport('사과 도난범 체포')).toBe(true);
    expect(isIncidentReport('사과 도난범 체포 정책')).toBe(false);

    const all = buildAllSources(p);
    expect(all.map((s) => s.id)).toEqual(['i1', 'i2', 'g1']);
    expect(all.find((s) => s.id === 'g1')!.category).toBe('가');
    expect(buildSources(p).map((s) => s.id)).toEqual(['i1', 'g1']); // 비활성 i2 건너뜀

    expect(summarySystemKo()).toContain('시험 요약 규칙.');
    expect(summarySystemKo()).toContain(' 시험 기준.');
    expect(judgeSystem()).toBe('시험 판정 절차');
    expect(categoryKeyFor('ga')).toBe('가');
    expect(defaultDbName({})).toBe('test_db');
  });

  it('기본 설정(DEFAULT 파일 → addiction.json)이 읽히고 옛 값이 그대로 들어 있다', () => {
    const p = fieldProfile();
    expect(p.categories.list.length).toBe(5);
    expect(p.sources.google_news.length).toBeGreaterThanOrEqual(25);
    expect(p.keywords.incident_patterns.length).toBe(18);
    expect(p.gate.deepseek_daily_cap).toBe(400);
    expect(p.freshness_hours).toBe(72);
  });

  it('코드(src, 시험 파일 제외)에 분야 글자가 없다', () => {
    const root = path.join(__dirname, '..');
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) {
          const words = fieldProfile().categories.list.concat([fieldProfile().field]);
          const text = fs.readFileSync(f, 'utf8');
          // 분야 이름과 분류 이름의 공통 글자(설정에서 읽음 → 이 시험 파일에도 분야 글자를 두지 않는다)
          const fieldWord = fieldProfile().site_name.slice(0, 2);
          if (text.includes(fieldWord) || words.some((w) => text.toLowerCase().includes(w.toLowerCase()))) hits.push(path.relative(root, f));
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
