// ============================================================
// field_profile.ts (NEWS-Q2 ■1) — 분야 설정 읽기.
// 수집기·관문·공개 API 는 분야 글자를 코드에 두지 않고 data/field_profiles/<이름>.json 을 읽는다.
// 이름 = 환경변수 FIELD_PROFILE (기본 = data/field_profiles/DEFAULT 파일). 파일이 없거나 꼴이 틀리면 시끄럽게 실패한다
// (빈 설정으로 조용히 아무것도 안 모으는 것보다 낫다).
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import type { BlockedInfo } from './crawl_schedule';

export const FIELD_PROFILE_DIR = path.join(__dirname, '../../data/field_profiles');

/** 기본 분야 이름 = data/field_profiles/DEFAULT 파일의 첫 줄(코드에 분야 이름을 두지 않는다). */
export function defaultFieldProfileName(dir: string = FIELD_PROFILE_DIR): string {
  try {
    return fs.readFileSync(path.join(dir, 'DEFAULT'), 'utf8').split(/\r?\n/)[0].trim();
  } catch {
    throw new FieldProfileError(`FIELD_PROFILE 이 없고 기본 파일도 없음: ${path.join(dir, 'DEFAULT')}`);
  }
}

type LangKeys = { ko?: string[]; en?: string[]; [lang: string]: string[] | string | undefined };

export type SourceGrade = 'institution' | 'academic' | 'press' | 'aggregator';
export type TierRule = 'archive' | 'reject';

export interface ProfileFeed {
  id: string;
  url: string;
  source_name?: string;
  category?: string;
  region?: string;
  lang?: string;
  outlet_id?: string;
  priority?: number;
  grade?: SourceGrade;
  max_items?: number;
  active?: boolean;
  inactive_reason?: string;
  /** 'rss'(기본) | 'html' | 'json' — html 은 list_pattern, json 은 json_map 으로 읽는다. */
  format?: 'rss' | 'html' | 'json';
  /** html 목록: 항목 하나를 잡는 정규식(이름 붙은 묶음 link·title·date). */
  list_pattern?: string;
  /** json 목록: 칸 이름(items·title·link·date) · link_prefix */
  json_map?: { items: string; title: string; link: string; date?: string; link_prefix?: string };
  /** NEWS-Q4 ■2: 막힌 피드(Render 망에서만 막힘 · 어디서나 403) — 원 피드는 주·월 1회만 다시 해 봄 */
  blocked?: BlockedInfo;
  /** NEWS-Q4 ■2: 이 피드가 대신 읽는 원 피드 id(구글뉴스 site: 검색) */
  substitute_for?: string;
  /** 이보다 오래된 항목은 건너뜀(대체 검색 피드용) */
  max_age_days?: number;
}

export interface FieldProfile {
  field: string;
  site_name: string;
  database_default: string;
  freshness_hours: number;
  categories: {
    list: string[];
    default: string;
    requires_core_keyword: string[];
    slugs: Record<string, string>;
    aliases: Record<string, string>;
    keywords: Record<string, string[]>;
  };
  keywords: {
    strong: LangKeys;
    negative: LangKeys;
    /**
     * NEWS-Q8 ■1: 한글 제외어는 낱말 경계에서만 맞춘다(「출입금지」 속 「입금」은 제외어 아님). 없으면 옛 부분문자열 맞춤.
     * particles = 뒤에 붙어도 경계로 치는 조사 · anywhere = 경계 없이도 제외할 낱말 · allow_long = 제외어를 품어도 지나가는 긴 낱말.
     */
    negative_boundary?: { particles?: string[]; anywhere?: string[]; allow_long?: string[]; endings?: string[] };
    /**
     * NEWS-Q10 ■2: 제외어마다 「이 낱말이 함께 있으면 막지 않음」(keep_with_any). 없으면 늘 막음.
     */
    negative_context?: Record<string, { keep_with_any?: string[] } | string>;
    /**
     * NEWS-Q10 ■2: 스팸 낱말 하나 ∧ 제목 핵심어 = 떨어뜨리지 않고 관문(DeepSeek)으로. 없으면 옛 규칙(떨어뜨림).
     * words = 스팸 낱말 · max_hits = 스팸 낱말 몇 개까지 · unless_any = 이 낱말(도박 쪽)이 있으면 그대로 떨어뜨림
     * (ad_penalty 낱말이 있어도 그대로 떨어뜨림).
     */
    spam_gate?: { words?: string[]; max_hits?: number; unless_any?: string[] };
    /**
     * NEWS-Q9 ■1: 뜻이 둘인 strong 핵심어(「금주」 = 술 끊기 / 이번 주)를 조건부로만 센다. 없으면 옛 부분문자열.
     * skip_attached = 바로 붙으면 안 세는 꼴(금주의) · skip_next_word = 붙거나 한 칸 띄고 오면 안 세는 낱말(금주 이슈)
     * · keep_attached / keep_next_word = 뜻이 굳은 꼴(금주구역 · 금주 운동) = 맥락 없이도 셈
     * · lead_any = 제목·첫 문단에 이 가운데 하나(낱말 머리)가 있어야 셈 · lead_chars = 첫 문단 길이 상한.
     */
    strong_context?: Record<
      string,
      | {
          skip_attached?: string[];
          skip_next_word?: string[];
          keep_attached?: string[];
          keep_next_word?: string[];
          lead_any?: string[];
          lead_chars?: number;
        }
      | string
    >;
    core: string[];
    ad_penalty: string[];
    dup_stopwords: string[];
    incident_patterns: string[];
    policy_context: string[];
  };
  gate: {
    publish: { category_fit: boolean; is_incident: boolean; confidence: 'high' | 'medium' | 'low' };
    incident: TierRule;
    low_confidence: TierRule;
    category_mismatch_with_keyword: TierRule;
    deepseek_daily_cap: number;
  };
  prompts: {
    summary_system: string;
    judge_criteria: string;
    judge_system: string;
    judge_schema_name: string;
    judge_fit_description: string;
    fallback_summary_line: string;
  };
  sources: {
    press_files: { world?: string; kr?: string; specialty?: string };
    google_news: ProfileFeed[];
    specialized: ProfileFeed[];
    institutions: ProfileFeed[];
    academic: ProfileFeed[];
    broadcast: { file: string; keywords: string[]; false_friends: string[] };
    statory_query: string;
    /** NEWS-Q7 ■3: 놓친 날 되짚기(국내지 구글 site: 날짜 검색) — 없으면 끔 */
    missed_day?: { query: string; max_items?: number; max_days?: number; locale?: string };
  };
  messages: { notify_prefix: string };
  smoke_samples: Array<{ label: string; title: string; content: string; category: string }>;
  /** 백과(encyclopedia) 시드 파일·자동 링크 제외어 */
  encyclopedia: { file: string; link_stop: string[] };
  /** Statory 보고서 API scenario_id */
  statory_scenario_id: string;
}

export class FieldProfileError extends Error {}

const REQUIRED: Array<[string, (p: any) => unknown]> = [
  ['field', (p) => typeof p.field === 'string' && p.field],
  ['site_name', (p) => typeof p.site_name === 'string'],
  ['categories.list', (p) => Array.isArray(p.categories?.list) && p.categories.list.length > 0],
  ['categories.default', (p) => p.categories?.list?.includes(p.categories?.default)],
  ['keywords.strong', (p) => p.keywords?.strong && typeof p.keywords.strong === 'object'],
  ['gate.publish', (p) => p.gate?.publish && typeof p.gate.publish === 'object'],
  ['prompts.summary_system', (p) => typeof p.prompts?.summary_system === 'string'],
  ['prompts.judge_system', (p) => typeof p.prompts?.judge_system === 'string'],
  ['sources', (p) => p.sources && typeof p.sources === 'object'],
];

/** 이름 → 파일 읽기. 이름은 소문자·숫자·-_ 만(경로 넘나들기 막음). */
export function loadFieldProfile(name?: string, dir: string = FIELD_PROFILE_DIR): FieldProfile {
  const n = (name ?? defaultFieldProfileName(dir)).trim();
  if (!/^[a-z0-9_-]{1,40}$/.test(n)) throw new FieldProfileError(`FIELD_PROFILE 이름이 틀림: "${name}"`);
  const file = path.join(dir, `${n}.json`);
  if (!fs.existsSync(file)) throw new FieldProfileError(`분야 설정 없음: ${file}`);
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new FieldProfileError(`분야 설정 JSON 오류(${file}): ${(e as Error).message}`);
  }
  const missing = REQUIRED.filter(([, ok]) => !ok(raw)).map(([k]) => k);
  if (missing.length) throw new FieldProfileError(`분야 설정 칸 빠짐(${n}): ${missing.join(', ')}`);
  return withDefaults(raw);
}

function withDefaults(p: any): FieldProfile {
  const s = p.sources || {};
  return {
    ...p,
    database_default: p.database_default || p.field,
    freshness_hours: Number(p.freshness_hours) > 0 ? Number(p.freshness_hours) : 72,
    categories: {
      requires_core_keyword: [], slugs: {}, aliases: {}, keywords: {},
      ...p.categories,
    },
    keywords: {
      negative: {}, core: [], ad_penalty: [], dup_stopwords: [], incident_patterns: [], policy_context: [],
      ...p.keywords,
    },
    gate: {
      incident: 'reject', low_confidence: 'reject', category_mismatch_with_keyword: 'reject', deepseek_daily_cap: 400,
      ...p.gate,
    },
    prompts: {
      judge_criteria: '', judge_schema_name: `${p.field}_judgment`, judge_fit_description: '', fallback_summary_line: '',
      ...p.prompts,
    },
    sources: {
      press_files: s.press_files || {},
      google_news: s.google_news || [],
      specialized: s.specialized || [],
      institutions: s.institutions || [],
      academic: s.academic || [],
      broadcast: { file: '', keywords: [], false_friends: [], ...(s.broadcast || {}) },
      statory_query: s.statory_query || '',
      missed_day: s.missed_day && typeof s.missed_day.query === 'string' ? s.missed_day : undefined,
    },
    messages: { notify_prefix: p.site_name, ...(p.messages || {}) },
    smoke_samples: p.smoke_samples || [],
    encyclopedia: { file: '', link_stop: [], ...(p.encyclopedia || {}) },
    statory_scenario_id: p.statory_scenario_id || p.field,
  };
}

let cached: FieldProfile | null = null;

/** 실행 중 쓰는 분야 설정(FIELD_PROFILE · 한 번 읽고 기억). */
export function fieldProfile(): FieldProfile {
  if (!cached) cached = loadFieldProfile(process.env.FIELD_PROFILE || undefined);
  return cached;
}

/** 시험용: 기억한 설정을 비우거나 바꿔 끼운다. */
export function setFieldProfileForTest(p: FieldProfile | null): void {
  cached = p;
}

/** DB 이름 기본값(환경변수 DB_NAME 이 없을 때) — 분야 설정에서. */
export function defaultDbName(env: NodeJS.ProcessEnv = process.env): string {
  return env.DB_NAME || fieldProfile().database_default;
}

/** 언어별 낱말 → 한 목록(ko·en 먼저, 그다음 es·pt 등 나머지 언어 · NEWS-Q6 ■1). '_' 로 시작하는 칸은 설명이라 뺀다. */
export function flattenLang(block?: LangKeys): string[] {
  if (!block) return [];
  const rest = Object.keys(block).filter((k) => k !== 'ko' && k !== 'en' && !k.startsWith('_'));
  return ['ko', 'en', ...rest].flatMap((k) => (Array.isArray(block[k]) ? (block[k] as string[]) : [])).filter(Boolean);
}
