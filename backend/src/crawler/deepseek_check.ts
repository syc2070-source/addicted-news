// ============================================================
// deepseek_check.ts — DeepSeek 판정 호출 단독 진단(실키로 3건).
// 7/25 크론에서 "성공 0 / 실패 34" 로 판정이 전멸한 원인(호출 실패 vs 빈 응답 vs
// 파싱 실패)을 데스크탑에서 즉시 가려낸다. deepseek_summary 의 개선된 로깅이
// [deepseek] 태그로 status/code/빈응답 여부를 함께 찍는다.
//
// 실행 (backend/ 에서, .env 에 DEEPSEEK_API_KEY 있는 상태):
//   npx ts-node src/crawler/deepseek_check.ts
//   (모델 바꿔 확인: DEEPSEEK_MODEL=deepseek-v4-pro npx ts-node ...)
// ============================================================
import 'dotenv/config';
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

// --n 20 처럼 반복 횟수를 주면 SAMPLES 를 순환하며 N건 연속 판정 후 성공률을 낸다.
function repeatCount(): number {
  const i = process.argv.indexOf('--n');
  if (i >= 0 && process.argv[i + 1]) return Math.max(1, Number(process.argv[i + 1]) || 1);
  return 0;
}

async function runBatch(n: number) {
  console.log(`=== v4-flash 연속 판정 테스트 ${n}건 (model=${process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash(기본)'}) ===`);
  let judged = 0;
  const fails: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = SAMPLES[i % SAMPLES.length];
    const pack = await summarizeKoreanDeepSeek(s.title, s.content, { translate: false, category: s.category });
    const ok = !!pack && (pack.categoryFit !== undefined || pack.isIncident !== undefined);
    if (ok) judged++;
    else fails.push(`${i + 1}. ${s.title.slice(0, 24)} — ${pack ? '판정 필드 없음(파싱 실패)' : 'null(호출 실패)'}`);
    console.log(`  [${i + 1}/${n}] ${ok ? 'OK ' : 'FAIL'} ` +
      `is_incident=${pack?.isIncident} category_fit=${pack?.categoryFit} confidence=${pack?.confidence}`);
  }
  const rate = ((judged / n) * 100).toFixed(1);
  console.log(`\n=== 결과: 판정 성공 ${judged}/${n} (${rate}%) ===`);
  if (fails.length) { console.log('실패 목록:'); fails.forEach((f) => console.log('  - ' + f)); }
  console.log(`DeepSeek 호출 집계: 총 ${deepseekStats.calls}회 (성공 ${deepseekStats.ok} / 실패 ${deepseekStats.fail})`);
  console.log('※ 실패가 있으면 위 "[deepseek] JSON 추출 실패" 로그의 응답 원문으로 패턴을 확정하세요.');
}

async function main() {
  console.log('=== DeepSeek 판정 진단 ===');
  console.log(`DEEPSEEK_API_KEY: ${deepseekAvailable ? '있음' : '없음(설정 필요)'}`);
  console.log(`DEEPSEEK_MODEL: ${DEEPSEEK_MODEL}${process.env.DEEPSEEK_MODEL ? '' : ' (기본값)'}`);
  if (!deepseekAvailable) {
    console.error('\n[X] 키가 없어 진단 불가. backend/.env 의 DEEPSEEK_API_KEY 확인.');
    process.exit(1);
  }

  const n = repeatCount();
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
