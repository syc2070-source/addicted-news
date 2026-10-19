import {
  matchedBroadcastKeywords,
  passesBroadcastKeywordGate,
} from './broadcast';

// NEWS-Q10 덧: 방송 핵심어 보탬(카지노 · 바카라 · 펜타닐) — 9채널 검색 표본에서 제목에 「도박」 없이 놓친 분야 편
describe('broadcast 핵심어 — 놓친 도박·약물 편(NEWS-Q10 덧)', () => {
  it('카지노 · 바카라 · 펜타닐 제목은 핵심어 관문을 지난다(→ DeepSeek 관문)', () => {
    expect(
      passesBroadcastKeywordGate({
        title:
          '다 잃으면 갱생할 줄 알았는데 카지노에서 전 재산 탕진하고 쪽방에서 한 방 노리는 80대',
        description: '',
      }),
    ).toBe(true);
    expect(
      passesBroadcastKeywordGate({
        title: '"교실 컴퓨터 연결해서 바카라해요" | PD수첩',
        description: '',
      }),
    ).toBe(true);
    expect(
      matchedBroadcastKeywords('펜타닐이 급속도로 퍼질 수 있었던 이유', ''),
    ).toEqual(['펜타닐']);
  });

  it('뜻이 다른 낱말(재활용)과 무관한 편은 그대로 막힘', () => {
    expect(
      passesBroadcastKeywordGate({
        title: 'AI 딜레마 1부 : 일자리 종말론',
        description: '재활용 산업의 변화도 다룬다.',
      }),
    ).toBe(false);
    expect(
      passesBroadcastKeywordGate({
        title: '5공 청산의 사각지대...허화평 재단의 비밀',
        description: '',
      }),
    ).toBe(false);
  });
});
