import {
  archiveListedBroadcasts,
  coresMatch,
  episodeCore,
  existingEpisodeMains,
  foldEpisodes,
  isClipTitle,
  sameEpisode,
  shiftYmd,
} from './broadcast_episode';
import { fieldProfile } from './field_profile';

// NEWS-Q12 ■1: 같은 편 묶기 — 10-21 첫 실전 방송 실림 20(실제 제목)으로 · 흔한 낱말은 분야 설정에서(크롤러와 같게)
const GENERIC_LIST =
  fieldProfile().sources.broadcast.episode_generic_words ?? [];
const GENERIC = new Set(GENERIC_LIST);
const PD = 'MBC PD수첩';
const SBS = 'SBS 그것이 알고 싶다';
const K60 = 'KBS 추적60분';
const ST = 'MBC 스트레이트';
const it_ = (
  title: string,
  program: string,
  publishedAt: string,
  description = '',
) => ({
  title,
  program,
  publishedAt,
  description,
});

const REAL_1021 = [
  it_(
    '[예고] 납 공장 \'비타민 주사\'의 비밀 / "시키지도 않았는데" AI의 수상한 행동 실험 | 356회 스트레이트 예고',
    ST,
    '2026-10-10',
  ),
  it_(
    '[PD수첩 10분 컷] 친구 가입 시키면 월 150만 원? 불법 도박 사이트는 어떻게 교실을 점령했나',
    PD,
    '2026-08-12',
  ),
  it_(
    '[PD수첩] "도박소년이 된 내 아들" - 2026년 8월 11일 밤 10시 20분 방송',
    PD,
    '2026-08-11',
  ),
  it_(
    '[PD수첩 1518회 예고] 도박소년이 된 내 아들 - PD수첩, MBC 260811 방송',
    PD,
    '2026-08-07',
  ),
  it_('마약왕과 원점 타격 | 스파이 전쟁 1부', SBS, '2026-06-09'),
  it_('마약왕과 원점 타격 | 스파이 전쟁 예고', SBS, '2026-06-04'),
  it_('마약왕과 원점 타격 | 스파이 전쟁 티저', SBS, '2026-06-01'),
  it_(
    '[full] 모두가 자식의 폰과 싸우고 있다 | 추적60분 KBS 260522 방송',
    K60,
    '2026-05-22',
  ),
  it_(
    '[금요일밤10시] 모두가 자식의 폰과 싸우고 있다 | 추적60분 1457회 예고 KBS 방송',
    K60,
    '2026-05-21',
  ),
  it_(
    '[full] 파는 자와 쫓는 자, 텔레그램 시대의 마약 전쟁 | 추적60분 KBS 260227 방송',
    K60,
    '2026-02-27',
  ),
  it_(
    "[금요일밤10시] 파는 자와 쫓는 자 '야당'과 마약 전쟁 | 추적60분 KBS 방송",
    K60,
    '2026-02-26',
  ),
  it_(
    '"부모가 막을 수가 없어요" 틱톡과 악성앱을 통해 아이들 사이에서 번지는 도박과 학폭 | 추적60분 KBS 260522 방송',
    K60,
    '2026-06-21',
  ),
];

describe('broadcast_episode — 같은 편 묶기(NEWS-Q12 ■1)', () => {
  it('클립 표지는 낱말 경계에서만(「복수를 예고하는」은 본편) · #shorts · 10분 컷', () => {
    expect(isClipTitle('[예고] 납 공장')).toBe(true);
    expect(isClipTitle('[PD수첩 1518회 예고] 도박소년이 된 내 아들')).toBe(
      true,
    );
    expect(isClipTitle('마약왕과 원점 타격 | 스파이 전쟁 티저')).toBe(true);
    expect(isClipTitle('[PD수첩 10분 컷] 친구 가입 시키면')).toBe(true);
    expect(isClipTitle('핏자국과 약물로 난장판이 된 모텔방#shorts')).toBe(true);
    expect(
      isClipTitle(
        '마약, 총기 다루는 지인을 비밀리에 고발했는데... 복수를 예고하는 편지가 왔다',
      ),
    ).toBe(false);
    expect(isClipTitle('[full] 모두가 자식의 폰과 싸우고 있다')).toBe(false);
  });

  it('회차 제목 핵심 = 괄호·프로그램 꼬리·따옴표를 뗀 글', () => {
    expect(
      episodeCore(
        '[PD수첩 1518회 예고] 도박소년이 된 내 아들 - PD수첩, MBC 260811 방송',
      ),
    ).toBe('도박소년이 된 내 아들');
    expect(
      episodeCore(
        '[PD수첩] "도박소년이 된 내 아들" - 2026년 8월 11일 밤 10시 20분 방송',
      ),
    ).toBe('도박소년이 된 내 아들');
    expect(episodeCore('마약왕과 원점 타격 | 스파이 전쟁 1부')).toBe(
      '마약왕과 원점 타격',
    );
    expect(
      coresMatch(
        '파는 자와 쫓는 자 텔레그램 시대의 마약 전쟁',
        '파는 자와 쫓는 자 야당 과 마약 전쟁',
        GENERIC,
      ),
    ).toBe(true);
    expect(
      coresMatch('도박 청소년이 성인이 되면', '도박소년이 된 내 아들'),
    ).toBe(false);
  });

  it('10-21 실림 12 → 본편 5 · 클립 6 · 같은 회차 1(본편 = [full] 또는 이른 것)', () => {
    const roles = foldEpisodes(REAL_1021, [], { generic: GENERIC_LIST });
    expect(roles).toEqual([
      'clip', // 스트레이트 [예고]
      'clip', // 10분 컷
      'main', // PD수첩 도박소년 본편
      'clip', // 1518회 예고
      'main', // 스파이 전쟁 1부
      'clip',
      'clip',
      'main', // [full] 폰과 싸우고
      'clip', // 1457회 예고
      'main', // [full] 파는 자와 쫓는 자
      'episode_dup', // [금요일밤10시] 같은 회차
      'main', // 다른 회차(06-21 · 같은 프로그램이지만 날짜 밖)
    ]);
  });

  it('같은 회차 = 같은 프로그램 ∧ ±7일 · 1부·2부(회차 표기 다름)는 다른 편 · 관련 클립은 설명이 본편 제목을 품을 때', () => {
    const main = it_('마약왕과 원점 타격 | 스파이 전쟁 1부', SBS, '2026-06-09');
    expect(
      sameEpisode(
        it_('마약왕과 원점 타격 | 스파이 전쟁 2부', SBS, '2026-06-16'),
        main,
      ),
    ).toBe(false);
    expect(
      sameEpisode(
        it_('마약왕과 원점 타격 | 스파이 전쟁 하이라이트', SBS, '2026-06-30'),
        main,
      ),
    ).toBe(false);
    expect(
      sameEpisode(
        it_('마약왕과 원점 타격 다시보기', '다른 프로그램', '2026-06-09'),
        main,
      ),
    ).toBe(false);
    const pd = it_(
      '[PD수첩] "도박소년이 된 내 아들" - 2026년 8월 11일',
      PD,
      '2026-08-11',
    );
    expect(
      sameEpisode(
        it_(
          '도박 청소년이 성인이 되면 | PD수첩',
          PD,
          '2026-08-13',
          'PD수첩 「도박소년이 된 내 아들」 중에서',
        ),
        pd,
      ),
    ).toBe(true);
    // 설명이 틀(boilerplate)뿐이면 묶지 않음(10-21 실측 한계 · 보고서)
    expect(
      sameEpisode(
        it_(
          '도박 청소년이 성인이 되면 | PD수첩',
          PD,
          '2026-08-13',
          '제작 : MBC 시사교양국',
        ),
        pd,
      ),
    ).toBe(false);
  });

  it('리뷰 반영: 「예고 없이」·「하이라이트 없는」은 표지 아님 · 흔한 낱말만 겹치면 다른 편 · DB 의 옛 예고는 본편 아님', () => {
    expect(isClipTitle('예고 없이 찾아온 도박 중독')).toBe(false);
    expect(isClipTitle('[풀버전] 마약 하이라이트 없는 삶')).toBe(false);
    expect(isClipTitle('[추적60분 1457회 예고 KBS 방송]')).toBe(true);
    // 반박 반영: 표지 뒤에 제목이 이어지는 실제 꼴은 그대로 클립
    for (const t of [
      '예고편 공개',
      'PD수첩 예고편 공개',
      '추적60분 예고 마약에 빠진 10대',
      '다음주 예고 마약',
      '마약 10분컷 몰아보기',
      '선공개 마약 청소년',
      '[티저] 다음 주 방송',
    ])
      expect([t, isClipTitle(t)]).toEqual([t, true]);
    expect(GENERIC_LIST.length).toBeGreaterThan(10);
    expect(
      coresMatch('청소년 도박 중독 실태', '청소년 마약 중독 실태', GENERIC),
    ).toBe(false);
    // 흔한 낱말 목록이 없으면 옛 동작(반 이상 겹침 = 같은 회차)
    expect(coresMatch('청소년 도박 중독 실태', '청소년 마약 중독 실태')).toBe(
      true,
    );
    const oldTrailer = [
      {
        title: '[PD수첩 1518회 예고] 도박소년이 된 내 아들 - PD수첩',
        program: PD,
        publishedAt: '2026-08-07',
      },
    ];
    expect(
      foldEpisodes(
        [
          it_(
            '[PD수첩] "도박소년이 된 내 아들" - 2026년 8월 11일 밤 10시 20분 방송',
            PD,
            '2026-08-11',
          ),
        ],
        oldTrailer,
      ),
    ).toEqual(['main']);
  });

  it('이미 실린 본편(지난 실행)이 있으면 이번 것은 모두 보관', () => {
    const existing = [
      {
        title:
          '[PD수첩] "도박소년이 된 내 아들" - 2026년 8월 11일 밤 10시 20분 방송',
        program: PD,
        publishedAt: '2026-08-11',
      },
    ];
    expect(
      foldEpisodes(
        [it_('도박소년이 된 내 아들 [다시보기 풀영상]', PD, '2026-08-12')],
        existing,
      ),
    ).toEqual(['episode_dup']);
    expect(
      foldEpisodes([it_('「사행산업」 새 회차', PD, '2026-08-18')], existing),
    ).toEqual(['main']);
  });

  it('설정 archive_ids(오너 지시 11 편 · PD수첩 클립 넷 포함) → 이 id·방송·실림층만 보관 · 몇 번 돌아도 같음 · 실패면 []', async () => {
    const ids = fieldProfile().sources.broadcast.archive_ids ?? [];
    expect(ids).toHaveLength(11);
    expect(ids).toEqual(expect.arrayContaining([5868, 5869, 5870, 5871]));
    expect(ids).not.toContain(5873); // PD수첩 본편은 실림 그대로
    const calls: unknown[][] = [];
    const moved = await archiveListedBroadcasts((sql, params) => {
      calls.push([sql, params]);
      return Promise.resolve([{ id: 5868 }, { id: 5869 }]);
    }, ids);
    expect(moved).toEqual([5868, 5869]);
    expect(String(calls[0][0])).toMatch(/SET tier = 'archive'/);
    expect(String(calls[0][0])).toMatch(/source_type = 'broadcast'/);
    expect(String(calls[0][0])).toMatch(
      /COALESCE\(tier, 'publish'\) = 'publish'/,
    );
    expect(calls[0][1]).toEqual([ids]);
    expect(
      await archiveListedBroadcasts(() => Promise.resolve([]), []),
    ).toEqual([]);
    expect(
      await archiveListedBroadcasts(() => Promise.reject(new Error('x')), [1]),
    ).toEqual([]);
  });

  it('DB 읽기: 같은 프로그램 · 날짜 창 · 실림층만 · 실패면 빈 목록 · shiftYmd', async () => {
    const calls: unknown[][] = [];
    const rows = await existingEpisodeMains(
      (sql, params) => {
        calls.push([sql, params]);
        return Promise.resolve([{ title: 'A', published_at: '2026-08-11' }]);
      },
      PD,
      '2026-08-04',
      '2026-08-20',
      { deletedAt: true },
    );
    expect(rows).toEqual([
      { title: 'A', program: PD, publishedAt: '2026-08-11' },
    ]);
    expect(String(calls[0][0])).toMatch(/source_type = 'broadcast'/);
    expect(String(calls[0][0])).toMatch(
      /left\(published_at::text, 10\) >= \$2/,
    );
    expect(String(calls[0][0])).toMatch(/deleted_at IS NULL/);
    expect(calls[0][1]).toEqual([PD, '2026-08-04', '2026-08-20']);
    expect(
      await existingEpisodeMains(
        () => Promise.reject(new Error('x')),
        PD,
        'a',
        'b',
        { deletedAt: false },
      ),
    ).toEqual([]);
    expect(shiftYmd('2026-08-11', -7)).toBe('2026-08-04');
    expect(shiftYmd('2026-08-28', 7)).toBe('2026-09-04');
  });
});
