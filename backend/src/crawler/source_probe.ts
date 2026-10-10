// ============================================================
// source_probe.ts (NEWS-Q2 ■5·■10) — 읽기 전용 소스 점검. DB·DeepSeek 접속 없음.
// 분야 설정의 전 소스(비활성 포함)를 한 번씩 읽어 소스별 「읽음 · 핵심어 후보」 표와 피드 건강을 찍는다.
//   npx ts-node src/crawler/source_probe.ts            # 표(사람용)
//   npx ts-node src/crawler/source_probe.ts --json     # JSON
// 후보 = 제목+피드 요약에 분야 strong 핵심어가 있고 제외어가 없는 항목(사건 거름망은 보관 모드처럼 허용).
// 실제 크롤은 여기에 본문 추출·중복 확인·DeepSeek 관문이 더해지므로 저장 수는 이보다 적다.
// ============================================================
import Parser from 'rss-parser';
import { fieldProfile } from './field_profile';
import { buildAllSources, SourceConfig } from './sourceConfig';
import { fetchFeed } from './feed_fetch';
import { matchesFieldKeywords } from './field_filter';
import { fetchBroadcastItems, loadBroadcastSources, passesBroadcastKeywordGate } from './broadcast';

export interface ProbeRow {
  id: string;
  type: string;
  grade: string;
  active: boolean;
  status: string;
  read: number;
  candidates: number;
  newest: string | null;
  note?: string;
}

function strip(s: unknown): string {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function probeSource(conf: SourceConfig, parser: Parser<any>): Promise<ProbeRow> {
  const row: ProbeRow = {
    id: conf.id, type: conf.sourceType, grade: conf.grade, active: conf.active, status: '', read: 0, candidates: 0, newest: null,
  };
  if (!conf.active) {
    row.status = 'inactive';
    row.note = conf.inactiveReason;
    return row;
  }
  try {
    const { feed, retried, repaired } = await fetchFeed(
      { url: new URL(conf.url).href, format: conf.format, listPattern: conf.listPattern, jsonMap: conf.jsonMap },
      parser,
      { timeoutMs: 20000 },
    );
    const items = (feed.items || []).slice(0, conf.maxItems ?? 30);
    row.status = `ok${retried ? '+retry' : ''}${repaired ? '+repaired' : ''}`;
    row.read = items.length;
    let newest = 0;
    for (const it of items) {
      const t = Date.parse(it.isoDate || it.pubDate || '');
      if (!Number.isNaN(t) && t > newest) newest = t;
      const body = strip(it.contentSnippet || it.content || it.description || '');
      if (matchesFieldKeywords(strip(it.title), body, { allowIncident: true })) row.candidates++;
    }
    row.newest = newest ? new Date(newest).toISOString().slice(0, 10) : null;
  } catch (e) {
    const m = String((e as Error).message || e);
    const st = m.match(/status code\s*(\d{3})/i);
    row.status = st ? `fail ${st[1]}` : `fail ${((e as any).code || m).toString().slice(0, 30)}`;
  }
  return row;
}

async function main() {
  const json = process.argv.includes('--json');
  const p = fieldProfile();
  const parser = new Parser({ customFields: { item: ['source', 'description', 'content:encoded'] } });
  const sources = buildAllSources(p);
  const rows: ProbeRow[] = [];
  const CHUNK = 6;
  for (let i = 0; i < sources.length; i += CHUNK) {
    rows.push(...(await Promise.all(sources.slice(i, i + CHUNK).map((s) => probeSource(s, parser)))));
  }
  for (const b of loadBroadcastSources()) {
    const r: ProbeRow = { id: `broadcast:${b.outletId}`, type: 'broadcast', grade: 'press', active: true, status: '', read: 0, candidates: 0, newest: null };
    try {
      const items = await fetchBroadcastItems(b, 15);
      r.status = 'ok';
      r.read = items.length;
      r.candidates = items.filter(passesBroadcastKeywordGate).length;
      r.newest = items[0]?.publishedAt?.slice(0, 10) || null;
    } catch (e) {
      r.status = `fail ${String((e as Error).message).match(/\d{3}/)?.[0] || 'ERR'}`;
    }
    rows.push(r);
  }
  const active = rows.filter((r) => r.active);
  const ok = active.filter((r) => r.status.startsWith('ok'));
  const summary = {
    field: p.field,
    at: new Date().toISOString(),
    sources: rows.length,
    active: active.length,
    inactive: rows.length - active.length,
    ok: ok.length,
    failed: active.length - ok.length,
    read: ok.reduce((n, r) => n + r.read, 0),
    candidates: ok.reduce((n, r) => n + r.candidates, 0),
    byType: Object.fromEntries(
      [...new Set(rows.map((r) => r.type))].map((t) => {
        const rs = ok.filter((r) => r.type === t);
        return [t, { sources: rows.filter((r) => r.type === t).length, ok: rs.length, read: rs.reduce((n, r) => n + r.read, 0), candidates: rs.reduce((n, r) => n + r.candidates, 0) }];
      }),
    ),
  };
  if (json) {
    console.log(JSON.stringify({ summary, rows }, null, 1));
    return;
  }
  console.log(`=== 읽기 전용 소스 점검 (field=${p.field} · DB·DeepSeek 없음) ===`);
  for (const r of rows) {
    console.log(`${r.id}\t${r.type}\t${r.grade}\t${r.status}\t읽음 ${r.read}\t후보 ${r.candidates}\t최신 ${r.newest ?? '-'}${r.note ? `\t${r.note}` : ''}`);
  }
  console.log(`\n합계: 소스 ${summary.sources}(활성 ${summary.active} · 비활성 ${summary.inactive}) · 성공 ${summary.ok} · 실패 ${summary.failed} · 읽음 ${summary.read} · 후보 ${summary.candidates}`);
  for (const [t, v] of Object.entries(summary.byType)) console.log(`  ${t}: ${JSON.stringify(v)}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
