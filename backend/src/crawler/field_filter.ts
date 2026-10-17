// backend/src/crawler/field_filter.ts
// NEWS-Q2 ■1: 분야 핵심어 거름망. 낱말 목록·사건 패턴·정책 맥락은 분야 설정(field_profiles/*.json)에서 읽는다.
import { fieldProfile, flattenLang } from './field_profile';

/** NEWS-Q8 ■1: 제외어 낱말 경계 설정(분야 설정 keywords.negative_boundary · 없으면 null = 옛 부분문자열). */
export type NegativeBoundary = { particles: string[]; anywhere: Set<string>; allowLong: string[] };

type Loaded = { strong: string[]; negative: string[]; incident: RegExp[]; policy: string[]; boundary: NegativeBoundary | null };

let cached: { field: string; data: Loaded } | null = null;

function lowerList(xs: unknown): string[] {
  return Array.isArray(xs) ? xs.map((x) => String(x || '').toLowerCase().trim()).filter(Boolean) : [];
}

function loadKeywords(): Loaded {
  const p = fieldProfile();
  if (cached && cached.field === p.field) return cached.data;
  const nb = p.keywords.negative_boundary;
  const data: Loaded = {
    strong: flattenLang(p.keywords.strong),
    negative: flattenLang(p.keywords.negative),
    incident: p.keywords.incident_patterns.map((s) => new RegExp(s)),
    policy: p.keywords.policy_context,
    boundary: nb
      ? {
          // 긴 조사(에서·으로)를 먼저 맞춘다
          particles: lowerList(nb.particles).sort((a, b) => b.length - a.length),
          anywhere: new Set(lowerList(nb.anywhere)),
          allowLong: lowerList(nb.allow_long),
        }
      : null,
  };
  cached = { field: p.field, data };
  return data;
}

/** 시험용: 분야 설정을 바꿔 끼운 뒤 기억한 낱말을 비운다. */
export function resetFieldFilterCache(): void {
  cached = null;
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

const HANGUL_SYLLABLE = /[가-힣]/;

function isHangul(ch: string): boolean {
  return !!ch && HANGUL_SYLLABLE.test(ch);
}

/**
 * NEWS-Q8 ■1: 한글 낱말이 경계에서 나오는가.
 * 앞 = 문장 시작 또는 한글 음절이 아닌 글자(공백·문장부호·숫자·영문) ·
 * 뒤 = 끝 · 한글 음절이 아닌 글자 · 또는 조사 하나(그 뒤가 다시 한글 음절이 아닐 때).
 */
export function hasKoreanWordAt(text: string, key: string, particles: string[]): boolean {
  if (!key) return false;
  let i = text.indexOf(key);
  while (i !== -1) {
    if (!isHangul(text.charAt(i - 1))) {
      const rest = text.slice(i + key.length);
      if (!isHangul(rest.charAt(0))) return true;
      if (particles.some((pt) => rest.startsWith(pt) && !isHangul(rest.charAt(pt.length)))) return true;
    }
    i = text.indexOf(key, i + 1);
  }
  return false;
}

/** 제외어 맞춤 — 경계 설정이 있으면 한글 제외어는 낱말 경계에서만(anywhere 는 부분문자열 그대로). 영문은 옛 규칙. */
function textHasNegative(text: string, keyword: string, boundary: NegativeBoundary | null): boolean {
  const key = (keyword || '').toLowerCase().trim();
  if (!boundary || !key || !/[가-힣]/.test(key) || boundary.anywhere.has(key)) return textHasKeyword(text, key);
  return hasKoreanWordAt(text, key, boundary.particles);
}

/** 허용 긴 낱말을 공백으로 지운 글(제외어 맞춤 전용). */
function withoutAllowedLong(text: string, boundary: NegativeBoundary | null): string {
  if (!boundary || !boundary.allowLong.length) return text;
  return boundary.allowLong.reduce((t, w) => t.split(w).join(' '), text);
}

/** 이 글을 막는 제외어(없으면 null) — 실측·시험용으로도 쓴다. */
export function negativeHit(title: string, body: string): string | null {
  const { negative, boundary } = loadKeywords();
  const text = withoutAllowedLong(`${title || ''} ${body || ''}`.toLowerCase(), boundary);
  return negative.find((k) => textHasNegative(text, k, boundary)) ?? null;
}

// ────────────────────────────────────────────────────────────
// v5.2 #1: 사건사고 단순 보도 제외 — 제목의 사건묘사 패턴(설정 keywords.incident_patterns)
// AND NOT 정책·치료·예방·회복 맥락(설정 keywords.policy_context). 정책 보도는 통과.
// ────────────────────────────────────────────────────────────

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
  const { incident, policy } = loadKeywords();
  const hasIncident = incident.some((re) => re.test(t));
  if (!hasIncident) return false;
  const hasPolicyContext = policy.some((k) =>
    t.includes(k.toLowerCase()),
  );
  return !hasPolicyContext;
}

/**
 * 채택 = (strong >= 1) AND (negative == 0) AND (사건사고 아님)
 * 제목+본문, 한/영 함께 소문자 비교.
 */
export function matchesFieldKeywords(title: string, body: string, opts: { allowIncident?: boolean } = {}): boolean {
  const text = `${title || ''} ${body || ''}`.toLowerCase();
  if (!text.trim()) return false;
  const { strong } = loadKeywords();
  const strongHit = strong.some((k) => textHasKeyword(text, k));
  if (!strongHit) return false;
  if (negativeHit(title, body) !== null) return false;
  // v5.2 #1: 단순 사건사고(정책·치료 맥락 없는) 제외
  // NEWS-Q2 ■6: allowIncident=true 면 통과시켜 DeepSeek 판정 뒤 보관(archive)으로 보낸다(tier 열 있을 때만).
  if (!opts.allowIncident && isIncidentReport(title, body)) return false;
  return true;
}

/** 분야 strong 핵심어가 하나라도 있는지(제외어·사건사고 무관). NEWS-Q2 ■6 보관(archive) 판정용. */
export function hasFieldKeyword(title: string, body: string): boolean {
  const text = `${title || ''} ${body || ''}`.toLowerCase();
  if (!text.trim()) return false;
  return loadKeywords().strong.some((k) => textHasKeyword(text, k));
}
