// ============================================================
// json_extract.ts — LLM 응답에서 JSON 오브젝트를 관대하게 추출.
// v4-flash 전환 후 판정 실패 58%("JSON 파싱 오류")의 원인 대응.
//
// 기존 파서의 문제: /\{[\s\S]*\}/ 가 탐욕적(greedy)이라 첫 '{' 부터 마지막 '}' 까지를
// 통째로 잡는다. 응답에 코드펜스·앞뒤 설명문·두 번째 오브젝트가 섞이면 잘못된 구간을
// 잘라내 JSON.parse 가 실패한다.
//
// 전략(순서대로, 하나라도 성공하면 반환):
//   1) 코드펜스(```json ... ```) 안쪽 우선
//   2) 전체 문자열이 그대로 JSON
//   3) 균형 잡힌 중괄호 스캔으로 '첫 번째 완결 오브젝트'부터 차례로 시도
//      (문자열 리터럴/이스케이프 인식 — 본문에 '}' 가 들어가도 안전)
//   4) 흔한 오염 보정 후 재시도(스마트따옴표, 트레일링 콤마)
// 모두 실패해야 null(= 판정 실패).
// ============================================================

/** 코드펜스 블록 내용만 뽑아낸다(```json … ``` / ``` … ```). 없으면 []. */
function fencedBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /```[a-zA-Z]*\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1].trim();
    if (body) out.push(body);
  }
  return out;
}

/**
 * 균형 잡힌 중괄호 스캔. 문자열 리터럴 안의 중괄호/이스케이프를 무시한다.
 * 시작 '{' 마다 완결되는 구간을 잘라 후보로 돌려준다(등장 순서).
 */
export function balancedObjects(text: string, limit = 5): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length && out.length < limit; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j; // 이 오브젝트 끝에서 다음 탐색 재개
          break;
        }
      }
    }
  }
  return out;
}

/** 흔한 LLM 출력 오염 보정: 스마트따옴표, 트레일링 콤마. */
function repair(candidate: string): string {
  return candidate
    .replace(/[“”]/g, '"')   // “ ” → "
    .replace(/[‘’]/g, "'")   // ‘ ’ → '
    .replace(/,\s*([}\]])/g, '$1');    // {a:1,} → {a:1}
}

function tryParse(candidate: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(candidate);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* 다음 후보 */ }
  try {
    const v = JSON.parse(repair(candidate));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* 실패 */ }
  return null;
}

/**
 * 응답 텍스트에서 판정 JSON 오브젝트를 추출. 실패 시 null.
 * wanted: 이 키들 중 하나라도 있으면 '판정 오브젝트'로 인정(여러 후보 중 선택용).
 */
export function extractJsonObject(
  text: string,
  wanted: string[] = ['summary', 'category_fit', 'is_incident', 'confidence', 'titleKo'],
): Record<string, unknown> | null {
  if (!text) return null;
  const hasWanted = (o: Record<string, unknown>) => wanted.some((k) => k in o);

  // 1) 코드펜스 내부 우선
  for (const block of fencedBlocks(text)) {
    const direct = tryParse(block);
    if (direct && hasWanted(direct)) return direct;
    for (const cand of balancedObjects(block)) {
      const o = tryParse(cand);
      if (o && hasWanted(o)) return o;
    }
  }

  // 2) 전체가 JSON
  const whole = tryParse(text.trim());
  if (whole && hasWanted(whole)) return whole;

  // 3) 균형 스캔 후보들 — 원하는 키를 가진 첫 오브젝트
  const candidates = balancedObjects(text);
  for (const cand of candidates) {
    const o = tryParse(cand);
    if (o && hasWanted(o)) return o;
  }

  // 4) 키 조건을 못 맞췄어도 파싱되는 오브젝트가 있으면 마지막 수단으로 반환
  for (const cand of candidates) {
    const o = tryParse(cand);
    if (o) return o;
  }
  return null;
}
