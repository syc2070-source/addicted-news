import { renderSample, ruleCounts, selectSample, SampleRow } from './cluster_sample';

const NOW = Date.parse('2026-10-14T03:00:00Z');
const at = (h: number) => new Date(NOW - h * 3600e3).toISOString();

describe('cluster_sample — 묶음 표본 검사기(NEWS-Q5 ■2 · 읽기 전용)', () => {
  it('최근 7일만 · 묶음은 묶음마다 하나 · 단독은 씨앗 고정 무작위 n(같은 씨앗 = 같은 표본)', () => {
    const rows: SampleRow[] = [
      { id: 1, title: 'a', publishedAt: at(1), clusterId: '1', clusterSize: 2 },
      { id: 2, title: 'b', publishedAt: at(2), clusterId: '1', clusterSize: 2 },
      { id: 3, title: 'c', publishedAt: at(3), clusterId: '3', clusterSize: 3 },
      { id: 9, title: 'old', publishedAt: at(24 * 8), clusterId: '9', clusterSize: 2 },
      ...Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, title: `s${i}`, publishedAt: at(5 + i), clusterId: null, clusterSize: 1 })),
    ];
    const p = selectSample(rows, NOW, '2026-10-14', 20);
    expect(p.recentTotal).toBe(33);
    expect(p.clusters.map((c) => c.clusterId)).toEqual(['3', '1']); // 큰 묶음 먼저 · 8일 전 묶음 빠짐
    expect(p.singlesTotal).toBe(30);
    expect(p.singles).toHaveLength(20);
    expect(new Set(p.singles.map((s) => s.id)).size).toBe(20);
    expect(selectSample(rows, NOW, '2026-10-14', 20).singles.map((s) => s.id)).toEqual(p.singles.map((s) => s.id));
    expect(selectSample(rows, NOW, '2026-10-15', 20).singles.map((s) => s.id).sort()).not.toEqual(p.singles.map((s) => s.id).sort());
  });

  it('마크다운: 묶음 id · 대표 · 구성 기사 제목·매체·시각·rule · 맞음/틀림 빈칸 · rule 분포 · 표 깨는 | 막음', () => {
    const clusters = [{
      clusterId: '5410', size: 2, mode: 'column',
      representative: { id: 5410, title: '마약퇴치운동본부 | 줄퇴사', source: '연합뉴스', publishedAt: at(3) },
      members: [
        { id: 5410, title: '마약퇴치운동본부 | 줄퇴사', source: '연합뉴스', publishedAt: at(3), rule: 'seed' },
        { id: 5399, title: '운동본부 직원 잇단 퇴사', source: '뉴시스', publishedAt: at(5), rule: 'entity' },
      ],
    }];
    expect(ruleCounts(clusters)).toEqual({ seed: 1, entity: 1 });
    const md = renderSample({
      api: 'https://x', now: NOW, recentTotal: 3, clusters, failed: [],
      singles: [{ id: 7, title: '단독 기사', source: 'KBS', publishedAt: at(1) }], singlesTotal: 1,
    });
    expect(md).toContain('### 묶음 5410 · 2건 · column');
    expect(md).toContain('대표: [5410] 마약퇴치운동본부 ｜ 줄퇴사 — 연합뉴스');
    expect(md).toContain('| 5399 | 운동본부 직원 잇단 퇴사 | 뉴시스 | 2026-10-14 07:00 | entity |  |');
    expect(md).toContain('근거(rule) 분포: seed 1 · entity 1');
    expect(md).toContain('판정: ☐ 맞음 ☐ 틀림');
    expect(md).toContain('| 7 | 단독 기사 | KBS | 2026-10-14 11:00 |  |');
    expect(md).toContain('묶음(2건+) 1 · 구성 기사 2 · 단독 1 중 무작위 1');
  });
});
