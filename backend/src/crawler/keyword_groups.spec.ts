import { fieldProfile, setFieldProfileForTest } from './field_profile';
import {
  GroupCounter,
  groupSummary,
  keywordGroupNames,
  keywordGroupsOf,
} from './keyword_groups';

// NEWS-Q11 ■3: 핵심어 묶음별 수(분야 설정 keywords.groups)
describe('keyword_groups — 핵심어 묶음(NEWS-Q11 ■3)', () => {
  afterEach(() => setFieldProfileForTest(null));

  it('제목 + 첫 문단으로 묶음을 고른다(여럿 가능 · 없으면 기타 · 「기술」은 알코올 아님)', () => {
    expect(keywordGroupsOf('청소년 불법 도박 사이트 단속', '')).toEqual([
      '도박',
    ]);
    expect(
      keywordGroupsOf('Fentanyl overdose deaths fall', 'vaping also down'),
    ).toEqual(['약물', '담배']);
    expect(keywordGroupsOf('일중독 직장인 늘어', '')).toEqual(['일']);
    expect(keywordGroupsOf('폭식장애 치료 길', '')).toEqual(['음식']);
    expect(keywordGroupsOf('AI 중독 청소년', '챗봇에 하루 5시간')).toEqual([
      'AI',
    ]);
    expect(keywordGroupsOf('신기술 박람회', '')).toEqual(['기타']);
    // 첫 300 자 밖 낱말은 안 셈
    expect(
      keywordGroupsOf('회복 공동체 이야기', `${'가'.repeat(400)} 도박`),
    ).toEqual(['기타']);
  });

  it('설정에 묶음이 없으면 세지 않음([])', () => {
    setFieldProfileForTest({
      ...fieldProfile(),
      keywords: { ...fieldProfile().keywords, groups: undefined },
    });
    expect(keywordGroupsOf('도박', '')).toEqual([]);
    expect(keywordGroupNames()).toEqual([]);
  });

  it('실행 집계: 후보·저장·보관·거부 · 빈 묶음 빼고 후보 많은 순 · health 한 줄 「후보/저장」', () => {
    const c = new GroupCounter();
    c.add(['도박'], 'candidates');
    c.add(['도박', '약물'], 'candidates');
    c.add(['도박'], 'saved');
    c.add(['약물'], 'archived');
    c.add(undefined, 'saved');
    expect(c.toJSON()).toEqual({
      도박: { candidates: 2, saved: 1, archived: 0, rejected: 0 },
      약물: { candidates: 1, saved: 0, archived: 1, rejected: 0 },
    });
    expect(Object.keys(c.toJSON())).toEqual(['도박', '약물']);
    expect(groupSummary(c.toJSON())).toEqual({ 도박: '2/1', 약물: '1/0' });
    expect(groupSummary(null)).toBeNull();
    expect(groupSummary({})).toBeNull();
  });
});
