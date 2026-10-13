// ============================================================
// cluster_sample.ts (NEWS-Q5 ■2) — 묶음 표본 검사기(읽기 전용 · LLM 0 · DB 열쇠 0).
// 공개 API 만 읽는다: /articles/latest?group=none(최근 기사) → 최근 7일 묶음(2건+) 전부는 /articles/cluster/:id 로
// 구성 기사·근거(rule)를, 단독 기사는 무작위 20(KST 날짜로 씨앗 고정 = 같은 날 다시 돌리면 같은 표본).
// 결과 = docs/reports/<YYYYMM>/cluster_sample_<MMDD>.md (맞음/틀림 빈칸 · 사람이 채운다).
//   npm run cluster:sample            (기본 https://addicted-news-backend.onrender.com)
//   CLUSTER_SAMPLE_API=http://localhost:3000 npm run cluster:sample
// ============================================================
import * as fs from 'fs';
import * as path from 'path';

export const SAMPLE_DAYS = 7;
export const SAMPLE_SINGLES = 20;
const DEFAULT_API = 'https://addicted-news-backend.onrender.com';

export interface SampleRow {
  id: number;
  title: string;
  source?: string | null;
  publishedAt?: string | null;
  publishedTs?: string | null;
  clusterId?: string | number | null;
  clusterSize?: number | null;
}

export interface SampleMember {
  id: number;
  title: string;
  source?: string | null;
  publishedAt?: string | null;
  rule?: string | null;
}

export interface SampleCluster {
  clusterId: string;
  size: number;
  mode?: string | null;
  representative: { id: number; title: string; source?: string | null; publishedAt?: string | null };
  members: SampleMember[];
}

function tsOf(r: { publishedTs?: string | null; publishedAt?: string | null }): number {
  const t = Date.parse(String(r.publishedTs || r.publishedAt || ''));
  return Number.isFinite(t) ? t : 0;
}

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 최근 7일 기사 → 묶음(2건+ · 묶음마다 기사 하나의 id) + 단독 무작위 n(씨앗 고정). */
export function selectSample(rows: SampleRow[], now: number, seed: string, singlesN = SAMPLE_SINGLES) {
  const recent = rows.filter((r) => tsOf(r) >= now - SAMPLE_DAYS * 864e5 && tsOf(r) <= now + 3600e3);
  const clusters = new Map<string, { clusterId: string; anyId: number; size: number }>();
  const singles: SampleRow[] = [];
  for (const r of recent) {
    if (r.clusterId != null && Number(r.clusterSize || 0) >= 2) {
      const key = String(r.clusterId);
      if (!clusters.has(key)) clusters.set(key, { clusterId: key, anyId: r.id, size: Number(r.clusterSize) });
    } else {
      singles.push(r);
    }
  }
  const rnd = seeded(seed);
  const pool = [...singles].sort((a, b) => a.id - b.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return {
    recentTotal: recent.length,
    clusters: [...clusters.values()].sort((a, b) => b.size - a.size || a.anyId - b.anyId),
    singles: pool.slice(0, singlesN).sort((a, b) => tsOf(b) - tsOf(a)),
    singlesTotal: singles.length,
  };
}

/** 근거 분포(seed·jaccard·noun·entity·merge · 없음). */
export function ruleCounts(clusters: SampleCluster[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of clusters) for (const m of c.members) out[m.rule || '없음'] = (out[m.rule || '없음'] || 0) + 1;
  return out;
}

const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '｜').replace(/\s+/g, ' ').trim();

export function kstStamp(iso: string | number | null | undefined): string {
  const t = typeof iso === 'number' ? iso : Date.parse(String(iso || ''));
  if (!Number.isFinite(t) || !t) return '-';
  return new Date(t + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
}

export function renderSample(input: {
  api: string;
  now: number;
  recentTotal: number;
  clusters: SampleCluster[];
  singles: SampleRow[];
  singlesTotal: number;
  failed: string[];
}): string {
  const { clusters, singles } = input;
  const memberN = clusters.reduce((n, c) => n + c.members.length, 0);
  const rules = ruleCounts(clusters);
  const L: string[] = [];
  L.push(`# 묶음 표본 검사 — ${kstStamp(input.now)} KST`);
  L.push('');
  L.push(`- 원천: ${input.api} (공개 API · 읽기 전용 · LLM 0)`);
  L.push(`- 기간: 최근 ${SAMPLE_DAYS}일 공개 기사 ${input.recentTotal}건 → 묶음(2건+) ${clusters.length} · 구성 기사 ${memberN} · 단독 ${input.singlesTotal} 중 무작위 ${singles.length}`);
  L.push(`- 근거(rule) 분포: ${Object.entries(rules).map(([k, v]) => `${k} ${v}`).join(' · ') || '-'}`);
  if (input.failed.length) L.push(`- 못 읽은 묶음: ${input.failed.join(', ')}`);
  L.push('- 채우는 법: 묶음마다 「판정」에 맞음/틀림. 틀리면 빠져야 할 기사 id 를 메모에. 단독은 다른 기사와 같은 사건인데 못 묶였으면 틀림.');
  L.push('- rule: seed = 묶음의 가장 이른 기사 · jaccard = 제목 낱말 겹침 · noun = 핵심 명사 · entity = 고유명사 2개+ 공유 · merge = 사슬로 이어짐');
  L.push('');
  L.push(`## 묶음 ${clusters.length}`);
  for (const c of clusters) {
    L.push('');
    L.push(`### 묶음 ${cell(c.clusterId)} · ${c.size}건${c.mode ? ` · ${cell(c.mode)}` : ''}`);
    L.push(`대표: [${c.representative.id}] ${cell(c.representative.title)} — ${cell(c.representative.source)} · ${kstStamp(c.representative.publishedAt)}`);
    L.push('');
    L.push('| 기사 id | 제목 | 매체 | 시각(KST) | rule | 맞음/틀림 |');
    L.push('|---|---|---|---|---|---|');
    for (const m of c.members) {
      L.push(`| ${m.id} | ${cell(m.title)} | ${cell(m.source)} | ${kstStamp(m.publishedAt)} | ${cell(m.rule || '-')} |  |`);
    }
    L.push('');
    L.push('판정: ☐ 맞음 ☐ 틀림 · 메모: ');
  }
  L.push('');
  L.push(`## 단독 무작위 ${singles.length}`);
  L.push('');
  L.push('| 기사 id | 제목 | 매체 | 시각(KST) | 맞음/틀림 |');
  L.push('|---|---|---|---|---|');
  for (const s of singles) L.push(`| ${s.id} | ${cell(s.title)} | ${cell(s.source)} | ${kstStamp(s.publishedTs || s.publishedAt)} |  |`);
  L.push('');
  return L.join('\n');
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function main() {
  const api = (process.env.CLUSTER_SAMPLE_API || DEFAULT_API).replace(/\/+$/, '');
  const now = Date.now();
  const day = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  const rows: SampleRow[] = await getJson(`${api}/articles/latest?limit=1000&group=none`);
  const pick = selectSample(Array.isArray(rows) ? rows : [], now, day);
  const clusters: SampleCluster[] = [];
  const failed: string[] = [];
  for (const c of pick.clusters) {
    try {
      const d = await getJson(`${api}/articles/cluster/${c.anyId}`);
      clusters.push({
        clusterId: String(d.clusterId ?? c.clusterId),
        size: Number(d.clusterSize || c.size),
        mode: d.mode ?? null,
        representative: {
          id: d.representative?.id,
          title: d.representative?.title,
          source: d.representative?.source,
          publishedAt: d.representative?.publishedTs || d.representative?.publishedAt,
        },
        members: (d.members || []).map((m: any) => ({ id: m.id, title: m.title, source: m.source, publishedAt: m.publishedTs || m.publishedAt, rule: m.rule })),
      });
    } catch (e) {
      failed.push(`${c.clusterId}(${(e as Error).message.slice(0, 40)})`);
    }
  }
  const md = renderSample({ api, now, recentTotal: pick.recentTotal, clusters, singles: pick.singles, singlesTotal: pick.singlesTotal, failed });
  const dir = path.join(__dirname, '../../../docs/reports', day.slice(0, 7).replace('-', ''));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `cluster_sample_${day.slice(5, 7)}${day.slice(8, 10)}.md`);
  fs.writeFileSync(file, md, 'utf8');
  const rules = ruleCounts(clusters);
  console.log(`[cluster:sample] ${file}`);
  console.log(`  최근 ${SAMPLE_DAYS}일 ${pick.recentTotal}건 · 묶음 ${clusters.length} · 구성 ${clusters.reduce((n, c) => n + c.members.length, 0)} · 단독 ${pick.singlesTotal} 중 ${pick.singles.length}`);
  console.log(`  rule: ${Object.entries(rules).map(([k, v]) => `${k} ${v}`).join(' · ')}${failed.length ? ` · 못 읽음 ${failed.length}` : ''}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[cluster:sample] 실패:', (e as Error).message);
    process.exit(1);
  });
}
