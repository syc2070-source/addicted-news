// backend/src/crawler/addictionFilter.ts
import * as fs from 'fs';
import * as path from 'path';

type LangKeys = { ko?: string[]; en?: string[] };
type KeywordFile = {
  strong?: LangKeys;
  negative?: LangKeys;
  ko?: string[];
  en?: string[];
};

type Loaded = { strong: string[]; negative: string[] };

let cached: Loaded | null = null;

function flattenLang(block?: LangKeys): string[] {
  if (!block) return [];
  return [...(block.ko || []), ...(block.en || [])].filter(Boolean);
}

function loadKeywords(): Loaded {
  if (cached) return cached;
  const p = path.join(__dirname, '../../data/addiction_keywords.json');
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as KeywordFile;
    if (raw.strong || raw.negative) {
      cached = {
        strong: flattenLang(raw.strong),
        negative: flattenLang(raw.negative),
      };
    } else {
      cached = {
        strong: [...(raw.ko || []), ...(raw.en || [])].filter(Boolean),
        negative: [],
      };
    }
  } catch {
    cached = { strong: ['중독', 'addiction'], negative: [] };
  }
  return cached;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 한글/공백 포함 구문: 부분문자열.
 * 영문 단일 토큰: 단어 경계(rehab ≠ rehabilitation, dui ≠ medium 등).
 */
function textHasKeyword(text: string, keyword: string): boolean {
  const key = (keyword || '').toLowerCase().trim();
  if (!key) return false;
  const hasNonAscii = /[^\u0000-\u007f]/.test(key);
  if (hasNonAscii || key.includes(' ')) {
    return text.includes(key);
  }
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(key)}(?:[^a-z0-9]|$)`, 'i');
  return re.test(text);
}

// ────────────────────────────────────────────────────────────
// v5.2 #1: 사건사고(교통사고·강력범죄) 단순 보도 제외
// "음주"·"만취"·"마약" 등 strong 키워드로 통과하지만 중독 이슈 보도가
// 아닌 단순 사건사고를, 제목의 사건묘사 패턴 AND NOT 정책·치료·예방·회복
// 맥락으로 판정해 걸러낸다. 정책 보도("음주운전 처벌 강화 법안" 등)는 통과.
// ────────────────────────────────────────────────────────────

// 사건 결과·행위를 나타내는 표현(주로 제목). 이것만으로는 판정하지 않고,
// 정책 맥락이 전혀 없을 때만 스킵한다.
const INCIDENT_PATTERNS: RegExp[] = [
  // 음주·만취 운전 사고/단속·범죄 처리
  /(음주운전|만취운전|음주 ?운전|만취).{0,12}(사망|숨(져|진|졌)|참변|중태|부상|다쳐|다친|치여|치인|덮쳐|들이받|추돌|역주행|뺑소니|사고|입건|구속|검거|적발|체포|기소|불구속|재판|징역|실형|벌금)/,
  /(사망|숨(져|진|졌)|참변|중태|부상|사고|뺑소니|추돌|역주행).{0,12}(음주운전|만취운전|음주 ?운전|만취)/,
  // 충돌 의성어·뺑소니 단독
  /쾅/, /뺑소니/, /들이받/, /역주행/,
  // v5.2+ 교통사고류 확장(음주·만취 문맥): 전복·통제·치사·추락·급발진·충돌사고
  /(음주운전|만취운전|음주 ?운전|만취).{0,16}(전복|급발진|추락|치사|충돌 ?사고|중앙선 ?침범|가드레일|가로수|전신주)/,
  /(전복|급발진|추락|치사|충돌 ?사고|중앙선 ?침범).{0,16}(음주운전|만취운전|음주 ?운전|만취)/,
  /(음주|만취).{0,20}(도로|차로|교량|대교) ?(통제|폐쇄)/,
  /(도로|차로|교량|대교) ?(통제|폐쇄).{0,24}(음주|만취)/,
  /(음주|만취).{0,16}(치어|치고).{0,10}(숨지|숨진|숨졌|사망|사상|중상)/,
  // 강력사건 표현
  /(시신|사체|주검).{0,10}(훼손|유기|발견|암매장)/,
  /(훼손|유기|암매장).{0,10}(시신|사체|주검)/,
  /(살해|살인|흉기|칼부림|암매장|사체유기|시신유기|토막)/,
  // 마약 등 투약·유통 단순 검거 보도(중독 치료·정책 맥락 없을 때)
  /(마약|필로폰|대마|향정).{0,14}(투약|유통|밀반입|밀수|판매).{0,14}(검거|적발|구속|입건|송치|기소|체포)/,
  // v5.2+ 밀수류: 밀반입·밀수·밀매 + 형사처리(양방향, 거리 완화)
  /(밀반입|밀수|밀매).{0,24}(징역|실형|집행유예|구속|검거|적발|송치|선고|붙잡|체포)/,
  /(징역|실형|집행유예|구속|검거|적발|송치|선고|붙잡|체포).{0,24}(밀반입|밀수|밀매)/,
  // v5.2+ 형사절차류: 개별 사건 판결·수사 보도(마약·음주 주체 + 사법 처리)
  /(마약|필로폰|펜타닐|헤로인|코카인|대마|향정|음주운전|만취운전).{0,22}(징역|실형|집행유예|벌금형|선고|구형|송치|기소|검찰에 ?넘|불구속|항소심|상고심|1심|2심|붙잡(혀|았|혔))/,
];

// 정책·제도·치료·예방·회복 맥락 — 하나라도 있으면 사건사고 스킵을 해제(통과)
const POLICY_CONTEXT_KEYWORDS: string[] = [
  // 정책·제도·입법
  '정책', '제도', '법안', '법률', '입법', '개정', '조례', '규제', '처벌 강화',
  '처벌강화', '재범 방지', '재범방지', '근절', '대책', '방지법', '단속 강화',
  '단속강화', '캠페인', '토론회', '세미나', '공청회', '간담회', '위원회',
  '국회', '정부', '지자체', '보건복지부', '식약처', '경찰청', '법무부',
  // 치료·예방·회복·재활
  '치료', '예방', '회복', '재활', '상담', '재활원', '치료공동체', '자조모임',
  '단주', '단약', '단도박', '금주', '금연', '중독관리', '중독예방', '회복지원',
  '프로그램', '지원센터', '실태', '연구', '조사', '통계', '보고서', '백서',
  // 영문
  'policy', 'legislation', 'regulation', 'prevention', 'treatment',
  'recovery', 'rehabilitation', 'awareness', 'reform',
];

// 명명 HTML 엔티티 → 문자 (자주 등장하는 것만)
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  lsquo: "'", rsquo: "'", sbquo: "'", ldquo: '"', rdquo: '"', bdquo: '"',
  hellip: '...', middot: '·', ndash: '-', mdash: '-', minus: '-',
  copy: '(c)', reg: '(r)', trade: '(tm)', deg: '°',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _m; }
    })
    .replace(/&#(\d+);/g, (_m, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return _m; }
    })
    .replace(/&([a-z][a-z0-9]*);/gi, (_m, name) => {
      const v = NAMED_ENTITIES[String(name).toLowerCase()];
      return v !== undefined ? v : _m;
    });
}

/**
 * 공용 정규화(단일 소스) — isIncidentReport 와 중복 핵심어 추출 양쪽 입구,
 * 크롤러 실시간 필터와 cleanup 스크립트가 동일하게 사용한다.
 * 처리: HTML 엔티티 디코드 → NFKC(전각→반각·호환문자 통일) →
 *       둥근/전각 따옴표 통일 → 특수 대시·말줄임 통일 → 연속공백 정리.
 * ※ 가타카나 장음(ー, U+30FC)은 하이픈으로 바꾸지 않음(일본어 훼손 방지).
 */
export function normalize(s: string): string {
  let x = s || '';
  x = decodeEntities(x);
  // NFKC: 전각 영숫자/기호 → 반각, 호환 문자 통일(… → ... 포함), 전각공백 → 공백
  try { x = x.normalize('NFKC'); } catch { /* noop */ }
  // 홑따옴표류 → '  (‘ ’ ‛ ʼ ′ ` ´ ＇)
  x = x.replace(/[‘’‛ʼ′`´＇]/g, "'");
  // 겹따옴표류 → "  (“ ” ‟ ″ 〝 〞 ＂)
  x = x.replace(/[“”‟″〝〞＂]/g, '"');
  // 특수 대시류 → -  (‐ ‑ ‒ – — ― − 및 전각 －). ー(U+30FC)는 제외.
  x = x.replace(/[‐‑‒–—―−－]/g, '-');
  // 말줄임 변형 → ...  (⋯, 그리고 혹시 남은 …)
  x = x.replace(/[…⋯]/g, '...');
  x = x.replace(/\s+/g, ' ').trim();
  return x;
}

/** @deprecated normalize() 로 통일 — 하위호환 별칭 */
export const normalizeForMatch = normalize;

/**
 * 단순 사건사고(교통사고·강력범죄) 보도인지 판정.
 * = 제목에 사건묘사 패턴이 있고 AND 제목에 정책·치료·예방·회복 맥락이 없음.
 *
 * 정책 맥락은 '제목' 기준으로만 판정한다(2번째 인자 body 는 하위호환용, 미사용):
 * 옛 DeepSeek 요약에는 '정책·예방·대책·실태' 등 논평성 단어가 섞여 있어,
 * 요약까지 정책 맥락으로 보면 실제 사건사고가 통과해 버린다(관측된 버그).
 * 실제 정책 보도는 제목에서 정책을 표방한다: "처벌 강화 법안", "정부 종합대책" 등.
 */
export function isIncidentReport(title: string, _body?: string): boolean {
  const t = normalize(title).toLowerCase();
  const hasIncident = INCIDENT_PATTERNS.some((re) => re.test(t));
  if (!hasIncident) return false;
  const hasPolicyContext = POLICY_CONTEXT_KEYWORDS.some((k) =>
    t.includes(k.toLowerCase()),
  );
  return !hasPolicyContext;
}

/**
 * 채택 = (strong >= 1) AND (negative == 0) AND (사건사고 아님)
 * 제목+본문, 한/영 함께 소문자 비교.
 */
export function matchesAddictionKeywords(title: string, body: string): boolean {
  const text = `${title || ''} ${body || ''}`.toLowerCase();
  if (!text.trim()) return false;
  const { strong, negative } = loadKeywords();
  const strongHit = strong.some((k) => textHasKeyword(text, k));
  if (!strongHit) return false;
  const negHit = negative.some((k) => textHasKeyword(text, k));
  if (negHit) return false;
  // v5.2 #1: 단순 사건사고(정책·치료 맥락 없는) 제외
  if (isIncidentReport(title, body)) return false;
  return true;
}
