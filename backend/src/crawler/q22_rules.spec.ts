import * as fs from 'fs';
import * as path from 'path';
import { fieldProfile, topicTitleWords } from './field_profile';
import type { ClusterInfo } from './event_cluster';
import {
  LightRow,
  compareTopPicks,
  institutionsOf,
  rankTopWeighted,
  sameEvent,
  scoreTopGroup,
  titleNouns,
} from '../articles/cluster_view';
import { fetchFeedText } from './feed_fetch';
import { timeoutOf } from './sourceConfig';

const now = Date.parse('2026-10-29T13:00:00+09:00');
const rule = { ...fieldProfile().top_rank!, topic_words: topicTitleWords() };
const row = (id: number, title: string, hoursAgo: number, source = '지역일보'): LightRow => ({
  id, title, source, sourceUrl: '', publishedAt: '', publishedTs: null, sourceGrade: 'press', category: null,
  ts: now - hoursAgo * 3600000, summaryOk: true,
});
const sig = (title: string, hoursAgo: number) => ({
  institutions: institutionsOf([{ title }], rule),
  nouns: titleNouns(title, rule),
  newest: now - hoursAgo * 3600000,
});

// ---------- ■1 같은 사건 짝 ----------
describe('NEWS-Q22 ■1 — 같은 사건 = 기관 하나 이상 + 날짜 ±1 + 제목 명사 겹침 2 이상(LLM 0)', () => {
  const T5767 = '원민경 장관, 도박문제예방치유원 방문...청소년 도박 발견부터 치유까지 - 뉴스핌';
  const T5830 = '예방치유원·성평등가족부 등 청소년 도박 예방 협력…위험군 조기 발견 강화 - 인더스트리뉴스';

  it('산하기관 · 줄임말은 모기관 이름으로 · 학회 · 연구팀은 기관 수에 안 셈 · 사설은 뺌', () => {
    expect(institutionsOf([{ title: T5830 }], rule)).toEqual(['사행산업통합감독위원회', '성평등가족부']);
    expect(institutionsOf([{ title: '성평등부·도박예방치유원, 청소년 도박 협력' }], rule)).toEqual(['사행산업통합감독위원회', '성평등가족부']);
    expect(institutionsOf([{ title: '복지부·식약처·한국마약퇴치운동본부 합동 점검' }], rule)).toEqual(['보건복지부', '식품의약품안전처']);
    expect(institutionsOf([{ title: '한국중독정신의학회 연구팀, 도박 연구' }], rule)).toEqual([]);
    expect(institutionsOf([{ title: '[사설] 복지부는 도박 대책을 서둘러야' }], rule)).toEqual([]);
  });

  it('제목 명사: 「 - 매체」 꼬리 · [태그] · 끝 조사 · 기관 낱말 덩어리 뺌', () => {
    expect(titleNouns(T5767, rule)).toEqual(['원민경', '장관', '방문', '청소년', '도박', '발견', '치유']);
    expect(titleNouns('[단독] 식약처, 마약류 처방을 줄인다 - 연합뉴스', rule)).toEqual(['마약류', '처방', '줄인다']);
  });

  it('5767·5830 은 같은 사건 · 같은 부처 다른 사건 · 날짜 ±2 · 기관 다름은 아님', () => {
    expect(sameEvent(sig(T5767, 30), sig(T5830, 10))).toBe(true);
    expect(sameEvent(sig('복지부, 마약 중독 치료 병원 지정 확대', 5), sig('복지부, 청소년 도박 상담 콜센터 개설', 6))).toBe(false);
    expect(sameEvent(sig(T5767, 72), sig(T5830, 10))).toBe(false);
    expect(sameEvent(sig('식약처, 청소년 도박 예방 교육', 5), sig('복지부, 청소년 도박 예방 교육', 5))).toBe(false);
  });

  it('TOP3 에 같은 사건 두 묶음이 들지 않음 · 빠진 것은 앞 자리 sameEventIds 에', () => {
    const a = row(1, T5767, 30, '중앙일보');
    const a2 = row(2, '원민경 장관 도박문제예방치유원 방문 청소년 도박 치유', 31);
    const b = row(3, T5830, 10, '중앙일보');
    const b2 = row(4, '사감위·성평등가족부·예방치유원, 청소년 도박 예방 머리 맞댔다', 9);
    const c = row(5, '마약 사범 검거 늘어', 2);
    const d = row(6, '청소년 게임 중독 상담 늘어', 3);
    const ca: ClusterInfo = { clusterId: '5767', size: 2, representativeId: 1, memberIds: [1, 2] };
    const cb: ClusterInfo = { clusterId: '5830', size: 2, representativeId: 3, memberIds: [3, 4] };
    const light = new Map([a, a2, b, b2, c, d].map((r) => [r.id, r]));
    const index = new Map<number, ClusterInfo>([[1, ca], [2, ca], [3, cb], [4, cb]]);
    const picks = rankTopWeighted(light, index, now, rule, 3);
    const ids = picks.map((p) => p.id);
    expect(ids.filter((id) => id === 1 || id === 3)).toHaveLength(1);
    expect(ids).toHaveLength(3);
    expect(picks[0].sameEventIds).toEqual([ids[0] === 1 ? 3 : 1]);
  });

  it('모기관 연결 열쇠는 점수 가산에 안 씀(「마약퇴치운동본부 ○○지부 캠페인」이 −2 그대로)', () => {
    const r = row(1, '마약퇴치운동본부 서울지부, 시민들과 마약 예방 걷기 캠페인', 1);
    const s = scoreTopGroup([r], r, 1, rule);
    expect(s.institution).toBe(false);
    expect(s.local).toBe(true);
  });
});

// ---------- ■2 동점 깨기 ----------
describe('NEWS-Q22 ■2 — 동점 = 기관 수 → 최신 → 묶음 큰 것', () => {
  const sc = (score: number) => ({ national: false, institution: false, local: false, offTopic: false, reports: 0, score });
  it('점수 먼저 · 같으면 기관 수 · 같으면 최신 · 같으면 묶음 큰 것', () => {
    const base = { score: sc(2), institutions: ['보건복지부'], newest: 100, size: 2 };
    const cases: Array<[object, number]> = [
      [{ ...base, score: sc(3), institutions: [] }, -1],
      [{ ...base, institutions: ['보건복지부', '국회'], newest: 1, size: 1 }, -1],
      [{ ...base, newest: 200, size: 1 }, -1],
      [{ ...base, size: 5 }, -1],
      [{ ...base }, 0],
    ];
    for (const [x, sign] of cases) expect(Math.sign(compareTopPicks(x as typeof base, base))).toBe(sign);
  });

  it('rankTopWeighted 가 이 순서를 씀(동점 셋 → 기관 둘이 맨 앞 · 그다음 최신)', () => {
    const a = row(1, '청소년 도박 상담 늘어', 1);
    const b = row(2, '복지부 국회 보고, 청소년 도박 상담 늘어', 5);
    const c = row(3, '도박 상담 늘어', 2);
    const light = new Map([a, b, c].map((r) => [r.id, r]));
    const picks = rankTopWeighted(light, new Map(), now, { ...rule, institution_bonus: 0 }, 3);
    expect(picks.map((p) => p.id)).toEqual([2, 1, 3]);
    expect(picks[0].institutions).toEqual(['국회', '보건복지부']);
  });
});

// ---------- ■3 엔티티 ----------
describe('NEWS-Q22 ■3 — 엔티티 summary = 운영 DB(NOT NULL · 기본 \'\')', () => {
  it('article.entity.ts 의 summary 는 nullable 아님 · 기본 빈 글', () => {
    const src = fs.readFileSync(path.join(__dirname, '../articles/article.entity.ts'), 'utf8');
    expect(src).toMatch(/@Column\(\{ type: 'text', default: '' \}\)\s*summary: string;/);
  });
});

// ---------- ■4 실패 소스 ----------
describe('NEWS-Q22 ■4 — 406 은 Accept */* 로 1회 더 · 피드별 시간 한도', () => {
  it('406 → 두 번째는 Accept */* · 403 은 Accept 그대로 · 더 하지 않음', async () => {
    for (const [first, accept] of [[406, '*/*'], [403, undefined]] as const) {
      const calls: Array<Record<string, string>> = [];
      const get = async (_u: string, c: Record<string, unknown>) => {
        calls.push(c.headers as Record<string, string>);
        return calls.length === 1 ? { status: first, data: '' } : { status: 200, data: '<rss/>' };
      };
      const r = await fetchFeedText('https://example.com/rss', { get, waitMs: 0 });
      expect(r.retried).toBe(true);
      expect(calls).toHaveLength(2);
      if (accept) expect(calls[1].Accept).toBe(accept);
      else expect(calls[1].Accept).toBe(calls[0].Accept);
    }
  });

  it('timeout_ms 는 1~60초만 · Bangkok Post 는 30초', () => {
    expect(timeoutOf({ timeout_ms: 30000 })).toEqual({ timeoutMs: 30000 });
    expect(timeoutOf({ timeout_ms: 500 })).toEqual({});
    expect(timeoutOf({ timeout_ms: 'x' })).toEqual({});
    expect(timeoutOf({})).toEqual({});
    const wp = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/world_press_rss.json'), 'utf8'));
    const bp = wp.feeds.find((f: { feed_id: string }) => f.feed_id === 'wpr-048');
    expect(bp.timeout_ms).toBe(30000);
  });
});
