import { EpisodeItem, foldEpisodes, shortClip } from './broadcast_episode';
import { keywordGroupsOf } from './keyword_groups';
import {
  QuotaGuard,
  apiTodayFromRuns,
  durationBudgetLeft,
  fetchDurations,
} from './youtube_api';
import { fieldProfile } from './field_profile';
import { broadcastArchiveList } from './broadcast_archive_list';

const FAKE_KEY = 'test-youtube-key-not-real';

// ---------- ■2 쇼츠 61~180초 ----------
describe('NEWS-Q15 ■2 — 길이 ≤ 180초 = 클립(제목 [full] · 방송 꼬리면 본편)', () => {
  const b = fieldProfile().sources.broadcast;
  const RULE = { mainMinSec: b.main_min_seconds, clipMaxSec: b.clip_max_seconds };
  const ep = (title: string, durationSec: number, publishedAt = '2026-10-22T01:00:00Z'): EpisodeItem => ({
    title,
    program: 'KBS 추적60분',
    publishedAt,
    groups: keywordGroupsOf(title).concat('도박'),
    durationSec,
  });

  it('설정 180초', () => {
    expect(RULE.clipMaxSec).toBe(180);
  });

  it('경계: 60 · 61 · 180 = 클립 · 181 = 아님', () => {
    const t = '도박 빚 3억, 엄마의 눈물';
    expect([60, 61, 180, 181].map((s) => shortClip(ep(t, s), RULE))).toEqual([true, true, true, false]);
    // 길이 0(생방송 예정) · 모름 = 클립 아님
    expect(shortClip(ep(t, 0), RULE)).toBe(false);
    expect(shortClip({ title: t, program: 'p', publishedAt: '' }, RULE)).toBe(false);
  });

  it('제목에 [full] · 방송 꼬리가 있으면 180초 안이어도 본편', () => {
    expect(shortClip(ep('[full] 도박 빚 이야기', 150), RULE)).toBe(false);
    expect(shortClip(ep('도박 빚 이야기 풀버전', 150), RULE)).toBe(false);
    expect(shortClip(ep('도박 빚 이야기 - 추적60분 KBS 261021 방송', 150), RULE)).toBe(false);
    expect(shortClip(ep('도박 빚 이야기 | 1400회', 150), RULE)).toBe(false);
    // 리뷰: 60초 이하는 꼬리가 있어도 클립(꼬리 붙은 예고·쇼츠) · [full] 만 본편
    expect(shortClip(ep('도박 빚의 끝 - PD수첩, MBC 261021 방송', 45), RULE)).toBe(true);
    expect(shortClip(ep('도박 빚의 끝 - PD수첩, MBC 261021 방송', 60), RULE)).toBe(true);
    expect(shortClip(ep('도박 빚의 끝 - PD수첩, MBC 261021 방송', 61), RULE)).toBe(false);
    expect(shortClip(ep('[full] 도박 빚의 끝', 45), RULE)).toBe(false);
  });

  it('묶기: 2분 쇼츠 = 클립(보관) · 3분 1초 = 본편 후보 · 꼬리 붙은 2분 = 본편', () => {
    const roles = foldEpisodes(
      [
        ep('도박 빚 3억, 엄마의 눈물', 120),
        ep('청소년 불법 도박 사이트의 덫', 181, '2026-10-22T02:00:00Z'),
        ep('카지노 앞 전당포 골목 - 추적60분 KBS 261022 방송', 120, '2026-10-22T03:00:00Z'),
      ],
      [],
      { length: RULE },
    );
    expect(roles).toEqual(['clip', 'main', 'main']);
    // 반박: 같은 회차의 꼬리 붙은 2분 영상은 꼬리 붙은 60분 본편 뒤(긴 것 먼저) → episode_dup
    const main = ep('도박에 빠진 10대들 - 추적60분 KBS 261022 방송', 3600, '2026-10-22T13:00:00Z');
    const tagged2m = ep('도박에 빠진 10대들 - 추적60분 KBS 261022 방송', 120, '2026-10-22T09:00:00Z');
    expect(foldEpisodes([tagged2m, main], [], { length: RULE })).toEqual(['episode_dup', 'main']);
    // 반박: 60초 이하 옛 [full] 행은 본편으로 치지 않음 → 표시 없는 새 후보를 막지 않음
    const oldFull = ep('[full] 도박에 빠진 10대들', 45, '2026-10-21T09:00:00Z');
    expect(foldEpisodes([ep('도박에 빠진 10대들', 600, '2026-10-22T09:00:00Z')], [oldFull], { length: RULE })).toEqual(['main']);
  });

  it('이미 실린 옛 행도 같은 규칙(길이 읽은 2분 쇼츠는 본편으로 치지 않음 · 꼬리 붙은 2분은 본편)', () => {
    const now = ep('도박에 빠진 10대들 - 추적60분 KBS 261024 방송', 3600, '2026-10-24T13:00:00Z');
    const oldShort = ep('도박에 빠진 10대들', 120, '2026-10-23T01:00:00Z');
    expect(foldEpisodes([now], [oldShort], { length: RULE })).toEqual(['main']);
    const oldTagged = ep('도박에 빠진 10대들 - 추적60분 KBS 261023 방송', 120, '2026-10-23T01:00:00Z');
    // 꼬리 붙은 2분 옛 행은 클립이 아니라 본편 목록에 남지만, 길이로 20분 미만이 확인돼 꼬리 붙은 새 후보를 막지 않음(Q14 반박 M2 규칙)
    expect(foldEpisodes([{ ...now, title: '도박에 빠진 10대들 - 추적60분 KBS 261023 방송', durationSec: undefined }], [oldTagged], { length: RULE })).toEqual([
      'main',
    ]);
    // 표시 없는 새 후보는 그 옛 행에 막힘(옛 규칙)
    expect(foldEpisodes([ep('도박에 빠진 10대들', 600, '2026-10-24T01:00:00Z')], [oldTagged], { length: RULE })).toEqual(['episode_dup']);
  });
});

// ---------- ■1 보관 목록 잘림 ----------
describe('NEWS-Q15 ■1 · Q17 ■3 — 보관 목록은 다 싣는다(잘림 = 건너뛴 행이 있을 때만)', () => {
  // NEWS-Q17 ■3: 행 한도를 없앰 → 5,001 행도 다 내보내고 truncated 는 늘 false(칸은 그대로)
  it('NEWS-Q17: 한도 없음 — 5,001 행 그대로 · truncated false · news_id = id · LIMIT 없음', async () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: i + 1, source_url: null, tier: 'archive', changed: String(1_700_000_000_000 + i) }));
    const all = await broadcastArchiveList(jest.fn().mockResolvedValue(mk(5001)), { tier: 'archive', deletedAt: false });
    expect([all?.truncated, all?.items.length]).toEqual([false, 5001]);
    expect(all?.items.every((x) => x.news_id === x.id)).toBe(true);
    const q = jest.fn().mockResolvedValue([]);
    await broadcastArchiveList(q, { tier: 'archive', deletedAt: false });
    expect(String((q.mock.calls as unknown[][])[0][0])).not.toMatch(/LIMIT/);
    // 반박: 꼴이 틀려 건너뛴 행이 하나라도 있으면 truncated true(받는 쪽이 빠진 id 를 숨김으로 읽지 않게) · pg bigint 글 id 는 그대로 읽힘
    const some = await broadcastArchiveList(
      jest.fn().mockResolvedValue([...mk(2), { id: '7', source_url: null, tier: 'archive', changed: '1700000000000' }, { id: 9, tier: 'archive', changed: null }]),
      { tier: 'archive', deletedAt: false },
    );
    expect([some?.truncated, some?.items.map((x) => x.id)]).toEqual([true, [1, 2, 7]]);
  });
});

// ---------- ■3 하루 단위 ----------
describe('NEWS-Q15 ■3 — 길이 읽기 단위 = KST 하루 합', () => {
  it('남은 단위 = 하루 상한 − 오늘 앞 실행들이 쓴 것(0 아래 없음)', () => {
    expect(durationBudgetLeft(20, 0)).toBe(20);
    expect(durationBudgetLeft(20, 2)).toBe(18);
    expect(durationBudgetLeft(20, 20)).toBe(0);
    expect(durationBudgetLeft(20, 35)).toBe(0);
    expect(durationBudgetLeft(undefined, 0)).toBe(0);
  });

  it('runs 의 오늘(KST) 실행 broadcastDuration.units 를 더함 · 실패면 0', async () => {
    const query = jest.fn().mockResolvedValue([
      { api: { units: 438, channels: ['a'] }, dur: { units: 2 } },
      { api: JSON.stringify({ units: 10, channels: ['b'] }), dur: JSON.stringify({ units: 5 }) },
      { api: null, dur: null },
      // 깨진 길이 칸 하나는 그 행만 0(하루 단위·채널은 그대로)
      { api: { units: 0, channels: [] }, dur: '{broken' },
    ]);
    const t = await apiTodayFromRuns(query, 'f');
    expect(t).toEqual({ units: 448, channels: ['a', 'b'], durationUnits: 7 });
    expect(String((query.mock.calls as unknown[][])[0][0])).toMatch(/broadcastDuration' AS dur[\s\S]*Asia\/Seoul/);
    await expect(apiTodayFromRuns(jest.fn().mockRejectedValue(new Error('x')), 'f')).resolves.toEqual({
      units: 0,
      channels: [],
      durationUnits: 0,
    });
  });

  it('둘째 실행: 앞 실행이 18 을 썼으면 2 번만 부름 · 하루 2,000 가드 그대로', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `v${String(i).padStart(10, '0')}`);
    const get = (_u: string, params: Record<string, string | number>) =>
      Promise.resolve({ items: String(params.id).split(',').map((id) => ({ id, contentDetails: { duration: 'PT2M' } })) });
    const budget = { left: durationBudgetLeft(20, 18) };
    const r = await fetchDurations(ids, FAKE_KEY, new QuotaGuard(2000, 100), budget, { get });
    expect([r.calls, r.stopped, budget.left]).toEqual([2, 'unit_cap', 0]);
    const g = new QuotaGuard(2000, 1999);
    const r2 = await fetchDurations(ids, FAKE_KEY, g, { left: durationBudgetLeft(20, 0) }, { get });
    expect([r2.calls, r2.stopped]).toEqual([1, 'quota_guard']);
  });
});
