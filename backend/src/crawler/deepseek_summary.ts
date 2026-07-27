// ============================================================
// 중독뉴스 요약: DeepSeek 기반 한국어 "충실한 한 문단" 요약
// 외국어 → 한국어 번역+요약 통합. env: DEEPSEEK_API_KEY
// ============================================================
import OpenAI from 'openai';
import { extractJsonObject } from './json_extract';

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
// 모델명 단일 소스: 환경변수 DEEPSEEK_MODEL. 기본값은 현행 모델(구 deepseek-chat 폐기됨).
// 백엔드는 이 상수를 통해서만 모델을 참조한다(하드코딩 금지).
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
export const deepseekAvailable = !!DEEPSEEK_KEY;

const deepseek = deepseekAvailable
  ? new OpenAI({ apiKey: DEEPSEEK_KEY, baseURL: 'https://api.deepseek.com' })
  : null;

// v5.2 #6: DeepSeek 실제 호출 집계(비용 추적). 재시도 포함 매 API 요청을 calls로,
// 성공/실패를 분리 집계한다. (기존 apiCallCount는 미호출 dead-code였음)
export const deepseekStats = { calls: 0, ok: 0, fail: 0 };

const SUMMARY_SYSTEM_KO_BASE =
  '너는 중독(도박·약물·알코올·행동중독 등) 전문 뉴스 큐레이터다. ' +
  '독자가 원문 기사에 가지 않고도 내용을 충분히 파악할 수 있도록, 한국어로 충실한 요약을 쓴다. ' +
  '중독 뉴스 원문에는 도박 광고 등 유해 요소가 많아, 요약만으로 이해가 끝나는 것이 독자에게 이롭다. ' +
  '형식: 자연스러운 한 문단(대략 5~8문장). 소제목·불릿·번호 없이 서술형으로. ' +
  '내용에 반드시 담을 것: (1) 무슨 일이 있었는가(핵심 사실·주체·시점), ' +
  '(2) 원문에 나온 배경이나 맥락. ' +
  '규칙: 제목을 그대로 반복하지 말 것. 본문에 없는 사실(수치·인용·이름)을 지어내지 말 것 — ' +
  '재료가 부족하면 확인된 범위에서만 서술하고, 무리하게 늘리지 말 것. ' +
  // v5.2 #2: 논평·사설 금지 — 사실중심 재서술만
  '원문에 없는 평가·의견·교훈·전망·의의를 절대 덧붙이지 말 것. ' +
  '"~을 보여준다", "~로 평가된다", "~이 필요하다", "~을 시사한다", "~을 강조한다", ' +
  '"~중요성을 보여준다", "~문제다", "~우려된다" 같은 논평·해석·프레임 문장을 쓰지 말 것. ' +
  '오직 원문이 전한 사실만 담담히 재서술한다. "왜 중요한가"를 네 판단으로 덧붙이지 말고, ' +
  '원문이 직접 언급한 경우에만 그 근거와 함께 사실로 적을 것. ' +
  // v5.2 #3: 본문 부실 시 추측 금지
  '본문이 부실하거나 정보가 적으면 추측하지 말고 확인된 사실만 1~2문장으로 짧게 쓸 것. ' +
  '"~것으로 보인다", "~것으로 추정된다", "~로 풀이된다" 같은 추측 어미를 쓰지 말 것. ' +
  '과장·선정성·자극적 표현 배제. 담담하고 정확하게. 도박·약물 사용을 조장하거나 미화하지 말 것. ' +
  '민감한 주제(자살·자해 등)는 방법·수치를 넣지 말 것.';

// v5.4: 입구 게이트용 판정 — 정밀도 우선("엄한 기사가 실리는 것보다 잃는 것이 낫다").
const JUDGE_JSON_INSTRUCTION =
  ' 그리고 이 기사가 "중독 전문 매체"에 실릴 자격이 있는지 엄격히 판정한다. 정밀도 우선 — 애매하면 거부한다.\n' +
  '[유지 = category_fit:true, is_incident:false] ' +
  '중독 관련 정책·법·제도·규제 동향; 정부·지자체·공공기관·공익재단의 예방사업·캠페인·포럼·교육(강원랜드·사행산업통합감독위 유형); ' +
  '중독 관련 연구 결과·통계·역학 데이터·치료법·치료과학; 중독 산업 구조 분석·심층 기획·연재; 해외 중독 정책·대응 사례.\n' +
  '[거부 = category_fit:false 또는 is_incident:true] ' +
  '개인의 사건·사고·범죄·사망 보도(범인/피해자가 특정 개인); ' +
  // v5.4.1 작업1: 기관 집행 단신 구멍 봉합(개인 특정 여부 무관)
  '수사기관·행정기관의 개별 집행 활동 단신(단속·검거·체포·압수·폐기·적발·소탕·기소·송치·표창/감사장 전달 등 ' +
  '"누가 언제 무엇을 집행했다" 형태의 1회성 보도). 판별 요령: 그 기사에서 집행 활동을 빼면 남는 내용이 없으면 거부. ' +
  '단, 집행 실적이 정책 변화·통계 분석·제도 논의의 근거로 다뤄지면 유지(예: "연간 단속 통계 발표…전년比 30%↑"는 유지, ' +
  '"OO서, 불법도박 9명 검거"는 거부); ' +
  '연예인·유명인의 중독 고백·신변잡기·예능 내용(금쪽이·결혼지옥·상담소 유형); ' +
  '소송·재판·판결 보도(집단소송 포함 — 전부 사건으로 분류); ' +
  '스포츠 경기 결과·문화연예 일반·건강 일반 상식; ' +
  '"중독"이 비유·수사로만 쓰인 기사(규제 중독, 중독성 있는 맛, 관직 중독 등); ' +
  '카지노·토토 홍보 및 SEO 생성 콘텐츠(부자연스러운 조사, 무의미한 부제 패턴); ' +
  '확신이 서지 않는 모든 경우.\n' +
  'is_incident: 개별 인물·특정 사건의 사고·범죄·판결·수사 보도이면 true(본문에 중독 단어가 있어도). ' +
  'category_fit: 위 [유지] 기준에 확실히 부합하고 배정 카테고리에 맞으면 true, 아니면 false. ' +
  'confidence: 판정 확신도 "high"|"medium"|"low"(조금이라도 애매하면 high 를 주지 말 것).\n' +
  '반드시 아래 JSON만 출력(다른 텍스트 금지): ' +
  '{"titleKo":"제목(외국어는 한국어 번역, 한국어는 원제)","summary":"한국어 한 문단 요약",' +
  '"is_incident":true|false,"category_fit":true|false,"confidence":"high|medium|low"}';

const SUMMARY_SYSTEM_KO = SUMMARY_SYSTEM_KO_BASE + JUDGE_JSON_INSTRUCTION;

const SUMMARY_SYSTEM_TRANSLATE =
  SUMMARY_SYSTEM_KO_BASE +
  ' 원문이 외국어(영어·일본어 등)이면 반드시 한국어로 번역·요약하라.' +
  JUDGE_JSON_INSTRUCTION;

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
export async function summarizeKoreanDeepSeek(
  title: string,
  content: string,
  opts?: { translate?: boolean; category?: string },
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

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      deepseekStats.calls++;
      const r = await deepseek.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: translate ? SUMMARY_SYSTEM_TRANSLATE : SUMMARY_SYSTEM_KO },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.4,
        max_tokens: 900,
      });
      const choice = r.choices?.[0];
      let text = (choice?.message?.content || '').trim();
      // 일부 모델(reasoner 계열)은 content 가 비고 reasoning_content 로 옴 → 폴백
      if (!text) {
        const rc = (choice?.message as unknown as { reasoning_content?: unknown })?.reasoning_content;
        if (typeof rc === 'string' && rc.trim()) text = rc.trim();
      }
      if (!text) {
        // 호출은 됐으나 빈 응답(그동안 조용히 continue 되어 원인 미상이던 지점 — 로깅 추가)
        console.warn(
          `[deepseek] 빈 응답 (attempt ${attempt}/2, model=${DEEPSEEK_MODEL}, ` +
          `finish=${choice?.finish_reason ?? '?'}, translate=${translate}) title="${title.slice(0, 40)}"`,
        );
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
        // 관대한 추출까지 실패 = 진짜 형식 이탈. 원문 앞부분을 남겨 패턴을 확정한다.
        // (DEEPSEEK_RAW_LOG=full 이면 전문, 기본은 400자)
        const raw = process.env.DEEPSEEK_RAW_LOG === 'full' ? text : text.slice(0, 400);
        console.warn(
          `[deepseek] JSON 추출 실패(model=${DEEPSEEK_MODEL}) title="${title.slice(0, 30)}"\n` +
          `---- 응답 원문 ----\n${raw}\n------------------`,
        );
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
      if (attempt === 2) {
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
