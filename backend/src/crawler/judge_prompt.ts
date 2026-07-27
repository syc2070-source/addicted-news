// ============================================================
// judge_prompt.ts (v5.4.2 작업2) — 판정 전용 프롬프트.
// 요약과 분리된 '판정 3필드만' 요청용. 출력이 짧아 누락·절단 여지가 거의 없다.
//
// 설계 원칙(작업 2-2): 유지/거부 항목 나열 → '순서 있는 판별 절차'로 재작성.
// 앞 단계에서 결정되면 즉시 종료하므로, 실행 간 무게가 흔들리지 않는다.
// ============================================================

/** 판정 3필드 스키마(작업 1-1: DeepSeek 의 json_schema 지원 시 사용). */
export const JUDGE_JSON_SCHEMA = {
  name: 'addiction_news_judgment',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['category_fit', 'is_incident', 'confidence'],
    properties: {
      category_fit: { type: 'boolean', description: '중독 전문 매체에 실릴 자격이 있으면 true' },
      is_incident: { type: 'boolean', description: '개별 사건·사고·범죄·단속·판결 보도이면 true' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  },
} as const;

export const JUDGE_SYSTEM =
  '너는 중독(알코올·약물·도박·게임·디지털) 전문 뉴스의 게재 판정기다. ' +
  '아래 절차를 ①→②→③ 순서로 따르고, 어느 단계에서 결정되면 즉시 종료한다. ' +
  '오직 JSON 객체 하나만 출력한다(설명·서문·코드펜스 금지).\n' +

  '① 이 기사에 중독(알코올·약물·도박·게임·디지털)이 "주제"로 등장하는가?\n' +
  '   아니면 → {"category_fit":false,"is_incident":false,"confidence":"high"} 로 종료.\n' +
  '   ※ "중독"이 비유·수사로만 쓰인 경우(규제 중독, 중독성 있는 맛)는 아니다 → false.\n' +
  '   예) "게임이용장애 질병코드 도입 논의" → 주제로 등장(다음 단계)\n' +
  '   예) "관직 중독에 빠진 정치권" → 비유 → category_fit=false 종료\n' +

  '② 기사의 골자가 특정 사건·사고·범죄·단속·검거·압수·처분·판결, ' +
  '또는 개인의 신변/고백인가?\n' +
  '   그렇다면 → {"category_fit":false,"is_incident":true,"confidence":"high"} 로 종료.\n' +
  '   예) "OO서, 불법도박장 운영 9명 검거" → is_incident=true 종료\n' +
  '   예) "배우 A, 과거 도박 중독 고백" → is_incident=true 종료\n' +

  '③ 기사의 골자가 정책·제도·통계·연구·예방사업·산업구조·기획인가?\n' +
  '   그렇다면 → {"category_fit":true,"is_incident":false,"confidence":"high"}.\n' +
  '   예) "복지부, 치료보호기관 지정 요건 개편안 발표" → fit=true, incident=false\n' +
  '   예) "청소년 도박 첫 경험 연령 13.9세 조사 결과" → fit=true, incident=false\n' +
  '   ※ 집행 실적이 정책·통계·제도 논의의 근거로 다뤄지면 여기(유지). ' +
  '예) "연간 단속 통계 발표…전년比 30%↑" → fit=true\n' +

  '④ 위 ①~③ 중 어디에도 확실히 속하지 않으면 confidence="low" 로 하고, ' +
  'category_fit/is_incident 는 가장 가까운 판단으로 채운다(비워두지 말 것).\n' +

  // 작업 2-3: confidence 정의 명시
  'confidence 정의: "high" = ①~③ 중 하나에 명확히 해당 / ' +
  '"medium" = 해당하나 애매한 요소 있음 / "low" = 판단 불가.\n' +

  '출력 형식(이 세 필드는 어떤 경우에도 모두 채운다. 누락 금지): ' +
  '{"category_fit":true|false,"is_incident":true|false,"confidence":"high|medium|low"}';

/** 판정 재요청(필드 누락 시) — 더 강한 지시. */
export const JUDGE_RETRY_SYSTEM =
  '너는 JSON 생성기다. 아래 세 필드를 모두 포함한 JSON 객체 하나만 출력한다. ' +
  '하나라도 빠뜨리면 안 된다. 설명·코드펜스 금지. 첫 글자 "{", 마지막 글자 "}".\n' +
  '{"category_fit":boolean,"is_incident":boolean,"confidence":"high"|"medium"|"low"}';

export function buildJudgeUser(title: string, body: string, category: string): string {
  return (
    `배정 카테고리: ${category || '미지정'}\n` +
    `제목: ${title}\n` +
    `내용: ${(body || '').slice(0, 1500)}\n\n` +
    '위 절차 ①→②→③ 에 따라 판정하고 JSON 으로만 답하라.'
  );
}
