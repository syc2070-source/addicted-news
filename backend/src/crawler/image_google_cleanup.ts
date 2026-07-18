// ============================================================
// image_google_cleanup.ts — 구글 로고/정적자원 imageUrl 정리
// ------------------------------------------------------------
// - 대상: image_url 이 GOOGLE_BLOCKED 목록에 걸리는 articles.
// - google_url/source_url → resolveFinalUrl → og:image 재수집.
// - 성공: UPDATE image_url / 실패: image_url NULL(SVG 폴백).
// - 삭제 전 백업 JSON 이어붙이기. --resume 재실행 시 남은 대상만.
//
// 실행:
//   npx ts-node src/crawler/image_google_cleanup.ts
//   npx ts-node src/crawler/image_google_cleanup.ts --resume
//   DELAY_MS=700 BACKFILL_LIMIT=50 npx ts-node ...
// ============================================================
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Client, ClientConfig } from 'pg';
import { extractOgImageFromUrl } from './article_extractor';
import { googleBlockedImageSqlCondition, isValidArticleImageUrl } from './image_validation';

const DELAY_MS = Number(process.env.DELAY_MS ?? 2500);
const LIMIT = Number(process.env.BACKFILL_LIMIT ?? 0);

const DEPLOY_DIR = path.join(__dirname, '../../../deploy');
const BACKUP_PATH = path.join(DEPLOY_DIR, 'image_google_cleanup_backup.json');
const REPORT_PATH = path.join(DEPLOY_DIR, 'image_google_cleanup_report.txt');

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

type BackupRow = {
  id: number;
  old_image_url: string;
  source_url: string | null;
  google_url: string | null;
  action: 'recovered' | 'nulled';
  new_image_url: string | null;
  at: string;
};

function appendBackup(rows: BackupRow[]) {
  if (rows.length === 0) return;
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  let existing: BackupRow[] = [];
  if (fs.existsSync(BACKUP_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
  }
  fs.writeFileSync(BACKUP_PATH, JSON.stringify([...existing, ...rows], null, 2), 'utf8');
}

async function main() {
  const resume = process.argv.includes('--resume');
  console.log(`\n=== image_google_cleanup (delay=${DELAY_MS}ms${LIMIT ? `, limit=${LIMIT}` : ''}${resume ? ', resume' : ''}) ===`);

  const client = new Client(buildClientConfig());
  await client.connect();
  console.log('✅ DB 연결');

  const blockedCond = googleBlockedImageSqlCondition('image_url');
  const { rows: totalRow } = await client.query<{ c: string }>(`SELECT COUNT(*)::text c FROM articles`);
  const totalArticles = Number(totalRow[0]?.c ?? 0);

  const targetSql =
    `SELECT id, image_url, source_url, google_url FROM articles
      WHERE image_url IS NOT NULL AND image_url <> ''
        AND ${blockedCond}
      ORDER BY id` + (LIMIT > 0 ? ` LIMIT ${LIMIT}` : '');
  const { rows: targets } = await client.query<{
    id: number;
    image_url: string;
    source_url: string | null;
    google_url: string | null;
  }>(targetSql);

  console.log(`전체 ${totalArticles}건 중 구글 오염 image_url ${targets.length}건 정리 시작\n`);

  let recovered = 0, nulled = 0, done = 0;
  const batchBackup: BackupRow[] = [];

  for (const t of targets) {
    done++;
    const link = t.google_url || t.source_url || '';
    let action: 'recovered' | 'nulled' = 'nulled';
    let newUrl: string | null = null;

    try {
      const img = await extractOgImageFromUrl(link);
      if (isValidArticleImageUrl(img)) {
        await client.query(
          `UPDATE articles SET image_url = $1, updated_at = now() WHERE id = $2`,
          [img, t.id],
        );
        newUrl = img;
        action = 'recovered';
        recovered++;
      } else {
        await client.query(
          `UPDATE articles SET image_url = NULL, updated_at = now() WHERE id = $1`,
          [t.id],
        );
        nulled++;
      }
    } catch {
      await client.query(
        `UPDATE articles SET image_url = NULL, updated_at = now() WHERE id = $1`,
        [t.id],
      );
      nulled++;
    }

    batchBackup.push({
      id: t.id,
      old_image_url: t.image_url,
      source_url: t.source_url,
      google_url: t.google_url,
      action,
      new_image_url: newUrl,
      at: new Date().toISOString(),
    });

    if (done % 100 === 0) {
      appendBackup(batchBackup.splice(0, batchBackup.length));
      console.log(`  …${done}/${targets.length} (재수집 ${recovered}, NULL ${nulled})`);
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  appendBackup(batchBackup);

  // 잔여 구글 오염 URL 일괄 NULL(429 등으로 개별 처리 누락 방지)
  const bulkNull = await client.query(
    `UPDATE articles SET image_url = NULL, updated_at = now()
      WHERE image_url IS NOT NULL AND image_url <> '' AND ${blockedCond}
      RETURNING id`,
  );
  if (bulkNull.rowCount && bulkNull.rowCount > 0) {
    console.log(`  잔여 ${bulkNull.rowCount}건 일괄 NULL 처리`);
    nulled += bulkNull.rowCount;
  }

  const { rows: withImgRow } = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM articles WHERE image_url IS NOT NULL AND image_url <> ''`,
  );
  const { rows: blockedRow } = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text c FROM articles WHERE image_url IS NOT NULL AND image_url <> '' AND ${blockedCond}`,
  );
  const withImg = Number(withImgRow[0]?.c ?? 0);
  const stillBlocked = Number(blockedRow[0]?.c ?? 0);
  const rate = totalArticles > 0 ? ((withImg / totalArticles) * 100).toFixed(1) : '0.0';

  const report = [
    `=== image_google_cleanup ${new Date().toISOString()} ===`,
    `대상(구글 오염): ${targets.length}건`,
    `재수집 성공: ${recovered}건`,
    `NULL 처리: ${nulled}건`,
    `잔여 구글 오염: ${stillBlocked}건`,
    `최종 실이미지 보유: ${withImg}/${totalArticles} (${rate}%)`,
    `백업: ${BACKUP_PATH}`,
  ].join('\n');

  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  fs.appendFileSync(REPORT_PATH, report + '\n\n', 'utf8');

  console.log('\n================ 결과 ================');
  console.log(report);
  console.log('=====================================\n');

  await client.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ image_google_cleanup 실패:', e);
    process.exit(1);
  });
}
