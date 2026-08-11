import * as fs from 'fs';
import * as path from 'path';
import { isKoreanOutput, isKoreanText, langRatio, KO_MIN, HANJA_MAX } from './lang_output';

// LANG-GUARD-1 작업3-1: 판별 함수 회귀 박제(최소 4계열)
const KO_SUMMARY =
  '보건복지부는 청소년 도박중독 예방을 위해 전국 중·고등학교에 예방 교육을 확대한다고 밝혔다. ' +
  '올해 시범사업 결과를 바탕으로 프로그램을 표준화하고 상담 연계를 강화한다는 계획이다.';

describe('(a) 정상 한국어 산출물 → 통과', () => {
  it('한국어 제목 + 한국어 요약', () => {
    expect(isKoreanOutput('청소년 도박중독 예방 교육 전국 확대', KO_SUMMARY).ok).toBe(true);
  });
  it('백과체 한국어 문장', () => {
    expect(isKoreanText('중독은 통제력을 잃고 반복하게 되는 상태를 말한다.').ok).toBe(true);
  });
});

describe('(b) F1 실제 중국어 2건 → 불합격', () => {
  const CN1 = '香港应随着移动游戏成瘾问题出现而监管开箱吗？';
  const CN2 = '成瘾康复护理公司同意支付1620万美元的医疗补助欺诈判决';
  it('중국어 제목 ① (SCMP)', () => {
    const r = isKoreanOutput(CN1, KO_SUMMARY);
    expect(r.ok).toBe(false);
    expect(r.field).toBe('title');
    expect(r.reason).toBe('hanja_dominant');
  });
  it('중국어 제목 ② (Addiction Recovery eBulletin)', () => {
    expect(isKoreanOutput(CN2, KO_SUMMARY).ok).toBe(false);
  });
  it('제목은 한국어인데 요약이 중국어여도 불합격(필드별 검사)', () => {
    const r = isKoreanOutput('중독 회복 기업 합의금 지급', CN2);
    expect(r.ok).toBe(false);
    expect(r.field).toBe('summary');
  });
});

describe('(c) 영어 전문 → 불합격', () => {
  it('영어 제목', () => {
    const r = isKoreanOutput(
      'Hong Kong should regulate loot boxes as mobile gaming addiction emerges',
      KO_SUMMARY,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('low_korean');
  });
  it('영어 요약', () => {
    expect(isKoreanText('The ministry said it would expand prevention programs nationwide.').ok).toBe(false);
  });
  it('일본어도 불합격', () => {
    expect(isKoreanText('ゲーム依存症の治療プログラムが拡大している').ok).toBe(false);
  });
});

describe('(d) 한국어 + 라틴 혼합(기관명·수치) → 통과', () => {
  const cases = [
    'WHO, ICD-11 게임이용장애 등재',
    'DSM-5-TR 기준 개정…중독 진단 변화',
    'AA·NA·GA 자조모임 전국 확대',
    'GLP-1 계열 약물, 알코올 갈망 감소 연구',
    '보건복지부, 2026년 중독예방 예산 1620억원 편성',
    'SBIRT 1차의료 시범사업 확대',
  ];
  for (const t of cases) {
    it(`통과: ${t}`, () => {
      expect(isKoreanText(t).ok).toBe(true);
    });
  }
});

describe('임계값이 측정 분포 바깥에 있는가(근거 고정)', () => {
  it('정상 한국어 최저 사례의 한글비율 > KO_MIN', () => {
    // 측정된 최악(라틴 최다) 정상 사례 = 0.444
    const worst = langRatio('WHO, ICD-11 게임이용장애 등재');
    expect(worst.ko).toBeGreaterThan(KO_MIN);
  });
  it('비한국어 대조군의 한글비율은 0', () => {
    for (const t of ['香港应随着移动游戏成瘾问题出现而监管开箱吗？', 'Hong Kong should regulate loot boxes']) {
      expect(langRatio(t).ko).toBe(0);
    }
  });
  it('한국어 표본의 한자비율 < HANJA_MAX', () => {
    expect(langRatio(KO_SUMMARY).hanja).toBeLessThan(HANJA_MAX);
  });
  it('짧은 문자열은 한글 유무로 판정(비율 불안정 구간)', () => {
    expect(isKoreanText('중독').ok).toBe(true);
    expect(isKoreanText('成瘾').ok).toBe(false);
  });
});

// 작업3-2: 저장 직전 가드가 실제로 배선되어 있는지(스모크)
describe('가드 배선 스모크', () => {
  const src = fs.readFileSync(path.join(__dirname, 'newsCrawler.ts'), 'utf8');
  it('newsCrawler 가 lang_output 을 import 한다', () => {
    expect(src).toMatch(/from '\.\/lang_output'/);
  });
  it('저장 push 이전에 isKoreanOutput 검사가 있다', () => {
    const guardIdx = src.indexOf('isKoreanOutput(finalTitle, finalSummary)');
    const pushIdx = src.indexOf('out.push({');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(guardIdx);   // 가드가 저장보다 앞
  });
  it('불합격 시 non_korean_output 으로 격리한다(폴백 저장 아님)', () => {
    expect(src).toMatch(/rejectReason: 'non_korean_output'/);
  });
  it('재생성은 forceKorean 옵션으로 기존 요약 호출을 재사용한다(새 호출 유형 없음)', () => {
    expect(src).toMatch(/forceKorean: true/);
  });
});
