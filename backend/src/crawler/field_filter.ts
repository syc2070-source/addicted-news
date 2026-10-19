// backend/src/crawler/field_filter.ts
// NEWS-Q2 ■1: 분야 핵심어 거름망. 낱말 목록·사건 패턴·정책 맥락은 분야 설정(field_profiles/*.json)에서 읽는다.
import { fieldProfile, flattenLang } from './field_profile';

/**
 * NEWS-Q8 ■1: 제외어 낱말 경계 설정(분야 설정 keywords.negative_boundary · 없으면 null = 옛 부분문자열).
 * NEWS-Q10 ■2: endings = 조사 뒤에 한 번 더 붙어도 경계로 치는 어미(입금에서는 · 다이어트에도).
 */
export type NegativeBoundary = { particles: string[]; anywhere: Set<string>; allowLong: string[]; endings?: string[] };

/** NEWS-Q10 ■2: 스팸 낱말 ∧ 제목 핵심어 → 관문으로(분야 설정 keywords.spam_gate). */
type SpamGate = { words: Set<string>; maxHits: number; unlessAny: string[] };

/** NEWS-Q9 ■1: 조건부 strong 핵심어 하나(분야 설정 keywords.strong_context). */
export type StrongContext = {
  skipAttached: string[];
  skipNextWord: string[];
  keepAttached: string[];
  keepNextWord: string[];
  leadAny: string[];
  leadChars: number;
};

type Loaded = {
  strong: string[];
  negative: string[];
  incident: RegExp[];
  policy: string[];
  boundary: NegativeBoundary | null;
  context: Map<string, StrongContext>;
  negContext: Map<string, string[]>;
  spamGate: SpamGate | null;
  adPenalty: string[];
};

function loadNegContext(raw: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.startsWith('_') || !v || typeof v !== 'object') continue;
    const keep = lowerList((v as Record<string, unknown>).keep_with_any);
    if (keep.length) out.set(k.toLowerCase().trim(), keep);
  }
  return out;
}

function loadContext(raw: unknown): Map<string, StrongContext> {
  const out = new Map<string, StrongContext>();
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.startsWith('_') || !v || typeof v !== 'object') continue;
    const c = v as Record<string, unknown>;
    out.set(k.toLowerCase().trim(), {
      skipAttached: lowerList(c.skip_attached),
      skipNextWord: lowerList(c.skip_next_word),
      keepAttached: lowerList(c.keep_attached),
      keepNextWord: lowerList(c.keep_next_word),
      leadAny: lowerList(c.lead_any),
      leadChars: Number(c.lead_chars) > 0 ? Number(c.lead_chars) : 300,
    });
  }
  return out;
}

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
          endings: lowerList(nb.endings),
        }
      : null,
    context: loadContext(p.keywords.strong_context),
    negContext: loadNegContext(p.keywords.negative_context),
    spamGate: p.keywords.spam_gate
      ? {
          words: new Set(lowerList(p.keywords.spam_gate.words)),
          maxHits: Number(p.keywords.spam_gate.max_hits) > 0 ? Number(p.keywords.spam_gate.max_hits) : 1,
          unlessAny: lowerList(p.keywords.spam_gate.unless_any),
        }
      : null,
    adPenalty: lowerList(p.keywords.ad_penalty),
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
 * NEWS-Q10 ■2: 조사 뒤에 어미(endings) 하나가 더 붙은 꼴(에서는 · 에도 · 까지도)도 경계.
 */
export function hasKoreanWordAt(text: string, key: string, particles: string[], endings: string[] = []): boolean {
  if (!key) return false;
  const endsHere = (s: string) => !isHangul(s.charAt(0)) || endings.some((e) => s.startsWith(e) && !isHangul(s.charAt(e.length)));
  let i = text.indexOf(key);
  while (i !== -1) {
    if (!isHangul(text.charAt(i - 1))) {
      const rest = text.slice(i + key.length);
      if (!isHangul(rest.charAt(0))) return true;
      if (particles.some((pt) => rest.startsWith(pt) && endsHere(rest.slice(pt.length)))) return true;
    }
    i = text.indexOf(key, i + 1);
  }
  return false;
}

/** 제외어 맞춤 — 경계 설정이 있으면 한글 제외어는 낱말 경계에서만(anywhere 는 부분문자열 그대로). 영문은 옛 규칙. */
function textHasNegative(text: string, keyword: string, boundary: NegativeBoundary | null): boolean {
  const key = (keyword || '').toLowerCase().trim();
  if (!boundary || !key || !/[가-힣]/.test(key) || boundary.anywhere.has(key)) return textHasKeyword(text, key);
  return hasKoreanWordAt(text, key, boundary.particles, boundary.endings);
}

/** 허용 긴 낱말을 공백으로 지운 글(제외어 맞춤 전용). */
function withoutAllowedLong(text: string, boundary: NegativeBoundary | null): string {
  if (!boundary || !boundary.allowLong.length) return text;
  return boundary.allowLong.reduce((t, w) => t.split(w).join(' '), text);
}

/**
 * NEWS-Q10 ■2: 제외어 판정. hit = 걸린 첫 제외어(동행 낱말이 있어 풀린 제외어는 뺌) ·
 * gate = 걸린 것이 모두 스팸 낱말이고 spam_gate 조건(개수 · 제목 핵심어 · 광고·도박 낱말 없음)을 채움 → 떨어뜨리지 않고 관문으로.
 */
export function negativeVerdict(title: string, body: string): { hit: string | null; gate: boolean } {
  const { negative, boundary, negContext, spamGate, adPenalty } = loadKeywords();
  const full = `${title || ''} ${body || ''}`.toLowerCase();
  const text = withoutAllowedLong(full, boundary);
  const hits = negative.filter((k) => {
    if (!textHasNegative(text, k, boundary)) return false;
    const keep = negContext.get(k.toLowerCase().trim());
    return !(keep && keep.some((w) => textHasKeyword(full, w)));
  });
  if (!hits.length) return { hit: null, gate: false };
  const gate =
    !!spamGate &&
    hits.length <= spamGate.maxHits &&
    hits.every((k) => spamGate.words.has(k.toLowerCase().trim())) &&
    strongHit(title, '') !== null &&
    !adPenalty.some((w) => full.includes(w)) &&
    !spamGate.unlessAny.some((w) => textHasKeyword(full, w));
  return { hit: hits[0], gate };
}

/** 이 글을 막는 제외어(없으면 null · 관문으로 보내는 스팸 낱말은 막지 않음) — 실측·시험용으로도 쓴다. */
export function negativeHit(title: string, body: string): string | null {
  const v = negativeVerdict(title, body);
  return v.gate ? null : v.hit;
}

/** 제목 + 본문 첫 문단(줄바꿈으로 가른 문단을 80자가 될 때까지 · 상한 chars). 스니펫처럼 줄바꿈이 없으면 앞 chars 자. */
function leadOf(title: string, body: string, chars: number): string {
  let lead = '';
  for (const para of (body || '').split('\n')) {
    lead = lead ? `${lead} ${para}` : para;
    if (lead.trim().length >= 80) break;
  }
  return `${title || ''} ${lead.slice(0, chars)}`.toLowerCase();
}

/** 낱말 머리에서 나오는가(앞이 한글 음절이 아님 · 「술」은 되고 「기술」은 아님). */
function hasWordStart(text: string, w: string): boolean {
  let i = text.indexOf(w);
  while (i !== -1) {
    if (!isHangul(text.charAt(i - 1))) return true;
    i = text.indexOf(w, i + 1);
  }
  return false;
}

/**
 * NEWS-Q9 ■1: 조건부 핵심어 — 안 세는 꼴(금주의 · 금주 이슈)을 뺀 자리가 하나라도 있고,
 * 제목·첫 문단에 맥락 낱말(술·알코올·음주·단주·절주)이 있을 때만 핵심어. 굳은 꼴(keep_*)은 맥락 없이도 핵심어.
 */
export function contextKeywordHit(title: string, body: string, key: string, c: StrongContext): boolean {
  const text = `${title || ''} ${body || ''}`.toLowerCase();
  let i = text.indexOf(key);
  let found = false;
  while (i !== -1) {
    const rest = text.slice(i + key.length);
    const next = /^\s/.test(rest) ? rest.slice(1) : rest;
    const skip = c.skipAttached.some((s) => rest.startsWith(s)) || c.skipNextWord.some((w) => next.startsWith(w));
    if (!skip) {
      // 뜻이 하나로 굳은 꼴(금주구역 · 금주령 · 금주를 · 금주 운동)은 맥락 낱말 없이도 센다
      if (c.keepAttached.some((s) => rest.startsWith(s)) || c.keepNextWord.some((w) => next.startsWith(w))) return true;
      found = true;
    }
    i = text.indexOf(key, i + 1);
  }
  if (!found) return false;
  if (!c.leadAny.length) return true;
  const lead = leadOf(title, body, c.leadChars);
  return c.leadAny.some((w) => hasWordStart(lead, w));
}

/** 이 글이 맞춘 strong 핵심어(없으면 null) — 조건부 핵심어는 contextKeywordHit 로. 실측·시험용으로도 쓴다. */
export function strongHit(title: string, body: string): string | null {
  const text = `${title || ''} ${body || ''}`.toLowerCase();
  if (!text.trim()) return null;
  const { strong, context } = loadKeywords();
  return (
    strong.find((k) => {
      if (!textHasKeyword(text, k)) return false;
      const c = context.get(k.toLowerCase().trim());
      return c ? contextKeywordHit(title, body, k.toLowerCase().trim(), c) : true;
    }) ?? null
  );
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
  if (strongHit(title, body) === null) return false;
  if (negativeHit(title, body) !== null) return false;
  // v5.2 #1: 단순 사건사고(정책·치료 맥락 없는) 제외
  // NEWS-Q2 ■6: allowIncident=true 면 통과시켜 DeepSeek 판정 뒤 보관(archive)으로 보낸다(tier 열 있을 때만).
  if (!opts.allowIncident && isIncidentReport(title, body)) return false;
  return true;
}

/** 분야 strong 핵심어가 하나라도 있는지(제외어·사건사고 무관). NEWS-Q2 ■6 보관(archive) 판정용. */
export function hasFieldKeyword(title: string, body: string): boolean {
  return strongHit(title, body) !== null;
}
