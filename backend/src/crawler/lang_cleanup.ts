// ============================================================
// lang_cleanup.ts (LANG-GUARD-1 작업2) — 비한국어 산출물 기사 청소.
//
// 대상: articles 의 title/summary 가 한국어가 아닌 기사(lang_output.isKoreanOutput 판별).
//       원문 언어가 무엇이든 상관없다. 차단 대상은 "산출물이 한국어가 아닌 것"이지
//       "원문이 중국어인 매체"가 아니다(SCMP 영문 기사는 정상 자산 — 손대지 않는다).
//
// 안전장치:
//   · --apply 없으면 무조건 DRY-RUN (cli_flags.isApply 재사용).
//   · DRY 출력에 대상 전체 목록(id, 제목, 매체, 날짜) 표시.
//   · 삭제분은 judge_backup 과 같은 방식으로 전량 백업(파일 이어붙이기).
//   · ★ 이 스크립트는 로컬 데스크탑에서만 실행한다. 크론 등록 금지.
//     (Render 크론 컨테이너는 휘발성이라 백업 파일이 남지 않는다 — R1)
//
// 실행:
//   npx ts-node src/crawler/lang_cleanup.ts            # DRY-RUN(목록만)
//   npx ts-node src/crawler/lang_cleanup.ts --apply    # 오너 확인 후 실제 삭제
// ============================================================
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Client, ClientConfig } from 'pg';
import { isKoreanOutput, describeLangCheck, KO_MIN, HANJA_MAX } from './lang_output';
import { isApply, modeLabel } from './cli_flags';

const DRY_RUN = !isApply();
const DEPLOY_DIR = path.join(__dirname, '../../../deploy');
const BACKUP_PATH = path.join(DEPLOY_DIR, 'lang_backup.json');
const REPORT_PATH = path.join(DEPLOY_DIR, 'lang_cleanup_report.txt');

function buildClientConfig(): ClientConfig {
  const url = process.env.DATABASE_URL?.trim();
  const host = process.env.DB_HOST || 'localhost';
  const isLocal = /^(localhost|127\.0\.0\.1|::1)$/.test(host) ||
    (url ? /@(localhost|127\.0\.0\.1)/.test(url) : false);
  const ssl = process.env.DB_SSL === 'false' || isLocal ? undefined : { rejectUnauthorized: false };
  if (url) return { connectionString: url, ssl };
  return {
    host, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''), database: process.env.DB_NAME || 'addiction_news', ssl,
  };
}

type Row = {
  id: number; title: string; summary: string | null; source: string | null;
  published_at: string | null; lang: string | null; is_foreign: boolean | null;
};

async function main() {
  console.log(`\n=== lang_cleanup (${modeLabel()}) | 임계 KO_MIN=${KO_MIN} HANJA_MAX=${HANJA_MAX} ===`);
  const client = new Client(buildClientConfig());
  await client.connect();
  console.log('✅ DB 연결');

  const { rows: totalRow } = await client.query<{ c: string }>(`SELECT COUNT(*)::text c FROM articles`);
  const totalBefore = Number(totalRow[0]?.c ?? 0);

  // 전수 스캔(판별은 코드에서 — SQL 정규식으로 근사하지 않는다)
  const { rows } = await client.query<Row>(
    `SELECT id, title, summary, source, published_at::text AS published_at, lang, is_foreign
       FROM articles ORDER BY id DESC`,
  );
  console.log(`전체 ${totalBefore}건 스캔\n`);

  const targets: Array<Row & { why: string }> = [];
  for (const r of rows) {
    const check = isKoreanOutput(r.title || '', r.summary || '');
    if (!check.ok) targets.push({ ...r, why: describeLangCheck(check) });
  }

  console.log(`대상(비한국어 산출물) ${targets.length}건`);
  const lines: string[] = [];
  lines.push(`# lang_cleanup report (${modeLabel()}) 임계 KO_MIN=${KO_MIN} HANJA_MAX=${HANJA_MAX}`);
  lines.push(`# 전체 ${totalBefore}건 중 대상 ${targets.length}건`);
  lines.push('');
  for (const t of targets) {
    const line = `  [id=${t.id}] (${t.published_at ?? '-'}) [${t.source ?? '-'}] lang=${t.lang ?? '-'} ` +
      `${t.why}\n      ${String(t.title).slice(0, 60)}`;
    console.log(line);
    lines.push(line);
  }
  if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  console.log(`\n📄 리포트: ${REPORT_PATH}`);

  const ids = targets.map((t) => t.id);

  // 백업(삭제 전 전량, 이어붙이기)
  if (ids.length > 0) {
    const res = await client.query(`SELECT * FROM articles WHERE id = ANY($1::int[])`, [ids]);
    let backupLog: unknown[] = [];
    if (fs.existsSync(BACKUP_PATH)) {
      try {
        const prev = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
        if (Array.isArray(prev)) backupLog = prev; else if (prev) backupLog = [prev];
      } catch { backupLog = []; }
    }
    backupLog.push({
      generatedAt: new Date().toISOString(),
      mode: DRY_RUN ? 'DRY_RUN' : 'APPLY',
      thresholds: { KO_MIN, HANJA_MAX },
      ids, rows: res.rows,
    });
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(backupLog, null, 2), 'utf8');
    console.log(`💾 백업(누적 ${backupLog.length}회): ${BACKUP_PATH} (이번 ${res.rows.length}행)`);
  }

  let deleted = 0;
  if (!DRY_RUN && ids.length > 0) {
    const del = await client.query(`DELETE FROM articles WHERE id = ANY($1::int[])`, [ids]);
    deleted = del.rowCount ?? 0;
    console.log(`🗑️  삭제 완료: ${deleted}건`);
  } else if (DRY_RUN) {
    console.log(`\n(DRY_RUN) 삭제 예정 ${ids.length}건 — 실제 삭제 안 함.`);
    console.log('  오너가 위 목록을 확인한 뒤 --apply 로 실행하세요.');
  }

  const { rows: afterRow } = await client.query<{ c: string }>(`SELECT COUNT(*)::text c FROM articles`);
  console.log('\n================ 결과 ================');
  console.log(`스캔: ${rows.length}건 / 대상: ${targets.length}건${DRY_RUN ? ' (예정)' : `, 삭제 ${deleted}건`}`);
  console.log(`남은 총 기사: ${Number(afterRow[0]?.c ?? 0)}건`);
  console.log('=====================================\n');

  await client.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ lang_cleanup 실패:', e);
    process.exit(1);
  });
}
