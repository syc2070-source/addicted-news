import { decodeEntities, hasEntityArtifact, crossMediaSimilarity } from './text_utils';

describe('decodeEntities (3-1 HTML 엔티티)', () => {
  it('표준 엔티티 디코딩', () => {
    expect(decodeEntities('감사장&hellip;&quot;정신질환자&quot;')).toBe('감사장…"정신질환자"');
  });
  it('& 소실 고아 엔티티 복원', () => {
    expect(decodeEntities('감사장hellip; quot;정신질환자')).toBe('감사장… "정신질환자');
  });
  it('숫자/고아 숫자 엔티티', () => {
    expect(decodeEntities("아이들&#39;s 그리고 아이들#39;s")).toBe("아이들's 그리고 아이들's");
  });
  it('정상 텍스트는 불변', () => {
    expect(decodeEntities('강원랜드 중독예방포럼 개최')).toBe('강원랜드 중독예방포럼 개최');
  });
  it('artifact 감지', () => {
    expect(hasEntityArtifact('감사장hellip;')).toBe(true);
    expect(hasEntityArtifact('정상 제목')).toBe(false);
  });
});

describe('crossMediaSimilarity (3-2 동일 사건 크로스매체)', () => {
  it('대구 서부정류장 세계일보/뉴시스 쌍 → 0.6 이상', () => {
    const s = crossMediaSimilarity(
      '[속보] 대구 서부정류장 일대 불법도박장 적발…9명 검거 - 세계일보',
      '대구 서부정류장 불법도박장 적발 9명 검거 (뉴시스)');
    expect(s).toBeGreaterThanOrEqual(0.6);
  });
  it('무관 기사는 0.6 미만(오탐 방지)', () => {
    const s = crossMediaSimilarity('강원랜드 중독예방포럼 개최', '서울시 청소년 스마트폰 중독 예방 교육');
    expect(s).toBeLessThan(0.6);
  });
});
