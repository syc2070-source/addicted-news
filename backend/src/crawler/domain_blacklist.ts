// ============================================================
// domain_blacklist.ts (v5.4.1) — 딥시크 호출 전 0원 필터
// - 블랙리스트 도메인 기사는 딥시크 호출 없이 즉시 폐기.
// - 자동 확장(완화): in-memory 카운트 폐기 → rejected_articles 집계 기반.
//   기준: 누적 판정 10건 이상 AND (category_fit/SEO 사유 거부율) 90% 이상.
//   is_incident 사유는 카운트 제외(사건 많은 정상 매체 오차단 방지).
// - 초기 목록은 data/domain_blacklist.json(스팸 시드 8종).
// ============================================================
import * as fs from 'fs';
import * as path from 'path';

const AUTO_MIN_JUDGED = Number(process.env.DOMAIN_AUTOADD_MIN ?? 10);   // 누적 판정 최소
const AUTO_MIN_RATE = Number(process.env.DOMAIN_AUTOADD_RATE ?? 0.9);   // 거부율 최소(cat_fit/seo)

export function normalizeHost(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    const s = String(url).trim().toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
  }
}

function loadSeed(): Set<string> {
  const p = path.join(__dirname, '../../data/domain_blacklist.json');
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { domains?: string[] };
    return new Set((raw.domains || []).map((d) => d.toLowerCase().replace(/^www\./, '')));
  } catch {
    return new Set();
  }
}

const blacklist: Set<string> = loadSeed();
const runtimeAdded: string[] = [];

export function isBlacklistedDomain(sourceUrl?: string, googleUrl?: string): boolean {
  const host = normalizeHost(sourceUrl) || normalizeHost(googleUrl);
  return host ? blacklist.has(host) : false;
}

export function addRuntimeBlacklist(domain: string): void {
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (!blacklist.has(d)) { blacklist.add(d); runtimeAdded.push(d); }
}

/** 순수 판정: (총 판정, cat_fit/seo 거부 수)로 자동 블랙리스트 자격 여부. */
export function qualifiesForAutoBlacklist(totalJudged: number, catSeoRejects: number): boolean {
  if (totalJudged < AUTO_MIN_JUDGED) return false;
  return catSeoRejects / totalJudged >= AUTO_MIN_RATE;
}

export type AutoBlacklistHit = {
  domain: string; total: number; catSeoRejects: number; recentTitles: string[];
};

/**
 * rejected_articles + articles 집계로 자동 블랙리스트 대상 도출.
 * runQuery: 원시 SQL 실행기(TypeORM ds.query 등). 실패 시 [] 반환.
 * 대상 도메인은 in-memory 블랙리스트에 추가(이번 실행부터 차단)하고 목록을 반환.
 */
export async function evaluateAutoBlacklistFromDb(
  runQuery: (sql: string) => Promise<any[]>,
): Promise<AutoBlacklistHit[]> {
  const domRe = `lower(regexp_replace(source_url, '^https?://(www\\.)?([^/]+).*$', '\\2'))`;
  const sql = `
    WITH rej AS (
      SELECT ${domRe} AS domain,
             count(*) AS total_rej,
             count(*) FILTER (WHERE reject_reason LIKE 'category_fit%' OR reject_reason LIKE 'seo%'
                              OR reject_reason LIKE 'low_confidence%') AS cat_seo
      FROM rejected_articles
      WHERE source_url IS NOT NULL AND source_url <> ''
      GROUP BY 1
    ),
    acc AS (
      SELECT ${domRe} AS domain, count(*) AS accepted
      FROM articles
      WHERE source_url IS NOT NULL AND source_url <> ''
      GROUP BY 1
    )
    SELECT r.domain,
           (r.total_rej + COALESCE(a.accepted,0))::int AS total,
           r.cat_seo::int AS cat_seo
    FROM rej r LEFT JOIN acc a ON a.domain = r.domain
    WHERE (r.total_rej + COALESCE(a.accepted,0)) >= ${AUTO_MIN_JUDGED}
      AND r.cat_seo::float / NULLIF(r.total_rej + COALESCE(a.accepted,0),0) >= ${AUTO_MIN_RATE}
  `;
  let rows: any[] = [];
  try { rows = await runQuery(sql); } catch { return []; }

  const hits: AutoBlacklistHit[] = [];
  for (const r of rows) {
    const domain = String(r.domain || '').replace(/^www\./, '');
    if (!domain || blacklist.has(domain)) continue;
    // 최근 거부 제목 3건
    let recentTitles: string[] = [];
    try {
      const t = await runQuery(
        `SELECT title FROM rejected_articles
          WHERE ${domRe} = '${domain.replace(/'/g, "''")}'
          ORDER BY created_at DESC LIMIT 3`,
      );
      recentTitles = t.map((x) => String(x.title || '')).filter(Boolean);
    } catch { /* 무시 */ }
    addRuntimeBlacklist(domain);
    hits.push({ domain, total: Number(r.total), catSeoRejects: Number(r.cat_seo), recentTitles });
  }
  return hits;
}

export function getBlacklistSnapshot(): { size: number; runtimeAdded: string[] } {
  return { size: blacklist.size, runtimeAdded: [...runtimeAdded] };
}

// 테스트용
export function _resetBlacklistState(): void {
  runtimeAdded.length = 0;
}
