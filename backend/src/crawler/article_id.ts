/** JSON 백업·pg 혼합 환경에서 article id를 안전하게 number로 통일 */
export function parseArticleId(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

/** 백업 행 id를 number로 정규화(없으면 null) */
export function normalizeBackupRow<T extends Record<string, unknown>>(row: T): (T & { id: number }) | null {
  const id = parseArticleId(row.id);
  if (id === null) return null;
  return { ...row, id };
}
