// ============================================================
// event_cluster.ts (NEWS-Q3 ■1) — 같은 사건을 다룬 기사 묶기(LLM 0 · 낱말 겹침만).
//  · 정규화: 제목 꼬리 매체명 · 괄호([속보]·(종합)·[서울25]) · 따옴표·구두점 · 숫자 꼴(1,000 → 1000 · 5만 원 → 5만원)
//    · 한글 조사·어미 제거 · 일반 불용어와 분야 상투어(설정 keywords.dup_stopwords) 뺌.
//  · 겹침(둘 중 하나면 같은 사건):
//      ① 제목 2-gram Jaccard ≥ 0.5 (한글 = 띄어쓰기 뺀 글자 2-gram · 라틴 = 낱말)
//      ② 핵심 명사 집합 겹침 |A∩B| / min(|A|,|B|) ≥ 0.6 — 제목 명사(겹친 것 2개+) 또는 제목+첫 문단 명사(3개+)
//         핵심 명사 = 길이 2+ 낱말 − 불용어 − 묶음 안 흔한 낱말(문서 빈도 > max(12, 10%))
//      ③ (NEWS-Q4 ■3) 고유명사 규칙: 제목+첫 문단의 기관명·인명(기관 접미 본부·위원회·청·처·부·원·협회·재단·병원·
//         대학교·센터·경찰서 등 · 「○○○ 의원/장관」 꼴 인명)이 서로 다른 것 둘 이상 같으면
//         제목 Jaccard 문턱 0.5 → 0.35, 또는 제목+첫 문단 2-gram Jaccard ≥ 0.25(실측 · 보고서 NEWS-Q4 ■3).
//  · 보도 시각 차 ±36시간 안에서만.
//  · 사슬 막기: 새 기사는 묶음의 (시간 창 안) 기사 절반 이상과 겹칠 때만 그 묶음에 든다.
//  · cluster_id = 묶음에서 가장 이른 보도의 id · 대표 = source_grade 높은 매체 → 같으면 이른 보도 → 작은 id.
// ============================================================
import type { SourceGrade } from './field_profile';

export const JACCARD_MIN = 0.5;
export const NOUN_OVERLAP_MIN = 0.6;
export const NOUN_OVERLAP_MIN_COUNT = 2;
export const NOUN_OVERLAP_MIN_COUNT_WITH_LEAD = 3;
export const JOIN_MIN_FRACTION = 0.34;
export const WINDOW_HOURS = 36;
/** 흔한 낱말 = 문서 빈도 > max(12, 10%) */
export const COMMON_MIN_DOCS = 12;
export const COMMON_DOC_RATIO = 0.1;
/** NEWS-Q4 ■3: 고유명사 규칙(끄려면 false — 오묶음이 생기면 끄고 사유를 보고서에) */
export const ENTITY_RULE_ON = true;
export const ENTITY_MIN_SHARED = 2;
export const ENTITY_JACCARD_MIN = 0.35;
export const ENTITY_PARA_JACCARD_MIN = 0.25;

/** 같은 사건으로 본 근거: ① 제목 Jaccard · ② 명사 겹침 · ③ 고유명사 규칙 */
export type ClusterRule = 'jaccard' | 'noun' | 'entity';

export const GRADE_ORDER: Record<string, number> = { institution: 0, academic: 1, press: 2, aggregator: 3 };
export function gradeRank(g: SourceGrade | string | null | undefined): number {
  return g && g in GRADE_ORDER ? GRADE_ORDER[g] : 4;
}

export interface ClusterDoc {
  id: number;
  title: string;
  /** 첫 문단(요약 첫 문장 · 피드 스니펫) — 없어도 됨 */
  lead?: string | null;
  /** 첫 문단(앞 두 문장 · 300자) — 고유명사 규칙용 · 없으면 lead */
  para?: string | null;
  /** 보도 시각(ms) */
  ts: number;
  grade?: SourceGrade | string | null;
  /** 원제(외국 기사는 원문 제목) — 있으면 제목과 함께 비교 */
  altTitle?: string | null;
}

export interface ClusterInfo {
  clusterId: string;
  size: number;
  representativeId: number;
  /** 보도 시각 순(이른 것 먼저) */
  memberIds: number[];
}

export interface ClusterOptions {
  /** 분야 상투어(설정 keywords.dup_stopwords) */
  fieldStopwords?: Iterable<string>;
  /** 첫 문단으로 쓰지 않을 문장(설정 prompts.fallback_summary_line 같은 대체 문구) */
  ignoreLeads?: Iterable<string>;
  windowHours?: number;
  /** 고유명사 규칙(기본 ENTITY_RULE_ON) */
  entityRule?: boolean;
}

// ---------- 정규화 ----------
const KO_PARTICLES = [
  '으로써', '으로서', '이라고', '이라는', '에서는', '에서도', '으로는', '라고', '으로', '로서', '로써', '에서', '에게',
  '까지', '부터', '조차', '마저', '처럼', '만큼', '보다', '이나', '이란', '라는', '와의', '과의', '에는', '에도', '에만',
  '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '만', '로', '서',
];
const KO_ENDINGS = [
  '한다는', '한다', '했다', '된다', '됐다', '하며', '하고', '하는', '했던', '하면', '였다', '이다',
  '나선다', '나섰다', '나서', '밝혔다', '연다', '열어', '돼',
];
// 일반 뉴스 상투어(분야 무관). 분야 상투어는 설정 keywords.dup_stopwords 에서 더한다.
const GENERIC_STOP = new Set([
  '속보', '단독', '종합', '기자', '뉴스', '보도', '영상', '사진', '포토', '인터뷰', '오늘', '내일', '어제', '올해', '내년',
  '지난해', '지난', '이번', '최근', '관련', '대한', '위한', '통해', '대해', '따라', '위해', '있는', '없는', '하는', '게시판', '이제', '결국', '다시', '또', '본격',
  '대상', '소식', '개최', '실시', '진행', '참여', '함께', '이날', '지역', '관계자', '예정', '일부', '제목', '본문', '확인', '내용',
  '가운데', '전망', '설명', '강조', '주장', '지적', '목소리', '의견',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'after', 'about', 'amid', 'says', 'said',
  'new', 'will', 'are', 'was', 'has', 'have', 'its', 'their', 'more', 'than', 'how', 'why', 'what', 'who', 'not',
]);

function stripKo(word: string): string {
  let w = word;
  if (!/[가-힣]$/.test(w)) return w;
  for (const e of KO_ENDINGS) {
    if (w.length > e.length + 1 && w.endsWith(e)) { w = w.slice(0, -e.length); break; }
  }
  for (const p of KO_PARTICLES) {
    if (w.length > p.length + 1 && w.endsWith(p)) { w = w.slice(0, -p.length); break; }
  }
  return w;
}

/** 제목 꼬리 " - 매체명"(30자 이하)을 뗀다(두 번 붙은 꼴도). */
export function stripOutletSuffix(title: string): string {
  let t = String(title || '').trim();
  for (let round = 0; round < 2; round++) {
    let cut = false;
    for (const sep of [' - ', ' | ', ' – ', ' — ', ' > ']) {
      const i = t.lastIndexOf(sep);
      if (i > 0 && t.length - i - sep.length <= 30) { t = t.slice(0, i).trim(); cut = true; break; }
    }
    if (!cut) break;
  }
  return t;
}

export function normalizeClusterText(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\[[^\]]{0,30}\]|\([^)]{0,30}\)|【[^】]{0,30}】|〈[^〉]{0,30}〉|《[^》]{0,30}》|<[^>]{0,30}>/g, ' ')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/(\d)(만|억|천)?\s+(만|억|천|원|명|건|개|년|월|일|시|분|%)/g, '$1$2$3')
    .replace(/([a-z])([가-힣])/g, '$1 $2')
    .replace(/([가-힣])([a-z])/g, '$1 $2')
    .replace(/[^0-9a-z가-힣\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokensOf(text: string): string[] {
  return normalizeClusterText(text).split(' ').filter(Boolean).map(stripKo);
}

function isHangulText(s: string): boolean {
  const ko = (s.match(/[가-힣]/g) || []).length;
  const la = (s.match(/[a-z]/g) || []).length;
  return ko >= la;
}

/**
 * 제목 2-gram 집합: 한글 = 조사 뗀 낱말(불용어 뺌)을 붙여 쓴 글자 2-gram · 라틴 = 낱말(3자+).
 * 분야 상투어(설정 dup_stopwords)를 빼야 서로 다른 기사가 상투어만으로 겹치지 않는다.
 */
export function titleGrams(title: string, stop: Set<string> = new Set()): Set<string> {
  const toks = stripStopParts(tokensOf(stripOutletSuffix(title)), stop);
  const joined = toks.join(' ');
  const out = new Set<string>();
  if (isHangulText(joined)) {
    const s = toks.join('');
    for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  } else {
    for (const t of toks) if (t.length >= 3) out.add(t.replace(/s$/, ''));
  }
  return out;
}

/**
 * 불용어를 빼고, 한글 복합어 속 분야 상투어도 떼어 낸다(상투어 A·B 일 때 "AB" → "" · "불법A" → "불법").
 * 그래야 "○○ A예방 캠페인" 같은 상투 복합어만으로 서로 다른 기사가 묶이지 않는다.
 */
function stripStopParts(tokens: string[], stop: Set<string>): string[] {
  const parts = [...stop].filter((s) => s.length >= 2 && /^[가-힣]+$/.test(s)).sort((a, b) => b.length - a.length);
  const out: string[] = [];
  for (const t of tokens) {
    if (GENERIC_STOP.has(t) || stop.has(t)) continue;
    let w = t;
    if (/^[가-힣]+$/.test(w)) for (const p of parts) if (w.includes(p)) w = w.split(p).join('');
    if (w) out.push(w);
  }
  return out;
}

function nounsOf(text: string, stop: Set<string>): string[] {
  const seen = new Set<string>();
  for (const w of stripStopParts(tokensOf(text), stop)) {
    if (w.length < 2 || GENERIC_STOP.has(w) || stop.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    // 서술어(…다)는 명사가 아니다("마신다·못한다").
    if (/[가-힣]다$/.test(w)) continue;
    if (/^[a-z]+$/.test(w)) {
      if (w.length < 3) continue;
      seen.add(w.replace(/s$/, ''));
    } else {
      seen.add(w);
    }
  }
  return [...seen];
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function overlap(a: Set<string>, b: Set<string>): { ratio: number; count: number } {
  if (!a.size || !b.size) return { ratio: 0, count: 0 };
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return { ratio: inter / Math.min(a.size, b.size), count: inter };
}

/** 요약·스니펫의 첫 문장(160자 이내). */
export function leadOf(text: string | null | undefined): string {
  const s = String(text || '').trim();
  const first = s.split(/\n+/)[0] || '';
  const sentence = first.split(/(?<=[.!?。])\s+|(?<=다\.)/)[0] || first;
  return sentence.slice(0, 160);
}

/** 첫 문단의 앞 두 문장(300자 이내) — 고유명사 규칙 재료. */
export function paraOf(text: string | null | undefined): string {
  const first = String(text || '').trim().split(/\n+/)[0] || '';
  return first.split(/(?<=[.!?。])\s+/).slice(0, 2).join(' ').slice(0, 300);
}

// ---------- 고유명사(기관명·인명) ----------
// 긴 접미부터(경찰청 → 청 순서). 한 글자 접미는 낱말이 3자+ 일 때만.
const ENTITY_SUFFIXES = [
  '위원회', '대학교', '경찰서', '경찰청', '교육청', '지원청', '연구소', '연구원', '치유원', '진흥원', '본부', '협회', '재단',
  '병원', '대학', '센터', '경찰', '공단', '학회', '의회', '축제', '청', '처', '부', '원',
];
const PERSON_TITLES = new Set([
  '의원', '장관', '대표', '청장', '처장', '원장', '교수', '회장', '시장', '지사', '위원장', '본부장', '이사장', '구청장', '군수',
  '총장', '대행', '센터장', '소장', '국장',
]);

/** 제목·문단 속 기관명(접미)·인명(「세 글자 + 직함」). 앞 「한국·국립·대한」은 뗀다. */
export function entitiesOf(text: string): string[] {
  const toks = tokensOf(text);
  const out = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!/^[가-힣]+$/.test(t)) continue;
    if (/^[가-힣]{3}$/.test(t) && PERSON_TITLES.has(toks[i + 1] || '')) out.add('人' + t);
    for (const s of ENTITY_SUFFIXES) {
      if (t.length >= s.length + 2 && t.endsWith(s)) {
        const name = t.replace(/^(한국|국립|대한)(?=[가-힣]{3})/, '');
        out.add(name);
        break;
      }
    }
  }
  return [...out];
}

/** 두 기사에 함께 나온 고유명사(서로 다른 것만 · 「경남경찰」⊂「경남경찰청」 은 하나로 셈). */
export function sharedEntities(a: Iterable<string>, b: Iterable<string>): string[] {
  const bs = [...b];
  const hits: string[] = [];
  for (const x of a) {
    for (const y of bs) {
      const same = x === y || (x.length >= 3 && y.length >= 3 && !x.startsWith('人') && !y.startsWith('人') && (x.includes(y) || y.includes(x)));
      if (same) hits.push(x.length <= y.length ? x : y);
    }
  }
  const kept: string[] = [];
  for (const h of [...new Set(hits)].sort((p, q) => p.length - q.length)) {
    if (!kept.some((k) => k === h || (!k.startsWith('人') && !h.startsWith('人') && (h.includes(k) || k.includes(h))))) kept.push(h);
  }
  return kept;
}

// ---------- 준비(정규화 결과 기억) ----------
interface Prepared {
  doc: ClusterDoc;
  grams: Set<string>;
  altGrams: Set<string> | null;
  titleNouns: string[];
  leadNouns: string[];
  /** ■3: 제목+첫 문단 고유명사 · 제목+첫 문단 2-gram */
  entities: string[];
  paraGrams: Set<string>;
}

interface Filtered {
  doc: ClusterDoc;
  grams: Set<string>;
  altGrams: Set<string> | null;
  titleNouns: Set<string>;
  allNouns: Set<string>;
  entities: string[];
  paraGrams: Set<string>;
}

class Prep {
  readonly stop: Set<string>;
  readonly ignoreLeads: Set<string>;
  readonly windowMs: number;
  readonly entityRule: boolean;
  private df = new Map<string, number>();
  private n = 0;

  constructor(opts: ClusterOptions) {
    this.stop = new Set([...(opts.fieldStopwords || [])].map((s) => normalizeClusterText(String(s))).filter(Boolean));
    this.ignoreLeads = new Set([...(opts.ignoreLeads || [])].map((s) => normalizeClusterText(String(s))).filter(Boolean));
    this.windowMs = (opts.windowHours ?? WINDOW_HOURS) * 3600 * 1000;
    this.entityRule = opts.entityRule ?? ENTITY_RULE_ON;
  }

  prepare(doc: ClusterDoc): Prepared {
    let lead = leadOf(doc.lead);
    if (lead && this.ignoreLeads.has(normalizeClusterText(lead))) lead = '';
    const titleNouns = nounsOf(stripOutletSuffix(doc.title), this.stop);
    if (doc.altTitle && doc.altTitle !== doc.title) {
      for (const w of nounsOf(stripOutletSuffix(doc.altTitle), this.stop)) if (!titleNouns.includes(w)) titleNouns.push(w);
    }
    let para = paraOf(doc.para ?? doc.lead);
    if (para && (this.ignoreLeads.has(normalizeClusterText(para)) || this.ignoreLeads.has(normalizeClusterText(leadOf(para))))) para = '';
    const title = stripOutletSuffix(doc.title);
    const grams = titleGrams(doc.title, this.stop);
    return {
      doc,
      grams,
      altGrams: doc.altTitle && doc.altTitle !== doc.title ? titleGrams(doc.altTitle, this.stop) : null,
      titleNouns,
      leadNouns: lead ? nounsOf(lead, this.stop).filter((w) => !titleNouns.includes(w)) : [],
      entities: this.entityRule ? entitiesOf(`${title} ${para}`) : [],
      // 첫 문단이 없으면 빈 집합 → 고유명사 규칙은 제목 Jaccard(0.35)로만
      paraGrams: this.entityRule && para ? titleGrams(`${title} ${para}`, this.stop) : new Set<string>(),
    };
  }

  count(p: Prepared): void {
    this.n++;
    for (const w of new Set([...p.titleNouns, ...p.leadNouns])) this.df.set(w, (this.df.get(w) || 0) + 1);
    for (const e of p.entities) this.df.set('E:' + e, (this.df.get('E:' + e) || 0) + 1);
  }

  /** 문서 빈도로 흔한 낱말을 뺀 비교용 꼴. */
  filter(p: Prepared): Filtered {
    // 한 사건이 기사 수를 크게 차지해도 그 사건 낱말이 빠지지 않게 문턱을 넉넉히(작은 묶음에선 사실상 끔).
    const limit = Math.max(COMMON_MIN_DOCS, Math.ceil(this.n * COMMON_DOC_RATIO));
    const keep = (w: string) => (this.df.get(w) || 0) <= limit;
    const titleNouns = new Set(p.titleNouns.filter(keep));
    return {
      doc: p.doc,
      grams: p.grams,
      altGrams: p.altGrams,
      titleNouns,
      allNouns: new Set([...titleNouns, ...p.leadNouns.filter(keep)]),
      // 흔한 기관(국감 철 「보건복지위원회」 같은)은 고유명사 규칙에서 뺀다.
      entities: p.entities.filter((e) => (this.df.get('E:' + e) || 0) <= limit),
      paraGrams: p.paraGrams,
    };
  }

  /** 같은 사건인가. */
  same(a: Filtered, b: Filtered): boolean {
    return this.rule(a, b) !== null;
  }

  /** 같은 사건으로 본 근거(아니면 null). */
  rule(a: Filtered, b: Filtered): ClusterRule | null {
    if (Math.abs(a.doc.ts - b.doc.ts) > this.windowMs) return null;
    const j = Math.max(
      jaccard(a.grams, b.grams),
      a.altGrams ? jaccard(a.altGrams, b.grams) : 0,
      b.altGrams ? jaccard(a.grams, b.altGrams) : 0,
      a.altGrams && b.altGrams ? jaccard(a.altGrams, b.altGrams) : 0,
    );
    if (j >= JACCARD_MIN) return 'jaccard';
    const t = overlap(a.titleNouns, b.titleNouns);
    if (t.count >= NOUN_OVERLAP_MIN_COUNT && t.ratio >= NOUN_OVERLAP_MIN) return 'noun';
    const f = overlap(a.allNouns, b.allNouns);
    if (f.count >= NOUN_OVERLAP_MIN_COUNT_WITH_LEAD && f.ratio >= NOUN_OVERLAP_MIN) return 'noun';
    if (this.entityRule && sharedEntities(a.entities, b.entities).length >= ENTITY_MIN_SHARED) {
      if (j >= ENTITY_JACCARD_MIN || jaccard(a.paraGrams, b.paraGrams) >= ENTITY_PARA_JACCARD_MIN) return 'entity';
    }
    return null;
  }
}

export function pickRepresentative(members: ClusterDoc[]): ClusterDoc {
  return [...members].sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.ts - b.ts || a.id - b.id)[0];
}

function earliest(members: ClusterDoc[]): ClusterDoc {
  return [...members].sort((a, b) => a.ts - b.ts || a.id - b.id)[0];
}

/** 새 기사가 들 묶음: 시간 창 안 기사 중 절반 이상과 겹치는 묶음 가운데 겹친 비율이 가장 큰 것. */
function bestGroup(prep: Prep, me: Filtered, groups: Filtered[][]): number {
  let best = -1;
  let bestFrac = 0;
  for (let g = 0; g < groups.length; g++) {
    const near = groups[g].filter((m) => Math.abs(m.doc.ts - me.doc.ts) <= prep.windowMs);
    if (!near.length) continue;
    let hit = 0;
    for (const m of near) if (prep.same(me, m)) hit++;
    const frac = hit / near.length;
    if (hit > 0 && frac >= JOIN_MIN_FRACTION && frac > bestFrac) {
      best = g;
      bestFrac = frac;
    }
  }
  return best;
}

/**
 * 둘째 단계: 한 사건이 순서 탓에 두 묶음으로 갈린 것을 합친다.
 * 두 묶음 사이 (시간 창 안) 기사 쌍의 절반 이상이 겹치면 합친다(평균 연결). 더 합칠 것이 없을 때까지.
 */
function mergeGroups(prep: Prep, groups: Filtered[][]): Filtered[][] {
  const gs = groups.filter((g) => g.length);
  const span = (g: Filtered[]) => [Math.min(...g.map((m) => m.doc.ts)), Math.max(...g.map((m) => m.doc.ts))];
  for (let changed = true; changed; ) {
    changed = false;
    outer: for (let a = 0; a < gs.length; a++) {
      const [a0, a1] = span(gs[a]);
      for (let b = a + 1; b < gs.length; b++) {
        const [b0, b1] = span(gs[b]);
        if (b0 - a1 > prep.windowMs || a0 - b1 > prep.windowMs) continue;
        let pairs = 0;
        let hit = 0;
        for (const x of gs[a]) {
          for (const y of gs[b]) {
            if (Math.abs(x.doc.ts - y.doc.ts) > prep.windowMs) continue;
            pairs++;
            if (prep.same(x, y)) hit++;
          }
        }
        if (pairs > 0 && hit / pairs >= JOIN_MIN_FRACTION) {
          gs[a] = gs[a].concat(gs[b]);
          gs.splice(b, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return gs;
}

function toInfo(members: ClusterDoc[]): ClusterInfo {
  const sorted = [...members].sort((a, b) => a.ts - b.ts || a.id - b.id);
  return {
    clusterId: String(earliest(members).id),
    size: members.length,
    representativeId: pickRepresentative(members).id,
    memberIds: sorted.map((m) => m.id),
  };
}

/**
 * 문서 묶기(보도 시각 순으로 하나씩 · ±36h · 절반 이상 겹침). 반환 = id → 묶음 정보(혼자인 기사도 size 1).
 */
export function clusterDocs(docs: ClusterDoc[], opts: ClusterOptions = {}): Map<number, ClusterInfo> {
  const prep = new Prep(opts);
  const sorted = [...docs].filter((d) => Number.isFinite(d.ts)).sort((a, b) => a.ts - b.ts || a.id - b.id);
  const prepared = sorted.map((d) => prep.prepare(d));
  for (const p of prepared) prep.count(p);
  let groups: Filtered[][] = [];
  for (const p of prepared) {
    const me = prep.filter(p);
    const g = bestGroup(prep, me, groups);
    if (g >= 0) groups[g].push(me);
    else groups.push([me]);
  }
  groups = mergeGroups(prep, groups);
  const out = new Map<number, ClusterInfo>();
  for (const g of groups) {
    const info = toInfo(g.map((m) => m.doc));
    for (const m of g) out.set(m.doc.id, info);
  }
  return out;
}

/** 묶음 정보 → 묶음 목록(2건 이상만). */
export function multiClusters(index: Map<number, ClusterInfo>): ClusterInfo[] {
  const seen = new Set<string>();
  const out: ClusterInfo[] = [];
  for (const info of index.values()) {
    if (info.size < 2 || seen.has(info.clusterId)) continue;
    seen.add(info.clusterId);
    out.push(info);
  }
  return out;
}

/**
 * ■3: 묶음 기사마다 같은 사건으로 본 근거(가장 센 것: jaccard > noun > entity). 가장 이른 기사 = 'seed'.
 * 묶음 안 다른 기사 누구와도 직접 안 겹치면(평균 연결로 합쳐진 것) 'merge'.
 */
export function clusterRules(docs: ClusterDoc[], opts: ClusterOptions = {}): Map<number, ClusterRule | 'seed' | 'merge'> {
  const prep = new Prep(opts);
  const prepared = docs.filter((d) => Number.isFinite(d.ts)).map((d) => prep.prepare(d));
  for (const p of prepared) prep.count(p);
  const fs = prepared.map((p) => prep.filter(p));
  const out = new Map<number, ClusterRule | 'seed' | 'merge'>();
  if (!fs.length) return out;
  const seed = earliest(fs.map((f) => f.doc));
  const strength: Record<ClusterRule, number> = { jaccard: 3, noun: 2, entity: 1 };
  for (const me of fs) {
    if (me.doc === seed) { out.set(me.doc.id, 'seed'); continue; }
    let best: ClusterRule | null = null;
    for (const other of fs) {
      if (other === me) continue;
      const r = prep.rule(me, other);
      if (r && (!best || strength[r] > strength[best])) best = r;
    }
    out.set(me.doc.id, best ?? 'merge');
  }
  return out;
}

// ---------- 수집기용: 새 후보가 이미 있는 묶음에 드는가 ----------
export interface PoolMatch<T> {
  /** 묶음 대표(등급 → 이른 보도)의 자료 */
  data: T;
  doc: ClusterDoc;
  /** 묶음 열쇠(대표가 아니라 가장 이른 보도의 id) */
  clusterId: string;
  size: number;
}

/**
 * 수집 중 쓰는 묶음 기억(최근 저장분 + 이번 실행에서 판정한 것).
 * match() 는 새 후보가 들 묶음(절반 이상 겹침)의 대표를 돌려준다. add() 는 묶음에 넣거나 새 묶음을 연다.
 */
export class ClusterPool<T> {
  private prep: Prep;
  private groups: Array<Array<{ f: Filtered; p: Prepared; data: T }>> = [];

  constructor(opts: ClusterOptions = {}) {
    this.prep = new Prep(opts);
  }

  get size(): number {
    return this.groups.reduce((s, g) => s + g.length, 0);
  }

  private refilter(): Filtered[][] {
    return this.groups.map((g) => g.map((m) => this.prep.filter(m.p)));
  }

  private find(doc: ClusterDoc): { g: number; me: Filtered; p: Prepared } {
    const p = this.prep.prepare(doc);
    const me = this.prep.filter(p);
    return { g: bestGroup(this.prep, me, this.refilter()), me, p };
  }

  match(doc: ClusterDoc): PoolMatch<T> | null {
    const { g } = this.find(doc);
    if (g < 0) return null;
    const members = this.groups[g];
    const rep = pickRepresentative(members.map((m) => m.p.doc));
    const hit = members.find((m) => m.p.doc === rep)!;
    return { data: hit.data, doc: rep, clusterId: String(earliest(members.map((m) => m.p.doc)).id), size: members.length };
  }

  /** 묶음에 넣는다(joinWith = match 때 고른 묶음에 강제로 · 없으면 다시 찾음). 반환 = 묶음 열쇠. */
  add(doc: ClusterDoc, data: T): string {
    const { g, me, p } = this.find(doc);
    this.prep.count(p);
    if (g >= 0) this.groups[g].push({ f: me, p, data });
    else this.groups.push([{ f: me, p, data }]);
    const members = this.groups[g >= 0 ? g : this.groups.length - 1];
    return String(earliest(members.map((m) => m.p.doc)).id);
  }
}

/** 보도 시각(ms): published_ts → 없으면 published_at(날짜면 KST 정오) → NaN. */
export function docTs(publishedTs: Date | string | null | undefined, publishedAt: string | Date | null | undefined): number {
  if (publishedTs) {
    const t = new Date(publishedTs).getTime();
    if (Number.isFinite(t)) return t;
  }
  if (!publishedAt) return NaN;
  const s = publishedAt instanceof Date ? publishedAt.toISOString() : String(publishedAt);
  const ymd = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd) && (s.length === 10 || s.endsWith('T00:00:00.000Z'))) {
    return Date.parse(`${ymd}T12:00:00+09:00`);
  }
  return Date.parse(s);
}
