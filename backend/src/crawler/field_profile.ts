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
    /**
     * NEWS-Q11 ■3: 핵심어 묶음(이름 → 낱말). 실행마다 묶음별 후보·저장 수를 센다 · 방송 관문 하위 주제 후보.
     * '_' 로 시작하는 칸은 설명. 없으면 묶음 수를 세지 않는다.
     */
    groups?: Record<string, string[] | string>;
    /** NEWS-Q12 ■4: 묶음 이름 → 내보내기 subtype 영문 id(묶인 범주는 둘 다 · 없는 묶음·기타 = 빈 배열) */
    group_ids?: Record<string, string[] | string>;
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
    /** NEWS-Q12 ■2: 보도 날짜가 수집일보다 이 날 수 넘게 오래된 기사(방송 아님)는 실림 대신 보관 · 없으면 끔 · 앞으로만 */
    old_dated_archive_days?: number;
    /**
     * NEWS-Q14 ■3: 본문 추출 단락기로 본문을 못 읽은 기사는 RSS 요약(description · 제목·매체 이름 뺀 글)이 이 글자 수 이상이면
     * 제목 + 요약으로 판정(관문 1번 그대로 · 추가 호출 0). 없거나 0 이면 끔(옛 규칙: 본문 부실 건너뜀).
     */
    breaker_summary_min_chars?: number;
    /**
     * NEWS-Q18 ■2: 관문 앞 주제 거름(LLM 0 · topic_exclude.ts) — must ∧ context ∧ ¬except 이면 거부(사유 = id) ·
     * 이미 실린 기사는 다음 실행 시작에 보관층으로(keep_ids = 되돌림). 없으면 끔.
     */
    topic_exclude?: Array<{ id: string; must: string[]; context: string[]; except: string[]; keep_ids?: number[]; sweep_created_before?: string }>;
  };
  prompts: {
    summary_system: string;
    judge_criteria: string;
    judge_system: string;
    judge_schema_name: string;
    judge_fit_description: string;
    fallback_summary_line: string;
    /** NEWS-Q11 ■2: 방송 전용 관문 한 질문(이 편이 분야를 다루는가 · 예/부분/아니오 + 하위 주제). 없으면 방송 판정 0(fail-closed). */
    broadcast_gate?: string;
  };
  sources: {
    press_files: { world?: string; kr?: string; specialty?: string };
    google_news: ProfileFeed[];
    specialized: ProfileFeed[];
    institutions: ProfileFeed[];
    academic: ProfileFeed[];
    /**
     * lookback_pages = NEWS-Q11 ■2 업로드 재생목록 되짚기 쪽 수(한 쪽 50편 · 1단위) — 없으면 3
     * NEWS-Q12 ■2: cover_days = 기본 쪽 수로 이만큼 못 덮으면 max_pages 까지 더(더 읽는 쪽은 하루 unit_cap_day 안)
     * NEWS-Q12 ■1: clip_markers = 제목에 있으면 예고·클립(실림 대신 보관) · episode_days = 같은 회차로 볼 날짜 폭(±)
     */
    broadcast: {
      file: string;
      keywords: string[];
      false_friends: string[];
      lookback_pages?: number;
      cover_days?: number;
      max_pages?: number;
      unit_cap_day?: number;
      clip_markers?: string[];
      episode_days?: number;
      /** 같은 회차 제목 비교에서 빼는 흔한 낱말(분야 낱말이 겹친다고 같은 회차는 아님) */
      episode_generic_words?: string[];
      /** NEWS-Q12 ■1: 실린 방송 가운데 보관층으로 옮길 id(본편 아닌 예고·클립 · 이미 보관이면 그대로) */
      archive_ids?: number[];
      /** NEWS-Q13 ■2: 관련 클립 자동 묶기 — 본편 뒤 이 날 수 안(기본 3) · keep_ids = 보관층에서 실림으로 되돌릴 id */
      related_days?: number;
      keep_ids?: number[];
      /** 본편 표시 정규식(없으면 코드 기본 · 방송 꼬리 「… 방송」·「N회」·날짜·[full]) */
      main_evidence?: string[];
      /**
       * NEWS-Q14 ■4: 영상 길이로 본편·클립 가리기(videos.list contentDetails · 50편 1단위) — 본편 = 방송 꼬리 ∨ 길이 ≥ main_min_seconds ·
       * 클립 = 길이 ≤ clip_max_seconds(NEWS-Q15 ■2 · 61초부터는 [full] · 방송 꼬리면 본편) · 길이 읽기는 KST 하루 합 duration_unit_cap_day 단위 안
       * (NEWS-Q15 ■3 · 하루 가드 그대로). 없거나 0 이면 끔.
       */
      main_min_seconds?: number;
      clip_max_seconds?: number;
      duration_unit_cap_day?: number;
      /**
       * NEWS-Q16 ■1: 재업로드 = 제목 · 설명의 원 방송일이 게시일(KST)보다 이 날 수 넘게 앞섬 → published_at = 원 방송일(규칙 · LLM 0) ·
       * 다음 실행 시작에 이미 저장된 방송 행도 같은 규칙으로 맞춤. 없거나 0 이면 끔.
       */
      aired_date_min_days?: number;
      /** NEWS-Q16 리뷰: 원 방송일 맞춤에서 뺄 id(손으로 날짜를 고친 행 · 잘못 읽힌 행 — 다음 실행이 다시 옮기지 않게) */
      aired_skip_ids?: number[];
      /**
       * NEWS-Q16 ■2: 방송 관문 한 번 다시 판정(id 가 runs 에 done 이면 다시 안 돎) — yes = 실림으로 · partial · no = 보관 그대로(지움 0) · 결과 progress.broadcastRejudge.
       */
      rejudge_once?: { id: string; ids: number[] };
      /** NEWS-Q13 ■3: 못 닿은 채널만 search.list 로 한 번 메움(id 가 runs 에 done 이면 다시 안 돎) */
      backfill_search_once?: {
        id: string;
        channels: string[];
        query: string;
        days?: number;
        max_pages?: number;
        unit_cap_day?: number;
      };
    };
    statory_query: string;
    /** NEWS-Q7 ■3: 놓친 날 되짚기(국내지 구글 site: 날짜 검색) — 없으면 끔 */
    missed_day?: { query: string; max_items?: number; max_days?: number; locale?: string };
    /**
     * NEWS-Q14 ■1: 집계기(구글뉴스 · Statory) 스팸 출처 — 피드 <source> 또는 제목 끝 「 - 출처」가 names 가운데 하나면 거부(판정 호출 0 · 격리 0).
     * archive_ids = 이미 실린 그 출처 글을 다음 실행 시작에 보관층으로(이 id · 기사 · 실림층 · 출처가 names 에 맞는 행만 · 지움 0).
     */
    spam_publishers?: { names?: string[]; archive_ids?: number[] };
    /**
     * NEWS-Q16 ■5: 오너 공개 자료(보고서 · 현황자료) → 기획기사 · 리포트 칸(GET /reports 에 Statory 보고서와 함께).
     * enabled = 스위치(false = 꺼짐 · 지금 응답 그대로) · file = data/ 아래 JSON(items[]) · max_items = 한 번에 내보낼 수(기본 20).
     */
    owner_materials?: { enabled?: boolean; file?: string; max_items?: number };
  };
  messages: { notify_prefix: string };
  smoke_samples: Array<{ label: string; title: string; content: string; category: string }>;
  /** 백과(encyclopedia) 시드 파일·자동 링크 제외어 */
  encyclopedia: { file: string; link_stop: string[] };
  /** Statory 보고서 API scenario_id */
  statory_scenario_id: string;
  /** NEWS-Q18 ■3: TOP 무게 규칙 상수(articles/cluster_view TopRule) · 없으면 옛 규칙(묶음 크기) */
  top_rank?: {
    national_sources: string[];
    national_bonus: number;
    institution_words: string[];
    institution_bonus: number;
    local_words: string[];
    local_patterns?: string[];
    local_penalty: number;
    per_report: number;
    report_cap: number;
    /** NEWS-Q19 ■3: 묶음 제목에 분야 핵심어(topicTitleWords)가 하나도 없으면 더함(예: -1) · 없거나 0 이면 끔 */
    off_topic_penalty?: number;
    /** NEWS-Q19 리뷰: 기존 목록에 없는 제목 핵심어(TOP 감점 판단에만 · 수집 · 묶음 셈에는 안 씀) */
    topic_words_extra?: string[];
  };
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
      spam_publishers: s.spam_publishers && typeof s.spam_publishers === 'object' ? s.spam_publishers : undefined,
      // NEWS-Q16 ■5: 없거나 꼴이 틀리면 undefined(= 스위치 꺼짐)
      owner_materials: s.owner_materials && typeof s.owner_materials === 'object' ? s.owner_materials : undefined,
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

/**
 * NEWS-Q19 ■3: 제목 분야 핵심어 = 기존 목록 재사용(keywords.strong 모든 언어 + keywords.core + keywords.groups 낱말)
 * + top_rank.topic_words_extra(리뷰 · TOP 전용) · 소문자 · 겹침 뺌.
 * categories.keywords(정책 · 정부 · 교육 류)는 넓어서 넣지 않는다.
 */
export function topicTitleWords(p: FieldProfile = fieldProfile()): string[] {
  const groups = Object.entries(p.keywords.groups || {})
    .filter(([k, v]) => !k.startsWith('_') && Array.isArray(v))
    .flatMap(([, v]) => v as string[]);
  const all = [...flattenLang(p.keywords.strong), ...(p.keywords.core || []), ...groups, ...(p.top_rank?.topic_words_extra || [])];
  return [...new Set(all.map((w) => String(w || '').trim().toLowerCase()).filter(Boolean))];
}
