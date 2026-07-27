import { shouldDelete, canDelete, passesIngestionGate, rejectReason } from './judge_article';

describe('judge_cleanup 안전망 (shouldDelete)', () => {
  it('is_incident=true 이면 삭제', () => {
    expect(shouldDelete({ isIncident: true, categoryFit: true })).toBe(true);
  });
  it('category_fit=false 이면 삭제', () => {
    expect(shouldDelete({ isIncident: false, categoryFit: false })).toBe(true);
  });
  it('issue + category_fit=true 는 저장(삭제 안 함)', () => {
    expect(shouldDelete({ isIncident: false, categoryFit: true })).toBe(false);
  });
  it('판정 미상(undefined)은 fail-safe로 삭제 안 함', () => {
    expect(shouldDelete({})).toBe(false);
  });
});

describe('삭제 실행 가드 (canDelete) — 판정 실패는 절대 삭제 금지', () => {
  it("via='failed' 는 삭제 근거가 있어 보여도 삭제 안 함", () => {
    // 설령 isIncident=true 라도 판정이 '실패'로 표시되면 삭제 금지
    expect(canDelete({ isIncident: true, categoryFit: false, via: 'failed' })).toBe(false);
    expect(canDelete({ via: 'failed' })).toBe(false);
  });
  it("via='deepseek' 실제 판정은 shouldDelete 규칙대로", () => {
    expect(canDelete({ isIncident: true, via: 'deepseek' })).toBe(true);
    expect(canDelete({ categoryFit: false, via: 'deepseek' })).toBe(true);
    expect(canDelete({ isIncident: false, categoryFit: true, via: 'deepseek' })).toBe(false);
  });
  it("via 없음/keyword 는 shouldDelete 규칙대로(로컬 폴백)", () => {
    expect(canDelete({ isIncident: true, via: 'keyword' })).toBe(true);
    expect(canDelete({})).toBe(false);
  });
});

describe('입구 게이트 (passesIngestionGate, 정밀도 우선)', () => {
  it('category_fit=true AND is_incident=false AND confidence=high → 진입', () => {
    expect(passesIngestionGate({ categoryFit: true, isIncident: false, confidence: 'high' })).toBe(true);
  });
  it('confidence=medium → 거부', () => {
    expect(passesIngestionGate({ categoryFit: true, isIncident: false, confidence: 'medium' })).toBe(false);
    expect(rejectReason({ categoryFit: true, isIncident: false, confidence: 'medium' })).toBe('low_confidence:medium');
  });
  it('is_incident=true → 거부', () => {
    expect(passesIngestionGate({ categoryFit: true, isIncident: true, confidence: 'high' })).toBe(false);
    expect(rejectReason({ categoryFit: true, isIncident: true, confidence: 'high' })).toBe('is_incident');
  });
  it('category_fit=false → 거부', () => {
    expect(passesIngestionGate({ categoryFit: false, isIncident: false, confidence: 'high' })).toBe(false);
    expect(rejectReason({ categoryFit: false, isIncident: false, confidence: 'high' })).toBe('category_fit_false');
  });
  it('판정 미상 → 거부(judgment_missing)', () => {
    expect(passesIngestionGate({})).toBe(false);
    expect(rejectReason({})).toBe('judgment_missing');
  });
});

describe('입구 게이트 — 판정 실패는 절대 통과 못 함(fail-closed)', () => {
  // DeepSeek JSON 파싱 실패 시 pack 의 판정 필드는 전부 undefined 로 온다.
  const parseFailed = { categoryFit: undefined, isIncident: undefined, confidence: undefined };
  it('파싱 실패(전 필드 undefined) → 거부 + judgment_missing', () => {
    expect(passesIngestionGate(parseFailed)).toBe(false);
    expect(rejectReason(parseFailed)).toBe('judgment_missing');
  });
  it('요약만 오고 판정 없음 → 거부', () => {
    expect(passesIngestionGate({ confidence: 'high' })).toBe(false);   // categoryFit 없음
    expect(passesIngestionGate({ categoryFit: true })).toBe(false);    // confidence 없음
    expect(passesIngestionGate({ categoryFit: true, isIncident: false })).toBe(false);
  });
});

describe('키워드 사건사고 veto — 모델 오판 차단', () => {
  const modelSaysFine = { categoryFit: true, isIncident: false, confidence: 'high' as const };
  it('모델이 통과시켜도 키워드가 사건사고면 거부', () => {
    expect(passesIngestionGate(modelSaysFine)).toBe(true);              // veto 없으면 통과
    expect(passesIngestionGate(modelSaysFine, true)).toBe(false);       // veto 시 거부
    expect(rejectReason(modelSaysFine, true)).toBe('keyword_incident');
  });
  it('키워드가 사건사고 아니면 기존 규칙 그대로', () => {
    expect(passesIngestionGate(modelSaysFine, false)).toBe(true);
    expect(rejectReason(modelSaysFine, false)).toBeNull();
  });
});
