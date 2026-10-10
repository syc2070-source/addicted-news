// ============================================================
// schema_probe.ts (NEWS-Q1) — 새 열을 쓰는 코드는 "열이 있는지 확인한 뒤에만" 켠다.
// synchronize:false 이고 스키마 변경은 오너가 묶음 SQL 로 적용하므로(docs/governance/sql),
// 열이 아직 없으면 옛 동작 그대로 돈다. 확인 실패도 "없음"으로 본다(fail-closed).
// ============================================================

export type QueryFn = (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;

export async function columnExists(query: QueryFn, table: string, column: string): Promise<boolean> {
  try {
    const rows = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2
        LIMIT 1`,
      [table, column],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
