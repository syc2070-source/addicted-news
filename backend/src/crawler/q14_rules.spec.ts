import * as fs from 'fs';
import * as path from 'path';
import { archiveSpamArticles, spamPublisherOf, titleTail } from './spam_publisher';
import { breakerSummaryOf, summaryBeyondTitle } from './breaker_summary';
import {
  EpisodeItem,
  existingEpisodeMains,
  foldEpisodes,
  isMainItem,
  relatedClip,
  shortByLength,
  videoIdOfUrl,
} from './broadcast_episode';
import { keywordGroupsOf } from './keyword_groups';
import {
  QuotaGuard,
  fetchDurations,
  parseDurations,
  parseIsoDuration,
} from './youtube_api';
import { AlertFacts, evaluateRunAlerts } from './run_alerts';
import { digestPerSource } from './crawl_runs';
import {
  broadcastArchiveList,
  parseArchiveTier,
  redactArchiveList,
} from './broadcast_archive_list';
import { runCleanup, JudgeFn, Row } from './judge_cleanup';
import type { QueryFn } from './schema_probe';
import { redactPublic } from './public_redact';
import { AppService } from '../app.service';

const FAKE_KEY = 'test-youtube-key-not-real';

type ProfileJson = {
  gate: { breaker_summary_min_chars?: number };
  sources: {
    spam_publishers: { names: string[]; archive_ids: number[] };
    broadcast: {
      main_min_seconds: number;
      clip_max_seconds: number;
      duration_unit_cap_day: number;
    };
  };
};

function profileJson(): ProfileJson {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../../data/field_profiles/addiction.json'),
      'utf8',
    ),
  ) as ProfileJson;
}

/** jest.fn() n 번째 부름의 SQL 글 */
function sqlOf(m: jest.Mock, n = 0): string {
  return String((m.mock.calls as unknown[][])[n][0]);
}

const NAMES = profileJson().sources.spam_publishers.names;

// ---------- ■1 스팸 출처 ----------
describe('NEWS-Q14 ■1 — 집계기 스팸 출처', () => {
  // 10-23 실림 실제 제목(공개 API · 원제)
  const SPAM = [
    '설정값과 결과값을 구별하는 인터넷 게임 중독의 문제점 숫자 읽기 - Calgary Roughnecks',
    '모바일 도움말의 스크롤 영역, 포커 중독 화면 사용법 - Calgary Roughnecks',
    '같은 심벌이 연속으로 나와야 하나요? 도박 중독 사례 - Calgary Roughnecks',
    '도박중독 번호 : 초보자가 알아야 할 모든 것 - 실용적인 접근법 - Calgary Roughnecks',
    '이전 결과가 다음 결과를 보장하나요? 스포츠토토 중독 치료 - Calgary Roughnecks',
    '공간이 좁은 화면에서 읽는 토토중독 정보 영역 - calgaryroughnecks.com',
    '스캐터와 일반 심벌을 구별하는 인터넷게임 중독 아동의 치료 심벌 안내 - Histoire pour tous',
    '인터넷 게임 중독 예방지침 투자 재테크로 보는 권위 있는 해석: 기초, 심화 및 마스터 - Platea Magazine',
    '도박중독 갤 포스트 코로나 시대 브랜드 구축: 기초, 심화 및 마스터 - horacke-noviny.com',
    '도박중독 치료 센터 에 대한 궁금증을 해소하는 완벽한 가이드 - termokonteiner.ru',
  ];
  // 오탐 표본 20: 같은 출처(구글뉴스 KR 검색 피드)의 정상 기사 — 10-23 실림 실제 원제(꼬리 매체가 모두 다름)
  const NORMAL = [
    '단양군, 공동생활가정 아동 대상 성교육·중독 예방교육 실시 - 뉴스신',
    '‘수원대디’ 이동엽, 청소년 도박중독 종합지원 체계 마련 - 동방일보',
    '10대 약물중독 진료율 5년 새 34.5% 증가 - 한국교육신문',
    '의사 ‘셀프처방’ 의료용 마약류 1종→22종 확대…펜타닐·에토미데이트도 금지 - 서울경제',
    '미성년자에 필로폰 투약 후 성관계한 남성 항소심 징역 8년10개월 - 뉴스1',
    '서울시립인터넷중독예방상담센터, 디지털미디어 정책포럼 개최 - 비건뉴스',
    '청소년이 그린 중독 예방 메시지 계룡시 교육 현장으로 확산 - 충청일보',
    '서울시립인터넷중독예방상담센터 정책포럼 개최, 청소년 디지털미디어 과의존 예방 논의 - 핸드메이커',
    '혹시 나도? 도박보다 심각하다고 여기는 ‘스마트폰 중독’ [서베이 행간읽기] - 더스쿠프',
    '판돈만 23조원…불법 도박사이트 188개 공급한 조직 77명 검거 - https://www.seoulilbo.co.kr/',
    '한화생명, 금융교육으로 인니 청소년 불법도박 근절 나선다 - 재외동포신문',
    "[쇼츠] '판돈만 23조원' 국내 최대 불법 도박사이트 조직 적발 - 연합뉴스",
    '경기 마퇴사업본부, 약물 중독 회복자 일상 복귀 방안 논의 - 데일리팜',
    '23조원대 역대 최대 불법 도박사이트 조직 적발··· 대기업 개발자 출신도 가담 - 한국일보',
    '국내 최대 불법 도박사이트 공급조직원 77명 검거…23조원 규모 - 국민일보',
    '판돈 23조원 불법 도박사이트 조직 적발...188개 제작·유통, 77명 검거 - M이코노미뉴스',
    '판돈 23조원…불법 도박사이트 188개 제작·공급 일당 77명 검거 - 중앙일보',
    '23조 원대 불법 도박사이트 공급조직 적발…77명 검거·21명 구속 > 뉴스 - 천안신문',
    '충남경찰청, 동남아 거점 불법 도박사이트 188개 운영…판돈 23조원·77명 검거 - 시사저널',
    "23조 불법 도박사이트 제작·공급 조직 77명 '검거' - 세이프타임즈",
  ];

  it('제목 꼬리 = 앞뒤 띈 마지막 「 - 」 뒤(붙은 「-」는 이름 안)', () => {
    expect(titleTail('가 - 나 - horacke-noviny.com')).toBe('horacke-noviny.com');
    expect(titleTail('꼬리 없는 제목')).toBe('');
    expect(titleTail('A – Calgary Roughnecks')).toBe('Calgary Roughnecks');
  });

  it('스팸 10 꼴은 모두 걸리고 이름을 돌려준다(설정 names · 코드에 글자 0)', () => {
    for (const t of SPAM) expect(spamPublisherOf(t, 'Google News (KR)', NAMES)).not.toBeNull();
    expect(spamPublisherOf(SPAM[0], null, NAMES)).toBe('Calgary Roughnecks');
    expect(spamPublisherOf('번역된 제목', 'Calgary Roughnecks', NAMES)).toBe('Calgary Roughnecks');
  });

  it('오탐 표본 20(같은 구글뉴스 KR 출처 정상 기사) → 0 건 막힘', () => {
    expect(NORMAL).toHaveLength(20);
    const blocked = NORMAL.filter((t) => spamPublisherOf(t, 'Google News (KR)', NAMES) !== null);
    expect(blocked).toEqual([]);
  });

  it('제목 가운데 낱말은 보지 않는다 · 이름 없거나 짧으면 0', () => {
    expect(spamPublisherOf('캘거리 Calgary Roughnecks 경기 결과 - 연합뉴스', null, NAMES)).toBeNull();
    expect(spamPublisherOf(SPAM[0], null, [])).toBeNull();
    expect(spamPublisherOf('가 - ab', null, ['ab'])).toBeNull();
  });

  it('설정: archive_ids 160 · 중복 0 · names 6', () => {
    const sp = profileJson().sources.spam_publishers;
    expect(sp.names).toHaveLength(6);
    expect(sp.archive_ids).toHaveLength(160);
    expect(new Set(sp.archive_ids).size).toBe(160);
    expect(sp.archive_ids).toEqual(expect.arrayContaining([6054, 6130, 5998, 4860, 866]));
  });

  it('보관층으로: 기사 · 실림층 · 출처가 맞는 행만 · [행들, 수] 꼴 · updated_at · 몇 번 돌아도 같음', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: 6054, title: '번역 제목', original_title: SPAM[0], source: 'Google News (KR)' },
        { id: 5043, title: SPAM[5], original_title: null, source: 'Google News' },
        { id: 6036, title: NORMAL[1], original_title: NORMAL[1], source: 'Google News (KR)' },
      ])
      .mockResolvedValueOnce([[{ id: 6054 }, { id: 5043 }], 2]);
    const r = await archiveSpamArticles(query, [6054, 5043, 6036, 9999], NAMES);
    expect(r.archived).toEqual([6054, 5043]);
    expect(r.skipped).toEqual([6036, 9999]);
    expect(sqlOf(query, 0)).toMatch(/source_type IS DISTINCT FROM 'broadcast' AND COALESCE\(tier, 'publish'\) = 'publish'/);
    expect(sqlOf(query, 1)).toMatch(/SET tier = 'archive', updated_at = now\(\)/);
    expect(sqlOf(query, 1)).not.toMatch(/DELETE/);
    expect((query.mock.calls as unknown[][])[1][1]).toEqual([[6054, 5043]]);
    // 다시 돌면 이미 보관 → SELECT 0 행 · UPDATE 안 부름
    const again = jest.fn().mockResolvedValueOnce([]);
    await expect(archiveSpamArticles(again, [6054], NAMES)).resolves.toEqual({ archived: [], skipped: [6054] });
    expect(again).toHaveBeenCalledTimes(1);
    await expect(archiveSpamArticles(jest.fn().mockRejectedValue(new Error('db')), [1], NAMES)).resolves.toEqual({
      archived: [],
      skipped: [1],
      error: true,
    });
    // 숨긴 행은 건드리지 않음(열 있을 때)
    const hid = jest.fn().mockResolvedValueOnce([]);
    await archiveSpamArticles(hid, [6054], NAMES, { deletedAt: true });
    expect(sqlOf(hid)).toMatch(/deleted_at IS NULL/);
  });

  it('리뷰: 머리 맞춤은 도메인 꼬리만 — 흔한 이름이 다른 매체를 막지 않음', () => {
    expect(spamPublisherOf('기사 - Daily Mail', null, ['Daily'])).toBeNull();
    expect(spamPublisherOf('기사 - Daily', null, ['Daily'])).toBe('Daily');
    expect(spamPublisherOf('기사 - daily.com', null, ['Daily'])).toBe('Daily');
    expect(spamPublisherOf('기사 - Calgary Roughnecks Lacrosse Club', null, NAMES)).toBeNull();
  });
});

// ---------- ■3 단락기 요약 판정 ----------
describe('NEWS-Q14 ■3 — 단락기로 본문 없는 기사는 RSS 요약으로', () => {
  const MIN = profileJson().gate.breaker_summary_min_chars;

  it('구글 site: 피드 description(= 제목 + 매체) → 요약 없음 → null(옛 규칙: 본문 부실 건너뜀)', () => {
    const title = '美민주당 버지니아주의원, 마약 유통·돈세탁 혐의 기소…가족도 연루 - 동아일보';
    const desc = '美민주당 버지니아주의원, 마약 유통·돈세탁 혐의 기소…가족도 연루 동아일보';
    expect(summaryBeyondTitle(desc, title, '동아일보')).toBe('');
    expect(breakerSummaryOf(desc, title, '동아일보', MIN)).toBeNull();
  });

  it('제목 밖 요약이 넉넉하면 그 요약(호출 수 그대로 · 판정 재료만 늘어남)', () => {
    const title = '청소년 도박 첫 경험 연령 13.9세 - 프레시안';
    const desc =
      '청소년 도박 첫 경험 연령 13.9세 사행산업통합감독위원회가 전국 중고생 1만 7천 명을 조사한 결과 처음 도박을 해 본 나이가 평균 13.9세로 낮아졌다고 밝혔다. 위원회는 온라인 도박 경험률도 함께 늘었다며 학교 예방 교육을 넓히겠다고 덧붙였다.';
    const s = breakerSummaryOf(desc, title, '프레시안', MIN);
    expect(s).toContain('사행산업통합감독위원회가');
    expect(s).not.toContain('13.9세 사행');
  });

  it('끔: min 0 · 없음', () => {
    expect(breakerSummaryOf('아주 긴 요약 '.repeat(20), '제목', null, 0)).toBeNull();
    expect(breakerSummaryOf('아주 긴 요약 '.repeat(20), '제목', null, undefined)).toBeNull();
  });
});

// ---------- ■4 길이 본편 ----------
describe('NEWS-Q14 ■4 — 영상 길이로 본편·클립', () => {
  it('ISO 길이 → 초', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT59S')).toBe(59);
    expect(parseIsoDuration('PT20M')).toBe(1200);
    expect(parseIsoDuration('P1DT1S')).toBe(86401);
    expect(parseIsoDuration('P0D')).toBe(0);
    expect(parseIsoDuration('')).toBeNull();
    expect(parseIsoDuration('PT')).toBeNull();
    expect(parseIsoDuration(undefined)).toBeNull();
    const m = parseDurations({
      items: [
        { id: 'aaaaaaaaaaa', contentDetails: { duration: 'PT45M' } },
        { id: 'bbbbbbbbbbb', contentDetails: {} },
      ],
    });
    expect([...m]).toEqual([['aaaaaaaaaaa', 2700]]);
  });

  it('videos.list contentDetails · 50편 1단위 · 길이 상한 · 가드 · 열쇠는 머리글에만', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${String(i).padStart(10, '0')}`);
    const calls: Array<{ params: Record<string, string | number>; headers: Record<string, string> }> = [];
    const get = async (_u: string, params: Record<string, string | number>, headers: Record<string, string>) => {
      calls.push({ params, headers });
      return {
        items: String(params.id)
          .split(',')
          .map((id) => ({ id, contentDetails: { duration: 'PT30S' } })),
      };
    };
    const guard = new QuotaGuard(2000, 0);
    const r = await fetchDurations([...ids, ids[0], 'bad id'], FAKE_KEY, guard, { left: 20 }, { get });
    expect(r.calls).toBe(3);
    expect(r.units).toBe(3);
    expect(r.durations.size).toBe(120);
    expect(calls[0].params.part).toBe('contentDetails');
    expect(String(calls[0].params.id).split(',')).toHaveLength(50);
    expect(JSON.stringify(calls.map((c) => c.params))).not.toContain(FAKE_KEY);
    expect(calls[0].headers['x-goog-api-key']).toBe(FAKE_KEY);

    // 길이 상한 2 → 2 번 뒤 멈춤
    const budget = { left: 2 };
    const r2 = await fetchDurations(ids, FAKE_KEY, new QuotaGuard(2000, 0), budget, { get });
    expect([r2.calls, r2.stopped, budget.left]).toEqual([2, 'unit_cap', 0]);
    // 하루 가드
    const r3 = await fetchDurations(ids, FAKE_KEY, new QuotaGuard(2000, 2000), { left: 20 }, { get });
    expect([r3.calls, r3.stopped]).toEqual([0, 'quota_guard']);
    // 할당량 오류 → 멈춤 · 가드 stopped
    const g4 = new QuotaGuard(2000, 0);
    const r4 = await fetchDurations(ids, FAKE_KEY, g4, { left: 20 }, {
      get: () => Promise.reject({ response: { status: 403, data: { error: { errors: [{ reason: 'quotaExceeded' }] } } } }),
    });
    expect([r4.calls, r4.stopped, g4.stopped]).toEqual([1, 'quotaExceeded', true]);
  });

  const RULE = { mainMinSec: 1200, clipMaxSec: 60 };
  const ep = (title: string, publishedAt: string, durationSec?: number, program = 'MBC PD수첩'): EpisodeItem => ({
    title,
    program,
    publishedAt,
    groups: keywordGroupsOf(title).concat('도박'),
    ...(durationSec !== undefined ? { durationSec } : {}),
  });

  it('60초 미만 = 클립(보관) · [full] 은 짧아도 클립 아님 · 길이 없으면 옛 규칙', () => {
    const items = [
      ep('도박에 빠진 아이들 - PD수첩, MBC 261021 방송', '2026-10-21T13:10:00Z', 3600),
      ep('도박 빚 3억, 엄마의 눈물', '2026-10-22T01:00:00Z', 45),
      ep('[full] 도박 짧은 판', '2026-10-22T02:00:00Z', 50),
      ep('도박 빚 이야기 다른 편', '2026-10-22T03:00:00Z'),
    ];
    const roles = foldEpisodes(items, [], { length: RULE });
    expect(roles[0]).toBe('main');
    expect(roles[1]).toBe('clip');
    expect(roles[2]).toBe('main');
    // 길이 규칙을 안 주면 Q13 그대로
    expect(foldEpisodes(items, [])[1]).toBe('main');
    expect(shortByLength({ title: 'x', program: 'p', publishedAt: '', durationSec: 0 }, RULE)).toBe(false);
  });

  it('제목에 방송 꼬리가 없어도 20분 넘는 영상은 본편 — 뒤 클립을 관련 클립으로 묶음(단독 채널)', () => {
    const main = ep('도박에 빠진 10대들', '2026-10-21T13:10:00Z', 3540);
    const clip = ep('도박 빚 갚으려 다시 도박', '2026-10-22T01:00:00Z', 420);
    expect(isMainItem(main, undefined, RULE)).toBe(true);
    expect(isMainItem(main)).toBe(false);
    expect(relatedClip(clip, main, 3, undefined, RULE)).toBe(true);
    expect(relatedClip(clip, main)).toBe(false); // 길이 없으면 Q13 그대로(본편 표시 없음 → 안 묶음)
    expect(foldEpisodes([main, clip], [], { solo: true, length: RULE })).toEqual(['main', 'related']);
    // 둘 다 20분 넘으면 둘 다 본편(묶지 않음 · 덜 버리는 쪽)
    const long2 = ep('도박 빚 갚으려 다시 도박', '2026-10-22T01:00:00Z', 1500);
    expect(foldEpisodes([main, long2], [], { solo: true, length: RULE })).toEqual(['main', 'main']);
  });

  it('이미 실린 본편: source_url 에서 영상 id · 60초 미만 옛 행은 본편으로 치지 않음', async () => {
    expect(videoIdOfUrl('https://www.youtube.com/watch?v=abcdefghijk')).toBe('abcdefghijk');
    expect(videoIdOfUrl('https://youtu.be/abcdefghijk?t=3')).toBe('abcdefghijk');
    expect(videoIdOfUrl('https://www.youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk');
    expect(videoIdOfUrl('https://example.com/x')).toBe('');
    const query = jest.fn().mockResolvedValue([
      { title: '도박 편', source_url: 'https://www.youtube.com/watch?v=abcdefghijk', keywords: '도박', published_at: '2026-10-20' },
      { title: '옛 편', keywords: null, published_at: '2026-10-19' },
    ]);
    const rows = await existingEpisodeMains(query, 'MBC PD수첩', '2026-10-10', '2026-10-30', { deletedAt: false });
    expect(rows[0].videoId).toBe('abcdefghijk');
    expect(rows[1].videoId).toBeUndefined();
    expect(sqlOf(query)).toMatch(/SELECT title, source_url,/);
    // 길이 읽은 옛 짧은 행은 본편 목록에서 빠짐 → 이번 같은 회차가 episode_dup 으로 밀리지 않음
    const oldShort = { ...ep('도박에 빠진 10대들', '2026-10-20T01:00:00Z', 30) };
    const now = ep('도박에 빠진 10대들 - PD수첩, MBC 261021 방송', '2026-10-21T13:10:00Z', 3600);
    expect(foldEpisodes([now], [oldShort], { length: RULE })).toEqual(['main']);
    // 반박 리뷰 M1: 옛 행 길이를 모르면 옛 규칙 그대로(옛 실린 행이 앞섬 → episode_dup)
    expect(foldEpisodes([now], [{ ...oldShort, durationSec: undefined }])).toEqual(['episode_dup']);
    expect(foldEpisodes([now], [{ ...oldShort, durationSec: undefined }], { length: RULE })).toEqual(['episode_dup']);
    expect(foldEpisodes([now], [{ ...now, publishedAt: '2026-10-20T13:10:00Z', durationSec: undefined }])).toEqual(['episode_dup']);
  });

  it('리뷰: 꼬리 없는 20분+ 「몰아보기」가 먼저 올라와도 꼬리 본편이 본편 · 옛 꼬리 없는 실린 클립이 새 본편을 밀지 않음', () => {
    const digest = ep('마약에 빠진 10대들 몰아보기', '2026-10-20T01:00:00Z', 2100, 'KBS 추적60분');
    const main = ep('마약에 빠진 10대들 - 추적60분 1400회 KBS 261021 방송', '2026-10-21T13:00:00Z', 3600, 'KBS 추적60분');
    expect(foldEpisodes([digest, main], [], { length: RULE })).toEqual(['episode_dup', 'main']);
    const oldClip = ep('마약에 빠진 10대들', '2026-10-20T01:00:00Z', 600, 'KBS 추적60분');
    expect(foldEpisodes([main], [oldClip], { length: RULE })).toEqual(['main']);
    // 이번 후보가 본편 표시 없으면 옛 규칙 그대로(옛 실린 행이 앞섬)
    const plain = ep('마약에 빠진 10대들', '2026-10-21T13:00:00Z', 600, 'KBS 추적60분');
    expect(foldEpisodes([plain], [oldClip], { length: RULE })).toEqual(['episode_dup']);
    // 반박 리뷰 M2: 같은 실행에서 꼬리 붙은 6분 클립이 먼저 올라와도 꼬리 붙은 60분 본편이 본편
    const tagClip = ep('마약에 빠진 10대들 - 추적60분 KBS 261021 방송', '2026-10-21T09:00:00Z', 360, 'KBS 추적60분');
    expect(foldEpisodes([tagClip, main], [], { length: RULE })).toEqual(['episode_dup', 'main']);
    // 옛 꼬리 붙은 클립(길이 읽음 · 6분)은 새 60분 본편을 밀지 않음
    expect(foldEpisodes([main], [{ ...tagClip, publishedAt: '2026-10-20T09:00:00Z' }], { length: RULE })).toEqual(['main']);
  });

  it('설정: 20분 · 180초(Q15) · 하루 20단위', () => {
    const b = profileJson().sources.broadcast;
    // NEWS-Q15 ■2: 쇼츠 상한 180초
    expect([b.main_min_seconds, b.clip_max_seconds, b.duration_unit_cap_day]).toEqual([1200, 180, 20]);
  });
});

// ---------- ■2 세계 경보 ----------
describe('NEWS-Q14 ■2 — world_zero_2d = 세계 실림 + 보관 0', () => {
  const facts = (o: Partial<AlertFacts>): AlertFacts => ({
    startedAt: '2026-10-23T03:00:00Z',
    durationSec: 600,
    timedOut: false,
    reachedOf: null,
    broadcastExpected: true,
    broadcastChannelsRead: 9,
    worldSaved: 0,
    worldArchived: 0,
    urlResolveFail: 0,
    deepseekCalls: 10,
    saved: 50,
    ...o,
  });
  const y = '2026-10-22T03:00:00Z';

  it('실림 0 · 보관 있음(10-21 1 · 10-22 6 꼴) → 울리지 않음', () => {
    expect(evaluateRunAlerts([facts({ worldArchived: 6 }), facts({ startedAt: y, worldArchived: 1 })])).toEqual([]);
    expect(evaluateRunAlerts([facts({}), facts({ startedAt: y, worldArchived: 1 })])).toEqual([]);
  });

  it('이틀 모두 실림 + 보관 0 → 울림 · 옛 사실(worldArchived 없음)은 0 으로', () => {
    const old = facts({ startedAt: y });
    delete old.worldArchived;
    expect(evaluateRunAlerts([facts({}), old]).map((a) => a.code)).toEqual(['world_zero_2d']);
  });

  it('per_source 세계 보관 수를 센다', () => {
    const d = digestPerSource({
      'wp-wpr-001': { read: 5, saved: 0, archived: 2 },
      'wp-google-site-clarin': { read: 3, saved: 1, archived: 1 },
      'kr-press-a': { read: 3, saved: 2, archived: 4 },
    });
    expect([d.sources.worldSaved, d.sources.worldArchived]).toEqual([1, 3]);
  });
});

// ---------- ■5 보관 목록 ----------
describe('NEWS-Q14 ■5 · Q15 ■1 — 공개 방송 보관 목록', () => {
  it('id · tier · changedAt · videoId 만 · 방송 · 보관 전 기간 · 지운 편 = deleted · 막힘 뺌', async () => {
    const query = jest.fn().mockResolvedValue([
      // pg bigint = 글
      { id: 5868, source_url: 'https://www.youtube.com/watch?v=abcdefghijk', tier: 'archive', changed: String(Date.parse('2026-10-23T03:00:41.120Z')) },
      { id: 5000, source_url: 'https://example.com/x', tier: 'deleted', changed: String(Date.parse('2026-06-01T00:00:00.000Z')) },
      { id: 'x', tier: 'archive', changed: '1' },
      { id: 6141, tier: 'archive', changed: null },
    ]);
    const res = await broadcastArchiveList(query, { tier: 'archive', deletedAt: true });
    // NEWS-Q17 반박: 꼴 틀린 행(id 'x' · changed null)을 건너뛰었으니 「다 실었다」 아님
    expect(res?.truncated).toBe(true);
    const items = res?.items;
    expect(items).toEqual([
      { id: 5000, news_id: 5000, tier: 'deleted', changedAt: '2026-06-01T00:00:00.000Z', videoId: null },
      { id: 5868, news_id: 5868, tier: 'archive', changedAt: '2026-10-23T03:00:41.120Z', videoId: 'abcdefghijk' },
    ]);
    const sql = sqlOf(query);
    expect(sql).toMatch(/source_type = 'broadcast'/);
    expect(sql).toMatch(/deleted_at IS NOT NULL OR tier = 'archive'/);
    expect(sql).toMatch(/WHEN deleted_at IS NOT NULL THEN 'deleted'/);
    expect(sql).toMatch(/NOT blocked/);
    // NEWS-Q17 ■3 · Q18 ■4: id 차례 · 안전 한도 50,000(+1 을 읽어 넘쳤는지 앎)
    expect(sql).toMatch(/ORDER BY id LIMIT 50001$/);
    // 보관 · 지운 편은 날 수 제한 없음
    expect(sql).not.toMatch(/interval/);
    expect((query.mock.calls as unknown[][])[0][1]).toEqual([]);
    expect(sql).not.toMatch(/title|summary|description/);
    expect(JSON.stringify(items)).not.toMatch(/https?:/);
  });

  it('tier=all = 실림 포함(NEWS-Q16 ■4: 전 기간) · 그 밖의 값 = archive · deleted_at 열 없으면 deleted 0 · 실패면 null', async () => {
    expect(parseArchiveTier('all')).toBe('all');
    expect(parseArchiveTier('publish')).toBe('archive');
    expect(parseArchiveTier(undefined)).toBe('archive');
    const query = jest.fn().mockResolvedValue([]);
    await broadcastArchiveList(query, { tier: 'all', deletedAt: false });
    expect(sqlOf(query)).toMatch(/tier = 'archive' OR COALESCE\(tier, 'publish'\) = 'publish'\)/);
    expect(sqlOf(query)).not.toMatch(/interval/);
    expect((query.mock.calls as unknown[][])[0][1]).toEqual([]);
    expect(sqlOf(query)).not.toMatch(/deleted_at/);
    await expect(
      broadcastArchiveList(jest.fn().mockRejectedValue(new Error('x')), { tier: 'archive', deletedAt: false }),
    ).resolves.toBeNull();
  });

  it('AppService: DB 없으면 available false · 200 꼴 · 공개 가림 뒤에도 DB 주소·열쇠 꼴 0', async () => {
    const none = await new AppService().broadcastArchive('archive');
    expect(none).toMatchObject({ kind: 'broadcast', available: false, count: 0, items: [], days: null });

    const query = jest.fn(async (sql: string) => {
      if (sql.includes('information_schema.columns')) return [{ x: 1 }];
      return [{ id: 5868, source_url: 'https://youtu.be/abcdefghijk', tier: 'archive', changed: Date.parse('2026-10-23T03:00:41Z') }];
    });
    const svc = new AppService({ isInitialized: true, query } as never);
    const out = redactArchiveList(await svc.broadcastArchive('all'));
    expect(out).toMatchObject({ tier: 'all', available: true, count: 1, truncated: false });
    expect(out.items).toEqual([{ id: 5868, news_id: 5868, tier: 'archive', changedAt: '2026-10-23T03:00:41.000Z', videoId: 'abcdefghijk' }]);
    const text = JSON.stringify(out);
    for (const re of [/postgres(ql)?:\/\//i, /\.render\.com/i, /password/i, /sk-[a-z0-9]{16,}/i, /AIza[0-9A-Za-z_-]{20,}/]) {
      expect(text).not.toMatch(re);
    }
    // 리뷰(Q15): 「sk-」 · 「eyJ」 로 시작하는 진짜 영상 id 는 열쇠 꼴 가림에 지워지지 않음 · 꼴이 틀린 id 는 null
    const kept = redactArchiveList({
      ...out,
      items: [
        { id: 1, news_id: 1, tier: 'archive', changedAt: '2026-10-23T03:00:41.000Z', videoId: 'sk-abcdefgh' },
        { id: 2, news_id: 2, tier: 'deleted', changedAt: '2026-10-23T03:00:41.000Z', videoId: 'eyJabcdefgh' },
        { id: 3, news_id: 3, tier: 'archive', changedAt: '2026-10-23T03:00:41.000Z', videoId: 'https://x/y' },
      ],
    });
    expect(kept.items.map((x) => x.videoId)).toEqual(['sk-abcdefgh', 'eyJabcdefgh', null]);
    expect(redactPublic('sk-abcdefgh')).toBe('<key>');
    // 60초 기억
    await svc.broadcastArchive('all');
    expect(query.mock.calls.filter((c) => String(c[0]).includes('FROM articles')).length).toBe(1);
  });
});

// ---------- ■6 정리 수 ----------
describe('NEWS-Q14 ■6 — judge_cleanup 삭제 수', () => {
  const row = (id: number): Row => ({
    id,
    title: `기사 ${id}`,
    summary: null,
    category: '도박중독',
    source: 'x',
    published_at: '2026-10-01',
    created_at: null,
  });
  const judge: JudgeFn = () => Promise.resolve({ isIncident: true, categoryFit: false, confidence: 'high', via: 'deepseek' });

  function db(shape: 'pg' | 'typeorm'): QueryFn {
    return (text, params) => {
      if (text.includes('information_schema.columns')) return Promise.resolve([{ x: 1 }]);
      if (/^\s*SELECT id, title/.test(text)) return Promise.resolve([row(1), row(2), row(3)] as never);
      const ids = ((params?.[0] as number[]) ?? []).map((id) => ({ id }));
      return Promise.resolve((shape === 'pg' ? ids : [ids, ids.length]) as never);
    };
  }

  it('pg Client(.rows = 행들) 와 typeorm([행들, 수]) 둘 다 3 — 옛 코드는 typeorm 꼴이면 늘 2', async () => {
    for (const shape of ['pg', 'typeorm'] as const) {
      const r = await runCleanup({ query: db(shape), judge, apply: true, hardDelete: false, log: () => undefined });
      expect(r.softDeleted).toBe(3);
      const h = await runCleanup({ query: db(shape), judge, apply: true, hardDelete: true, log: () => undefined });
      expect(h.hardDeleted).toBe(3);
    }
  });
});
