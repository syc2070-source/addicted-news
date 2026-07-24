// ============================================================
// entity_cleanup.ts (v5.4.1 3-1 보정) — 저장된 기사 제목/요약의 HTML 엔티티 잔존물 정리.
// - title/summary 에 (hellip|quot|amp|nbsp|#\d+); 등 잔존물 있는 행 조회 → 디코딩 → UPDATE.
// - --apply 없으면 DRY_RUN(대상 목록만 출력).
// 실행: npx ts-node src/crawler/entity_cleanup.ts [--apply]
// ============================================================
import 'dotenv/config';
import { Client, ClientConfig } from 'pg';
import { decodeEntities, hasEntityArtifact } from './text_utils';
import { isApply, modeLabel } from './cli_flags';

const DRY_RUN = !isApply();

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

// 엔티티 잔존물 패턴(SQL 후보 필터 — 정밀 판별은 hasEntityArtifact 로 재확인)
const SQL_ARTIFACT = `(title ~* '(&|)?(hellip|quot|amp|nbsp|lt|gt|apos|middot|mdash|ndash|lsquo|rsquo|ldquo|rdquo);|(&|)?#x?[0-9a-f]+;'
   OR summary ~* '(&|)?(hellip|quot|amp|nbsp|lt|gt|apos|middot|mdash|ndash|lsquo|rsquo|ldquo|rdquo);|(&|)?#x?[0-9a-f]+;')`;

async function main() {
  console.log(`\n=== entity_cleanup (${modeLabel()}) ===`);
  const client = new Client(buildClientConfig());
  await client.connect();
  console.log('✅ DB 연결');

  const { rows } = await client.query<{ id: number; title: string; summary: string | null }>(
    `SELECT id, title, summary FROM articles WHERE ${SQL_ARTIFACT} ORDER BY id`,
  );
  // 정밀 재확인 후 실제 변경 대상만
  const targets = rows
    .map((r) => ({ id: r.id, title: r.title, summary: r.summary, newTitle: decodeEntities(r.title), newSummary: r.summary ? decodeEntities(r.summary) : r.summary }))
    .filter((r) => r.newTitle !== r.title || r.newSummary !== r.summary);

  console.log(`후보 ${rows.length}건 / 실제 변경 대상 ${targets.length}건\n`);
  for (const t of targets.slice(0, 50)) {
    console.log(`  [id=${t.id}] "${t.title}" → "${t.newTitle}"`);
  }
  if (targets.length > 50) console.log(`  … 외 ${targets.length - 50}건`);

  let updated = 0;
  if (!DRY_RUN) {
    for (const t of targets) {
      try {
        await client.query(`UPDATE articles SET title=$1, summary=$2, updated_at=now() WHERE id=$3`,
          [t.newTitle, t.newSummary, t.id]);
        updated++;
      } catch { /* 개별 실패 무시 */ }
    }
    console.log(`\n🛠️  보정 완료: ${updated}건`);
  } else {
    console.log(`\n(DRY_RUN) 보정 예정 ${targets.length}건 — --apply 시 실제 UPDATE`);
  }

  console.log('\n================ 결과 ================');
  console.log(`변경 대상: ${targets.length}건${DRY_RUN ? ' (예정)' : `, 완료 ${updated}건`}`);
  console.log('=====================================\n');
  await client.end();
}

if (require.main === module) {
  main().catch((e) => { console.error('❌ entity_cleanup 실패:', e); process.exit(1); });
}
