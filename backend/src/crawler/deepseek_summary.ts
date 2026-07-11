// ============================================================
// 중독뉴스 요약: DeepSeek 기반 한국어 "충실한 한 문단" 요약
// env: DEEPSEEK_API_KEY (Statory 값 재사용)
// ============================================================
import OpenAI from 'openai';

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const deepseekAvailable = !!DEEPSEEK_KEY;

const deepseek = deepseekAvailable
  ? new OpenAI({ apiKey: DEEPSEEK_KEY, baseURL: 'https://api.deepseek.com' })
  : null;

const SUMMARY_SYSTEM =
  '너는 중독(도박·약물·알코올·행동중독 등) 전문 뉴스 큐레이터다. ' +
  '독자가 원문 기사에 가지 않고도 내용을 충분히 파악할 수 있도록, 한국어로 충실한 요약을 쓴다. ' +
  '중독 뉴스 원문에는 도박 광고 등 유해 요소가 많아, 요약만으로 이해가 끝나는 것이 독자에게 이롭다. ' +
  '형식: 자연스러운 한 문단(대략 5~8문장). 소제목·불릿·번호 없이 서술형으로. ' +
  '내용에 반드시 담을 것: (1) 무슨 일이 있었는가(핵심 사실·주체·시점), ' +
  '(2) 그 배경이나 맥락, (3) 중독·회복·정책 관점에서 왜 중요한가. ' +
  '규칙: 제목을 그대로 반복하지 말 것. 본문에 없는 사실(수치·인용·이름)을 지어내지 말 것 — ' +
  '재료가 부족하면 확인된 범위에서만 서술하고, 무리하게 늘리지 말 것. ' +
  '과장·선정성·자극적 표현 배제. 담담하고 정확하게. 도박·약물 사용을 조장하거나 미화하지 말 것. ' +
  '민감한 주제(자살·자해 등)는 방법·수치를 넣지 말 것. 출력은 요약 본문만.';

/**
 * DeepSeek 로 한국어 충실 요약(한 문단) 생성.
 * 실패 시 null
 */
export async function summarizeKoreanDeepSeek(
  title: string,
  content: string,
): Promise<string | null> {
  if (!deepseekAvailable || !deepseek) return null;
  const body = (content || '').trim();

  let userMsg: string;
  if (body.length > 200) {
    userMsg =
      `다음 기사를 5~8문장의 충실한 한 문단으로 요약하라.\n\n` +
      `제목: ${title}\n\n본문:\n${body.slice(0, 4000)}`;
  } else if (body.length > 30) {
    userMsg =
      `다음 기사 정보를 바탕으로 요약하라. 본문이 짧으니, 확인된 내용만으로 ` +
      `3~5문장 정도로 쓰고 없는 사실은 지어내지 말 것.\n\n` +
      `제목: ${title}\n\n본문(일부): ${body}`;
  } else {
    userMsg =
      `아래는 기사 제목만 제공된 경우다. 제목이 시사하는 주제를 2~3문장으로 신중히 ` +
      `요약하되, 구체적 사실(수치·인용·이름)은 절대 지어내지 말 것.\n\n제목: ${title}`;
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await deepseek.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.4,
        max_tokens: 900,
      });
      let text = (r.choices?.[0]?.message?.content || '').trim();
      if (!text) continue;
      text = text.replace(/\n{2,}/g, '\n').trim();
      const firstLine = text.split('\n')[0].trim();
      if (isTitleEcho(firstLine, title)) {
        text = text.split('\n').slice(1).join('\n').trim() || text;
      }
      if (text.length < 10) continue;
      return text;
    } catch (e) {
      if (attempt === 2) {
        console.warn('[deepseek summary] 실패:', (e as Error).message);
        return null;
      }
    }
  }
  return null;
}

function isTitleEcho(line: string, title: string): boolean {
  const norm = (s: string) => s.replace(/[\s\-·.]/g, '').toLowerCase();
  const a = norm(line);
  const b = norm(title);
  if (!a || !b) return false;
  return a === b || (a.length > 12 && (b.includes(a) || a.includes(b)));
}
