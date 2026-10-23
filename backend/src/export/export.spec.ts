import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ExportController } from './export.controller';
import {
  buildExportSql,
  checkExportKey,
  EXPORT_PAGE,
  ExportService,
  keyFromHeaders,
  parseExportQuery,
} from './export.service';

// NEWS-Q10 ■3: 읽기 전용 내보내기 문 v0 — 열쇠 없음 404 · 틀린 열쇠 401 · 맞으면 목록 칸만
const FAKE_KEY = 'test-export-key-not-real';
const COLS = [
  'id',
  'title',
  'source',
  'publishedAt',
  'publishedTs',
  'sourceUrl',
  'field',
  'category',
  'clusterId',
  'tier',
  'sourceGrade',
  // NEWS-Q12 ■4
  'sourceType',
  'subtype',
  'sourceEn',
];

function row(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `제목 ${id}`,
    source: '연합뉴스',
    published_at: '2026-10-18',
    source_url: `https://example.com/${id}`,
    category: '중독정책',
    published_ts: new Date('2026-10-18T01:00:00Z'),
    tier: 'publish',
    source_grade: 'press',
    cluster_id: '9001',
    // 테이블에 있어도 내보내지 않는 칸(본문·요약·내부 표시)
    summary: '요약',
    raw_body: '본문',
    blocked_reason: null,
    ...over,
  };
}

function controllerWith(rows: (sql: string, params?: unknown[]) => unknown[]) {
  const query = jest.fn((sql: string, params?: unknown[]) =>
    Promise.resolve(
      sql.includes('information_schema.columns')
        ? [{ x: 1 }]
        : rows(sql, params),
    ),
  );
  const svc = new ExportService({ isInitialized: true, query } as any);
  return { ctl: new ExportController(svc), query };
}

describe('export v0 — GET /api/export/articles(NEWS-Q10 ■3)', () => {
  const saved = process.env.EXPORT_READ_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.EXPORT_READ_KEY;
    else process.env.EXPORT_READ_KEY = saved;
  });

  it('열쇠 env 가 없으면 404(기본 꺼짐) — 머리에 무엇을 넣어도', async () => {
    delete process.env.EXPORT_READ_KEY;
    const { ctl, query } = controllerWith(() => []);
    await expect(
      ctl.articles({ 'x-export-key': FAKE_KEY }, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctl.articles({}, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(query).not.toHaveBeenCalled();
    expect(checkExportKey({} as NodeJS.ProcessEnv, FAKE_KEY)).toBe('off');
  });

  it('틀린 열쇠 · 열쇠 없음 = 401 · 주소(?key=)로는 받지 않음', async () => {
    process.env.EXPORT_READ_KEY = FAKE_KEY;
    const { ctl, query } = controllerWith(() => []);
    await expect(
      ctl.articles({ 'x-export-key': 'wrong' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      ctl.articles({}, { key: FAKE_KEY } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      ctl.articles({ authorization: 'Bearer wrong' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(query).not.toHaveBeenCalled();
  });

  it('맞는 열쇠(x-export-key · Bearer) = 목록 칸만 · 본문·요약 0 · 한 쪽 200 + nextCursor', async () => {
    process.env.EXPORT_READ_KEY = FAKE_KEY;
    const { ctl, query } = controllerWith((_sql, params) => {
      const after = Number(
        (params || []).find(
          (p, i, a) => i < a.length - 1 && typeof p === 'number',
        ) ?? 0,
      );
      return Array.from({ length: EXPORT_PAGE + 1 }, (_, i) =>
        row(after + i + 1),
      );
    });
    const page = await ctl.articles(
      { 'x-export-key': FAKE_KEY },
      { since: '2026-10-01', tier: 'publish' },
    );
    expect(Object.keys(page).sort()).toEqual([
      'field',
      'items',
      'limit',
      'nextCursor',
      'version',
    ]);
    expect(page.field).toBe('addiction');
    expect(page.items).toHaveLength(EXPORT_PAGE);
    expect(Object.keys(page.items[0]).sort()).toEqual([...COLS].sort());
    expect(page.items[0]).toMatchObject({
      id: 1,
      publishedAt: '2026-10-18',
      publishedTs: '2026-10-18T01:00:00.000Z',
      clusterId: '9001',
      tier: 'publish',
      sourceGrade: 'press',
    });
    expect(JSON.stringify(page)).not.toMatch(/요약|본문/);
    const sql = String(
      query.mock.calls.find((c) => String(c[0]).includes('FROM articles'))![0],
    );
    // NEWS-Q12 ■4: keywords(꼬리표)는 subtype 셈에만 읽음(내보내지 않음) · 본문·요약은 읽지도 않음
    expect(sql).not.toMatch(/summary|raw_body|teaser/);
    expect(parseExportQuery({ cursor: page.nextCursor! }).cursor).toBe(
      EXPORT_PAGE,
    );

    const bearer = await ctl.articles(
      { authorization: `Bearer ${FAKE_KEY}` },
      { cursor: page.nextCursor! },
    );
    expect(bearer.items[0].id).toBe(EXPORT_PAGE + 1);
  });

  it('since·kind·tier 판정 · 틀린 값 400 · 묶음 SQL 열이 없으면 null(보관 요청 = 빈 결과)', async () => {
    process.env.EXPORT_READ_KEY = FAKE_KEY;
    const { ctl } = controllerWith(() => []);
    await expect(
      ctl.articles({ 'x-export-key': FAKE_KEY }, { since: '어제' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctl.articles({ 'x-export-key': FAKE_KEY }, { tier: 'reject' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // NEWS-Q13 ■4: v0 은 실림만 — 보관·전부 요청은 400 · 기본 = publish
    for (const tier of ['archive', 'all']) {
      await expect(
        ctl.articles({ 'x-export-key': FAKE_KEY }, { tier }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(parseExportQuery({}).tier).toBe('publish');
    await expect(
      ctl.articles({ 'x-export-key': FAKE_KEY }, { cursor: 'xx' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(parseExportQuery({ since: '2026-10-01' }).since).toBe(
      '2026-09-30T15:00:00.000Z',
    ); // 날짜만 = KST 0시
    const none = {
      tier: false,
      sourceGrade: false,
      clusterId: false,
      deletedAt: false,
      publishedTs: false,
    };
    const a = buildExportSql(parseExportQuery({ kind: 'broadcast' }), none);
    expect(a.sql).not.toContain(`IN ('publish', 'archive')`);
    expect(a.sql).toContain(`source_type = 'broadcast'`);
    expect(a.sql).toContain('NULL AS tier');
    const pub = buildExportSql(parseExportQuery({ kind: 'broadcast' }), {
      ...none,
      tier: true,
    });
    expect(pub.sql).toContain(`COALESCE(tier, 'publish') = $1`);
    expect(pub.params[0]).toBe('publish');
    const all = {
      tier: true,
      sourceGrade: true,
      clusterId: true,
      deletedAt: true,
      publishedTs: true,
    };
    const b = buildExportSql(
      parseExportQuery({
        tier: 'publish',
        kind: 'article',
        since: '2026-10-01T00:00:00Z',
      }),
      all,
    );
    expect(b.sql).toContain('deleted_at IS NULL');
    expect(b.sql).toContain('blocked = false');
    expect(b.params).toEqual([
      'publish',
      '2026-10-01T00:00:00.000Z',
      EXPORT_PAGE + 1,
    ]);
  });

  it('머리에서 열쇠 읽기(x-export-key 먼저 · Bearer)', () => {
    expect(
      keyFromHeaders({ 'x-export-key': 'a', authorization: 'Bearer b' }),
    ).toBe('a');
    expect(keyFromHeaders({ authorization: 'bearer b' })).toBe('b');
    expect(keyFromHeaders({ authorization: 'Basic b' })).toBeUndefined();
  });
});
