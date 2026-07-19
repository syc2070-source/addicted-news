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
import { fetchImageForBackfill } from './article_extractor';

const DELAY_MS = Number(process.env.DELAY_MS ?? 700);
const LIMIT = Number(process.env.BACKFILL_LIMIT ?? 0); // 0 = 전체
// 429(rate limit) 대응
const RL_MAX_RETRY = Number(process.env.RL_MAX_RETRY ?? 3);       // 지수 백오프 최대 재시도
const RL_BASE_MS = Number(process.env.RL_BASE_MS ?? 2000);         // 백오프 기준(2s,4s,8s)
const RL_ABORT_STREAK = Number(process.env.RL_ABORT_STREAK ?? 50); // 연속 429 이 수만큼이면 중단

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

  let ok = 0, fail = 0, done = 0, rateLimited = 0, consec429 = 0;
  let aborted = false;
  for (const t of targets) {
    done++;
    const link = t.google_url || t.source_url || '';

    // 429면 지수 백오프로 최대 RL_MAX_RETRY 회 재시도
    let status = 0, img: string | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetchImageForBackfill(link);
        img = r.image; status = r.status;
      } catch {
        img = null; status = 0;
      }
      if (status === 429 && attempt < RL_MAX_RETRY) {
        const backoff = RL_BASE_MS * Math.pow(2, attempt); // 2s,4s,8s
        console.log(`  ⏳ 429 백오프 ${attempt + 1}/${RL_MAX_RETRY} (${backoff}ms) id=${t.id}`);
        await sleep(backoff);
        continue;
      }
      break;
    }

    if (status === 429) {
      // 재시도 후에도 429 → 이 건은 rate-limit 스킵, 연속 카운트 증가
      rateLimited++; consec429++;
      if (consec429 >= RL_ABORT_STREAK) {
        aborted = true;
        console.warn(`\n🛑 연속 429 ${consec429}건 — 남은 작업 자동 중단(집계 출력). 나중에 --resume 으로 재개 가능.\n`);
        break;
      }
    } else {
      consec429 = 0; // 429 연속 끊김
      if (img) {
        await client.query(`UPDATE articles SET image_url = $1, updated_at = now() WHERE id = $2`, [img, t.id]);
        ok++;
      } else {
        fail++;
      }
    }

    if (done % 100 === 0) {
      console.log(`  …${done}/${targets.length} 처리 (성공 ${ok}, 실패 ${fail}, 429 ${rateLimited})`);
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
  console.log(`${aborted ? '⚠️ 연속 429로 중단됨' : '완료'}`);
  console.log(`대상: ${targets.length}건 (처리 ${done}건)`);
  console.log(`성공(백필): ${ok}건`);
  console.log(`실패(og 없음/부적합): ${fail}건`);
  console.log(`429(rate limit) 스킵: ${rateLimited}건`);
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
