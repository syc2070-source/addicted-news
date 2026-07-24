// ============================================================
// judge_restore.ts (v5.4 작업1) — judge_backup.json 에서 선별 22건 복원
// ------------------------------------------------------------
// - deploy/judge_backup.json (+ 없으면 judge_backup_20260721_run1.json)에서
//   아래 RESTORE_IDS 22건의 원본 행을 찾아 articles 에 복원.
// - 멱등: 이미 존재하는 id 는 skip. judge_status='restored_manual' 표기(재삭제 방지).
// - DRY_RUN 기본 true — DRY_RUN=false 일 때만 실제 INSERT.
// - 결과를 deploy/judge_restore_report.txt 로 저장(성공/skip/실패 각 건).
//
// 실행:
//   npx ts-node src/crawler/judge_restore.ts                 # DRY RUN(기본)
//   DRY_RUN=false npx ts-node src/crawler/judge_restore.ts   # 실제 복원
// ============================================================
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Client, ClientConfig } from 'pg';
import { isApply } from './cli_flags';

// 복원 대상 22건 (상단 하드코딩)
const RESTORE_IDS: number[] = [
  23, 122, 137, 138, 141, 143, 144, 154, 162, 234, 399, 569,
  635, 636, 2342, 2446, 2492, 2963, 3086, 3198, 3303, 3539,
];

// 복원 근거 분류(주석용)
// - 기관·정책 예방사업: 162, 635, 636, 137, 138, 141, 143, 144, 2342, 2446, 569, 3198
// - 연구·통계·치료과학: 2492, 2963, 3086, 3303
// - 이슈 기획·해외 정책: 23, 122, 154, 234, 399, 3539

const DRY_RUN = !isApply(); // --apply 없으면 무조건 DRY_RUN(env 무시)
const DEPLOY_DIR = path.join(__dirname, '../../../deploy');
const REPORT_PATH = path.join(DEPLOY_DIR, 'judge_restore_report.txt');
const BACKUP_FILES = ['judge_backup.json', 'judge_backup_20260721_run1.json'];

function buildClientConfig(): ClientConfig {
  const url = process.env.DATABASE_URL?.trim();
  const host = process.env.DB_HOST || 'localhost';
  const isLocal = /^(localhost|127\.0\.0\.1|::1)$/.test(host) ||
    (url ? /@(localhost|127\.0\.0\.1)/.test(url) : false);
  const ssl = process.env.DB_SSL === 'false' || isLocal ? undefined : { rejectUnauthorized: false };
  if (url) return { connectionString: url, ssl };
  return {
    host, port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres', password: String(process.env.DB_PASSWORD ?? ''),
    database: process.env.DB_NAME || 'addiction_news', ssl,
  };
}

// 백업 파일(들)에서 id→행 맵 구성(뒤 파일이 앞을 덮지 않도록 먼저 채운 것 우선)
function loadBackupRows(): Map<number, any> {
  const map = new Map<number, any>();
  for (const fname of BACKUP_FILES) {
    const p = path.join(DEPLOY_DIR, fname);
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const runs = Array.isArray(data) ? data : [data];
      for (const run of runs) {
        for (const row of run?.rows || []) {
          if (row && typeof row.id === 'number' && !map.has(row.id)) map.set(row.id, row);
        }
      }
    } catch { /* 무시 */ }
  }
  return map;
}

// 복원 INSERT 컬럼(articles). 백업 행(snake_case) 값 사용, 없으면 기본값.
const INSERT_COLS = [
  'id', 'title', 'original_title', 'teaser', 'summary', 'category', 'region',
  'source', 'source_url', 'google_url', 'origin', 'is_top', 'is_feature',
  'is_rapha', 'is_issue', 'image_url', 'published_at', 'lang', 'is_foreign',
  'source_type', 'outlet_id', 'keywords', 'blocked', 'blocked_reason',
  'judge_status', 'created_at', 'updated_at',
];

function rowValues(r: any): any[] {
  const now = new Date();
  const g = (k: string, d: any = null) => (r[k] === undefined ? d : r[k]);
  return [
    r.id, g('title'), g('original_title'), g('teaser'), g('summary'),
    g('category', '중독사회와 회복'), g('region', 'KR'), g('source', ''),
    g('source_url', ''), g('google_url'), g('origin', 'crawler'),
    g('is_top', false), g('is_feature', false), g('is_rapha', false), g('is_issue', false),
    g('image_url'), g('published_at', ''), g('lang', 'ko'), g('is_foreign', false),
    g('source_type'), g('outlet_id'), g('keywords'), g('blocked', false), g('blocked_reason'),
    'restored_manual', g('created_at', now), g('updated_at', now),
  ];
}

async function main() {
  console.log(`\n=== judge_restore ${DRY_RUN ? '(DRY RUN — INSERT 안 함)' : '(APPLY — 실제 복원)'} ===`);
  const backup = loadBackupRows();
  console.log(`백업에서 로드한 행: ${backup.size}건 (대상 ${RESTORE_IDS.length}건 매칭 확인)`);

  const client = new Client(buildClientConfig());
  await client.connect();
  console.log('✅ DB 연결');

  // 이미 존재하는 id
  const { rows: existRows } = await client.query<{ id: number }>(
    `SELECT id FROM articles WHERE id = ANY($1::int[])`, [RESTORE_IDS],
  );
  const existing = new Set(existRows.map((r) => r.id));

  const results: { id: number; status: 'restored' | 'skip_exists' | 'not_in_backup' | 'error'; note?: string }[] = [];

  for (const id of RESTORE_IDS) {
    if (existing.has(id)) { results.push({ id, status: 'skip_exists' }); continue; }
    const row = backup.get(id);
    if (!row) { results.push({ id, status: 'not_in_backup' }); continue; }
    if (DRY_RUN) { results.push({ id, status: 'restored', note: '(DRY_RUN 예정)' }); continue; }
    try {
      const ph = INSERT_COLS.map((_, i) => `$${i + 1}`).join(', ');
      await client.query(
        `INSERT INTO articles (${INSERT_COLS.join(', ')}) VALUES (${ph}) ON CONFLICT (id) DO NOTHING`,
        rowValues(row),
      );
      results.push({ id, status: 'restored' });
    } catch (e) {
      results.push({ id, status: 'error', note: (e as Error).message });
    }
  }

  // 리포트
  if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  const restored = results.filter((r) => r.status === 'restored');
  const skipped = results.filter((r) => r.status === 'skip_exists');
  const missing = results.filter((r) => r.status === 'not_in_backup');
  const errored = results.filter((r) => r.status === 'error');
  const lines: string[] = [];
  lines.push(`# judge_restore report (mode: ${DRY_RUN ? 'DRY_RUN' : 'APPLY'})`);
  lines.push(`# 대상 ${RESTORE_IDS.length}건 → 복원 ${restored.length} / skip(이미존재) ${skipped.length} / 백업없음 ${missing.length} / 오류 ${errored.length}`);
  lines.push('');
  for (const r of results) {
    const t = backup.get(r.id)?.title || '';
    lines.push(`  [id=${r.id}] ${r.status}${r.note ? ' ' + r.note : ''}  ${String(t).slice(0, 50)}`);
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');

  console.log('\n================ 결과 ================');
  console.log(`복원: ${restored.length}건${DRY_RUN ? ' (예정)' : ''}`);
  console.log(`skip(이미 존재): ${skipped.length}건`);
  console.log(`백업에 없음: ${missing.length}건${missing.length ? ' → ' + missing.map((m) => m.id).join(',') : ''}`);
  console.log(`오류: ${errored.length}건`);
  console.log(`📄 리포트: ${REPORT_PATH}`);
  console.log('=====================================\n');

  await client.end();
}

if (require.main === module) {
  main().catch((e) => { console.error('❌ judge_restore 실패:', e); process.exit(1); });
}
