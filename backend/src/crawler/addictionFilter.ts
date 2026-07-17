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
  // 강력사건 표현
  /(시신|사체|주검).{0,10}(훼손|유기|발견|암매장)/,
  /(훼손|유기|암매장).{0,10}(시신|사체|주검)/,
  /(살해|살인|흉기|칼부림|암매장|사체유기|시신유기|토막)/,
  // 마약 등 투약·유통 단순 검거 보도(중독 치료·정책 맥락 없을 때)
  /(마약|필로폰|대마|향정).{0,14}(투약|유통|밀반입|밀수|판매).{0,14}(검거|적발|구속|입건|송치|기소|체포)/,
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

/**
 * 단순 사건사고(교통사고·강력범죄) 보도인지 판정.
 * = 제목에 사건묘사 패턴이 있고 AND 제목+본문에 정책·치료·예방·회복 맥락이 전혀 없음.
 */
export function isIncidentReport(title: string, body: string): boolean {
  const t = (title || '').toLowerCase();
  const full = `${title || ''} ${body || ''}`.toLowerCase();
  const hasIncident = INCIDENT_PATTERNS.some((re) => re.test(t));
  if (!hasIncident) return false;
  const hasPolicyContext = POLICY_CONTEXT_KEYWORDS.some((k) =>
    full.includes(k.toLowerCase()),
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
