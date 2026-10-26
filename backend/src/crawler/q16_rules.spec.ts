import * as path from 'path';
import { alignAiredDates, originalAirDate, parseBroadcastRawBody, withAiredLine } from './broadcast_aired';
import { BroadcastSource, buildBroadcastRow, channelLengthRule, loadBroadcastSources } from './broadcast';
import { broadcastGateSystem } from './broadcast_gate';
import { rejudgeBroadcasts, rejudgeStateFromRuns, REJUDGE_MAX_TRIES } from './broadcast_rejudge';
import { EpisodeItem, existingEpisodeMains, foldEpisodes, shortClip } from './broadcast_episode';
import { fieldProfile } from './field_profile';
import { oldDatedTier } from './tier';

const sqlOf = (q: jest.Mock, i = 0) => String((q.mock.calls as unknown[][])[i][0]);

const SRC: BroadcastSource = {
  outletId: 'kbs_docu_insight', program: 'KBS 다큐인사이트', channelTitle: 'KBS 다큐', channelId: 'UC4LW3sOslC14Vn5bcoNUBkg',
  feedUrl: 'x', sharedChannel: true, programEn: null, soloChannel: false,
};

// ---------- ■1 원 방송일 ----------
describe('NEWS-Q16 ■1 — 재업로드 방송은 원 방송일로(규칙 · LLM 0)', () => {
  const MIN = fieldProfile().sources.broadcast.aired_date_min_days;

  it('설정 30일', () => {
    expect(MIN).toBe(30);
  });

  it('제목 꼬리: 8자리 · 6자리+방송 · 「2017년 6월 19일 방송」 · (17.06.19) · 「시사기획 20100413」', () => {
    const up = '2026-08-03T09:00:00Z';
    expect(originalAirDate('마약 중독 회복자 | KBS 월요기획 20170619 방송', '', up, MIN)).toMatchObject({ aired: '2017-06-19', reupload: true, from: 'title' });
    expect(originalAirDate('도박의 늪 - 시사기획 20100413', '', up, MIN)?.aired).toBe('2010-04-13');
    expect(originalAirDate('음주 신고 69건 KBS 170619 방송', '', up, MIN)?.aired).toBe('2017-06-19');
    expect(originalAirDate('대학가 액상 대마 (2019년 3월 4일 방송)', '', up, MIN)?.aired).toBe('2019-03-04');
    expect(originalAirDate('전자담배 정밀검사 (19.03.04)', '', up, MIN)?.aired).toBe('2019-03-04');
    expect(originalAirDate('카지노 2017.06.19 방송분', '', up, MIN)?.aired).toBe('2017-06-19');
  });

  it('설명은 「방송·방영」 낱말이 든 줄만 · 아무 날짜나 읽지 않음', () => {
    const up = '2026-08-03T09:00:00Z';
    expect(originalAirDate('신학기 음주 강요', '2016년 조사에 따르면 대학생 70%\n※ 방송일: 2018.03.05', up, MIN)).toMatchObject({ aired: '2018-03-05', from: 'description' });
    expect(originalAirDate('신학기 음주 강요', '2016년 3월 4일 조사에 따르면', up, MIN)).toBeNull();
    expect(originalAirDate('신학기 음주 강요', '이 영상은 2018년 3월 5일 방영된 다큐입니다', up, MIN)?.aired).toBe('2018-03-05');
  });

  it('리뷰: 사건 날짜 · 제품 번호 · 지난 편 · 다른 뜻 「방송」 줄은 읽지 않음', () => {
    const up = '2026-10-20T09:00:00Z';
    const none = (t: string, d = '') => originalAirDate(t, d, up, MIN);
    expect(none('2019.03.14 버닝썬 사건의 전말 | 추적60분')).toBeNull();
    expect(none('20241203 계엄과 마약 수사')).toBeNull();
    expect(none('제품코드 20241231 펜타닐')).toBeNull();
    expect(none('뉴스타파 2025-10-01 보도')).toBeNull();
    expect(none('도박', '이 방송은 2015년 5월 3일 발생한 사건을 재구성했습니다')).toBeNull();
    expect(none('도박', '2018년 3월 1일 시행된 음주운전 처벌법을 방송에서 다룹니다')).toBeNull();
    expect(none('도박', '#PD수첩 MBC 방송 2019-12-31 기준 통계')).toBeNull();
    expect(none('도박', '개인방송 BJ가 2024년 3월 2일 방송 중 불법 도박을 생중계했다')).toBeNull();
    expect(none('도박', '지난 2023년 5월 9일 방송된 PD수첩 이후 달라진 것')).toBeNull();
    expect(none('도박', '방송통신심의위원회 2024.05.01 방송 심의')).toBeNull();
  });

  it('보통 편(밤 방송 · 다음 날 업로드)은 재업로드 아님 · 게시일 뒤 날(예정) · 없는 날 · 끔은 무시', () => {
    expect(originalAirDate('도박에 빠진 10대 - 추적60분 KBS 261021 방송', '', '2026-10-21T15:30:00Z', MIN)).toMatchObject({ aired: '2026-10-21', reupload: false });
    expect(originalAirDate('도박 - 261030 방송', '', '2026-10-21T01:00:00Z', MIN)).toBeNull();
    expect(originalAirDate('도박 20170231 방송', '', '2026-10-21T01:00:00Z', MIN)).toBeNull();
    expect(originalAirDate('도박 1400회 2026 실태', '', '2026-10-21T01:00:00Z', MIN)).toBeNull();
    expect(originalAirDate('도박 20170619 방송', '', '2026-10-21T01:00:00Z', 0)).toBeNull();
    // 경계: 정확히 30일 = 아님 · 31일 = 재업로드
    expect(originalAirDate('도박 20260921 방송', '', '2026-10-21T01:00:00Z', MIN)?.reupload).toBe(false);
    expect(originalAirDate('도박 20260920 방송', '', '2026-10-21T01:00:00Z', MIN)?.reupload).toBe(true);
  });

  it('buildBroadcastRow: 재업로드 = published_at 원 방송일 · published_ts 비움 · raw_body 「원 방송일:」 · 보통 편 그대로', () => {
    const item = {
      videoId: 'abcdefghijk', title: '마약 중독 회복자가 말하는 자멸 | KBS 월요기획 20170619 방송', description: '설명',
      publishedAt: '2026-08-03T09:00:00Z', url: 'https://www.youtube.com/watch?v=abcdefghijk', thumbnailUrl: null,
    };
    const r = buildBroadcastRow(SRC, item, { category: 'x' });
    expect([r.publishedAt, r.publishedTs, r.airedReupload]).toEqual(['2017-06-19', null, '2017-06-19']);
    expect(r.rawBody).toMatch(/게시 시각: 2026-08-03T09:00:00Z\n원 방송일: 2017-06-19 \(재업로드 · 제목에서 읽음 · 게시 2026-08-03\)/);
    const normal = buildBroadcastRow(SRC, { ...item, title: '도박 빚 - 추적60분 KBS 260802 방송' }, { category: 'x' });
    expect([normal.publishedAt, normal.publishedTs?.toISOString(), normal.airedReupload]).toEqual(['2026-08-03', '2026-08-03T09:00:00.000Z', null]);
    expect(normal.rawBody).not.toMatch(/원 방송일/);
    // 30일 규칙은 방송 제외 그대로(옛 날짜여도 보관으로 내리지 않음)
    expect(oldDatedTier('publish', r.publishedAt, { days: 30, broadcast: true, tierColumn: true }).tier).toBe('publish');
  });

  it('raw_body 읽기 · 「원 방송일:」 줄 넣기(한 번만)', () => {
    const raw = '프로그램: p\n채널: c (UC)\n게시 시각: 2026-08-03T09:00:00Z\n영상: u\n\n설명 첫 줄\n둘째 줄';
    expect(parseBroadcastRawBody(raw)).toEqual({ uploadedAt: '2026-08-03T09:00:00Z', description: '설명 첫 줄\n둘째 줄' });
    const a = originalAirDate('x 20170619 방송', '', '2026-08-03T09:00:00Z', 30)!;
    const once = withAiredLine(raw, a);
    expect(once.split('\n')[3]).toMatch(/^원 방송일: 2017-06-19/);
    expect(withAiredLine(once, a)).toBe(once);
  });

  it('alignAiredDates: 이미 저장된 재업로드만 고침(published_at · published_ts · raw_body) · 층 · updated_at 안 건드림 · 몇 번 돌아도 같음', async () => {
    const raw = (title: string) => `프로그램: p\n채널: c\n게시 시각: 2026-08-03T09:00:00Z\n영상: u\n\n${title}`;
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT')) {
        return [
          { id: 6223, title: '자멸 | KBS 월요기획 20170619 방송', raw_body: raw('설명'), published_at: '2026-08-03' },
          // 이미 맞춤(다시 안 고침)
          { id: 6230, title: '카지노 | 시사기획 20100413', raw_body: `${raw('설명')}\n`, published_at: '2010-04-13' },
          // 보통 편
          { id: 6240, title: '도박 - 추적60분 KBS 260802 방송', raw_body: raw('설명'), published_at: '2026-08-03' },
          // raw_body 없음(옛 행) — 게시일 = published_at
          { id: 6250, title: '음주 20180305 방송', raw_body: null, published_at: '2026-09-01' },
        ];
      }
      return [[{ id: params?.[0] }], 1];
    });
    const r = await alignAiredDates(query, 30, { deletedAt: true, publishedTs: true, rawBody: true });
    expect(r).toEqual({
      checked: 4,
      fixed: [
        { id: 6223, from: '2026-08-03', to: '2017-06-19' },
        { id: 6250, from: '2026-09-01', to: '2018-03-05' },
      ],
    });
    expect(sqlOf(query)).toMatch(/source_type = 'broadcast' AND NOT blocked AND deleted_at IS NULL[\s\S]*ORDER BY id DESC/);
    const upd = (query.mock.calls as unknown[][]).slice(1);
    expect(upd[0][0]).toMatch(/SET published_at = \$2, published_ts = NULL, raw_body = \$3 WHERE id = \$1 AND source_type = 'broadcast'/);
    expect(upd[0][1]).toEqual([6223, '2017-06-19', expect.stringContaining('원 방송일: 2017-06-19')]);
    expect(upd[1][0]).not.toMatch(/raw_body/);
    expect(upd[1][1]).toEqual([6250, '2018-03-05']);
    for (const [sql] of upd) expect(String(sql)).not.toMatch(/updated_at|tier/);
    const off = { deletedAt: false, publishedTs: false, rawBody: false };
    // 빼는 id(aired_skip_ids) · raw_body 열 없음 = 그 열을 읽지도 쓰지도 않음
    query.mockClear();
    const skipped = await alignAiredDates(query, 30, off, [6223]);
    expect(skipped.fixed.map((f) => f.id)).toEqual([6250]);
    expect(sqlOf(query)).toMatch(/NULL AS raw_body/);
    for (const [sql] of (query.mock.calls as unknown[][]).slice(1)) expect(String(sql)).not.toMatch(/raw_body|published_ts/);
    // 끔 · DB 오류
    expect(await alignAiredDates(query, 0, off)).toEqual({ checked: 0, fixed: [] });
    expect(await alignAiredDates(jest.fn().mockRejectedValue(new Error('x')), 30, off)).toEqual({
      checked: 0, fixed: [], error: true,
    });
  });

  it('리뷰: 같은 편 묶기 창 — 원 방송일로 옮긴 실린 본편은 raw_body 게시일로 창에 들어옴(raw_body 열 있을 때)', async () => {
    const q = jest.fn().mockResolvedValue([
      { title: '자멸 | KBS 월요기획 20170619 방송', source_url: 'https://www.youtube.com/watch?v=abcdefghijk', keywords: '', published_at: '2026-08-03' },
    ]);
    const rows = await existingEpisodeMains(q, 'KBS 다큐인사이트', '2026-07-27', '2026-08-10', { deletedAt: false, rawBody: true });
    expect(rows[0]).toMatchObject({ publishedAt: '2026-08-03', videoId: 'abcdefghijk' });
    expect(sqlOf(q)).toMatch(/CASE WHEN raw_body LIKE '%원 방송일:%'[\s\S]*게시 시각/);
    const q2 = jest.fn().mockResolvedValue([]);
    await existingEpisodeMains(q2, 'p', '2026-07-27', '2026-08-10', { deletedAt: false });
    expect(sqlOf(q2)).not.toMatch(/raw_body/);
  });
});

// ---------- ■2 관문 no 예시 · 다시 판정 ----------
describe('NEWS-Q16 ■2 — 관문 no 예시 넷 · 4 편 한 번 다시 판정', () => {
  it('관문 질문에 no 예시 넷(독극물 사건 · 검찰 개혁 일반 · 파출소 일반 · 응급구조 일반)', () => {
    const s = broadcastGateSystem()!;
    // NEWS-Q19 ■4: ⑤(음주운전 단속·사고 특집)가 더해져 다섯 — Q16 의 넷은 그대로
    expect(s).toMatch(/no 예시 다섯/);
    expect(s).toMatch(/독극물 사건/);
    expect(s).toMatch(/검찰 개혁 일반/);
    expect(s).toMatch(/파출소·지구대 일반/);
    expect(s).toMatch(/응급구조 일반/);
  });

  it('설정 rejudge_once = 6224 · 6211 · 6226 · 6227', () => {
    expect(fieldProfile().sources.broadcast.rejudge_once).toEqual({ id: 'q16-partial4', ids: [6224, 6211, 6226, 6227] });
  });

  it('편당 한 번 묻고 yes 만 실림으로(updated_at) · partial · no 는 보관 그대로 · 없는 id 기록', async () => {
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT')) {
        return [
          { id: 6211, title: '검찰 개혁 거취', source: 'KBS 시사기획 창', raw_body: '게시 시각: x\n\n검찰 인사', tier: 'archive' },
          { id: 6224, title: '국과수 독살', source: 'EBS 다큐프라임', raw_body: '게시 시각: x\n\n청산가리', tier: 'archive' },
          { id: 6226, title: '파출소 24시', source: 'EBS 다큐프라임', raw_body: null, tier: 'archive' },
        ];
      }
      return [[{ id: params?.[0] }], 1];
    });
    const answers: Record<string, string> = { '검찰 개혁 거취': 'no', '국과수 독살': 'yes', '파출소 24시': 'partial' };
    const ask = jest.fn(async (_s: string, u: string) => {
      const t = /제목: (.*)/.exec(u)![1];
      return { fit: answers[t], subtopic: '기타', summary: 's' };
    });
    const rec = await rejudgeBroadcasts(query, { id: 'q16-partial4', try: 1 }, [6224, 6211, 6226, 6227], 'SYS', ask, { deletedAt: true });
    expect(ask).toHaveBeenCalledTimes(3);
    expect(ask.mock.calls[0][1]).toMatch(/프로그램: KBS 시사기획 창\n제목: 검찰 개혁 거취\n\n설명:\n검찰 인사/);
    expect(rec).toEqual({
      id: 'q16-partial4', try: 1, done: true, missing: [6227],
      results: [
        { id: 6211, before: 'archive', fit: 'no', subtopic: '기타', moved: false },
        { id: 6224, before: 'archive', fit: 'yes', subtopic: '기타', moved: true },
        { id: 6226, before: 'archive', fit: 'partial', subtopic: '기타', moved: false },
      ],
    });
    expect(sqlOf(query)).toMatch(/source_type = 'broadcast' AND NOT blocked AND deleted_at IS NULL/);
    const writes = (query.mock.calls as unknown[][]).slice(1);
    expect(writes).toHaveLength(1);
    expect(String(writes[0][0])).toMatch(/SET tier = 'publish', updated_at = now\(\)[\s\S]*tier = 'archive'/);
    expect(String(writes[0][0])).not.toMatch(/DELETE|blocked/);
  });

  it('판정 없음이 있으면 done false(다음 실행이 다시) · runs 상태: done · 3번 해 봄 · 실패 = 다시 안 묻기', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 6211, title: 't', source: 's', raw_body: '', tier: 'archive' }]);
    const rec = await rejudgeBroadcasts(query, { id: 'r', try: 1 }, [6211], 'SYS', async () => null, { deletedAt: false });
    expect([rec.done, rec.results[0].fit]).toEqual([false, null]);

    const runs = (rows: unknown[]) => jest.fn().mockResolvedValue(rows);
    expect(await rejudgeStateFromRuns(runs([]), 'f', 'r')).toEqual({ done: false, tries: 0 });
    expect(await rejudgeStateFromRuns(runs([{ r: { id: 'r', done: false } }, { r: JSON.stringify({ id: 'r', done: true }) }]), 'f', 'r')).toEqual({ done: true, tries: 2 });
    expect(await rejudgeStateFromRuns(runs(Array.from({ length: REJUDGE_MAX_TRIES }, () => ({ r: { done: false } }))), 'f', 'r')).toEqual({ done: true, tries: 3 });
    expect(await rejudgeStateFromRuns(jest.fn().mockRejectedValue(new Error('x')), 'f', 'r')).toEqual({ done: true, tries: 0 });
  });
});

// ---------- ■3 채널별 클립 문턱 ----------
describe('NEWS-Q16 ■3 — 클립 길이 문턱 채널별(뉴스타파 60초 · 나머지 180초)', () => {
  const b = fieldProfile().sources.broadcast;
  const RULE = { mainMinSec: b.main_min_seconds, clipMaxSec: b.clip_max_seconds };
  const sources = loadBroadcastSources(path.join(__dirname, '../../data', b.file));
  const tapa = sources.find((s) => s.outletId === 'newstapa')!;
  const ep = (title: string, durationSec: number, program = '뉴스타파'): EpisodeItem => ({
    title, program, publishedAt: '2026-10-22T01:00:00Z', groups: ['도박'], durationSec,
  });

  it('설정: 뉴스타파만 60 · 나머지는 채널 칸 없음(분야 설정 180)', () => {
    expect(tapa.clipMaxSec).toBe(60);
    expect(sources.filter((s) => s.outletId !== 'newstapa').every((s) => s.clipMaxSec === null)).toBe(true);
    expect(channelLengthRule(RULE, tapa)).toEqual({ mainMinSec: 1200, clipMaxSec: 60 });
    const other = sources.find((s) => s.outletId === 'kbs_60min')!;
    expect(channelLengthRule(RULE, other)).toBe(RULE);
  });

  it('뉴스타파: 61~180초 꼬리 없는 보도 = 본편 · 60초 이하 = 클립(꼬리 있어도 · Q15 ④) · 다른 채널은 180초 그대로', () => {
    const tr = channelLengthRule(RULE, tapa);
    expect([45, 60, 61, 120, 180].map((s) => shortClip(ep('카지노 업계 로비 의혹', s), tr))).toEqual([true, true, false, false, false]);
    expect(shortClip(ep('카지노 로비 - 뉴스타파 261021 방송', 60), tr)).toBe(true);
    expect([60, 61, 180, 181].map((s) => shortClip(ep('도박 빚 3억', s, 'KBS 추적60분'), RULE))).toEqual([true, true, true, false]);
    // 묶기: 뉴스타파 2분 보도는 본편으로 실림
    expect(foldEpisodes([ep('카지노 업계 로비 의혹', 120)], [], { length: tr })).toEqual(['main']);
    expect(foldEpisodes([ep('카지노 업계 로비 의혹', 120, 'KBS 추적60분')], [], { length: RULE })).toEqual(['clip']);
  });

  it('채널 칸이 틀리면(0 · 글 · 소수) 무시', () => {
    const row = (id: string, v: unknown) => ({ outlet_id: id, program: id, channel_id: 'UC' + 'a'.repeat(22), clip_max_seconds: v });
    const read = () => JSON.stringify({ feeds: [row('a', 0), row('b', '60'), row('c', 60.5), row('d', 90)] });
    expect(loadBroadcastSources('fake.json', read).map((s) => s.clipMaxSec)).toEqual([null, null, null, 90]);
  });
});
