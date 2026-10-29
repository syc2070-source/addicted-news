// ============================================================
// summary_widget_run.ts (NEWS-Q21 ■1) — 위젯 요약 쓸기를 실행 시작 밖에서 한 번 돌리는 입구(수집기와 같은 sweepWidgetSummaries).
// --apply 없으면 DRY_RUN(고칠 목록만). 열쇠 · 연결 글은 출력하지 않는다.
// 실행: npx ts-node src/crawler/summary_widget_run.ts [--apply]
// ============================================================
import 'dotenv/config';
import { Client, ClientConfig } from 'pg';
import type { QueryFn } from './broadcast_episode';
import { isApply, modeLabel } from './cli_flags';
import { defaultDbName } from './field_profile';
import { sweepWidgetSummaries } from './summary_widget';

function buildClientConfig(): ClientConfig {
  const url = process.env.DATABASE_URL?.trim();
  const host = process.env.DB_HOST || 'localhost';
  const isLocal = /^(localhost|127\.0\.0\.1|::1)$/.test(host) || (url ? /@(localhost|127\.0\.0\.1)/.test(url) : false);
  const ssl = process.env.DB_SSL === 'false' || isLocal ? undefined : { rejectUnauthorized: false };
  if (url) return { connectionString: url, ssl };
  return {
    host, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''), database: defaultDbName(), ssl,
  };
}

async function columnOn(client: Client, column: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'articles' AND column_name = $1`,
    [column],
  );
  return rows.length > 0;
}

async function main() {
  const apply = isApply();
  console.log(`\n=== summary_widget (${modeLabel()}) ===`);
  const client = new Client(buildClientConfig());
  await client.connect();
  const query: QueryFn = async (sql, params) => (await client.query(sql, params as unknown[])).rows;
  const cols = {
    deletedAt: await columnOn(client, 'deleted_at'),
    rawBody: await columnOn(client, 'raw_body'),
    tier: await columnOn(client, 'tier'),
  };
  const sw = await sweepWidgetSummaries(query, cols, apply);
  console.log(`읽음 ${sw.checked} · 위젯 요약 ${sw.fixed.length}${apply ? ' (고침)' : ' (DRY_RUN — 고칠 것)'}${sw.error ? ` · 오류: ${sw.errorMessage}` : ''}`);
  for (const f of sw.fixed) {
    console.log(`  [id=${f.id} · ${f.tier}] 「${f.before.replace(/\s+/g, ' ')}」\n      → 「${(f.after || '(비움 · TOP 자격 0)').replace(/\s+/g, ' ')}」`);
  }
  await client.end();
}

if (require.main === module) {
  main().catch((e) => { console.error('❌ summary_widget 실패:', (e as Error).message); process.exit(1); });
}
