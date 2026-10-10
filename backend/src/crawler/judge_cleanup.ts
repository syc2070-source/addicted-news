// ============================================================
// judge_cleanup.ts — 저장된 기사를 딥시크 "최종 판정"으로 일괄 재심사 (주 1회 안전망)
// ------------------------------------------------------------
// - 대상: 최근 저장 기사(기본 최근 JUDGE_DAYS=14일, JUDGE_LIMIT=0=전체).
//   restored_manual 제외, deleted_at 열이 있으면 이미 숨긴 기사도 제외.
// - 각 기사: summarizeKoreanDeepSeek(title, summary, {category}) 로
//   report_type / category_fit 판정. incident 이거나 category_fit=false 면 "삭제 후보".
// - NEWS-Q1 ■1 (fail-closed, 규칙은 cleanup_policy.ts):
//   · 판정 실패·시간초과·빈 응답 → 건너뜀(삭제 0, 로그).
//   · DeepSeek 키가 없을 때의 키워드 판정(휴리스틱)은 후보 표시만, 삭제 근거 아님.
//   · 삭제는 soft 만: deleted_at = now(). 공개 API 는 deleted_at IS NULL 만 보여 준다.
//   · deleted_at 열이 없으면(묶음 SQL 적용 전) 후보 목록만 남기고 삭제 0.
//   · 하드 삭제(DELETE)는 CLEANUP_HARD_DELETE=1 일 때만(기본 꺼짐).
//   · 후보 목록(id·제목·사유·AI/휴리스틱)은 매 실행 로그(Render 로그)에 남는다.
//     soft 삭제는 행이 DB 에 그대로 있으므로 인스턴스 로컬 백업이 필요 없다.
// - 요청 간 딜레이(DELAY_MS, 기본 500ms).
//
// 실행:
//   npx ts-node src/crawler/judge_cleanup.ts            # 미리보기(후보 목록만)
//   npx ts-node src/crawler/judge_cleanup.ts --apply    # soft 삭제(deleted_at 열 있을 때)
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
import { isIncidentReport } from './field_filter';
import { isApply } from './cli_flags';
import {
  candidateReason, cleanupMode, CleanupMode, hardDeleteEnabled, isCandidate, isDeletionBasis, JudgedRow,
} from './cleanup_policy';
import { columnExists, QueryFn } from './schema_probe';
import { defaultDbName } from './field_profile';

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
    database: defaultDbName(),
    ssl,
  };
}

export type Row = {
  id: number; title: string; summary: string | null; category: string | null;
  source: string | null; published_at: string | null; created_at: string | Date | null;
};

export type JudgeFn = (row: Row) => Promise<JudgedRow>;

async function judge(row: Row): Promise<JudgedRow> {
  const content = (row.summary && row.summary.trim()) || row.title || '';
  if (deepseekAvailable) {
    // 운영 경로: 키가 있으면 DeepSeek 판정만 신뢰. 호출 실패/판정 미상은 'failed' →
    // 절대 삭제하지 않는다(판정 실패 기사 삭제 금지). 키워드 폴백으로 내려가지 않음.
    try {
      const pack = await summarizeKoreanDeepSeek(row.title || '', content, {
        translate: false,
        category: row.category || '미지정',
      });
      // 실제 판정값(is_incident/category_fit)이 있을 때만 deepseek 판정으로 인정.
      // 요약만 오고 판정 미상이면 삭제 근거가 없으므로 실패로 간주(건너뜀).
      if (pack && (pack.categoryFit !== undefined || pack.isIncident !== undefined)) {
        return { isIncident: pack.isIncident, categoryFit: pack.categoryFit, confidence: pack.confidence, via: 'deepseek' };
      }
      console.warn(`[judge_cleanup] 판정 실패(응답없음/판정미상) → 건너뜀(삭제 안 함) [id=${row.id}] ${String(row.title).slice(0, 40)}`);
      return { isIncident: undefined, categoryFit: undefined, via: 'failed' };
    } catch (e) {
      console.warn(`[judge_cleanup] DeepSeek 예외 → 건너뜀(삭제 안 함) [id=${row.id}]: ${(e as Error).message}`);
      return { isIncident: undefined, categoryFit: undefined, via: 'failed' };
    }
  }
  // 키 자체가 없을 때만(주로 로컬 검증) 키워드 판정 — 후보 표시만, 삭제 근거 아님.
  return {
    isIncident: isIncidentReport(row.title || '', content),
    categoryFit: undefined,
    via: 'keyword',
  };
}

export type Candidate = { row: Row; judged: JudgedRow; reason: string; basis: 'ai' | 'heuristic'; deletable: boolean };

export type CleanupResult = {
  mode: CleanupMode;
  deletedAtAvailable: boolean;
  reviewed: number;
  failedSkips: number;
  candidates: Candidate[];
  softDeleted: number;
  hardDeleted: number;
};

/**
 * 정리 본체(테스트 가능하도록 DB 질의·판정을 주입받는다).
 * 쓰기 SQL 은 mode 가 soft_delete(UPDATE deleted_at) / hard_delete(DELETE) 일 때만 나간다.
 */
export async function runCleanup(opts: {
  query: QueryFn;
  judge: JudgeFn;
  apply: boolean;
  hardDelete: boolean;
  days?: number;
  limit?: number;
  delayMs?: number;
  log?: (line: string) => void;
  beforeHardDelete?: (ids: number[]) => Promise<void>;
}): Promise<CleanupResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const days = opts.days ?? JUDGE_DAYS;
  const limit = opts.limit ?? JUDGE_LIMIT;
  const deletedAtAvailable = await columnExists(opts.query, 'articles', 'deleted_at');
  const mode = cleanupMode({ apply: opts.apply, deletedAtAvailable, hardDelete: opts.hardDelete });
  log(`[judge_cleanup] mode=${mode} · deleted_at 열 ${deletedAtAvailable ? '있음' : '없음(후보 목록만)'} · CLEANUP_HARD_DELETE=${opts.hardDelete ? '1' : '0'}`);

  // 최근 days 일 내 저장분(created_at) 대상. restored_manual(수동 복원)은 재심사 제외.
  const targetSql =
    `SELECT id, title, summary, category, source, published_at, created_at
       FROM articles
      WHERE created_at >= now() - ($1::int * interval '1 day')
        AND (judge_status IS DISTINCT FROM 'restored_manual')` +
    (deletedAtAvailable ? `\n        AND deleted_at IS NULL` : '') +
    `\n      ORDER BY id DESC` + (limit > 0 ? ` LIMIT ${Math.floor(limit)}` : '');
  const targets = (await opts.query(targetSql, [days])) as unknown as Row[];
  log(`재심사 대상(최근 ${days}일) ${targets.length}건`);

  const candidates: Candidate[] = [];
  let failedSkips = 0;
  let reviewed = 0;
  for (const row of targets) {
    reviewed++;
    const judged = await opts.judge(row);
    if (judged.via === 'failed') {
      failedSkips++;
    } else if (isCandidate(judged)) {
      const basis = judged.via === 'deepseek' ? 'ai' : 'heuristic';
      const c: Candidate = { row, judged, reason: candidateReason(judged), basis, deletable: isDeletionBasis(judged) };
      candidates.push(c);
      // 후보 목록 = 로그(Render 로그에 남음). 형식 고정: 감사·복원 근거.
      log(`[cleanup-candidate] id=${row.id} basis=${basis} reason=${c.reason} deletable=${c.deletable ? 'yes' : 'no'} title=${String(row.title).slice(0, 80)}`);
    }
    if (reviewed % 50 === 0) log(`  …${reviewed}/${targets.length} 심사 (후보 ${candidates.length}, 판정실패 건너뜀 ${failedSkips})`);
    if (opts.delayMs && opts.delayMs > 0) await sleep(opts.delayMs);
  }
  if (failedSkips > 0) {
    log(`⚠️ 판정 실패 ${failedSkips}/${targets.length}건 — 해당 기사는 삭제하지 않고 건너뜀(DeepSeek 상태 점검 필요).`);
  }

  const ids = candidates.filter((c) => c.deletable).map((c) => c.row.id);
  let softDeleted = 0;
  let hardDeleted = 0;
  if (ids.length > 0 && mode === 'soft_delete') {
    const res = (await opts.query(
      `UPDATE articles SET deleted_at = now() WHERE id = ANY($1::int[]) AND deleted_at IS NULL RETURNING id`,
      [ids],
    )) as unknown[];
    softDeleted = res.length;
    log(`🙈 soft 삭제(deleted_at): ${softDeleted}건 — 행은 DB 에 남음(복원 = deleted_at NULL)`);
  } else if (ids.length > 0 && mode === 'hard_delete') {
    if (opts.beforeHardDelete) await opts.beforeHardDelete(ids);
    const res = (await opts.query(`DELETE FROM articles WHERE id = ANY($1::int[]) RETURNING id`, [ids])) as unknown[];
    hardDeleted = res.length;
    log(`🗑️  하드 삭제(CLEANUP_HARD_DELETE=1): ${hardDeleted}건`);
  } else {
    log(`삭제 0 — ${mode === 'candidates_only' ? '후보 목록만' : '삭제 근거(AI 판정) 없음'} (AI 근거 ${ids.length}건 · 전체 후보 ${candidates.length}건)`);
  }

  return { mode, deletedAtAvailable, reviewed, failedSkips, candidates, softDeleted, hardDeleted };
}

/** 하드 삭제 경로(깃발 켰을 때만)의 옛 백업 — 인스턴스 로컬이라 백업으로 믿지 말 것. */
async function legacyLocalBackup(client: Client, ids: number[]) {
  const res = await client.query(`SELECT * FROM articles WHERE id = ANY($1::int[])`, [ids]);
  let backupLog: unknown[] = [];
  if (fs.existsSync(BACKUP_PATH)) {
    try {
      const prev = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
      backupLog = Array.isArray(prev) ? prev : prev ? [prev] : [];
    } catch { backupLog = []; }
  }
  backupLog.push({ generatedAt: new Date().toISOString(), mode: 'HARD_DELETE', ids, rows: res.rows });
  if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(backupLog, null, 2), 'utf8');
  console.log(`💾 (로컬 전용) 하드 삭제 전 백업 ${res.rows.length}행: ${BACKUP_PATH}`);
}

async function main() {
  const apply = isApply();
  const hardDelete = hardDeleteEnabled();
  console.log(`\n=== judge_cleanup ${apply ? '(APPLY)' : '(DRY RUN)'} | 판정: ${deepseekAvailable ? 'DeepSeek' : '키워드(후보 표시만)'} ===`);
  const client = new Client(buildClientConfig());
  await client.connect();
  console.log('✅ DB 연결');
  const query: QueryFn = async (sql, params) => (await client.query(sql, params as unknown[])).rows;

  const result = await runCleanup({
    query,
    judge,
    apply,
    hardDelete,
    delayMs: deepseekAvailable ? DELAY_MS : 0,
    beforeHardDelete: (ids) => legacyLocalBackup(client, ids),
  });

  // 사람이 읽는 리포트(로컬 편의용 — 기록의 정본은 위 로그)
  try {
    if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });
    const lines = [
      `# judge_cleanup report (mode: ${result.mode}, 판정: ${deepseekAvailable ? 'DeepSeek' : 'keyword'})`,
      `# 대상 ${result.reviewed}건 · 후보 ${result.candidates.length}건 · 판정실패 건너뜀 ${result.failedSkips}건`,
      '',
      ...result.candidates.map((c) =>
        `  [id=${c.row.id}] (${c.row.published_at ?? '-'}) [${c.reason}/${c.basis}${c.deletable ? '' : '/후보만'}] ${c.row.title}`),
    ];
    fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  } catch (e) {
    console.warn(`[judge_cleanup] 로컬 리포트 저장 실패(무시): ${(e as Error).message}`);
  }

  const incidentN = result.candidates.filter((c) => c.judged.isIncident === true).length;
  console.log('\n================ 결과 ================');
  console.log(`모드: ${result.mode}`);
  console.log(`재심사: ${result.reviewed}건 · 판정 실패(건너뜀): ${result.failedSkips}건`);
  console.log(`후보: ${result.candidates.length}건 (incident ${incidentN} + category_fit=false ${result.candidates.length - incidentN})`);
  console.log(`soft 삭제: ${result.softDeleted}건 · 하드 삭제: ${result.hardDeleted}건`);
  console.log('=====================================\n');

  await client.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ judge_cleanup 실패:', e);
    process.exit(1);
  });
}
