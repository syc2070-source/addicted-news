// NEWS-Q11 ■1 — 목록 응답 요약: 기사 행 수(rows) · 묶음에 접힌 수(folded). 손님 화면 「같은 소식 N건」은 그대로.
import { ArticlesService } from './articles.service';

function serviceWithIds(ids: number[]) {
  const repo = {
    query: jest.fn(() => Promise.resolve([])),
    find: jest.fn(() => Promise.resolve(ids.map((id) => ({ id })))),
    findAndCount: jest.fn(() => Promise.resolve([[], ids.length])),
    findOne: jest.fn(() => Promise.resolve(null)),
    findBy: jest.fn(() => Promise.resolve([])),
  };
  const service = new ArticlesService(repo as any);
  const info = {
    clusterId: 'c1',
    size: 2,
    representativeId: 1,
    memberIds: [1, 2],
  };
  jest.spyOn(service, 'clusterState').mockResolvedValue({
    at: Date.now(),
    mode: 'column',
    index: new Map([
      [1, info],
      [2, info],
    ]),
    light: new Map(),
  } as any);
  return service;
}

describe('ArticlesService 목록 요약(NEWS-Q11 ■1)', () => {
  it('묶음 단위(기본): rows = 기사 행 · folded = 대표 한 줄 뒤로 접힌 기사 · total = 묶음 수', async () => {
    const service = serviceWithIds([1, 2, 3, 4]);
    const r = await service.getLatestPaged(1, 10);
    expect(r).toMatchObject({ total: 3, rows: 4, folded: 1, group: 'cluster' });
    const c = await service.getByCategoryPaged('gambling', 1, 10);
    expect(c).toMatchObject({ rows: 4, folded: 1 });
  });

  it('group=none · 방송 · 보관: 접지 않음(folded 0 · rows = total)', async () => {
    const service = serviceWithIds([1, 2, 3, 4]);
    expect(
      await service.getLatestPaged(1, 10, 'article', 'publish', 'none'),
    ).toMatchObject({ total: 4, rows: 4, folded: 0, group: 'none' });
    expect(await service.getLatestPaged(1, 10, 'broadcast')).toMatchObject({
      rows: 4,
      folded: 0,
    });
  });
});
