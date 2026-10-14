import { flattenLang, setFieldProfileForTest } from './field_profile';
import { matchesFieldKeywords, resetFieldFilterCache } from './field_filter';

// NEWS-Q6 ■1: 세계 소식 필터 보강(설정 파일만 · 관문 기준 그대로) — 표본은 10-15 아침 세계 신문 피드에서
describe('field_filter — 세계 소식 보강(NEWS-Q6 ■1)', () => {
  beforeEach(() => {
    setFieldProfileForTest(null);
    resetFieldFilterCache();
  });

  it('언어 칸은 ko·en 다음에 es·pt 등 나머지까지 읽고, _ 로 시작하는 설명 칸은 뺀다', () => {
    expect(flattenLang({ ko: ['가'], en: ['b'], es: ['c'], pt: ['d'], _comment: 'x' } as any)).toEqual(['가', 'b', 'c', 'd']);
    expect(flattenLang(undefined)).toEqual([]);
  });

  it('표본에서 관련인데 떨어지던 것: 담배·전자담배 정책 기사가 이제 통과', () => {
    expect(matchesFieldKeywords(
      'Türkiye plans electronic age checks for tobacco sales',
      'Türkiye’s Health Ministry plans to introduce an electronic age verification system to prevent children and young people from accessing tobacco products.',
    )).toBe(true);
    expect(matchesFieldKeywords('Alabama vaping ban in public places takes effect Oct. 1 - WSFA', '')).toBe(true);
    expect(matchesFieldKeywords('2022-2025 Religious Beliefs and Substance Use among Adolescents - SAMHSA (.gov)', '')).toBe(true);
  });

  it('스페인어 피드: fentanilo · ludopatía 가 걸린다(전에는 ko·en 만 읽어 늘 0)', () => {
    expect(matchesFieldKeywords('Fiscalía incauta fentanilo, ketamina y otras drogas', '', { allowIncident: true })).toBe(true);
    expect(matchesFieldKeywords('Crece la ludopatía entre jóvenes', 'Un informe sobre apuestas en línea.')).toBe(true);
  });

  it('무관(표본 오탐 후보)은 그대로 떨어진다: 교황 회복 · 약값 · 「betting on」 비유 · 카지노 광고(제외어 우선)', () => {
    expect(matchesFieldKeywords('Pope Leo’s recovery from lung cancer surgery ‘progressing as planned’', 'Pontiff has begun walking in his hospital room.')).toBe(false);
    expect(matchesFieldKeywords('It’s no secret drug firms donate to political parties', 'Drug companies gave at least A$7.7 million.')).toBe(false);
    expect(matchesFieldKeywords('Investors are betting on a rate cut', 'Markets rallied on Wednesday.')).toBe(false);
    expect(matchesFieldKeywords('Online gambling casino free spin bonus', 'sign up today')).toBe(false);
  });
});
