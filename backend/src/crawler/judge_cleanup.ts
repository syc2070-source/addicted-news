// ============================================================
// judge_cleanup.ts — 저장된 기사를 딥시크 "최종 판정"으로 일괄 재심사
// ------------------------------------------------------------
// - 대상: 최근 저장 기사(기본 최근 JUDGE_DAYS=14일, JUDGE_LIMIT=0=전체).
// - 각 기사: summarizeKoreanDeepSeek(title, summary, {category}) 로
//   report_type / category_fit 판정. incident 이거나 category_fit=false 면
//   삭제 대상. (딥시크 미가용 시 키워드 isIncidentReport 로 폴백 — 로컬 검증용)
// - 삭제 전 대상 전체 행을 deploy/judge_backup.json 으로 백업(이어붙이기).
//   목록을 deploy/judge_cleanup_report.txt 로 저장한 뒤 DELETE. articles 만.
// - 요청 간 딜레이(DELAY_MS, 기본 500ms). 개별 실패는 판정 미상 → 삭제 안 함(fail-safe).
//
// 실행:
//   npx ts-node src/crawler/judge_cleanup.ts               # 딥시크 판정 후 삭제
//   DRY_RUN=true npx ts-node src/crawler/judge_cleanup.ts  # 미리보기(삭제 안 함)
//   JUDGE_DAYS=30 JUDGE_LIMIT=200 npx ts-node ...
//
// 연결: DATABASE_URL 우선, 없으면 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME.
//   원격(Supabase 등)은 SSL 자동. encyclopedia_terms 등 다른 테이블 불변.
// ============================================================
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Client, ClientConfig } from 'pg';
import { summarizeKoreanDeepSeek, deepseekAvailable } from './deepseek_summary';
import { isIncidentReport } from './addictionFilter';
import { shouldDelete, Judgment } from './judge_article';

const DRY_RUN = process.env.DRY_RUN === 'true';
const DELAY_MS = Number(process.env.DELAY_MS ?? 500);
const JUDGE_DAYS = Number(process.env.JUDGE_DAYS ?? 14);
const JUDGE_LIMIT = Number(process.env.JUDGE_LIMIT ?? 0); // 0 = 전체
const DEPLOY_DIR = path.join(__dirname, '../../../deploy');
const REPORT_PATH = path.join(DEPLOY_DIR, 'judge_cleanup_report.txt');
const BACKUP_PATH = path.join(DEPLOY_DIR, 'judge_backup.json');

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

type Row = {
  id: number; title: string; summary: string | null; category: string | null;
  source: string | null; published_at: string | null; created_at: string | Date | null;
};

type Judged = Judgment & { via: 'deepseek' | 'keyword' };

async function judge(row: Row): Promise<Judged> {
  const content = (row.summary && row.summary.trim()) || row.title || '';
  if (deepseekAvailable) {
    try {
      const pack = await summarizeKoreanDeepSeek(row.title || '', content, {
        translate: false,
        category: row.category || '미지정',
      });
      if (pack) {
        return { isIncident: pack.isIncident, categoryFit: pack.categoryFit, confidence: pack.confidence, via: 'deepseek' };
      }
    } catch { /* 폴백 */ }
  }
  // 폴백: 키워드 사건사고 판정(딥시크 미가용/실패 시 — 주로 로컬 검증용)
  return {
    isIncident: isIncidentReport(row.title || '', content),
    categoryFit: undefined,
    via: 'keyword',
  };
}

async function main() {
  console.log(`\n=== judge_cleanup ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} | 판정: ${deepseekAvailable ? 'DeepSeek' : '키워드 폴백'} ===`);
  const client = new Client(buildClientConfig());
  await client.connect();
  console.log('✅ DB 연결');

  const { rows: totalRow } = await client.query<{ c: string }>(`SELECT COUNT(*)::text c FROM articles`);
  const totalBefore = Number(totalRow[0]?.c ?? 0);

  // 최근 JUDGE_DAYS 일 내 저장분(created_at) 대상.
  // v5.4: restored_manual(수동 복원)은 재심사 제외(작업1과 연동).
  const targetSql =
    `SELECT id, title, summary, category, source, published_at, created_at
       FROM articles
      WHERE created_at >= now() - ($1::int * interval '1 day')
        AND (judge_status IS DISTINCT FROM 'restored_manual')
      ORDER BY id DESC` + (JUDGE_LIMIT > 0 ? ` LIMIT ${JUDGE_LIMIT}` : '');
  const { rows: targets } = await client.query<Row>(targetSql, [JUDGE_DAYS]);
  console.log(`전체 ${totalBefore}건 / 재심사 대상(최근 ${JUDGE_DAYS}일) ${targets.length}건\n`);

  const toDelete: Array<Row & { judged: Judged }> = [];
  let reviewed = 0;
  for (const row of targets) {
    reviewed++;
    const j = await judge(row);
    if (shouldDelete(j)) {
      toDelete.push({ ...row, judged: j });
      const reason = j.isIncident === true ? 'incident' : 'category_fit=false';
      console.log(`  🤖 삭제대상(${reason}, ${j.via}) [id=${row.id}] ${String(row.title).slice(0, 40)}`);
    }
    if (reviewed % 50 === 0) console.log(`  …${reviewed}/${targets.length} 심사 (삭제대상 ${toDelete.length})`);
    if (deepseekAvailable && DELAY_MS > 0) await sleep(DELAY_MS);
  }

  const ids = toDelete.map((r) => r.id);

  // 리포트
  if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  const lines: string[] = [];
  lines.push(`# judge_cleanup report (mode: ${DRY_RUN ? 'DRY_RUN' : 'APPLY'}, 판정: ${deepseekAvailable ? 'DeepSeek' : 'keyword'})`);
  lines.push(`# 대상 ${targets.length}건 중 삭제대상 ${toDelete.length}건`);
  lines.push('');
  for (const r of toDelete) {
    const reason = r.judged.isIncident === true ? 'incident' : 'category_fit=false';
    lines.push(`  [id=${r.id}] (${r.published_at ?? '-'}) [${reason}/${r.judged.via}] ${r.title}`);
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  console.log(`\n📄 리포트: ${REPORT_PATH}`);

  // 백업(이어붙이기)
  let backupRows: any[] = [];
  if (ids.length > 0) {
    const res = await client.query(`SELECT * FROM articles WHERE id = ANY($1::int[])`, [ids]);
    backupRows = res.rows;
  }
  let backupLog: any[] = [];
  if (fs.existsSync(BACKUP_PATH)) {
    try {
      const prev = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
      if (Array.isArray(prev)) backupLog = prev; else if (prev) backupLog = [prev];
    } catch { backupLog = []; }
  }
  backupLog.push({
    generatedAt: new Date().toISOString(),
    mode: DRY_RUN ? 'DRY_RUN' : 'APPLY',
    via: deepseekAvailable ? 'deepseek' : 'keyword',
    ids,
    rows: backupRows,
  });
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(backupLog, null, 2), 'utf8');
  console.log(`💾 백업(누적 ${backupLog.length}회): ${BACKUP_PATH} (이번 ${backupRows.length}행)`);

  // 삭제(articles 만)
  let deleted = 0;
  if (!DRY_RUN && ids.length > 0) {
    const del = await client.query(`DELETE FROM articles WHERE id = ANY($1::int[])`, [ids]);
    deleted = del.rowCount ?? 0;
    console.log(`🗑️  삭제 완료: ${deleted}건`);
  } else if (DRY_RUN) {
    console.log(`(DRY_RUN) 삭제 예정 ${ids.length}건 — 실제 삭제 안 함`);
  }

  const { rows: afterRow } = await client.query<{ c: string }>(`SELECT COUNT(*)::text c FROM articles`);
  const remaining = Number(afterRow[0]?.c ?? 0);
  const incidentN = toDelete.filter((r) => r.judged.isIncident === true).length;
  const catN = toDelete.filter((r) => r.judged.isIncident !== true && r.judged.categoryFit === false).length;

  console.log('\n================ 결과 ================');
  console.log(`판정 방식: ${deepseekAvailable ? 'DeepSeek' : '키워드 폴백'}`);
  console.log(`재심사: ${reviewed}건`);
  console.log(`삭제대상: ${toDelete.length}건 (incident ${incidentN} + category_fit=false ${catN})${DRY_RUN ? ' (예정)' : ''}`);
  console.log(`남은 총 기사: ${remaining}건`);
  console.log('=====================================\n');

  await client.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ judge_cleanup 실패:', e);
    process.exit(1);
  });
}
