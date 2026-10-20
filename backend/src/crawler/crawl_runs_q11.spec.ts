import { rejectReasonsBetween, runVisibility } from './crawl_runs';

// NEWS-Q11 ■1·■2: 실행 저장 행이 목록에 보이는 꼴 · 방송 거부 사유 둘째 마디
describe('crawl_runs — 보이는 꼴 · 방송 거부 사유(NEWS-Q11)', () => {
  const FROM = new Date('2026-10-20T03:00:41Z');
  const TO = new Date('2026-10-20T03:18:03Z');

  it('runVisibility: 실림·보관·방송·숨김 · 묶음 든 수 · 접힌 수(묶음 든 수 − 새 묶음) · 오래된 보도 날짜', async () => {
    const seen: Array<{ sql: string; params?: unknown[] }> = [];
    const query = (sql: string, params?: unknown[]) => {
      seen.push({ sql, params });
      return Promise.resolve([
        {
          publish: 47,
          archive: 24,
          broadcast: 1,
          hidden: 0,
          clustered: 29,
          new_clusters: 8,
          old_dated: 1,
        },
      ]);
    };
    const v = await runVisibility(query, FROM, TO, {
      tier: true,
      deletedAt: true,
      cluster: true,
    });
    expect(v).toEqual({
      publish: 47,
      archive: 24,
      broadcast: 1,
      hidden: 0,
      clustered: 29,
      folded: 21,
      oldDated: 1,
    });
    expect(seen[0].params).toEqual([FROM, TO]);
    expect(seen[0].sql).toContain(`COALESCE(tier, 'publish')`);
    expect(seen[0].sql).toContain('deleted_at IS NOT NULL');
    expect(seen[0].sql).toContain('cluster_size');
  });

  it('열이 없으면 그 칸 없이 셈(tier = publish · 숨김 = blocked · 묶음 0) · 접힌 수는 0 아래로 안 감 · 실패 = null', async () => {
    let sql = '';
    const v = await runVisibility(
      (s) => {
        sql = s;
        return Promise.resolve([{ publish: 3, clustered: 0, new_clusters: 2 }]);
      },
      FROM,
      TO,
      { tier: false, deletedAt: false, cluster: false },
    );
    expect(v).toMatchObject({ publish: 3, clustered: 0, folded: 0 });
    expect(sql).not.toContain('deleted_at');
    expect(sql).not.toContain('cluster_size');
    expect(sql).toContain('NULL::bigint');
    expect(
      await runVisibility(() => Promise.reject(new Error('x')), FROM, TO, {
        tier: true,
        deletedAt: true,
        cluster: true,
      }),
    ).toBeNull();
  });

  it('거부 사유: 방송은 둘째 마디까지(broadcast:topic_fit_false) · 기사는 앞머리', async () => {
    let sql = '';
    const r = await rejectReasonsBetween(
      (s) => {
        sql = s;
        return Promise.resolve([
          { reason: 'broadcast:topic_fit_false', n: 3 },
          { reason: 'category_fit_false', n: 9 },
        ]);
      },
      FROM,
      TO,
    );
    expect(r).toEqual({
      'broadcast:topic_fit_false': 3,
      category_fit_false: 9,
    });
    expect(sql).toContain(`WHEN reject_reason LIKE 'broadcast:%'`);
  });
});
