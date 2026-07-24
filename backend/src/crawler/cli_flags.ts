// ============================================================
// cli_flags.ts (v5.4.1 작업4) — DB 쓰기 스크립트 실행 안전장치.
// 규칙: --apply 플래그가 있어야만 실제 쓰기. 없으면 무조건 DRY_RUN(env 무시).
// 크론 진입점에서만 --apply 를 전달한다.
// ============================================================

/** --apply 플래그가 있으면 true(실제 쓰기). 없으면 false(DRY_RUN). env는 보지 않는다. */
export function isApply(argv: string[] = process.argv): boolean {
  return argv.includes('--apply');
}

/** 화면 표시용 모드 라벨 */
export function modeLabel(argv: string[] = process.argv): string {
  return isApply(argv) ? 'APPLY(실제 쓰기)' : 'DRY_RUN(--apply 없음 → 쓰기 안 함)';
}
