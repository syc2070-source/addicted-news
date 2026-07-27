// ============================================================
// deepseek_check.ts — DeepSeek 판정 호출 단독 진단(실키로 3건).
// 7/25 크론에서 "성공 0 / 실패 34" 로 판정이 전멸한 원인(호출 실패 vs 빈 응답 vs
// 파싱 실패)을 데스크탑에서 즉시 가려낸다. deepseek_summary 의 개선된 로깅이
// [deepseek] 태그로 status/code/빈응답 여부를 함께 찍는다.
//
// 실행 (backend/ 에서, .env 에 DEEPSEEK_API_KEY 있는 상태):
//   npx ts-node src/crawler/deepseek_check.ts              # 내장 샘플 3건
//   npx ts-node src/crawler/deepseek_check.ts --batch 20              # 판정 측정(성공률·누락·절단)
//   npx ts-node src/crawler/deepseek_check.ts --batch 20 --repeat 2   # + 반복 판정 불일치(뒤집힘)
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

/** --repeat N (기본 1). 같은 집합을 N회 판정해 불일치(뒤집힘)를 센다. */
function repeatCount(): number {
  const i = process.argv.indexOf('--repeat');
  if (i >= 0 && process.argv[i + 1]) return Math.max(1, Number(process.argv[i + 1]) || 1);
  return 1;
}

type Verdict = { fit?: boolean; incident?: boolean; conf?: string };

/**
 * 실제 DB 기사 N건 판정 측정(작업 3).
 *  (a) 판정 성공률 = 세 필드가 전부 존재한 비율  ← 정의 변경(기존 '하나라도 존재')
 *  (b) 필드별 누락 건수
 *  (c) finish_reason=length 건수  ← [deepseek] 절단 경고를 가로채 집계
 *  --repeat 2 시: 회차 간 판정 뒤집힘(불일치) 건수
 */
async function runBatch(n: number) {
  const reps = repeatCount();
  console.log(`=== 실제 DB 기사 ${n}건 판정 측정 (model=${DEEPSEEK_MODEL}, 반복 ${reps}회) ===`);
  const client = new Client(buildClientConfig());
  await client.connect();
  const { rows } = await client.query<Row>(
    `SELECT id, title, summary, category FROM articles ORDER BY id DESC LIMIT $1`, [n],
  );
  await client.end();
  if (!rows.length) { console.log('대상 기사가 없습니다(articles 비어 있음).'); return; }
  console.log(`DB에서 ${rows.length}건 로드(최근 id 순)\n`);

  // (c) 절단 건수: console.warn 의 '절단' 경고를 가로채 집계
  let lengthCount = 0;
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const s = args.map(String).join(' ');
    if (s.includes('finish_reason=length') || s.includes('응답 절단')) lengthCount++;
    origWarn(...(args as []));
  };

  const perRun: Array<Map<number, Verdict>> = [];
  const missing = { fit: 0, incident: 0, conf: 0 };
  let complete = 0, total = 0;
  const fails: string[] = [];

  for (let run = 1; run <= reps; run++) {
    const verdicts = new Map<number, Verdict>();
    console.log(`--- ${run}회차 ---`);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const content = (r.summary && r.summary.trim()) || r.title || '';
      const pack = await summarizeKoreanDeepSeek(r.title || '', content, {
        translate: false, category: r.category || '미지정',
      });
      total++;
      const v: Verdict = { fit: pack?.categoryFit, incident: pack?.isIncident, conf: pack?.confidence };
      verdicts.set(r.id, v);
      const full = v.fit !== undefined && v.incident !== undefined && v.conf !== undefined;
      if (full) complete++;
      else {
        if (v.fit === undefined) missing.fit++;
        if (v.incident === undefined) missing.incident++;
        if (v.conf === undefined) missing.conf++;
        fails.push(`run${run} id=${r.id} ${String(r.title).slice(0, 28)} — fit=${v.fit} incident=${v.incident} conf=${v.conf}`);
      }
      console.log(`  [${i + 1}/${rows.length}] ${full ? 'FULL' : 'MISS'} id=${r.id} ` +
        `fit=${v.fit} incident=${v.incident} conf=${v.conf}`);
    }
    perRun.push(verdicts);
  }
  console.warn = origWarn;

  // 집계
  const rate = ((complete / total) * 100).toFixed(1);
  console.log(`\n================ 측정 결과 ================`);
  console.log(`(a) 판정 성공률(세 필드 전부): ${complete}/${total} (${rate}%)   [합격 ≥95%]`);
  console.log(`(b) 필드 누락: category_fit ${missing.fit} / is_incident ${missing.incident} / confidence ${missing.conf}`);
  console.log(`(c) finish_reason=length: ${lengthCount}건   [합격 0건]`);

  let flips = 0;
  if (reps >= 2) {
    const flipList: string[] = [];
    for (const r of rows) {
      const vs = perRun.map((m) => m.get(r.id)!);
      const base = vs[0];
      for (let k = 1; k < vs.length; k++) {
        const v = vs[k];
        if (base.fit !== v.fit || base.incident !== v.incident) {
          flips++;
          flipList.push(`id=${r.id} ${String(r.title).slice(0, 28)} — ` +
            `1회차 fit=${base.fit},incident=${base.incident} ↔ ${k + 1}회차 fit=${v.fit},incident=${v.incident}`);
          break;
        }
      }
    }
    console.log(`(d) 반복 판정 불일치(뒤집힘): ${flips}/${rows.length}건   [합격 0건]`);
    if (flipList.length) { console.log('  뒤집힌 기사:'); flipList.forEach((f) => console.log('   - ' + f)); }
  }

  console.log(`DeepSeek 호출: 총 ${deepseekStats.calls}회 (성공 ${deepseekStats.ok} / 실패 ${deepseekStats.fail})`);
  const pass = Number(rate) >= 95 && lengthCount === 0 && (reps < 2 || flips === 0);
  console.log(`\n판정: ${pass ? '✅ 합격' : '❌ 불합격'} (기준: 세 필드 ≥95% / 불일치 0 / length 0)`);
  console.log('==========================================');
  if (fails.length) { console.log('누락 상세:'); fails.slice(0, 20).forEach((f) => console.log('  - ' + f)); }
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
