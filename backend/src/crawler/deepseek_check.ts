// ============================================================
// deepseek_check.ts — DeepSeek 판정 호출 단독 진단(실키로 3건).
// 7/25 크론에서 "성공 0 / 실패 34" 로 판정이 전멸한 원인(호출 실패 vs 빈 응답 vs
// 파싱 실패)을 데스크탑에서 즉시 가려낸다. deepseek_summary 의 개선된 로깅이
// [deepseek] 태그로 status/code/빈응답 여부를 함께 찍는다.
//
// 실행 (backend/ 에서, .env 에 DEEPSEEK_API_KEY 있는 상태):
//   npx ts-node src/crawler/deepseek_check.ts              # 내장 샘플 3건
//   npx ts-node src/crawler/deepseek_check.ts --batch 20   # 실제 DB 기사 20건 판정 성공률
//   (모델 바꿔 확인: DEEPSEEK_MODEL=deepseek-v4-pro npx ts-node ... )
//   (응답 원문 전문 보기: DEEPSEEK_RAW_LOG=full npx ts-node ... )
// ============================================================
import 'dotenv/config';
import { Client, ClientConfig } from 'pg';
import { summarizeKoreanDeepSeek, deepseekAvailable, deepseekStats, DEEPSEEK_MODEL } from './deepseek_summary';

const SAMPLES: Array<{ label: string; title: string; content: string; category: string }> = [
  {
    label: '정책/이슈(유지 기대: category_fit=true, incident=false)',
    title: '정부, 청소년 도박중독 예방 교육 전국 확대 발표',
    content:
      '보건복지부는 청소년 도박중독 예방을 위해 전국 중·고등학교에 예방 교육을 확대한다고 밝혔다. ' +
      '올해 시범사업 결과를 바탕으로 프로그램을 표준화하고 상담 연계를 강화한다는 계획이다.',
    category: 'policy',
  },
  {
    label: '개별 사건(거부 기대: is_incident=true)',
    title: 'OO경찰서, 불법 도박장 운영 일당 9명 검거',
    content:
      'OO경찰서는 도심 오피스텔에서 불법 도박장을 운영한 혐의로 일당 9명을 검거해 조사 중이라고 밝혔다. ' +
      '경찰은 여죄를 추궁하고 있다.',
    category: 'society',
  },
  {
    label: '연구/통계(유지 기대: category_fit=true)',
    title: '알코올 사용장애 유병률 5년간 변화 연구 결과 공개',
    content:
      '국내 연구진이 지난 5년간 알코올 사용장애 유병률 변화를 분석한 결과를 학술지에 발표했다. ' +
      '연령대별 추이와 치료 접근성의 상관관계를 함께 제시했다.',
    category: 'mechanism',
  },
];

/** --batch N (또는 --n N) → N. 없으면 0. */
function batchCount(): number {
  for (const flag of ['--batch', '--n']) {
    const i = process.argv.indexOf(flag);
    if (i >= 0 && process.argv[i + 1]) return Math.max(1, Number(process.argv[i + 1]) || 1);
  }
  return 0;
}

// judge_cleanup 과 동일한 접속 규칙(DATABASE_URL 우선, 없으면 DB_*; 원격은 SSL).
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

type Row = { id: number; title: string; summary: string | null; category: string | null };

/** 실제 DB 기사 N건을 판정해 성공률을 낸다(판정 필드가 실제로 온 것만 성공). */
async function runBatch(n: number) {
  console.log(`=== 실제 DB 기사 ${n}건 판정 테스트 (model=${DEEPSEEK_MODEL}) ===`);
  const client = new Client(buildClientConfig());
  await client.connect();
  const { rows } = await client.query<Row>(
    `SELECT id, title, summary, category FROM articles ORDER BY id DESC LIMIT $1`, [n],
  );
  await client.end();
  if (!rows.length) { console.log('대상 기사가 없습니다(articles 비어 있음).'); return; }
  console.log(`DB에서 ${rows.length}건 로드(최근 id 순)\n`);

  let judged = 0;
  const fails: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const content = (r.summary && r.summary.trim()) || r.title || '';
    const pack = await summarizeKoreanDeepSeek(r.title || '', content, {
      translate: false, category: r.category || '미지정',
    });
    // 성공 = 판정 필드가 실제로 존재(요약만 온 것은 실패로 계산 — 게이트에서 거부되므로)
    const ok = !!pack && (pack.categoryFit !== undefined || pack.isIncident !== undefined);
    if (ok) judged++;
    else fails.push(`id=${r.id} ${String(r.title).slice(0, 30)} — ${pack ? '판정 필드 없음(서술형/파싱 실패)' : 'null(호출 실패)'}`);
    console.log(`  [${i + 1}/${rows.length}] ${ok ? 'OK  ' : 'FAIL'} id=${r.id} ` +
      `incident=${pack?.isIncident} fit=${pack?.categoryFit} conf=${pack?.confidence}`);
  }
  const rate = ((judged / rows.length) * 100).toFixed(1);
  console.log(`\n=== 판정 성공 ${judged}/${rows.length} (${rate}%) ===`);
  if (fails.length) { console.log('실패 목록:'); fails.forEach((f) => console.log('  - ' + f)); }
  console.log(`DeepSeek 호출 집계: 총 ${deepseekStats.calls}회 (성공 ${deepseekStats.ok} / 실패 ${deepseekStats.fail})`);
  if (fails.length) console.log('※ 위 "[deepseek] JSON 추출 실패" 로그의 응답 원문으로 잔여 패턴을 확인하세요.');
}

async function main() {
  console.log('=== DeepSeek 판정 진단 ===');
  console.log(`DEEPSEEK_API_KEY: ${deepseekAvailable ? '있음' : '없음(설정 필요)'}`);
  console.log(`DEEPSEEK_MODEL: ${DEEPSEEK_MODEL}${process.env.DEEPSEEK_MODEL ? '' : ' (기본값)'}`);
  if (!deepseekAvailable) {
    console.error('\n[X] 키가 없어 진단 불가. backend/.env 의 DEEPSEEK_API_KEY 확인.');
    process.exit(1);
  }

  const n = batchCount();
  if (n > 0) { await runBatch(n); return; }

  for (const s of SAMPLES) {
    console.log(`\n──── ${s.label} ────`);
    console.log(`제목: ${s.title}`);
    const pack = await summarizeKoreanDeepSeek(s.title, s.content, { translate: false, category: s.category });
    if (!pack) {
      console.log('결과: null (판정 실패) — 위 [deepseek] 로그의 status/code/빈응답 확인');
      continue;
    }
    console.log(`요약: ${pack.summary.slice(0, 80)}...`);
    console.log(`판정: is_incident=${pack.isIncident} category_fit=${pack.categoryFit} confidence=${pack.confidence}`);
    const judged = pack.categoryFit !== undefined || pack.isIncident !== undefined;
    console.log(`판정 필드 존재: ${judged ? 'O' : 'X (요약만 옴 → 게이트에서 judgment_missing 처리)'}`);
  }

  console.log('\n=== 집계 ===');
  console.log(`DeepSeek 호출: 총 ${deepseekStats.calls}회 (성공 ${deepseekStats.ok} / 실패 ${deepseekStats.fail})`);
  if (deepseekStats.ok === 0 && deepseekStats.calls > 0) {
    console.log('⛔ 성공 0 — 크론 장애와 동일 상태. 위 [deepseek] 로그로 원인(키·잔액402·한도429·모델·빈응답) 확정.');
  } else if (deepseekStats.ok > 0) {
    console.log('✅ 호출·판정 정상 동작. 크론 장애는 환경(키/모델/한도) 차이일 가능성 — 크론 env 점검.');
  }
}

main().catch((e) => {
  console.error('deepseek_check 실패:', e);
  process.exit(1);
});
