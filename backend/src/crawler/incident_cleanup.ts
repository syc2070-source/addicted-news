// ============================================================
// incident_cleanup.ts — DB 잔존 사건사고 기사 + 강원랜드류 중복 정리
// ------------------------------------------------------------
// - 사건사고 판정은 crawler 의 isIncidentReport(단일 소스) 재사용.
// - 중복 판정은 newsCrawler v5.2 핵심어 Jaccard 로직을 그대로 반영.
// - 삭제 전 반드시 백업(JSON) → 그 후 DELETE. encyclopedia_terms 는 건드리지 않음(articles 만).
//
// 실행:
//   npx ts-node src/crawler/incident_cleanup.ts          # 삭제 실행(백업 후)
//   DRY_RUN=true npx ts-node src/crawler/incident_cleanup.ts   # 미리보기(삭제 안 함)
//
// 연결: DATABASE_URL 있으면 우선, 없으면 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME.
//   Supabase 등 원격은 자동으로 SSL(rejectUnauthorized:false) 적용(로컬은 미적용).
// ============================================================
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Client, ClientConfig } from 'pg';
import { isIncidentReport } from './addictionFilter';

const DRY_RUN = process.env.DRY_RUN === 'true';
const DEPLOY_DIR = path.join(__dirname, '../../../deploy');
const REPORT_PATH = path.join(DEPLOY_DIR, 'incident_cleanup_report.txt');
const BACKUP_PATH = path.join(DEPLOY_DIR, 'incident_backup.json');

// ---------- 중복 판정: newsCrawler v5.2 핵심어 로직 미러 ----------
function normalizeForDuplicateCheck(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/([a-z0-9])([가-힣])/g, '$1 $2')
    .replace(/([가-힣])([a-z0-9])/g, '$1 $2')
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const KO_PARTICLES = [
  '으로써', '으로서', '이라고', '라고', '으로', '로서', '로써', '에서', '에게', '에의',
  '까지', '부터', '조차', '마저', '처럼', '만큼', '보다', '이나', '이란', '라는', '이라는',
  '와의', '과의', '에는', '에도', '에만', '이라', '으론', '이든', '든지',
  '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '만', '로', '란', '및',
];
const KO_ENDINGS = [
  '한다는', '한다', '했다', '된다', '되다', '하며', '하고', '하는', '했던',
  '였다', '이다', '나선다', '나섰다', '나서', '시켰다', '시킨', '밝혔다', '내놨다',
];
function stripKoParticle(word: string): string {
  let w = word;
  for (const p of KO_PARTICLES) {
    if (w.length > p.length + 1 && w.endsWith(p) && /[가-힣]$/.test(w)) { w = w.slice(0, w.length - p.length); break; }
  }
  for (const e of KO_ENDINGS) {
    if (w.length > e.length + 1 && w.endsWith(e) && /[가-힣]$/.test(w)) { w = w.slice(0, w.length - e.length); break; }
  }
  return w;
}
const DUP_STOPWORDS = new Set([
  '에서', '으로', '이다', '하는', '있는', '되는', '위한', '대한', '통해', '관련',
  '오늘', '내일', '어제', '올해', '지난', '이번', '최근', '다시', '또한', '위해',
  '대해', '따라', '밝혀', '밝혀져', '전했다', '말했다', '나타났다', '드러났다',
  '종합', '단독', '속보', '기자', '뉴스', '보도', '영상', '사진', '인터뷰',
  '중독', '도박', '도박중독', '알코올', '마약', '상담', '지원', '예방', '강화',
  '도입', '서비스', '개시', '운영', '대책', '정책', '사업', '캠페인', '확대',
  '추진', '발표', '계획', '방안', '행사', '세미나', '토론회', '실태', '현황',
  '문제', '우려', '논란', '급증', '감소', '증가',
]);
function extractCoreKeywords(title: string): Set<string> {
  return new Set(
    normalizeForDuplicateCheck(title).split(' ').map(stripKoParticle)
      .filter((w) => w.length >= 2 && !DUP_STOPWORDS.has(w)),
  );
}
function titleSimilarity(a: string, b: string): number {
  const k1 = extractCoreKeywords(a), k2 = extractCoreKeywords(b);
  if (k1.size === 0 || k2.size === 0) return 0;
  let inter = 0;
  for (const k of k1) if (k2.has(k)) inter++;
  const union = k1.size + k2.size - inter;
  return union > 0 ? inter / union : 0;
}
// 대표 선정 순위: 전문 > 주요지 > 포털/지방지
function sourceTypeRank(t: string | null): number {
  switch (t) {
    case 'specialty': return 0;
    case 'world_press': return 1;
    case 'kr_press': return 1;
    case 'aggregator': return 2;
    default: return 3;
  }
}

type Row = {
  id: number; title: string; summary: string | null; source: string | null;
  source_type: string | null; image_url: string | null; published_at: string | null;
  created_at: string | Date | null;
};

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

async function main() {
  console.log(`\n=== incident_cleanup ${DRY_RUN ? '(DRY RUN — 삭제 안 함)' : '(APPLY — 백업 후 삭제)'} ===`);
  const client = new Client(buildClientConfig());
  await client.connect();
  console.log('✅ DB 연결');

  const { rows } = await client.query<Row>(
    `SELECT id, title, summary, source, source_type, image_url,
            published_at, created_at
       FROM articles`,
  );
  console.log(`전체 기사: ${rows.length}건`);

  // 1) 사건사고 판정 (제목+요약)
  const incident: Row[] = [];
  const incidentIds = new Set<number>();
  for (const r of rows) {
    if (isIncidentReport(r.title || '', r.summary || '')) {
      incident.push(r);
      incidentIds.add(r.id);
    }
  }

  // 2) 강원랜드류 중복 (사건사고로 이미 지울 것 제외한 나머지에서 클러스터링)
  const survivors = rows.filter((r) => !incidentIds.has(r.id));
  const dupDelete: Row[] = [];
  const dupIds = new Set<number>();
  const clusters: Row[][] = [];
  for (const r of survivors) {
    if (dupIds.has(r.id)) continue;
    let placed = false;
    for (const cl of clusters) {
      if (titleSimilarity(cl[0].title || '', r.title || '') >= 0.5) { cl.push(r); placed = true; break; }
    }
    if (!placed) clusters.push([r]);
  }
  const dupGroupsForReport: { keep: Row; drop: Row[] }[] = [];
  for (const cl of clusters) {
    if (cl.length < 2) continue;
    // 대표 선정: sourceType 우선 → 이미지 보유 → id 작은 것
    const sorted = [...cl].sort((a, b) => {
      const r = sourceTypeRank(a.source_type) - sourceTypeRank(b.source_type);
      if (r !== 0) return r;
      const ai = a.image_url ? 0 : 1, bi = b.image_url ? 0 : 1;
      if (ai !== bi) return ai - bi;
      return a.id - b.id;
    });
    const keep = sorted[0];
    const drop = sorted.slice(1);
    dupGroupsForReport.push({ keep, drop });
    for (const d of drop) { dupDelete.push(d); dupIds.add(d.id); }
  }

  const toDelete = [...incident, ...dupDelete];
  const toDeleteIds = toDelete.map((r) => r.id);

  // 3) 리포트 저장
  if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  const lines: string[] = [];
  lines.push(`# incident_cleanup report  (mode: ${DRY_RUN ? 'DRY_RUN' : 'APPLY'})`);
  lines.push(`# 전체 ${rows.length}건 중 삭제 대상 ${toDelete.length}건 (사건사고 ${incident.length} + 중복 ${dupDelete.length})`);
  lines.push('');
  lines.push(`## 사건사고 (${incident.length}건)`);
  for (const r of incident) {
    lines.push(`  [id=${r.id}] (${r.published_at ?? '-'}) ${r.title}`);
  }
  lines.push('');
  lines.push(`## 강원랜드류 중복 그룹 (${dupGroupsForReport.length}그룹, 삭제 ${dupDelete.length}건)`);
  for (const g of dupGroupsForReport) {
    lines.push(`  KEEP  [id=${g.keep.id}] (${g.keep.source_type ?? '-'}) ${g.keep.title}`);
    for (const d of g.drop) lines.push(`  DROP  [id=${d.id}] (${d.source_type ?? '-'}) ${d.title}`);
    lines.push('');
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  console.log(`📄 리포트: ${REPORT_PATH}`);

  // 4) 백업(삭제 대상 전체 행) — 복구 가능하게 전체 컬럼 저장
  let backupRows: any[] = [];
  if (toDeleteIds.length > 0) {
    const res = await client.query(`SELECT * FROM articles WHERE id = ANY($1::int[])`, [toDeleteIds]);
    backupRows = res.rows;
  }
  fs.writeFileSync(BACKUP_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: DRY_RUN ? 'DRY_RUN' : 'APPLY',
    incidentIds: incident.map((r) => r.id),
    dupIds: dupDelete.map((r) => r.id),
    rows: backupRows,
  }, null, 2), 'utf8');
  console.log(`💾 백업: ${BACKUP_PATH} (${backupRows.length}행)`);

  // 5) 삭제 실행(articles 만). DRY_RUN 이면 건너뜀.
  let deleted = 0;
  if (!DRY_RUN && toDeleteIds.length > 0) {
    const del = await client.query(`DELETE FROM articles WHERE id = ANY($1::int[])`, [toDeleteIds]);
    deleted = del.rowCount ?? 0;
    console.log(`🗑️  삭제 완료: ${deleted}건`);
  } else if (DRY_RUN) {
    console.log(`(DRY_RUN) 삭제 예정 ${toDeleteIds.length}건 — 실제 삭제 안 함`);
  }

  // 6) 남은 수 + 확인 LIKE 검색
  const { rows: cntRows } = await client.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM articles`);
  const remaining = Number(cntRows[0]?.c ?? 0);
  const checkTitles = ['%리어카%', '%반포대교%', '%밀반입%'];
  const checks: Record<string, number> = {};
  for (const patt of checkTitles) {
    const { rows: cr } = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM articles WHERE title LIKE $1`, [patt],
    );
    checks[patt] = Number(cr[0]?.c ?? 0);
  }

  console.log('\n================ 결과 ================');
  console.log(`삭제: 사건사고 ${incident.length} + 중복 ${dupDelete.length} = ${toDelete.length}건${DRY_RUN ? ' (예정)' : ''}`);
  console.log(`남은 총 기사: ${remaining}건`);
  console.log('확인용 LIKE 잔존 수:', checks);
  console.log('=====================================\n');

  await client.end();
}

main().catch((e) => {
  console.error('❌ incident_cleanup 실패:', e);
  process.exit(1);
});
