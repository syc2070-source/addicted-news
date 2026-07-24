// ============================================================
// date_cleanup.ts (v5.4.1 3-3 보정) — published_at 2026-01-01 오염 정리.
// - published_at='2026-01-01' 이고 created_at 이 1/1 이 아닌 행을
//   published_at = created_at 날짜로 UPDATE(최신순 정렬 정상화).
// - --apply 없으면 DRY_RUN(대상 수만 보고).
// 실행: npx ts-node src/crawler/date_cleanup.ts [--apply]
//   POLLUTED_DATE 로 기준 날짜 변경 가능(기본 2026-01-01).
// ============================================================
import 'dotenv/config';
import { Client, ClientConfig } from 'pg';
import { isApply, modeLabel } from './cli_flags';

const DRY_RUN = !isApply();
const POLLUTED = process.env.POLLUTED_DATE || '2026-01-01';

function buildClientConfig(): ClientConfig {
  const url = process.env.DATABASE_URL?.trim();
  const host = process.env.DB_HOST || 'localhost';
  const isLocal = /^(localhost|127\.0\.0\.1|::1)$/.test(host) || (url ? /@(localhost|127\.0\.0\.1)/.test(url) : false);
  const ssl = process.env.DB_SSL === 'false' || isLocal ? undefined : { rejectUnauthorized: false };
  if (url) return { connectionString: url, ssl };
  return {
    host, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''), database: process.env.DB_NAME || 'addiction_news', ssl,
  };
}

async function main() {
  console.log(`\n=== date_cleanup (${modeLabel()}) | 기준 오염일=${POLLUTED} ===`);
  const client = new Client(buildClientConfig());
  await client.connect();
  console.log('✅ DB 연결');

  // published_at 이 오염일이고 created_at 은 그 날짜가 아닌 행(= 파싱 실패로 찍힌 것)
  const where = `published_at = $1 AND to_char(created_at,'YYYY-MM-DD') <> $1`;
  const { rows } = await client.query<{ id: number; created: string }>(
    `SELECT id, to_char(created_at,'YYYY-MM-DD') AS created FROM articles WHERE ${where} ORDER BY id`,
    [POLLUTED],
  );
  console.log(`대상(오염 published_at) ${rows.length}건`);
  for (const r of rows.slice(0, 30)) console.log(`  [id=${r.id}] ${POLLUTED} → ${r.created}`);
  if (rows.length > 30) console.log(`  … 외 ${rows.length - 30}건`);

  let updated = 0;
  if (!DRY_RUN && rows.length > 0) {
    const res = await client.query(
      `UPDATE articles SET published_at = to_char(created_at,'YYYY-MM-DD'), updated_at=now() WHERE ${where}`,
      [POLLUTED],
    );
    updated = res.rowCount ?? 0;
    console.log(`\n🛠️  보정 완료: ${updated}건`);
  } else if (DRY_RUN) {
    console.log(`\n(DRY_RUN) 보정 예정 ${rows.length}건 — --apply 시 실제 UPDATE`);
  }

  console.log('\n================ 결과 ================');
  console.log(`변경 대상: ${rows.length}건${DRY_RUN ? ' (예정)' : `, 완료 ${updated}건`}`);
  console.log('=====================================\n');
  await client.end();
}

if (require.main === module) {
  main().catch((e) => { console.error('❌ date_cleanup 실패:', e); process.exit(1); });
}
