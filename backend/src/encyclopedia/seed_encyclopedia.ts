/**
 * 중독백과 JSON → encyclopedia_terms upsert
 * 실행: npx ts-node src/encyclopedia/seed_encyclopedia.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

function env(key: string): string {
  let v = process.env[key] ?? '';
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

interface EncEntry {
  id: string;
  term_ko: string;
  term_en: string;
  category: string;
  definition: string;
  example?: string;
  see_also?: string[];
  trend?: boolean;
}

interface EncFile {
  entries: EncEntry[];
}

async function main() {
  const jsonPath = path.join(__dirname, '../../addiction_encyclopedia_v4.json');
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw) as EncFile;
  const entries = data.entries ?? [];

  const client = new Client({
    host: env('DB_HOST') || 'localhost',
    port: Number(env('DB_PORT') || 5432),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
  });

  await client.connect();

  const sql = `
    INSERT INTO encyclopedia_terms (
      id, term_ko, term_en, category, definition, example,
      see_also, trend, sensitive, video_url, video_status, published, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7::jsonb, $8, $9, NULL, 'pending', true, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      term_ko = EXCLUDED.term_ko,
      term_en = EXCLUDED.term_en,
      category = EXCLUDED.category,
      definition = EXCLUDED.definition,
      example = EXCLUDED.example,
      see_also = EXCLUDED.see_also,
      trend = EXCLUDED.trend,
      sensitive = EXCLUDED.sensitive,
      updated_at = now()
  `;

  let seeded = 0;
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      const sensitive = e.id === 'eating-disorders';
      await client.query(sql, [
        e.id,
        e.term_ko,
        e.term_en,
        e.category,
        e.definition,
        e.example ?? '',
        JSON.stringify(e.see_also ?? []),
        e.trend ?? false,
        sensitive,
      ]);
      seeded += 1;
    }
    await client.query('COMMIT');
    console.log(`seeded ${seeded} encyclopedia terms`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('seed failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
