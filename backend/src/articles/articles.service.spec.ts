// NEWS-Q1 ■1ⓑ·■4ⓓ — 공개 API: soft 삭제 숨김(열이 있을 때만) · 기본 기사만 · ?kind=broadcast 면 방송만.
import { FindOperator } from 'typeorm';
import { ArticlesService, parseKind, visibleWhere } from './articles.service';

type Captured = { where: any };

function serviceWith(deletedAtColumn: boolean) {
  const calls: Captured[] = [];
  const repo = {
    query: jest.fn(async (sql: string, params?: unknown[]) =>
      sql.includes('information_schema.columns') && params?.[1] === 'deleted_at' && deletedAtColumn ? [{ x: 1 }] : []),
    find: jest.fn(async (opts: Captured) => { calls.push(opts); return []; }),
    findAndCount: jest.fn(async (opts: Captured) => { calls.push(opts); return [[], 0]; }),
    findOne: jest.fn(async (opts: Captured) => { calls.push(opts); return null; }),
    findBy: jest.fn(async () => []),
  };
  const service = new ArticlesService(repo as any);
  return { service, calls, repo };
}

function isOperator(v: unknown, type: string): boolean {
  return v instanceof FindOperator && v.type === type;
}

describe('ArticlesService 공개 조회 조건', () => {
  it('deleted_at 열이 있으면 모든 공개 목록·검색·상세가 deleted_at IS NULL 만', async () => {
    const { service, calls } = serviceWith(true);
    await service.onModuleInit();
    await service.getLatest(10);
    await service.getLatestPaged(1, 10);
    await service.getByCategory('gambling', 10);
    await service.getTopNews();
    await service.search('도박', 10);
    await service.getOne(5);
    const wheres = calls.flatMap((c) => (Array.isArray(c.where) ? c.where : [c.where]));
    expect(wheres.length).toBeGreaterThanOrEqual(7);
    for (const w of wheres) expect(isOperator(w.deletedAt, 'isNull')).toBe(true);
  });

  it('deleted_at 열이 없으면 그 조건을 쓰지 않는다(옛 동작 · 쿼리 실패 방지)', async () => {
    const { service, calls } = serviceWith(false);
    await service.onModuleInit();
    await service.getLatest(10);
    expect(calls[0].where).not.toHaveProperty('deletedAt');
    expect(calls[0].where.blocked).toBe(false);
  });

  it('기본 목록은 방송 제외(source_type NULL 포함 기사만), ?kind=broadcast 면 방송만', async () => {
    const { service, calls } = serviceWith(false);
    await service.onModuleInit();
    await service.getLatest(10);
    await service.getLatest(10, parseKind('broadcast'));
    const articleWhere = calls[0].where.sourceType;
    expect(isOperator(articleWhere, 'or')).toBe(true);
    expect(JSON.stringify(articleWhere)).toContain('broadcast');
    expect(calls[1].where.sourceType).toBe('broadcast');
  });

  it('parseKind: broadcast 외 값은 모두 기사', () => {
    expect(parseKind('broadcast')).toBe('broadcast');
    expect(parseKind(undefined)).toBe('article');
    expect(parseKind('article')).toBe('article');
    expect(parseKind('BROADCAST; drop')).toBe('article');
  });

  it('visibleWhere 는 호출자의 조건을 지키고 blocked=false 를 덧붙인다', () => {
    const w = visibleWhere({ isTop: true }, { kind: 'article', deletedAtAvailable: true }) as any;
    expect(w.isTop).toBe(true);
    expect(w.blocked).toBe(false);
    expect(isOperator(w.deletedAt, 'isNull')).toBe(true);
  });
});
