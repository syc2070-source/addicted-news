// ============================================================
// 중독뉴스 요약: DeepSeek 기반 한국어 "충실한 한 문단" 요약
// 외국어 → 한국어 번역+요약 통합. env: DEEPSEEK_API_KEY
// ============================================================
import OpenAI from 'openai';

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
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

// v5.4: 최종 판정 필드 — 요약과 함께 JSON으로 반환.
const JUDGE_JSON_INSTRUCTION =
  ' 그리고 기사의 성격을 판정한다. ' +
  'report_type: 개별 인물·특정 사건의 사고·범죄·폭행·투약·음주운전·밀수·판결·구형·선고·검거·기소·수사 등 ' +
  '"단일 사건/사고/범죄" 보도이면 "incident", ' +
  '정책·제도·법안·규제·통계·실태·연구·조사·치료·예방·회복·재활·캠페인·사회구조·이슈 보도이면 "issue". ' +
  '단순 범죄/사고/판결 보도는 본문에 중독 관련 단어가 있어도 "incident"다. ' +
  'category_fit: 이 기사가 "중독(도박·약물·알코올·게임/디지털·행동중독)" 이슈로서 유효하고 아래 배정 카테고리에 실제로 부합하면 true, ' +
  '단순 사건사고이거나 중독과 무관하거나 배정 카테고리와 맞지 않으면 false. ' +
  '반드시 아래 JSON만 출력하라(다른 텍스트 금지): ' +
  '{"titleKo":"제목(외국어 기사는 한국어 번역, 한국어 기사는 원제 그대로)",' +
  '"summary":"한국어 한 문단 요약","report_type":"incident|issue","category_fit":true|false}';

const SUMMARY_SYSTEM_KO = SUMMARY_SYSTEM_KO_BASE + JUDGE_JSON_INSTRUCTION;

const SUMMARY_SYSTEM_TRANSLATE =
  SUMMARY_SYSTEM_KO_BASE +
  ' 원문이 외국어(영어·일본어 등)이면 반드시 한국어로 번역·요약하라.' +
  JUDGE_JSON_INSTRUCTION;

export type ReportType = 'incident' | 'issue';
export type DeepSeekPack = {
  titleKo: string;
  summary: string;
  reportType?: ReportType;   // v5.4: incident면 저장 스킵
  categoryFit?: boolean;     // v5.4: false면 저장 스킵
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
      let text = (r.choices?.[0]?.message?.content || '').trim();
      if (!text) continue;

      // v5.4: 요약 + 판정(report_type/category_fit)을 JSON에서 추출(한/외국어 공통)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as {
            titleKo?: unknown; summary?: unknown; report_type?: unknown; category_fit?: unknown;
          };
          let summary = String(parsed.summary || '').trim().replace(/\n{2,}/g, '\n').trim();
          const titleKo = String(parsed.titleKo || '').trim() || title;
          const rt = String(parsed.report_type || '').toLowerCase();
          const reportType: ReportType | undefined =
            rt === 'incident' ? 'incident' : rt === 'issue' ? 'issue' : undefined;
          const cf = parsed.category_fit;
          const categoryFit: boolean | undefined =
            cf === false || cf === 'false' ? false : cf === true || cf === 'true' ? true : undefined;
          // 번역 경로는 titleKo 필수, 국내 경로는 원제 사용
          const okTitle = translate ? String(parsed.titleKo || '').trim().length > 0 : true;
          if (okTitle && summary.length >= 10) {
            deepseekStats.ok++;
            return { titleKo, summary, reportType, categoryFit };
          }
        } catch { /* JSON 파싱 실패 → 아래 폴백 */ }
      }

      // JSON 실패 시: 판정 없이 텍스트를 요약으로(판정 미상 → 저장 스킵 안 함, fail-open)
      text = text.replace(/\n{2,}/g, '\n').trim();
      const firstLine = text.split('\n')[0].trim();
      if (!translate && isTitleEcho(firstLine, title)) {
        text = text.split('\n').slice(1).join('\n').trim() || text;
      }
      if (text.length < 10) continue;
      deepseekStats.ok++;
      return { titleKo: title, summary: text };
    } catch (e) {
      if (attempt === 2) {
        console.warn('[deepseek summary] 실패:', (e as Error).message);
        deepseekStats.fail++;
        return null;
      }
    }
  }
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
