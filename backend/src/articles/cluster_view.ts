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

/** 공개 조건(raw SQL · 기사만 · publish 층) — 묶음 계산용 가벼운 읽기에. */
export function visibleSql(flags: { deletedAt: boolean; tier: boolean }, alias = ''): string {
  const a = alias ? `${alias}.` : '';
  const parts = [`${a}blocked = false`, `(${a}source_type IS NULL OR ${a}source_type <> 'broadcast')`];
  if (flags.deletedAt) parts.push(`${a}deleted_at IS NULL`);
  if (flags.tier) parts.push(`${a}tier = 'publish'`);
  return parts.join(' AND ');
}
