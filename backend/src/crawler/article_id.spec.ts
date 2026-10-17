import { parseArticleId, normalizeBackupRow } from './article_id';

describe('parseArticleId', () => {
  it('accepts number', () => {
    expect(parseArticleId(23)).toBe(23);
  });

  it('accepts numeric string from JSON backup', () => {
    expect(parseArticleId('3539')).toBe(3539);
  });

  it('rejects non-finite and invalid', () => {
    expect(parseArticleId('abc')).toBeNull();
    expect(parseArticleId(NaN)).toBeNull();
    expect(parseArticleId('')).toBeNull();
    expect(parseArticleId(-1)).toBeNull();
  });
});

describe('normalizeBackupRow', () => {
  it('coerces string id to number', () => {
    expect(normalizeBackupRow({ id: '122', title: 't' })).toEqual({ id: 122, title: 't' });
  });
});
