// ============================================================
// image_backfill.ts — imageUrl 비어있는 기존 기사에 og:image 백필
// ------------------------------------------------------------
// - 대상: image_url 이 NULL/'' 이고 source_url 이 있는 articles.
// - source_url(구글뉴스 리다이렉트면 해제)에서 og:image(없으면 twitter:image)를
//   가져와 UPDATE. article_extractor.extractOgImageFromUrl 재사용(axios·undici 금지).
// - 요청 간 딜레이(기본 700ms)로 예의 있게. 개별 실패는 스킵하고 계속.
// - 재개 가능: 이미 채워진 건 애초에 대상에서 제외(재실행하면 남은 것만 처리).
// - 진행 로그 100건마다. 끝에 집계(대상/성공/실패/최종 보유율).
//
// 실행:
//   npx ts-node src/crawler/image_backfill.ts            # 전체 백필
//   npx ts-node src/crawler/image_backfill.ts --resume   # 남은 것만(동일 동작, 명시)
//   BACKFILL_LIMIT=50 DELAY_MS=1000 npx ts-node ... --resume
//
// 연결: DATABASE_URL 우선, 없으면 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME.
//   원격(Supabase 등)은 SSL 자동. articles 만 UPDATE(다른 테이블 불변).
// ============================================================
import 'dotenv/config';
import { Client, ClientConfig } from 'pg';
import { extractOgImageFromUrl } from './article_extractor';
import { isValidArticleImageUrl } from './image_validation';

const DELAY_MS = Number(process.env.DELAY_MS ?? 700);
const LIMIT = Number(process.env.BACKFILL_LIMIT ?? 0); // 0 = 전체

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function buildClientConfig(): ClientConfig {
  const url = process.env.DATABASE_URL?.trim();
  const host = process.env.DB_HOST || 'localhost';
  const isLocal = /^(localhost|127\.0\.0\.1|::1)$/.test(host) ||
    (url ? /@(localhost|127\.0\.0\.1)/.test(url) : false);
  const ssl = process.env.DB_SSL === 'false' || isLocal ? undefined : { rejectUnauthorized: false };
  if (url) return { connectionString: url, ssl };
  return {
    host,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''),
    database: process.env.DB_NAME || 'addiction_news',
    ssl,
  };
}

// 추적 픽셀·로고 등 — image_validation.isValidArticleImageUrl 공용

async function main() {
  const resume = process.argv.includes('--resume');
  console.log(`\n=== image_backfill (delay=${DELAY_MS}ms${LIMIT ? `, limit=${LIMIT}` : ''}${resume ? ', resume' : ''}) ===`);
  const client = new Client(buildClientConfig());
  await client.connect();
  console.log('✅ DB 연결');

  const { rows: totalRow } = await client.query<{ c: string }>(`SELECT COUNT(*)::text c FROM articles`);
  const totalArticles = Number(totalRow[0]?.c ?? 0);

  const targetSql =
    `SELECT id, source_url, google_url FROM articles
      WHERE (image_url IS NULL OR image_url = '')
        AND source_url IS NOT NULL AND source_url <> ''
      ORDER BY id` + (LIMIT > 0 ? ` LIMIT ${LIMIT}` : '');
  const { rows: targets } = await client.query<{ id: number; source_url: string; google_url: string | null }>(targetSql);

  console.log(`전체 ${totalArticles}건 중 대상(이미지 없음) ${targets.length}건 처리 시작\n`);

  let ok = 0, fail = 0, done = 0;
  for (const t of targets) {
    done++;
    try {
      const link = t.google_url || t.source_url || '';
      const img = await extractOgImageFromUrl(link);
      if (isValidArticleImageUrl(img)) {
        await client.query(`UPDATE articles SET image_url = $1, updated_at = now() WHERE id = $2`, [img, t.id]);
        ok++;
      } else {
        fail++;
      }
    } catch {
      fail++;
    }
    if (done % 100 === 0) {
      console.log(`  …${done}/${targets.length} 처리 (성공 ${ok}, 실패 ${fail})`);
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  // 최종 보유율
  const { rows: withImgRow } = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM articles WHERE image_url IS NOT NULL AND image_url <> ''`,
  );
  const withImg = Number(withImgRow[0]?.c ?? 0);
  const rate = totalArticles > 0 ? ((withImg / totalArticles) * 100).toFixed(1) : '0.0';

  console.log('\n================ 결과 ================');
  console.log(`대상: ${targets.length}건`);
  console.log(`성공(백필): ${ok}건`);
  console.log(`실패(og 없음/부적합): ${fail}건`);
  console.log(`최종 이미지 보유: ${withImg}/${totalArticles} (${rate}%)`);
  console.log('=====================================\n');

  await client.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ image_backfill 실패:', e);
    process.exit(1);
  });
}
