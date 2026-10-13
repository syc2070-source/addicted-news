import {
  ClusterDoc, ClusterPool, clusterDocs, clusterRules, docTs, entitiesOf, leadOf, multiClusters, normalizeClusterText, paraOf,
  pickRepresentative, sharedEntities, stripOutletSuffix, titleGrams, jaccard,
} from './event_cluster';

// NEWS-Q3 ■1: 사건 묶기(LLM 0)
const H = 3600 * 1000;
const T0 = Date.parse('2026-10-12T00:00:00Z');
const STOP = ['중독', '도박', '마약', '예방', '캠페인', '운영'];
const FALLBACK = '기사의 핵심 쟁점과 중독 관련 함의를 추가 확인할 필요가 있습니다.';
const doc = (id: number, title: string, hours = 0, extra: Partial<ClusterDoc> = {}): ClusterDoc => ({
  id, title, ts: T0 + hours * H, grade: 'press', ...extra,
});

// 실데이터(10-11~12 서울역 금주구역 · 오너 화면의 5건 + 3건 · 첫 문단 = 저장된 요약 첫 문장)
const L1 = '서울 중구가 서울역 광장 일대를 금주구역으로 공식 지정한다고 12일 밝혔다.';
const L2 = '서울 중구가 서울역 광장과 서울역사 주변을 금주구역으로 지정하기 위해 12일부터 다음 달 8일까지 행정예고를 실시한다고 밝혔다.';
const SEOUL = [
  doc(5421, '서울역 광장 음주없이 쾌적하게…서울 중구, 서울역 광장 금주구역 지정 예고 - 문화일보', -3, { lead: L1 }),
  doc(5423, '"서울역 광장 음주금지"…내년 3월부터 적발시 과태료 5만원 - 연합뉴스', 0, { lead: L1 }),
  doc(5425, '[속보] 서울역 광장, 11월 공식 ‘금주구역’ 지정…내년 3월부터 과태료 5만원 - 경기일보', 0.3, {
    lead: '서울시 중구가 오는 11월 9일부터 서울역 광장 일대를 공식 금주구역으로 지정하고 단속에 나선다.',
  }),
  doc(5424, "내년 3월부터 서울역 광장서 '음주' 못한다…과태료 5만원 - YTN", 0.6, {
    lead: '서울 중구가 서울역 광장 일대를 금주구역으로 지정하고, 오는 11월 9일부터 공식 지정에 들어간다.',
  }),
  doc(5422, '서울역 광장, 금주 구역으로…술마시면 과태료 - 채널A', 0.7, {
    lead: '서울시 중구가 다음 달 9일부터 서울역 광장을 금주구역으로 공식 지정한다고 12일 밝혔다.',
  }),
  doc(5426, '서울역 광장서 술 마시면 과태료 5만원…내년 3월부터 본격 단속 - 미주중앙일보', 1.2, {
    lead: '서울 중구가 서울역 광장 일대를 금주구역으로 지정한다고 밝혔다.',
  }),
  doc(5398, '이제 서울역 광장서 술 못 마신다…적발 땐 과태료 5만 원[서울25]', 1.8, { lead: L2 }),
  doc(5420, '이제 서울역 광장서 술못마신다…금주구역 지정예고[서울25] - 경향신문', 1.8, { lead: L2 }),
];
const OTHERS = [
  doc(5427, '장성교육청, ‘학생과 함께 만드는 금연 문화’ 나서 - 장성투데이', 1),
  doc(5409, '딥페이크·불법도박 확산에…청소년활동진흥원, 16일 대국민 예방 연수 연다 - 불탑뉴스', 0),
  doc(5399, '입사 다음 날 짐 쌌다…마약퇴치운동본부 줄퇴사, 왜', 0),
  doc(5429, '청주시, 서원구 버스정류소에 금연 안내 바닥스티커 설치 - 모빅경제', -16),
];

describe('event_cluster — 정규화', () => {
  it('꼬리 매체명 · 괄호 · 숫자 꼴(5만 원 → 5만원 · 1,545 → 1545)', () => {
    expect(stripOutletSuffix('서울역 광장, 금주 구역으로 - 채널A')).toBe('서울역 광장, 금주 구역으로');
    expect(stripOutletSuffix('제목 - 머니투데이 - 머니투데이')).toBe('제목');
    expect(normalizeClusterText('[속보] 적발 땐 과태료 5만 원[서울25]')).toBe('적발 땐 과태료 5만원');
    expect(normalizeClusterText('올해 1,545건 적발 (종합)')).toBe('올해 1545건 적발');
  });

  it('제목 2-gram 은 조사·분야 상투어를 빼고 띄어쓰기와 무관', () => {
    const stop = new Set(STOP);
    expect(jaccard(titleGrams('금주 구역으로 지정', stop), titleGrams('금주구역 지정', stop))).toBe(1);
    expect(titleGrams('도박 예방', stop).size).toBe(0);
  });

  it('첫 문단 = 요약 첫 문장', () => {
    expect(leadOf('첫 문장이다. 둘째 문장이다.\n셋째 줄')).toBe('첫 문장이다.');
  });
});

describe('event_cluster — 묶기', () => {
  it('서울역 금주구역 8건은 한 묶음 · 다른 기사는 따로(LLM 0)', () => {
    const idx = clusterDocs([...SEOUL, ...OTHERS], { fieldStopwords: STOP });
    const multi = multiClusters(idx);
    expect(multi).toHaveLength(1);
    expect(multi[0].size).toBe(8);
    for (const o of OTHERS) expect(idx.get(o.id)!.size).toBe(1);
  });

  it('cluster_id = 가장 이른 보도의 id · 대표 = 등급 높은 매체 → 같으면 이른 보도', () => {
    const docs = SEOUL.map((d) => (d.id === 5424 ? { ...d, grade: 'institution' } : d));
    const info = clusterDocs(docs, { fieldStopwords: STOP }).get(5426)!;
    expect(info.clusterId).toBe('5421');
    expect(info.representativeId).toBe(5424);
    expect(pickRepresentative([doc(2, 'a', 1), doc(1, 'b', 2)]).id).toBe(2);
    expect(info.memberIds[0]).toBe(5421);
  });

  it('보도 시각이 36시간 넘게 벌어지면 묶지 않는다', () => {
    const a = doc(1, '서울역 광장 금주구역 지정…과태료 5만원', 0);
    const b = doc(2, '서울역 광장 금주구역 지정…과태료 5만원 부과', 37);
    const c = doc(3, '서울역 광장 금주구역 지정…과태료 5만원 단속', 35);
    expect(clusterDocs([a, b]).get(1)!.size).toBe(1);
    expect(clusterDocs([a, c]).get(1)!.size).toBe(2);
  });

  it('같은 대체 요약문(첫 문단)만 같다고 묶지 않는다', () => {
    const a = doc(1, '과천시 청소년 도박 중독 예방 교육', 0, { lead: FALLBACK });
    const b = doc(2, '인터넷·스마트폰 중독 예방 전문상담기관 모집', 0, { lead: FALLBACK });
    const idx = clusterDocs([a, b], { fieldStopwords: STOP, ignoreLeads: [FALLBACK] });
    expect(idx.get(1)!.size).toBe(1);
  });

  it('분야 상투어만 겹치는 기사(○○ 마약 예방 캠페인)는 묶지 않는다', () => {
    const a = doc(1, '경남경찰청, 함양산삼축제 마약 예방 캠페인', 0);
    const b = doc(2, '대구 중구, 마약류 중독예방 부스형 참여 교육 시행', 2);
    expect(clusterDocs([a, b], { fieldStopwords: STOP }).get(1)!.size).toBe(1);
  });

  it('영어 기사: 낱말 겹침 · 외국 기사는 원제(altTitle)로도 비교', () => {
    const a = doc(1, '매사추세츠 게이밍위원회, 참전용사 도박중독 연구 추진', 0, {
      altTitle: 'Massachusetts Gaming Commission funds study on veterans gambling addiction',
    });
    const b = doc(2, 'Massachusetts Gaming Commission to study gambling harm among veterans', 3);
    expect(clusterDocs([a, b]).get(2)!.size).toBe(2);
  });

  it('사슬 막기: A~B, B~C 만 닮고 A·C 가 다르면 셋을 한 묶음으로 잇지 않는다', () => {
    const a = doc(1, '강원랜드 불법도박 근절 세미나 개최', 0);
    const b = doc(2, '강원랜드 불법도박 근절 세미나…경찰청 국방부 참석', 1);
    const c = doc(3, '경찰청 국방부 군 장병 불법도박 합동 단속 착수', 2);
    const idx = clusterDocs([a, b, c]);
    expect(idx.get(1)!.clusterId).toBe(idx.get(2)!.clusterId);
    expect(idx.get(3)!.clusterId).not.toBe(idx.get(1)!.clusterId);
  });
});

describe('event_cluster — 수집기 묶음 기억(ClusterPool)', () => {
  it('둘째 기사부터 기존 묶음의 대표를 돌려준다(관문 건너뛰고 대표 판정 상속용)', () => {
    const pool = new ClusterPool<{ tier: string; category: string }>({ fieldStopwords: STOP });
    pool.add(SEOUL[1], { tier: 'publish', category: '중독정책' });
    pool.add(OTHERS[0], { tier: 'publish', category: '중독사회와 회복' });
    const m = pool.match(SEOUL[3]);
    expect(m).not.toBeNull();
    expect(m!.data).toEqual({ tier: 'publish', category: '중독정책' });
    expect(pool.match(OTHERS[2])).toBeNull();
  });
});

describe('event_cluster — 보도 시각', () => {
  it('published_ts 우선 · 날짜만 있으면 KST 정오', () => {
    expect(docTs('2026-10-12T01:00:00Z', '2026-10-10')).toBe(Date.parse('2026-10-12T01:00:00Z'));
    expect(docTs(null, '2026-10-12')).toBe(Date.parse('2026-10-12T03:00:00Z'));
    expect(docTs(null, '2026-10-12T00:00:00.000Z')).toBe(Date.parse('2026-10-12T03:00:00Z'));
    expect(Number.isNaN(docTs(null, null))).toBe(true);
  });
});

// NEWS-Q4 ■3: 고유명사 규칙(정밀 우선) — 실데이터(10-12 줄퇴사 쌍 · 8-26 같은 대학 센터의 서로 다른 행사)
const P5399 =
  '마약 중독자의 상담과 재활을 지원하는 한국마약퇴치운동본부에서 지난해 7월 7일 같은 날 채용된 직원 22명 가운데 14명(64%)이 근무 8개월 이내에 퇴사한 것으로 나타났다. ' +
  '국회 보건복지위원회 소속 허종식 더불어민주당 의원이 이 단체에서 제출받은 입·퇴사자 현황에 따르면 당시 채용 인력 중 17명은 지역 중독재활센터인 함께한걸음센터와 1342 용기한걸음센터 등 재활·상담 관련 부서에 배치됐으며';
const P5410 =
  '국회 보건복지위원회 소속 더불어민주당 이수진 의원이 한국마약퇴치운동본부에서 제출받은 자료에 따르면, 이 기관은 지난해 7월 7일 하루에 신입 직원 22명을 채용했는데 이 가운데 14명(64%)이 8개월을 채우지 못하고 퇴사했다. ' +
  '채용 당시 이들 중 17명은 중독재활센터와 1342 상담 등 중독재활 업무 부서에 배치됐다.';
const QUIT_A = doc(5410, '마약퇴치운동본부 신입 22명 중 14명 퇴사…원인 파악 못해 - 국제신문', 0, { lead: leadOf(P5410), para: paraOf(P5410) });
const QUIT_B = doc(5399, '입사 다음 날 짐 쌌다…마약퇴치운동본부 줄퇴사, 왜', 1.2, { lead: leadOf(P5399), para: paraOf(P5399) });
const P4659 =
  '부산가톨릭대학교 중독회복이음센터가 경북교육청과 함께 진행한 ‘청소년 도박중독 예방 전문강사 양성 기본 교육’ 수료식이 성황리에 마무리됐다. ' +
  '이번 교육은 청소년 도박중독 문제의 심각성이 커지는 가운데, 학교 현장에서 예방 활동을 이끌어갈 전문 인력을 양성하기 위해 마련됐다.';
const P4656 =
  '부산가톨릭대학교 중독회복이음센터가 부산사상구청소년상담복지센터와 청소년 중독 예방을 위한 협력 체계를 강화했다. ' +
  '이번 협력은 지역 청소년들의 중독 문제에 대응하기 위해 두 기관이 힘을 모은 것으로, 예방 활동과 상담 지원 등에서의 연계가 기대된다.';
const UNI_A = doc(4659, '부산가톨릭대학교 중독회복이음센터, 경북교육청과 함께 ‘청소년 도박중독 예방 전문강사 양성 기본 교육’수료식 성료 - 국제신문', 0, { lead: leadOf(P4659), para: paraOf(P4659) });
const UNI_B = doc(4656, '부산가톨릭대학교 중독회복이음센터, 부산사상구청소년상담복지센터와 청소년 중독 예방 협력 강화 - 국제신문', 0, { lead: leadOf(P4656), para: paraOf(P4656) });

describe('event_cluster — 고유명사 규칙(NEWS-Q4 ■3)', () => {
  it('기관명·인명을 뽑는다(앞 「한국」 뗌 · 「○○○ 의원」)', () => {
    const e = entitiesOf('국회 보건복지위원회 소속 허종식 의원이 한국마약퇴치운동본부에서');
    expect(e).toEqual(expect.arrayContaining(['보건복지위원회', '人허종식', '마약퇴치운동본부']));
  });
  it('「경남경찰」⊂「경남경찰청」은 하나로 센다', () => {
    expect(sharedEntities(['경남경찰청', '함양산삼축제'], ['경남경찰', '경남경찰청', '함양산삼축제'])).toHaveLength(2);
    expect(sharedEntities(['경북경찰청'], ['경북경찰', '경북경찰청'])).toHaveLength(1);
  });
  it('공통 고유명사 2개 + 제목+첫 문단 Jaccard 0.25 이상 → 묶음(근거 entity) · 규칙 끄면 따로', () => {
    const on = clusterDocs([QUIT_A, QUIT_B], { fieldStopwords: STOP });
    expect(on.get(5399)!.clusterId).toBe(on.get(5410)!.clusterId);
    expect(clusterRules([QUIT_A, QUIT_B], { fieldStopwords: STOP }).get(5399)).toBe('entity');
    const off = clusterDocs([QUIT_A, QUIT_B], { fieldStopwords: STOP, entityRule: false });
    expect(off.get(5399)!.clusterId).not.toBe(off.get(5410)!.clusterId);
  });
  it('같은 기관(대학+부설 센터)의 서로 다른 행사는 묶지 않는다(오묶음 0)', () => {
    const idx = clusterDocs([UNI_A, UNI_B], { fieldStopwords: STOP });
    expect(idx.get(4659)!.clusterId).not.toBe(idx.get(4656)!.clusterId);
  });
  it('첫 문단이 없으면 고유명사 규칙도 제목 Jaccard(0.35)로만 본다', () => {
    const a = doc(1, '경찰청·국방부, 군 장병 불법도박 합동 단속 착수', 0);
    const b = doc(2, '강원랜드 불법도박 근절 세미나…경찰청 국방부 참석', 1);
    const idx = clusterDocs([a, b]);
    expect(idx.get(1)!.clusterId).not.toBe(idx.get(2)!.clusterId);
  });
  it('묶음 근거: 가장 이른 기사 = seed · 나머지 = jaccard|noun|entity', () => {
    const r = clusterRules(SEOUL.slice(0, 4), { fieldStopwords: STOP });
    expect(r.get(5421)).toBe('seed');
    for (const id of [5423, 5425, 5424]) expect(['jaccard', 'noun', 'entity']).toContain(r.get(id));
  });
});
