// ============================================================
// 분야 뉴스 요약: DeepSeek 기반 한국어 "충실한 한 문단" 요약(분야 문구 = 분야 설정 prompts)
// 외국어 → 한국어 번역+요약 통합. env: DEEPSEEK_API_KEY
// ============================================================
import OpenAI from 'openai';
import { extractJsonObject } from './json_extract';
import { judgeSystem, JUDGE_RETRY_SYSTEM, judgeJsonSchema, buildJudgeUser } from './judge_prompt';
import { fieldProfile } from './field_profile';

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
// 모델명 단일 소스: 환경변수 DEEPSEEK_MODEL. 기본값은 현행 모델(구 deepseek-chat 폐기됨).
// 백엔드는 이 상수를 통해서만 모델을 참조한다(하드코딩 금지).
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

// JSON 절단(finish_reason='length') 방지. 요약 5~8문장 + 판정 필드 + 여유.
// 기존 900은 부족해 {"titleKo":...,"is_incident":false, 에서 잘리는 사례가 발생했다.
export const MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS || 2000);
export const MAX_TOKENS_RETRY = Number(process.env.DEEPSEEK_MAX_TOKENS_RETRY || 3000);
export const deepseekAvailable = !!DEEPSEEK_KEY;

// NEWS-Q6 ⓑ′: SDK 기본값(요청당 10분 · 재시도 2)은 DeepSeek 가 응답 없이 멈추면 호출 하나가 30분을 잡는다
// (10-15 방송 후보 2건 · 호출 4번에 62분 → 기사 소스 0). 요청당 60초 · 재시도 1.
export const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS || 60_000);
const deepseek = deepseekAvailable
  ? new OpenAI({ apiKey: DEEPSEEK_KEY, baseURL: 'https://api.deepseek.com', timeout: DEEPSEEK_TIMEOUT_MS, maxRetries: 1 })
  : null;

// 연결 실패(시간 초과·끊김 = status 없음)나 5xx 가 연달아 이만큼이면 이번 실행은 DeepSeek 를 더 부르지 않는다.
// 4xx(요청 하나의 문제)는 세지 않는다. 판정 없이 남은 후보는 거부로 남기지 않고 건너뛴다(다음 실행이 다시 본다).
export const DEEPSEEK_DOWN_AFTER = 3;
let deepseekTransportFails = 0;
export function noteDeepseekResult(err?: { status?: number } | null): void {
  if (!err) { deepseekTransportFails = 0; return; }
  const s = err.status;
  if (s === undefined || s === null || s >= 500) deepseekTransportFails++;
}
export function deepseekDown(): boolean {
  return deepseekTransportFails >= DEEPSEEK_DOWN_AFTER;
}

// v5.2 #6: DeepSeek 실제 호출 집계(비용 추적). 재시도 포함 매 API 요청을 calls로,
// 성공/실패를 분리 집계한다. (기존 apiCallCount는 미호출 dead-code였음)
export const deepseekStats = { calls: 0, ok: 0, fail: 0, promptTokens: 0, completionTokens: 0 };

/** 응답의 usage 를 더한다(없으면 0). 비용 추정은 deepseek_budget.estimateCostUsd. */
export function addUsage(r: { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null | undefined): void {
  deepseekStats.promptTokens += Number(r?.usage?.prompt_tokens || 0);
  deepseekStats.completionTokens += Number(r?.usage?.completion_tokens || 0);
}

// LANG-GUARD-1 작업1-3: 한국어 출력 지시를 프롬프트 맨 앞에 명시(보조 수단).
// ※ 방어선은 저장 직전 가드(lang_output)이며, 이 문구만으로 갈음하지 않는다.
const KOREAN_ONLY_RULE =
  '[언어 규칙 — 최우선] titleKo 와 summary 는 반드시 한국어로 작성한다. ' +
  '원문이 중국어·일본어·영어 등 어떤 언어이든, 산출물은 한국어여야 한다. ' +
  '원문 문장을 그대로 옮기거나 원문 언어로 답하지 말 것. 고유명사는 한국어 표기하되 ' +
  '필요하면 괄호로 원어를 병기한다. ';

// 요약 역할·규칙(분야 문구 포함)은 분야 설정 prompts.summary_system(NEWS-Q2 ■1).
function summarySystemKoBase(): string {
  return KOREAN_ONLY_RULE + fieldProfile().prompts.summary_system;
}

// v5.4: 입구 게이트용 판정 — 유지/거부 기준은 분야 설정 prompts.judge_criteria, 출력 형식은 여기.
const JUDGE_FORMAT_TAIL =
  '반드시 아래 JSON만 출력(다른 텍스트 금지): ' +
  '{"titleKo":"제목(외국어는 한국어 번역, 한국어는 원제)","summary":"한국어 한 문단 요약",' +
  '"is_incident":true|false,"category_fit":true|false,"confidence":"high|medium|low"}\n' +
  // v4-flash 대응: 서술형(산문)으로 답하는 케이스 차단.
  '출력 형식 규칙(엄수): 오직 JSON 객체 하나만 출력한다. ' +
  '설명·서문·맺음말·머리말·주석·코드펜스(```)를 절대 붙이지 말 것. ' +
  '응답의 첫 글자는 "{" 이고 마지막 글자는 "}" 여야 한다. ' +
  '판정이 어려워도 산문으로 답하지 말고, 위 JSON 스키마에 confidence:"low" 로 채워 출력할 것.';

function judgeJsonInstruction(): string {
  return fieldProfile().prompts.judge_criteria + JUDGE_FORMAT_TAIL;
}

export function summarySystemKo(): string {
  return summarySystemKoBase() + judgeJsonInstruction();
}

export function summarySystemTranslate(): string {
  return (
    summarySystemKoBase() +
    ' 원문이 외국어(영어·일본어 등)이면 반드시 한국어로 번역·요약하라.' +
    judgeJsonInstruction()
  );
}

// LANG-GUARD-1 1-2: 언어 가드 불합격 후 1회 재생성용 강화 지시.
const KOREAN_RETRY_SYSTEM =
  '[치명적 제약] 직전 산출물이 한국어가 아니어서 폐기됐다. 이번에는 titleKo 와 summary 를 ' +
  '100% 한국어로 작성한다. 중국어·일본어·영어 문장을 그대로 쓰면 다시 폐기된다. ' +
  '한자(漢字)로만 이루어진 제목·요약을 출력하지 말 것. 한국어 문장으로 옮겨 쓸 것.';

// 재시도용 강화 지시(1차에서 JSON 이 없을 때만 사용).
const STRICT_RETRY_SYSTEM =
  '너는 JSON 생성기다. 오직 유효한 JSON 객체 하나만 출력한다. ' +
  '어떤 설명도, 코드펜스도, 서문도 출력하지 않는다. 첫 글자 "{", 마지막 글자 "}". ' +
  '스키마: {"titleKo":string,"summary":string,"is_incident":boolean,' +
  '"category_fit":boolean,"confidence":"high"|"medium"|"low"}';

/**
 * response_format:{type:"json_object"} 사용 시 프롬프트에 "json" 단어가 포함되어야 한다는
 * 제약(OpenAI 호환 JSON 모드 공통)에 대비. 이 세션에서는 DeepSeek 공식 문서 접근이
 * 차단되어 원문 확인 불가 → 제약이 있든 없든 안전하도록 단어 포함을 보장한다.
 * (있으면 필수 충족, 없으면 무해)
 */
function ensureJsonWord(text: string): string {
  return /json/i.test(text) ? text : `${text}\n\n출력은 JSON 형식으로만 한다.`;
}

export type Confidence = 'high' | 'medium' | 'low';
export type DeepSeekPack = {
  titleKo: string;
  summary: string;
  isIncident?: boolean;      // v5.4: true면 거부
  categoryFit?: boolean;     // v5.4: false면 거부
  confidence?: Confidence;   // v5.4: high 아니면 거부(입구 게이트)
};

/**
 * DeepSeek 로 한국어 충실 요약(한 문단) 생성.
 * translate=true 이면 제목도 한국어로 번역해 함께 반환.
 * 실패 시 null
 */
async function summarizeCombined(
  title: string,
  content: string,
  opts?: { translate?: boolean; category?: string; forceKorean?: boolean },
): Promise<DeepSeekPack | null> {
  if (!deepseekAvailable || !deepseek) return null;
  const body = (content || '').trim();
  const translate = !!opts?.translate;
  const catLine = `배정 카테고리: ${opts?.category || '미지정'}\n`;
  const jsonTail = '\n\n반드시 지정한 JSON 형식(titleKo, summary, report_type, category_fit)만 출력.';

  let userMsg: string;
  if (translate) {
    if (body.length > 200) {
      userMsg =
        `다음 외국어 기사를 한국어로 번역·요약하고 성격을 판정하라.\n\n${catLine}` +
        `원제: ${title}\n\n본문:\n${body.slice(0, 4000)}${jsonTail}`;
    } else if (body.length > 30) {
      userMsg =
        `다음 외국어 기사 정보를 한국어로 번역·요약(확인된 내용만 3~5문장)하고 성격을 판정하라.\n\n${catLine}` +
        `원제: ${title}\n\n본문(일부): ${body}${jsonTail}`;
    } else {
      userMsg =
        `외국어 제목만 있다. 한국어 제목으로 옮기고 주제를 2~3문장으로만 요약(사실 창작 금지), 성격도 판정하라.\n\n${catLine}원제: ${title}${jsonTail}`;
    }
  } else if (body.length > 200) {
    userMsg =
      `다음 기사를 5~8문장의 충실한 한 문단으로 요약하고 성격을 판정하라.\n\n${catLine}` +
      `제목: ${title}\n\n본문:\n${body.slice(0, 4000)}${jsonTail}`;
  } else if (body.length > 30) {
    userMsg =
      `다음 기사 정보를 요약(본문이 짧으니 확인된 내용만 3~5문장, 창작 금지)하고 성격을 판정하라.\n\n${catLine}` +
      `제목: ${title}\n\n본문(일부): ${body}${jsonTail}`;
  } else {
    userMsg =
      `아래는 기사 제목만 제공된 경우다. 제목이 시사하는 주제를 2~3문장으로 신중히 요약(구체적 사실 창작 금지)하고 성격을 판정하라.\n\n${catLine}제목: ${title}${jsonTail}`;
  }

  // 1차에서 JSON 이 안 나오면(서술형 응답) 2차는 강화 지시 + temperature 0 으로 재요청.
  let strictRetry = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      deepseekStats.calls++;
      const baseSystem0 = translate ? summarySystemTranslate() : summarySystemKo();
      // LANG-GUARD-1 1-2: 언어 가드 불합격 후 재생성 시 한국어 강제 지시를 앞세운다.
      const baseSystem = opts?.forceKorean ? `${KOREAN_RETRY_SYSTEM}\n\n${baseSystem0}` : baseSystem0;
      const system = strictRetry ? `${STRICT_RETRY_SYSTEM}\n\n${baseSystem}` : baseSystem;
      const userBase = opts?.forceKorean
        ? `${userMsg}\n\n[재요청] 이전 산출물이 한국어가 아니었다. titleKo 와 summary 를 반드시 한국어로만 작성하라.`
        : userMsg;
      const user = strictRetry
        ? `${userBase}\n\n[재요청] 이전 응답이 JSON 이 아니었다. 설명 없이 JSON 객체만 출력하라.`
        : userBase;
      // 요청 파라미터를 한 곳에서 구성 → 전송 여부를 그대로 로그로 확인 가능.
      const params = {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system' as const, content: ensureJsonWord(system) },
          { role: 'user' as const, content: ensureJsonWord(user) },
        ],
        // 구조화 출력 강제(서술형 응답 차단). 프롬프트에 "JSON" 단어 포함은 ensureJsonWord 로 보장.
        response_format: { type: 'json_object' as const },
        temperature: strictRetry ? 0 : 0.4,
        // JSON 절단 방지: 요약 5~8문장 + 판정 필드가 다 들어가야 한다(기존 900은 부족).
        // 재시도는 더 넉넉히. DEEPSEEK_MAX_TOKENS 로 조정 가능.
        max_tokens: strictRetry ? MAX_TOKENS_RETRY : MAX_TOKENS,
      };
      if (process.env.DEEPSEEK_DEBUG_REQ === '1') {
        // 실제 전송 body 확인용(프롬프트 본문은 길어서 길이만).
        console.log('[deepseek][req]', JSON.stringify({
          model: params.model,
          response_format: params.response_format,
          temperature: params.temperature,
          max_tokens: params.max_tokens,
          system_len: params.messages[0].content.length,
          user_len: params.messages[1].content.length,
          system_has_json_word: /json/i.test(params.messages[0].content),
        }));
      }
      const r = await deepseek.chat.completions.create(params);
      addUsage(r as any);
      noteDeepseekResult(null);
      const choice = r.choices?.[0];
      let text = (choice?.message?.content || '').trim();

      // [수정] reasoning_content 는 '추론 산문'이라 요약/판정이 아니다.
      // 이전 구현은 content 가 비면 이 산문을 그대로 text 로 썼고, 그 결과
      // "We are asked..." 같은 영어 추론이 응답 본문처럼 취급됐다.
      // → JSON 이 들어있을 때만 사용하고, 산문이면 버린다(빈 응답 취급 → 강화 재시도).
      if (!text) {
        const rc = (choice?.message as unknown as { reasoning_content?: unknown })?.reasoning_content;
        if (typeof rc === 'string' && rc.trim() && extractJsonObject(rc)) {
          text = rc.trim();
        } else if (typeof rc === 'string' && rc.trim()) {
          console.warn(
            `[deepseek] content 비어 있고 reasoning_content 는 산문 → 폐기(재시도) ` +
            `title="${title.slice(0, 30)}" rc="${rc.slice(0, 120)}..."`,
          );
        }
      }

      // 토큰 상한으로 JSON 이 잘린 경우를 명시적으로 감지(파싱 실패의 실제 원인).
      if (choice?.finish_reason === 'length') {
        console.warn(
          `[deepseek] 응답 절단(finish_reason=length, max_tokens=${params.max_tokens}, ` +
          `attempt ${attempt}/2) title="${title.slice(0, 30)}" — 토큰 상한 상향 필요 시 ` +
          `DEEPSEEK_MAX_TOKENS 조정`,
        );
        if (attempt === 1) { strictRetry = true; continue; }   // 더 넉넉한 상한으로 재시도
      }
      if (!text) {
        // 호출은 됐으나 빈 응답(그동안 조용히 continue 되어 원인 미상이던 지점 — 로깅 추가)
        console.warn(
          `[deepseek] 빈 응답 (attempt ${attempt}/2, model=${DEEPSEEK_MODEL}, ` +
          `finish=${choice?.finish_reason ?? '?'}, translate=${translate}) title="${title.slice(0, 40)}"`,
        );
        strictRetry = true;
        continue;
      }

      // v5.4: 요약 + 판정(report_type/category_fit)을 JSON에서 추출(한/외국어 공통)
      // v4-flash 대응: 코드펜스·앞뒤 설명문·복수 오브젝트를 관대하게 처리(json_extract).
      const extracted = extractJsonObject(text);
      if (extracted) {
        try {
          const parsed = extracted as {
            titleKo?: unknown; summary?: unknown; is_incident?: unknown;
            report_type?: unknown; category_fit?: unknown; confidence?: unknown;
          };
          const summary = String(parsed.summary || '').trim().replace(/\n{2,}/g, '\n').trim();
          const titleKo = String(parsed.titleKo || '').trim() || title;
          // is_incident(신) 우선, 없으면 report_type(구) 호환
          let isIncident: boolean | undefined;
          const ii = parsed.is_incident;
          if (ii === true || ii === 'true') isIncident = true;
          else if (ii === false || ii === 'false') isIncident = false;
          else {
            const rt = String(parsed.report_type || '').toLowerCase();
            isIncident = rt === 'incident' ? true : rt === 'issue' ? false : undefined;
          }
          const cf = parsed.category_fit;
          const categoryFit: boolean | undefined =
            cf === false || cf === 'false' ? false : cf === true || cf === 'true' ? true : undefined;
          const conf = String(parsed.confidence || '').toLowerCase();
          const confidence: Confidence | undefined =
            conf === 'high' ? 'high' : conf === 'medium' ? 'medium' : conf === 'low' ? 'low' : undefined;
          // 번역 경로는 titleKo 필수, 국내 경로는 원제 사용
          const okTitle = translate ? String(parsed.titleKo || '').trim().length > 0 : true;
          if (okTitle && summary.length >= 10) {
            deepseekStats.ok++;
            return { titleKo, summary, isIncident, categoryFit, confidence };
          }
        } catch (pe) {
          // 파싱 실패는 호출 실패와 구분해서 로깅(원인 확정용). 아래 텍스트 폴백으로 진행.
          console.warn(`[deepseek] JSON 판정 파싱 실패 → 텍스트 폴백: ${(pe as Error).message}`);
        }
      } else {
        // 관대한 추출까지 실패 = 서술형(산문) 응답. 원문 앞부분을 남겨 패턴을 확정한다.
        // (DEEPSEEK_RAW_LOG=full 이면 전문, 기본은 400자)
        const raw = process.env.DEEPSEEK_RAW_LOG === 'full' ? text : text.slice(0, 400);
        console.warn(
          `[deepseek] JSON 추출 실패(attempt ${attempt}/2, model=${DEEPSEEK_MODEL}) title="${title.slice(0, 30)}"\n` +
          `---- 응답 원문 ----\n${raw}\n------------------`,
        );
        // 1차 실패면 강화 지시로 1회 재시도(요약 텍스트 폴백으로 새지 않게).
        if (attempt === 1) {
          strictRetry = true;
          continue;
        }
      }

      // JSON 실패 시: 판정 없이 텍스트를 요약으로.
      // ※ 판정 미상(undefined) → 입구 게이트 passesIngestionGate()가 반드시 거부(fail-closed).
      //    요약만 남기는 이유는 격리(rejected_articles) 기록의 가독성 때문.
      text = text.replace(/\n{2,}/g, '\n').trim();
      const firstLine = text.split('\n')[0].trim();
      if (!translate && isTitleEcho(firstLine, title)) {
        text = text.split('\n').slice(1).join('\n').trim() || text;
      }
      if (text.length < 10) continue;
      deepseekStats.ok++;
      return { titleKo: title, summary: text };
    } catch (e) {
      // 호출 예외를 상태코드·코드까지 남긴다(인증 401 / 잔액 402 / 한도 429 / 서버 5xx 구분).
      const err = e as {
        status?: number; code?: string; message?: string;
        response?: { status?: number; data?: unknown };
        error?: { code?: string; message?: string };
      };
      const status = err?.status ?? err?.response?.status ?? '?';
      const code = err?.code ?? err?.error?.code ?? '?';
      console.warn(
        `[deepseek] 호출 예외 (attempt ${attempt}/2, model=${DEEPSEEK_MODEL}, ` +
        `status=${status}, code=${code}): ${err?.message ?? String(e)}`,
      );
      noteDeepseekResult({ status: typeof status === 'number' ? status : undefined });
      if (attempt === 2 || deepseekDown()) {
        deepseekStats.fail++;
        return null;
      }
    }
  }
  // 두 번 모두 빈 응답 등으로 여기 도달(예외 아님) — 최종 실패 명시.
  console.warn(`[deepseek] 최종 실패(유효 응답 없음) title="${title.slice(0, 40)}"`);
  deepseekStats.fail++;
  return null;
}

function isTitleEcho(line: string, title: string): boolean {
  const norm = (s: string) => s.replace(/[\s\-·.]/g, '').toLowerCase();
  const a = norm(line);
  const b = norm(title);
  if (!a || !b) return false;
  return a === b || (a.length > 12 && (b.includes(a) || a.includes(b)));
}

// ══════════════════════════════════════════════════════════════════
// v5.4.2 — 판정 전용 호출(요약과 분리). 작업 1-2·1-3·2-1.
//  · 출력이 3필드뿐이라 누락·절단 여지가 거의 없다.
//  · temperature 0 고정(판정 일관성). 요약 호출은 기존 값 유지.
//  · 3필드 검증 → 하나라도 없으면 강화 지시로 1회 재요청 → 그래도 없으면 undefined
//    (judgment_missing → 입구 게이트 fail-closed. 새 폴백 경로 추가 금지 원칙).
// ══════════════════════════════════════════════════════════════════

// 200 은 부족했다(실측: finish_reason=length 20/20, 크론 판정 실패 26건) → 800.
export const JUDGE_MAX_TOKENS = Number(process.env.DEEPSEEK_JUDGE_MAX_TOKENS || 800);
/** 작업 1-1: DeepSeek 의 json_schema 지원이 '불명'이라 기본 비활성.
 *  데스크탑에서 DEEPSEEK_JSON_SCHEMA=1 로 켜서 지원 여부를 실측할 수 있다. */
const USE_JSON_SCHEMA = process.env.DEEPSEEK_JSON_SCHEMA === '1';

/** v4 는 thinking 기본 활성(effort=high). 판정 호출에서는 끈다(절단·temperature 무시 원인).
 *  DEEPSEEK_JUDGE_THINKING=on 이면 다시 켤 수 있다(비교 측정용). */
const THINKING_DISABLED = process.env.DEEPSEEK_JUDGE_THINKING !== 'on';

export type JudgeFields = {
  categoryFit?: boolean;
  isIncident?: boolean;
  confidence?: Confidence;
};

function toBool(v: unknown): boolean | undefined {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return undefined;
}

function parseJudge(obj: Record<string, unknown>): JudgeFields {
  const conf = String(obj.confidence ?? '').toLowerCase();
  return {
    categoryFit: toBool(obj.category_fit),
    isIncident: toBool(obj.is_incident),
    confidence: conf === 'high' ? 'high' : conf === 'medium' ? 'medium' : conf === 'low' ? 'low' : undefined,
  };
}

export function judgeComplete(j: JudgeFields): boolean {
  return j.categoryFit !== undefined && j.isIncident !== undefined && j.confidence !== undefined;
}

/** 판정 3필드만 요청. 누락 시 1회 재요청. 최종 미완성이면 부분(또는 빈) 결과 반환. */
export async function judgeArticleFields(
  title: string,
  body: string,
  category: string,
): Promise<JudgeFields> {
  if (!deepseekAvailable || !deepseek) return {};
  let out: JudgeFields = {};

  for (let attempt = 1; attempt <= 2; attempt++) {
    const strict = attempt === 2;
    try {
      deepseekStats.calls++;
      const params: Record<string, unknown> = {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: ensureJsonWord(strict ? `${JUDGE_RETRY_SYSTEM}\n\n${judgeSystem()}` : judgeSystem()) },
          {
            role: 'user',
            content: ensureJsonWord(
              strict
                ? `${buildJudgeUser(title, body, category)}\n\n[재요청] 이전 응답에 필드가 빠졌다. 세 필드를 모두 채워라.`
                : buildJudgeUser(title, body, category),
            ),
          },
        ],
        response_format: USE_JSON_SCHEMA
          ? { type: 'json_schema', json_schema: judgeJsonSchema() }
          : { type: 'json_object' },
        temperature: 0,            // 추론이 꺼지면 유효해진다(thinking 모드에선 무시됨)
        max_tokens: JUDGE_MAX_TOKENS,
        // v4 모델은 thinking 이 기본 활성(effort=high)이라 추론이 max_tokens 를 소진해
        // JSON 이 절단되고, temperature 도 무시된다 → 판정 호출에서는 끈다.
        // ※ Python SDK 의 extra_body 는 '본문 최상위에 병합'하는 장치다.
        //   openai-node 에는 extra_body 가 없고 body 객체가 그대로 직렬화되므로
        //   여기서는 최상위에 넣어야 실제 전송된다(전송 body 로그로 확인).
        ...(THINKING_DISABLED ? { thinking: { type: 'disabled' } } : {}),
      };
      if (process.env.DEEPSEEK_DEBUG_REQ === '1') {
        console.log('[deepseek][judge-req]', JSON.stringify({
          model: params.model, response_format: params.response_format,
          temperature: params.temperature, max_tokens: params.max_tokens,
          thinking: params.thinking ?? '(미전송)', attempt,
        }));
      }
      const r = await (deepseek.chat.completions.create as unknown as
        (p: unknown) => Promise<{ choices?: Array<{ finish_reason?: string; message?: { content?: string } }> }>)(params);
      addUsage(r as any);
      noteDeepseekResult(null);
      const choice = r.choices?.[0];
      const text = (choice?.message?.content || '').trim();
      if (choice?.finish_reason === 'length') {
        console.warn(`[deepseek][judge] 응답 절단(max_tokens=${JUDGE_MAX_TOKENS}) title="${title.slice(0, 30)}"`);
      }
      const obj = text ? extractJsonObject(text, ['category_fit', 'is_incident', 'confidence']) : null;
      if (obj) {
        const j = parseJudge(obj);
        // 부분 결과라도 채워진 필드는 보존(재요청이 나머지를 채울 수 있게)
        out = {
          categoryFit: out.categoryFit ?? j.categoryFit,
          isIncident: out.isIncident ?? j.isIncident,
          confidence: out.confidence ?? j.confidence,
        };
        if (judgeComplete(out)) { deepseekStats.ok++; return out; }
        console.warn(
          `[deepseek][judge] 필드 누락(attempt ${attempt}/2) ` +
          `fit=${out.categoryFit} incident=${out.isIncident} conf=${out.confidence} title="${title.slice(0, 30)}"`,
        );
      } else {
        const raw = process.env.DEEPSEEK_RAW_LOG === 'full' ? text : text.slice(0, 300);
        console.warn(`[deepseek][judge] JSON 추출 실패(attempt ${attempt}/2) title="${title.slice(0, 30)}"\n${raw}`);
      }
    } catch (e) {
      const err = e as { status?: number; code?: string; message?: string };
      console.warn(`[deepseek][judge] 호출 예외(attempt ${attempt}/2, status=${err?.status ?? '?'}): ${err?.message ?? String(e)}`);
      noteDeepseekResult(err);
      if (attempt === 2) deepseekStats.fail++;
      if (deepseekDown()) break;
    }
  }
  return out;   // 미완성 → 게이트에서 judgment_missing 으로 거부(fail-closed)
}

/**
 * NEWS-Q11 ■2: 질문 하나 → JSON 하나(방송 관문). 판정 호출과 같은 설정(temperature 0 · thinking 끔 · json_object).
 * keys 가 빠지면 강화 지시로 1회 재요청 · 그래도 없으면 null(부르는 쪽이 fail-closed). 통계·비용은 deepseekStats 에.
 */
export async function askDeepSeekJson(
  system: string,
  user: string,
  keys: string[],
  maxTokens = JUDGE_MAX_TOKENS,
): Promise<Record<string, unknown> | null> {
  if (!deepseekAvailable || !deepseek) return null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const strict = attempt === 2;
    try {
      deepseekStats.calls++;
      const params: Record<string, unknown> = {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: ensureJsonWord(strict ? `${STRICT_JSON_ONLY}\n\n${system}` : system) },
          {
            role: 'user',
            content: ensureJsonWord(strict ? `${user}\n\n[재요청] 이전 응답에 칸이 빠졌다. ${keys.join(', ')} 를 모두 채운 JSON 하나만.` : user),
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: maxTokens,
        ...(THINKING_DISABLED ? { thinking: { type: 'disabled' } } : {}),
      };
      const r = await (deepseek.chat.completions.create as unknown as
        (p: unknown) => Promise<{ choices?: Array<{ finish_reason?: string; message?: { content?: string } }> }>)(params);
      addUsage(r as any);
      noteDeepseekResult(null);
      const text = (r.choices?.[0]?.message?.content || '').trim();
      const obj = text ? extractJsonObject(text, keys) : null;
      if (obj && keys.every((k) => obj[k] !== undefined && obj[k] !== null)) {
        deepseekStats.ok++;
        return obj;
      }
      console.warn(`[deepseek][ask] 칸 누락·JSON 아님(attempt ${attempt}/2): ${text.slice(0, 160)}`);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      console.warn(`[deepseek][ask] 호출 예외(attempt ${attempt}/2, status=${err?.status ?? '?'}): ${err?.message ?? String(e)}`);
      noteDeepseekResult(err);
      if (deepseekDown()) break;
    }
  }
  deepseekStats.fail++;
  return null;
}

const STRICT_JSON_ONLY =
  '너는 JSON 생성기다. 오직 유효한 JSON 객체 하나만 출력한다. 설명·코드펜스·서문 금지. 첫 글자 "{", 마지막 글자 "}".';

/**
 * 요약 + 판정. v5.4.2 부터 판정은 '전용 호출'이 권위를 가진다(요약이 판정 필드를
 * 밀어내던 구조를 분리). 전용 판정이 실패하면 결합 호출에서 온 값으로 보완하고,
 * 그래도 미완성이면 undefined 로 남겨 입구 게이트가 거부한다.
 * DEEPSEEK_SPLIT_JUDGE=0 이면 기존(결합) 동작으로 되돌린다.
 */
export async function summarizeKoreanDeepSeek(
  title: string,
  content: string,
  opts?: { translate?: boolean; category?: string; forceKorean?: boolean },
): Promise<DeepSeekPack | null> {
  const pack = await summarizeCombined(title, content, opts);
  if (!pack) return null;
  if (process.env.DEEPSEEK_SPLIT_JUDGE === '0') return pack;

  // 판정 근거는 요약문(없으면 원문)을 쓴다 — 길이가 짧아 누락 여지가 작다.
  const body = (pack.summary && pack.summary.trim()) || content || title;
  const dedicated = await judgeArticleFields(title, body, opts?.category || '미지정');

  // 전용 판정이 '권위'다. 미완성이어도 결합 호출 값으로 메우지 않는다.
  //  - 결합 호출은 temperature 0.4 라 판정이 흔들리던 원인(작업2)이고,
  //  - 빈 자리를 메우는 것은 새 폴백 경로 추가(금지). 미완성 → judgment_missing → 게이트 거부.
  if (!judgeComplete(dedicated)) {
    console.warn(
      `[deepseek][judge] 최종 미완성 → judgment_missing(게이트 거부) ` +
      `fit=${dedicated.categoryFit} incident=${dedicated.isIncident} conf=${dedicated.confidence} ` +
      `title="${title.slice(0, 30)}"`,
    );
  }
  return {
    titleKo: pack.titleKo,
    summary: pack.summary,
    categoryFit: dedicated.categoryFit,
    isIncident: dedicated.isIncident,
    confidence: dedicated.confidence,
  };
}
