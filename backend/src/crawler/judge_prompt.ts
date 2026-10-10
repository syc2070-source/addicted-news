// ============================================================
// judge_prompt.ts (v5.4.2 작업2) — 판정 전용 프롬프트.
// 요약과 분리된 '판정 3필드만' 요청용. 출력이 짧아 누락·절단 여지가 거의 없다.
//
// 설계 원칙(작업 2-2): 유지/거부 항목 나열 → '순서 있는 판별 절차'로 재작성.
// 앞 단계에서 결정되면 즉시 종료하므로, 실행 간 무게가 흔들리지 않는다.
// ============================================================

import { fieldProfile } from './field_profile';

/** 판정 3필드 스키마(작업 1-1: DeepSeek 의 json_schema 지원 시 사용). 이름·설명은 분야 설정. */
export function judgeJsonSchema() {
  const p = fieldProfile().prompts;
  return {
    name: p.judge_schema_name,
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['category_fit', 'is_incident', 'confidence'],
      properties: {
        category_fit: { type: 'boolean', description: p.judge_fit_description },
        is_incident: { type: 'boolean', description: '개별 사건·사고·범죄·단속·판결 보도이면 true' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
  } as const;
}

/** 판정 절차(①→②→③) — 분야마다 달라 분야 설정 prompts.judge_system 에 둔다(NEWS-Q2 ■1). */
export function judgeSystem(): string {
  return fieldProfile().prompts.judge_system;
}

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
