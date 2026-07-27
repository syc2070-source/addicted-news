import { extractJsonObject, balancedObjects } from './json_extract';

// v4-flash 에서 관측·의심되는 응답 형식들. 기존 탐욕 정규식(/\{[\s\S]*\}/)이 깨지던 케이스.
const JUDGE = { titleKo: '제목', summary: '요약 문장입니다. 충분히 깁니다.', is_incident: false, category_fit: true, confidence: 'high' };

describe('extractJsonObject — v4-flash 응답 형식 관대 파싱', () => {
  it('순수 JSON', () => {
    expect(extractJsonObject(JSON.stringify(JUDGE))?.confidence).toBe('high');
  });

  it('```json 코드펜스로 감싼 경우', () => {
    const t = '```json\n' + JSON.stringify(JUDGE) + '\n```';
    expect(extractJsonObject(t)?.category_fit).toBe(true);
  });

  it('언어 없는 코드펜스', () => {
    const t = '```\n' + JSON.stringify(JUDGE) + '\n```';
    expect(extractJsonObject(t)?.is_incident).toBe(false);
  });

  it('앞뒤 설명 텍스트가 붙은 경우', () => {
    const t = `요청하신 판정 결과입니다.\n${JSON.stringify(JUDGE)}\n추가 설명이 필요하시면 알려주세요.`;
    expect(extractJsonObject(t)?.confidence).toBe('high');
  });

  it('설명 + 코드펜스 + 후기 텍스트 조합', () => {
    const t = `분석했습니다.\n\n\`\`\`json\n${JSON.stringify(JUDGE)}\n\`\`\`\n\n이상입니다.`;
    expect(extractJsonObject(t)?.summary).toContain('요약');
  });

  it('오브젝트가 2개(앞에 잡음 오브젝트) — 판정 키 가진 것을 고른다', () => {
    const t = `{"note":"작업 시작"}\n${JSON.stringify(JUDGE)}`;
    expect(extractJsonObject(t)?.category_fit).toBe(true);
  });

  it('요약 본문에 중괄호가 들어가도 안전(균형 스캔)', () => {
    const o = { ...JUDGE, summary: '연구는 {대조군} 설계를 사용했다. 결과는 유의했다.' };
    expect(extractJsonObject(JSON.stringify(o))?.confidence).toBe('high');
  });

  it('탐욕 정규식이 깨지던 케이스: JSON 뒤에 또 다른 중괄호 텍스트', () => {
    const t = `${JSON.stringify(JUDGE)}\n\n참고: 형식은 {키: 값} 구조입니다.`;
    // 기존 /\{[\s\S]*\}/ 는 마지막 '}' 까지 잡아 파싱 실패했음
    expect(extractJsonObject(t)?.is_incident).toBe(false);
  });

  it('트레일링 콤마 보정', () => {
    const t = '{"summary":"충분히 긴 요약입니다.","category_fit":true,"confidence":"high",}';
    expect(extractJsonObject(t)?.confidence).toBe('high');
  });

  it('스마트 따옴표 보정', () => {
    const t = '{“summary”:“충분히 긴 요약입니다.”,“confidence”:“high”}';
    expect(extractJsonObject(t)?.confidence).toBe('high');
  });

  it('진짜 형식 이탈(JSON 없음) → null', () => {
    expect(extractJsonObject('판정을 내리기 어렵습니다. 추가 정보가 필요합니다.')).toBeNull();
  });

  it('balancedObjects: 중첩 오브젝트를 하나로 센다', () => {
    const objs = balancedObjects('{"a":{"b":1}} {"c":2}');
    expect(objs).toHaveLength(2);
    expect(objs[0]).toBe('{"a":{"b":1}}');
  });
});
