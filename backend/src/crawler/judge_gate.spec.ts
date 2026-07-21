import { shouldDelete } from './judge_cleanup';

describe('judge gate (딥시크 최종 판정)', () => {
  it('report_type=incident 이면 삭제', () => {
    expect(shouldDelete({ reportType: 'incident', categoryFit: true })).toBe(true);
  });
  it('category_fit=false 이면 (issue 여도) 삭제', () => {
    expect(shouldDelete({ reportType: 'issue', categoryFit: false })).toBe(true);
  });
  it('incident + category_fit=false 삭제', () => {
    expect(shouldDelete({ reportType: 'incident', categoryFit: false })).toBe(true);
  });
  it('issue + category_fit=true 는 저장(삭제 안 함)', () => {
    expect(shouldDelete({ reportType: 'issue', categoryFit: true })).toBe(false);
  });
  it('판정 미상(undefined)은 fail-safe로 삭제 안 함', () => {
    expect(shouldDelete({})).toBe(false);
    expect(shouldDelete({ reportType: undefined, categoryFit: undefined })).toBe(false);
  });
});
