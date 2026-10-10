import { IsNull, LessThan } from 'typeorm';
import { decideTier, effectiveTier } from './tier';
import { fieldProfile } from './field_profile';
import { isFresh, parseTier, visibleWhere } from '../articles/articles.service';

// NEWS-Q2 ■6: 관문 두 층 · ■7 「최신」 표시
const gate = fieldProfile().gate;
const kw = { keywordIncident: false, hasKeyword: true, gate };

describe('tier — 세 갈래', () => {
  it('publish: 지금 기준(fit · 비사건 · high)', () => {
    expect(decideTier({ categoryFit: true, isIncident: false, confidence: 'high' }, kw)).toEqual({ tier: 'publish', reason: null });
  });

  it('archive: 확신 낮음 · 사건·사고 · 분류 불일치(애매) — 분야 핵심어가 있을 때만', () => {
    expect(decideTier({ categoryFit: true, isIncident: false, confidence: 'medium' }, kw).tier).toBe('archive');
    expect(decideTier({ categoryFit: false, isIncident: true, confidence: 'high' }, kw)).toEqual({ tier: 'archive', reason: 'is_incident' });
    expect(decideTier({ categoryFit: true, isIncident: false, confidence: 'high' }, { ...kw, keywordIncident: true }))
      .toEqual({ tier: 'archive', reason: 'keyword_incident' });
    expect(decideTier({ categoryFit: false, isIncident: false, confidence: 'low' }, kw).tier).toBe('archive');
    expect(decideTier({ categoryFit: false, isIncident: true, confidence: 'high' }, { ...kw, hasKeyword: false }).tier).toBe('reject');
  });

  it('reject: 확실히 무관 · 판정 없음(DeepSeek 실패 → fail-closed)', () => {
    expect(decideTier({ categoryFit: false, isIncident: false, confidence: 'high' }, kw)).toEqual({ tier: 'reject', reason: 'category_fit_false' });
    expect(decideTier({}, kw)).toEqual({ tier: 'reject', reason: 'judgment_missing' });
    expect(decideTier({ categoryFit: true, isIncident: false }, kw).reason).toBe('judgment_missing');
  });

  it('설정이 reject 면 보관 없이 거부(분야마다 다르게)', () => {
    const strict = { ...gate, incident: 'reject' as const, low_confidence: 'reject' as const };
    expect(decideTier({ categoryFit: false, isIncident: true, confidence: 'high' }, { ...kw, gate: strict }).tier).toBe('reject');
    expect(decideTier({ categoryFit: true, isIncident: false, confidence: 'low' }, { ...kw, gate: strict }).tier).toBe('reject');
  });

  it('tier 열이 없으면 archive 는 저장하지 않는다(옛 동작 = publish 만)', () => {
    expect(effectiveTier({ tier: 'archive', reason: 'is_incident' }, false)).toEqual({ tier: 'reject', reason: 'is_incident' });
    expect(effectiveTier({ tier: 'archive', reason: 'x' }, true).tier).toBe('archive');
    expect(effectiveTier({ tier: 'publish', reason: null }, false).tier).toBe('publish');
  });
});

describe('공개 API — 보관 숨김(?tier=archive 로만)', () => {
  it('tier 열이 있으면 기본 publish 만, ?tier=archive 면 보관만', () => {
    expect(parseTier(undefined)).toBe('publish');
    expect(parseTier('archive')).toBe('archive');
    expect(parseTier('anything')).toBe('publish');
    const pub = visibleWhere({}, { kind: 'article', deletedAtAvailable: true, tierAvailable: true });
    expect(pub.tier).toBe('publish');
    expect(pub.deletedAt).toEqual(IsNull());
    const arc = visibleWhere({ category: 'x' }, { kind: 'article', deletedAtAvailable: true, tierAvailable: true, tier: 'archive' });
    expect(arc.tier).toBe('archive');
    expect(arc.category).toBe('x');
  });

  it('tier 열이 없으면 조건을 걸지 않고(옛 동작), archive 요청은 빈 결과', () => {
    const pub = visibleWhere({}, { kind: 'article', deletedAtAvailable: false, tierAvailable: false });
    expect(pub.tier).toBeUndefined();
    const arc = visibleWhere({}, { kind: 'article', deletedAtAvailable: false, tierAvailable: false, tier: 'archive' });
    expect(arc.id).toEqual(LessThan(0));
  });
});

describe('「최신」 표시 — 72시간(설정)', () => {
  const now = new Date('2026-10-11T03:00:00Z');
  it('보도 시각이 있으면 그것으로, 없으면 보도 날짜 KST 0시로', () => {
    expect(isFresh(new Date('2026-10-09T04:00:00Z'), null, 72, now)).toBe(true);
    expect(isFresh(new Date('2026-10-07T00:00:00Z'), null, 72, now)).toBe(false);
    expect(isFresh(null, '2026-10-09', 72, now)).toBe(true);
    expect(isFresh(null, new Date('2026-10-01T00:00:00Z') as any, 72, now)).toBe(false);
    expect(isFresh(null, null, 72, now)).toBe(false);
    expect(isFresh(new Date('2026-10-20T00:00:00Z'), null, 72, now)).toBe(false); // 미래 시각은 최신 아님
  });
});
