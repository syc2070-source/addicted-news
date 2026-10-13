// NEWS-Q3 ■2·■3 — 공개 목록 묶음 단위 · TOP 규칙 · 열 없을 때 응답 때 계산
import { ClusterInfo } from '../crawler/event_cluster';
import { LightRow, groupIds, membersOf, parseGroup, rankTop, shownId, visibleSql } from './cluster_view';
import { ArticlesService } from './articles.service';

const H = 3600 * 1000;
const NOW = Date.parse('2026-10-13T03:00:00Z');
const info = (clusterId: string, rep: number, ids: number[]): ClusterInfo => ({ clusterId, size: ids.length, representativeId: rep, memberIds: ids });
const light = (id: number, hoursAgo: number, grade: string | null = 'press'): LightRow => ({
  id, title: `t${id}`, source: `s${id}`, sourceUrl: `https://x/${id}`, publishedAt: '2026-10-12', publishedTs: new Date(NOW - hoursAgo * H),
  sourceGrade: grade, ts: NOW - hoursAgo * H,
});

describe('cluster_view — 묶음 단위 목록', () => {
  const c = info('10', 12, [10, 11, 12]);
  const index = new Map<number, ClusterInfo>([[10, c], [11, c], [12, c]]);

  it('같은 묶음은 한 줄 · 자리 = 묶음의 가장 새 기사 자리 · 대표가 목록 안이면 대표를 보인다', () => {
    const groups = groupIds([12, 20, 11, 10, 21], index);
    expect(groups.map((g) => g.key)).toEqual(['c10', 'a20', 'a21']);
    expect(groups[0].ids).toEqual([12, 11, 10]);
    expect(shownId(groups[0])).toBe(12);
    // 대표(12)가 걸러진 목록에 없으면 목록에서 처음 나온 기사
    expect(shownId(groupIds([11, 10], index)[0])).toBe(11);
  });

  it('같은 소식 목록 = 보이는 기사를 뺀 나머지(보도 시각 순)', () => {
    const lm = new Map([10, 11, 12].map((id) => [id, light(id, 30 - id)]));
    expect(membersOf(c, 12, lm).map((r) => r.id)).toEqual([10, 11]);
    expect(membersOf(null, 12, lm)).toEqual([]);
  });

  it('parseGroup: none 만 옛 꼴, 그 밖은 묶음', () => {
    expect(parseGroup('none')).toBe('none');
    expect(parseGroup(undefined)).toBe('cluster');
    expect(parseGroup('x')).toBe('cluster');
  });

  it('visibleSql: 열이 있을 때만 deleted_at · tier 조건', () => {
    expect(visibleSql({ deletedAt: false, tier: false })).not.toContain('deleted_at');
    const s = visibleSql({ deletedAt: true, tier: true });
    expect(s).toContain('deleted_at IS NULL');
    expect(s).toContain("tier = 'publish'");
    expect(s).toContain("source_type <> 'broadcast'");
  });
});

describe('cluster_view — TOP', () => {
  it('72시간 안 묶음을 크기 순 · 동률은 대표 등급 · 오래된 단독 기사는 밀린다', () => {
    const big = info('1', 2, [1, 2, 3]);
    const pair = info('4', 4, [4, 5]);
    const pair2 = info('6', 6, [6, 7]);
    const index = new Map<number, ClusterInfo>([[1, big], [2, big], [3, big], [4, pair], [5, pair], [6, pair2], [7, pair2]]);
    const lm = new Map<number, LightRow>([
      [1, light(1, 10)], [2, light(2, 9)], [3, light(3, 8)],
      [4, light(4, 5, 'press')], [5, light(5, 5)],
      [6, light(6, 4, 'institution')], [7, light(7, 4)],
      [8, light(8, 1)], [9, light(9, 24 * 200)],
    ]);
    const top = rankTop(lm, index, NOW, 3);
    expect(top.map((t) => t.id)).toEqual([2, 6, 4]);
    expect(top[0]).toMatchObject({ size: 3, window: '72h' });
  });

  it('72시간 안 기사가 없으면 7일로 넓히고 window=7d', () => {
    const lm = new Map<number, LightRow>([[1, light(1, 100)], [2, light(2, 24 * 10)]]);
    expect(rankTop(lm, new Map(), NOW, 3)).toEqual([{ id: 1, size: 1, window: '7d' }]);
    expect(rankTop(new Map(), new Map(), NOW, 3)).toEqual([]);
  });
});

describe('ArticlesService — 열(cluster_id) 없을 때 응답 때 계산 · 10분 기억', () => {
  function svc(rows: any[]) {
    const repo = {
      query: jest.fn(async (sql: string) => (sql.includes('information_schema') ? [] : sql.includes('FROM articles WHERE') ? rows : [])),
      find: jest.fn(async () => rows.map((r) => ({ id: r.id }))),
      findBy: jest.fn(async () => rows.map((r) => ({ id: r.id, title: r.title, publishedAt: r.published_at }))),
      findAndCount: jest.fn(async () => [[], 0]),
      findOne: jest.fn(async () => null),
    };
    return { service: new ArticlesService(repo as any), repo };
  }
  const rows = [
    { id: 3, title: '서울역 광장 금주구역 지정…과태료 5만원 - 연합뉴스', published_at: '2026-10-12', summary: '' },
    { id: 2, title: '서울역 광장 금주구역 지정…과태료 5만원 부과 - YTN', published_at: '2026-10-12', summary: '' },
    { id: 1, title: '청주시 버스정류소 금연 안내 스티커 설치', published_at: '2026-10-12', summary: '' },
  ];

  it('최신 목록은 같은 소식을 접어 대표 1건 + clusterMembers', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-13T00:00:00Z'));
    const { service, repo } = svc(rows);
    await service.onModuleInit();
    const items: any[] = await service.getLatest(10);
    expect(items).toHaveLength(2);
    const seoul = items.find((a) => a.clusterSize === 2);
    expect(seoul.clusterId).toBe('2');
    expect(seoul.clusterMembers).toHaveLength(1);
    const none: any[] = await service.getLatest(10, 'article', 'publish', 'none');
    expect(none.length).toBe(0); // group=none 은 옛 findAndCount 길(모의 = 빈 목록)
    const computeCalls = repo.query.mock.calls.filter((c: any[]) => String(c[0]).includes('ORDER BY id DESC LIMIT 3000')).length;
    expect(computeCalls).toBe(1); // 10분 기억
    jest.useRealTimers();
  });
});
