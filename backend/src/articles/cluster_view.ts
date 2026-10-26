// ============================================================
// cluster_view.ts (NEWS-Q3 ■2·■3) — 공개 목록을 사건 묶음 단위로 접는 순수 함수들.
//  · 목록 = 묶음마다 대표 1건 + 「같은 소식 N건」(clusterMembers) · 묶음 자리 = 그 묶음의 가장 새 기사 자리
//  · TOP = 72시간 안 묶음을 cluster_size 큰 순(동률 = 대표 source_grade → 새 보도) · 72시간 안 기사가 없으면 7일로 넓힘
// ============================================================
import { ClusterInfo, gradeRank } from '../crawler/event_cluster';
import { isSameArticle } from '../crawler/dedup';

export type GroupMode = 'cluster' | 'none';

export function parseGroup(value?: string): GroupMode {
  return value === 'none' ? 'none' : 'cluster';
}

/** 묶음 펼침에 보이는 매체별 한 줄. */
export interface LightRow {
  id: number;
  title: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  publishedTs: Date | null;
  sourceGrade: string | null;
  category?: string | null;
  ts: number;
}

export interface Group {
  key: string;
  /** 이 목록(걸러진 것) 안의 묶음 기사 — 목록 순서대로 */
  ids: number[];
  info: ClusterInfo | null;
}

/** 순서 있는 id 목록 → 묶음(처음 나온 자리 유지). 묶음 정보가 없거나 1건이면 혼자. */
export function groupIds(ids: number[], index: Map<number, ClusterInfo>): Group[] {
  const out: Group[] = [];
  const at = new Map<string, Group>();
  for (const id of ids) {
    const info = index.get(id);
    const key = info && info.size > 1 ? `c${info.clusterId}` : `a${id}`;
    const g = at.get(key);
    if (g) g.ids.push(id);
    else {
      const ng: Group = { key, ids: [id], info: info && info.size > 1 ? info : null };
      at.set(key, ng);
      out.push(ng);
    }
  }
  return out;
}

/** 묶음에서 목록에 보일 기사: 대표가 이 목록 안에 있으면 대표, 아니면 목록에서 처음 나온 기사. */
export function shownId(g: Group): number {
  if (g.info && g.ids.includes(g.info.representativeId)) return g.info.representativeId;
  return g.ids[0];
}

/**
 * 묶음의 나머지 기사(보도 시각 순 · 보이는 기사 뺌).
 * NEWS-Q6 ■2: 같은 기사 두 번(정규화 URL · 같은 매체 24h 닮은 제목)은 앞 것 하나만 보인다(지움 0 · 접기만).
 */
export function membersOf(info: ClusterInfo | null, shown: number, light: Map<number, LightRow>, max = 20): LightRow[] {
  if (!info) return [];
  const kept: LightRow[] = [];
  const shownRow = light.get(shown);
  const asNear = (r: LightRow) => ({ title: r.title, source: r.source, url: r.sourceUrl, ts: r.ts });
  for (const id of info.memberIds) {
    if (id === shown) continue;
    const r = light.get(id);
    if (!r) continue;
    const me = asNear(r);
    if ((shownRow && isSameArticle(asNear(shownRow), me)) || kept.some((k) => isSameArticle(asNear(k), me))) continue;
    kept.push(r);
    if (kept.length >= max) break;
  }
  return kept;
}

export interface TopPick {
  id: number;
  size: number;
  window: '72h' | '7d';
}

/**
 * TOP 고르기: 창(72h → 없으면 7d) 안 보도된 기사들을 묶음으로 모아 cluster_size 큰 순 → 대표 등급 → 새 보도.
 * light = 최근 7일 공개 기사(보도 시각 포함).
 */
export function rankTop(
  light: Map<number, LightRow>,
  index: Map<number, ClusterInfo>,
  now: number,
  take = 3,
): TopPick[] {
  for (const [window, hours] of [['72h', 72], ['7d', 24 * 7]] as const) {
    const since = now - hours * 3600 * 1000;
    const inWin = [...light.values()].filter((r) => Number.isFinite(r.ts) && r.ts >= since && r.ts <= now + 3600 * 1000);
    if (!inWin.length) continue;
    const byKey = new Map<string, { rep: LightRow; size: number; newest: number }>();
    for (const r of inWin) {
      const info = index.get(r.id);
      const key = info && info.size > 1 ? `c${info.clusterId}` : `a${r.id}`;
      const repRow = info && info.size > 1 ? light.get(info.representativeId) || r : r;
      const cur = byKey.get(key);
      if (cur) cur.newest = Math.max(cur.newest, r.ts);
      else byKey.set(key, { rep: repRow, size: info?.size || 1, newest: r.ts });
    }
    return [...byKey.values()]
      .sort((a, b) => b.size - a.size || gradeRank(a.rep.sourceGrade) - gradeRank(b.rep.sourceGrade) || b.newest - a.newest)
      .slice(0, take)
      .map((g) => ({ id: g.rep.id, size: g.size, window }));
  }
  return [];
}

/**
 * NEWS-Q18 ■3(오너 결정 10-26): TOP 무게 규칙 — 상수는 분야 설정 top_rank(코드 변경 없이 조정).
 * 묶음 점수 = 전국 매체(묶음 안 한 곳이라도) + 기관 발표(묶음 안 제목 핵심어 · 출처 등급 institution/academic) + 지역 캠페인·홍보(보이는 제목) +
 *   같은 소식 건수(per_report × (묶음 수 − 1) · 상한 report_cap) + 제목 분야 핵심어 없음(off_topic_penalty · NEWS-Q19 ■3).
 *   동점 = 묶음 큰 것 → 최신. 창 72시간 · 묶음이 take 보다 적으면 7일.
 */
export interface TopRule {
  national_sources: string[];
  national_bonus: number;
  institution_words: string[];
  institution_bonus: number;
  local_words: string[];
  /** 제목에 맞으면 지역(정규식 · 예: 머리 「OO군,」) */
  local_patterns?: string[];
  local_penalty: number;
  per_report: number;
  report_cap: number;
  /** NEWS-Q19 ■3: 묶음 제목(「 - 매체」 꼬리 뺌) 어디에도 topic_words 가 없으면 더함(예: -1) · 없거나 0 · topic_words 가 비면 끔 */
  off_topic_penalty?: number;
  /** 분야 핵심어(소문자 · field_profile topicTitleWords) — 설정 파일이 아니라 부르는 쪽이 채움 */
  topic_words?: string[];
}

export interface TopScore {
  national: boolean;
  institution: boolean;
  local: boolean;
  offTopic: boolean;
  reports: number;
  score: number;
}

export interface WeightedPick extends TopPick {
  score: TopScore;
  newest: number;
}

const OPINION = /^\s*\[(사설|칼럼|기고|시론|오피니언)\]/;

function squashName(s: string): string {
  return String(s || '').toLowerCase().replace(/[\s·.()\-_]/g, '');
}

/** 제목 끝 「 - 매체」 꼬리(구글뉴스 · 매체 이름이 source 에 없을 때) */
function titleOutlet(title: string): string {
  const t = String(title || '');
  const i = t.lastIndexOf(' - ');
  return i > 0 && t.length - i - 3 <= 30 ? t.slice(i + 3) : '';
}

export function isNationalRow(r: Pick<LightRow, 'source' | 'title'>, names: ReadonlySet<string>): boolean {
  return names.has(squashName(r.source)) || names.has(squashName(titleOutlet(r.title)));
}

export function scoreTopGroup(rows: LightRow[], shown: LightRow, size: number, rule: TopRule): TopScore {
  const names = new Set(rule.national_sources.map(squashName));
  const anyWord = (t: string, words: string[]) => words.some((w) => w && t.includes(w));
  const national = rows.some((r) => isNationalRow(r, names));
  // 리뷰(Q18): 사설 · 칼럼 · 기고는 기관 발표로 치지 않음
  const institution = rows.some(
    (r) =>
      !OPINION.test(r.title || '') &&
      (anyWord(r.title || '', rule.institution_words) || r.sourceGrade === 'institution' || r.sourceGrade === 'academic'),
  );
  const patterns = (rule.local_patterns || []).map((p) => {
    try {
      return new RegExp(p);
    } catch {
      return null;
    }
  });
  const shownTitle = shown.title || '';
  // 리뷰(Q18): 기관 발표가 있으면 지역 감점 없음(「복지부 … 운영 확대」 · 「국회 토론회 개최」)
  const local =
    !institution && (anyWord(shownTitle, rule.local_words) || patterns.some((re) => !!re && re.test(shownTitle)));
  const reports = Math.min(rule.report_cap, rule.per_report * Math.max(0, size - 1));
  // NEWS-Q19 ■3: 묶음 제목 어디에도 분야 핵심어가 없으면 감점(느슨한 전국 기사가 +1 만으로 올라오지 않게)
  // 리뷰(Q19): 제목 끝 「 - 매체」 꼬리는 빼고 봄(「…인터넷신문」이 핵심어로 맞지 않게) · 보이는 제목 하나가 아니라 묶음 전부
  const words = rule.topic_words || [];
  const onTopic = (t: string) => {
    const tail = titleOutlet(t);
    const body = (tail ? t.slice(0, t.length - tail.length - 3) : t).toLowerCase();
    return words.some((w) => w && body.includes(w));
  };
  const offTopic = !!rule.off_topic_penalty && words.length > 0 && ![shown, ...rows].some((r) => onTopic(r.title || ''));
  const score =
    (national ? rule.national_bonus : 0) +
    (institution ? rule.institution_bonus : 0) +
    (local ? rule.local_penalty : 0) +
    (offTopic ? rule.off_topic_penalty || 0 : 0) +
    reports;
  return { national, institution, local, offTopic, reports, score: Math.round(score * 100) / 100 };
}

export function rankTopWeighted(
  light: Map<number, LightRow>,
  index: Map<number, ClusterInfo>,
  now: number,
  rule: TopRule,
  take = 3,
): WeightedPick[] {
  const names = new Set(rule.national_sources.map(squashName));
  let last: WeightedPick[] = [];
  for (const [window, hours] of [['72h', 72], ['7d', 24 * 7]] as const) {
    const since = now - hours * 3600 * 1000;
    const inWin = [...light.values()].filter((r) => Number.isFinite(r.ts) && r.ts >= since && r.ts <= now + 3600 * 1000);
    const byKey = new Map<string, { info: ClusterInfo | null; rows: LightRow[]; newest: number }>();
    for (const r of inWin) {
      const info = index.get(r.id);
      const key = info && info.size > 1 ? `c${info.clusterId}` : `a${r.id}`;
      const g = byKey.get(key);
      if (g) {
        g.rows.push(r);
        g.newest = Math.max(g.newest, r.ts);
      } else byKey.set(key, { info: info && info.size > 1 ? info : null, rows: [r], newest: r.ts });
    }
    const picks = [...byKey.values()].map((g) => {
      // 묶음 기사 전부(창 밖 것 포함 · light 에 있는 만큼)로 무게를 봄
      const all = g.info ? g.info.memberIds.map((id) => light.get(id)).filter((x): x is LightRow => !!x) : g.rows;
      const rep = g.info ? light.get(g.info.representativeId) || g.rows[0] : g.rows[0];
      // 대표가 전국 매체가 아니면 묶음 안 전국 매체 기사를 보임(가장 새 것)
      const nat = isNationalRow(rep, names)
        ? rep
        : [...all].filter((r) => isNationalRow(r, names)).sort((a, b) => b.ts - a.ts)[0];
      const shown = nat || rep;
      const size = g.info?.size || 1;
      return { id: shown.id, size, window, score: scoreTopGroup(all, shown, size, rule), newest: g.newest } as WeightedPick;
    });
    // 리뷰(Q18): 동점 = 묶음 큰 것 → 최신
    last = picks.sort((a, b) => b.score.score - a.score.score || b.size - a.size || b.newest - a.newest).slice(0, take);
    if (last.length >= take) return last;
  }
  return last;
}

/** 공개 조건(raw SQL · 기사만 · publish 층) — 묶음 계산용 가벼운 읽기에. */
export function visibleSql(flags: { deletedAt: boolean; tier: boolean }, alias = ''): string {
  const a = alias ? `${alias}.` : '';
  const parts = [`${a}blocked = false`, `(${a}source_type IS NULL OR ${a}source_type <> 'broadcast')`];
  if (flags.deletedAt) parts.push(`${a}deleted_at IS NULL`);
  if (flags.tier) parts.push(`${a}tier = 'publish'`);
  return parts.join(' AND ');
}
