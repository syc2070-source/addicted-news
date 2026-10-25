// ============================================================
// owner_materials.ts (NEWS-Q16 ■5) — 오너 공개 자료(보고서 · 현황자료) → 기획기사 · 리포트 칸의 문(LLM 0 · DB 0 · 스키마 0).
// 실측(10-25): 기획기사 칸의 「Statory 보고서」 두 편은 관리자 입력 · 시드가 아니라
//   GET /reports 가 Statory API(/api/reports?scenario_id=<분야>)를 그대로 대리해 가져온 것 · 기획기사 표시 글(/articles/featured)은 0.
//   리포트 쪽(frontend reports.html)은 「준비 중」 고정 글.
// 그래서 문도 같은 길(GET /reports)에 단다: 분야 설정 sources.owner_materials.enabled(스위치 · 지금 false) ∧ data/owner_materials.json 의
//   공개(public: true) · 꼴이 맞는 항목을 Statory ReportCard 와 같은 꼴(+ source_label · link_url · body_ko)로 섞어 낸다.
// 스위치가 꺼져 있으면 응답은 지금과 같다(시험).
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import { fieldProfile } from '../crawler/field_profile';

export type OwnerMaterialKind = 'report' | 'status';

/** 들어오는 꼴(data/owner_materials.json items[] 한 항목) */
export interface OwnerMaterial {
  /** 소문자 · 숫자 · - (1~60자) — 공개 id 는 owner-<id> */
  id: string;
  /** report = 보고서 · status = 현황자료 */
  kind: OwnerMaterialKind;
  title: string;
  summary: string;
  /** 본문(글) · link 가운데 하나 이상 */
  body?: string;
  /** https 주소 */
  link?: string;
  /** YYYY-MM-DD */
  date: string;
  /** 출처 = 오너(고정) */
  source: '오너';
  /** true 만 내보냄 */
  public: boolean;
}

export const OWNER_SOURCE = '오너';
export const OWNER_ID_PREFIX = 'owner-';
export const LIMITS = { title: 200, summary: 600, body: 20000, link: 2000 };

/** Statory ReportCard 와 같은 꼴 + 오너 칸(source_label · link_url · origin) */
export interface OwnerReportCard {
  id: string;
  scenario_id: string;
  scope: 'owner';
  title_ko: string;
  title_en: null;
  summary_ko: string;
  conclusion_ko: null;
  key_findings: [];
  thumbnail_chart_json: null;
  domain: null;
  region: null;
  category: OwnerMaterialKind;
  engines_count: 0;
  sections_count: 0;
  view_count: 0;
  published_at: string;
  sections_json: null;
  origin: 'owner';
  source_label: string;
  link_url: string | null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validLink(s: string): boolean {
  if (s.length > LIMITS.link) return false;
  try {
    const u = new URL(s);
    // 리뷰(Q16): 호스트의 따옴표는 정규화로 %-부호가 되지 않음 → 호스트는 글자 · 숫자 · . · - 만 · 정규화한 꼴에 따옴표 · <> · 빈칸 0
    return u.protocol === 'https:' && /^[a-z0-9.-]+$/.test(u.hostname) && !/["'<>\s`\\]/.test(u.href);
  } catch {
    return false;
  }
}

/** 한 항목 꼴 확인 — 맞으면 item(앞뒤 빈칸 뗌) · 틀리면 까닭들. 공개 여부는 여기서 거르지 않음(꼴만). */
export function validateOwnerMaterial(raw: unknown): { ok: true; item: OwnerMaterial } | { ok: false; errors: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['not_object'] };
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];
  const id = str(r.id);
  const kind = str(r.kind);
  const title = str(r.title);
  const summary = str(r.summary);
  const body = str(r.body);
  const link = str(r.link);
  const date = str(r.date);
  const source = str(r.source);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(id)) errors.push('id');
  if (kind !== 'report' && kind !== 'status') errors.push('kind');
  if (!title || title.length > LIMITS.title) errors.push('title');
  if (!summary || summary.length > LIMITS.summary) errors.push('summary');
  if (body.length > LIMITS.body) errors.push('body');
  if (link && !validLink(link)) errors.push('link');
  if (!body && !link) errors.push('body_or_link');
  if (!validDate(date)) errors.push('date');
  if (source !== OWNER_SOURCE) errors.push('source');
  if (typeof r.public !== 'boolean') errors.push('public');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    item: {
      id, kind: kind as OwnerMaterialKind, title, summary, date, source: OWNER_SOURCE, public: r.public as boolean,
      // 링크는 정규화한 꼴(빈칸 · 따옴표가 %-부호로 · validLink 가 남은 따옴표 · <> 를 막음 — 화면 href 에 들어가도 속성을 깨지 않게)
      ...(body ? { body } : {}), ...(link ? { link: new URL(link).href } : {}),
    },
  };
}

export interface OwnerMaterialsConfig {
  enabled?: boolean;
  file?: string;
  max_items?: number;
}

export interface OwnerMaterialsLoad {
  enabled: boolean;
  /** 공개 · 꼴 맞음 · 날짜 늦은 것 먼저 · max_items 까지 */
  items: OwnerMaterial[];
  /** 꼴이 틀려 뺀 항목(차례 · id · 까닭) — 로그 · 시험용(공개 응답에 넣지 않음) */
  rejected: Array<{ index: number; id: string; errors: string[] }>;
}

const DATA_DIR = path.join(__dirname, '../../data');

/** 설정 → 파일 읽기(스위치 꺼짐 · 파일 없음 · JSON 오류 = items []). 파일 이름은 data/ 바로 아래 *.json 만. */
export function loadOwnerMaterials(
  cfg: OwnerMaterialsConfig | undefined = fieldProfile().sources.owner_materials,
  dir: string = DATA_DIR,
  read: (f: string) => string = (f) => fs.readFileSync(f, 'utf8'),
): OwnerMaterialsLoad {
  const out: OwnerMaterialsLoad = { enabled: cfg?.enabled === true, items: [], rejected: [] };
  if (!out.enabled) return out;
  const name = cfg?.file || 'owner_materials.json';
  if (!/^[A-Za-z0-9_-]{1,60}\.json$/.test(name)) return out;
  let raw: { items?: unknown } | null = null;
  try {
    raw = JSON.parse(read(path.join(dir, name)));
  } catch {
    return out;
  }
  const list = Array.isArray(raw?.items) ? raw!.items : [];
  const seen = new Set<string>();
  list.forEach((it, index) => {
    const v = validateOwnerMaterial(it);
    if (!v.ok) {
      out.rejected.push({ index, id: str((it as Record<string, unknown> | null)?.id), errors: v.errors });
      return;
    }
    if (seen.has(v.item.id)) {
      out.rejected.push({ index, id: v.item.id, errors: ['duplicate_id'] });
      return;
    }
    seen.add(v.item.id);
    if (v.item.public) out.items.push(v.item);
  });
  const max = Number.isInteger(cfg?.max_items) && Number(cfg?.max_items) > 0 ? Number(cfg?.max_items) : 20;
  out.items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
  out.items = out.items.slice(0, max);
  return out;
}

/** 오너 항목 → 목록 카드(Statory ReportCard 꼴). published_at = 그날 0시 KST. */
export function ownerReportCard(m: OwnerMaterial, scenarioId: string): OwnerReportCard {
  return {
    id: `${OWNER_ID_PREFIX}${m.id}`,
    scenario_id: scenarioId,
    scope: 'owner',
    title_ko: m.title,
    title_en: null,
    summary_ko: m.summary,
    conclusion_ko: null,
    key_findings: [],
    thumbnail_chart_json: null,
    domain: null,
    region: null,
    category: m.kind,
    engines_count: 0,
    sections_count: 0,
    view_count: 0,
    published_at: `${m.date}T00:00:00+09:00`,
    sections_json: null,
    origin: 'owner',
    source_label: OWNER_SOURCE,
    link_url: m.link ?? null,
  };
}

/**
 * 목록 섞기: 오너 카드(첫 쪽에만 · offset 0) + Statory 항목 → published_at 늦은 것 먼저 · limit 까지.
 * Statory 응답의 다른 칸은 그대로 · count = 섞은 뒤 수 + (Statory count − Statory 받은 수).
 */
export function mergeReportLists(
  statory: { count?: unknown; items?: unknown } | null,
  owner: OwnerReportCard[],
  limit: number,
  offset: number,
): { count: number; items: unknown[] } & Record<string, unknown> {
  const sItems = statory && Array.isArray(statory.items) ? (statory.items as unknown[]) : [];
  const sCount = statory && Number.isFinite(Number(statory.count)) ? Number(statory.count) : sItems.length;
  const own = offset > 0 ? [] : owner;
  const ts = (x: unknown) => {
    const t = Date.parse(String((x as { published_at?: unknown })?.published_at ?? ''));
    return Number.isNaN(t) ? 0 : t;
  };
  const items = [...own, ...sItems].sort((a, b) => ts(b) - ts(a)).slice(0, Math.max(0, limit));
  return { ...(statory || {}), count: sCount + own.length, items };
}
