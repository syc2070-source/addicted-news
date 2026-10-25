import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { fieldProfile } from '../crawler/field_profile';
import * as om from './owner_materials';
import { loadOwnerMaterials, mergeReportLists, ownerReportCard, validateOwnerMaterial } from './owner_materials';
import { ReportsController } from './reports.controller';

const GOOD = {
  id: 'gambling-status-2026q3',
  kind: 'status',
  title: '2026년 3분기 도박 중독 현황',
  summary: '분기 현황 요약',
  body: '본문',
  date: '2026-10-20',
  source: '오너',
  public: true,
};

const STATORY = {
  count: 2,
  items: [
    { id: 'b2', title_ko: '중독의 과거와 미래', published_at: '2026-07-03T01:18:51.786543+00:00' },
    { id: 'b1', title_ko: '중독이란?', published_at: '2026-07-03T01:18:47.047283+00:00' },
  ],
};

/** 가짜 파일 읽기(디스크 쓰기 0) */
const fileOf = (content: unknown) => () => JSON.stringify(content);

describe('NEWS-Q16 ■5 — 오너 공개 자료 문(꼴 · 스위치)', () => {
  it('설정 스위치는 꺼짐 · 받는 파일은 비어 있음', () => {
    expect(fieldProfile().sources.owner_materials).toMatchObject({ enabled: false, file: 'owner_materials.json', max_items: 20 });
    expect(loadOwnerMaterials()).toEqual({ enabled: false, items: [], rejected: [] });
    const real = JSON.parse(fs.readFileSync(`${__dirname}/../../data/owner_materials.json`, 'utf8'));
    expect(real.items).toEqual([]);
  });

  it('꼴: 제목 · 요약 · 본문 또는 링크 · 날짜 · 출처 = 오너 · 공개 여부', () => {
    expect(validateOwnerMaterial(GOOD)).toEqual({ ok: true, item: { ...GOOD, kind: 'status' } });
    expect(validateOwnerMaterial({ ...GOOD, body: undefined, link: 'https://example.org/a b"c' })).toMatchObject({
      ok: true,
      item: { link: 'https://example.org/a%20b%22c' },
    });
    const bad = validateOwnerMaterial({
      id: 'Bad Id', kind: 'news', title: '', summary: 'x'.repeat(601), link: 'http://example.org', date: '2026-02-30', source: 'Statory', public: 'yes',
    });
    expect(bad).toEqual({ ok: false, errors: ['id', 'kind', 'title', 'summary', 'link', 'date', 'source', 'public'] });
    expect(validateOwnerMaterial({ ...GOOD, body: '' })).toEqual({ ok: false, errors: ['body_or_link'] });
    expect(validateOwnerMaterial({ ...GOOD, link: 'javascript:alert(1)' })).toEqual({ ok: false, errors: ['link'] });
    // 리뷰: 호스트의 따옴표는 정규화로 안 바뀜 → 막음(href 속성 깨기)
    expect(validateOwnerMaterial({ ...GOOD, link: 'https://x"onmouseover="alert(1)"a="' })).toEqual({ ok: false, errors: ['link'] });
    expect(validateOwnerMaterial({ ...GOOD, link: "https://example.org/it's" })).toEqual({ ok: false, errors: ['link'] });
    expect(validateOwnerMaterial(null)).toEqual({ ok: false, errors: ['not_object'] });
  });

  it('켜짐: 공개 · 꼴 맞음만 · 같은 id 둘째 뺌 · 날짜 늦은 것 먼저 · max_items · 파일 이름 확인', () => {
    const items = [
      { ...GOOD, id: 'a', date: '2026-09-01' },
      { ...GOOD, id: 'b', date: '2026-10-01' },
      { ...GOOD, id: 'hidden', public: false },
      { ...GOOD, id: 'a', date: '2026-10-05' },
      { ...GOOD, id: 'x', source: '남' },
      { ...GOOD, id: 'c', date: '2026-08-01' },
    ];
    const r = loadOwnerMaterials({ enabled: true, file: 'owner_materials.json', max_items: 2 }, '/nowhere', fileOf({ items }));
    expect(r.items.map((m) => m.id)).toEqual(['b', 'a']);
    expect(r.rejected).toEqual([
      { index: 3, id: 'a', errors: ['duplicate_id'] },
      { index: 4, id: 'x', errors: ['source'] },
    ]);
    expect(loadOwnerMaterials({ enabled: true, file: '../secret.json' }, '/nowhere').items).toEqual([]);
    expect(loadOwnerMaterials({ enabled: true, file: 'missing.json' }, '/nowhere').items).toEqual([]);
  });

  it('카드 = Statory ReportCard 꼴 + origin · source_label · link_url · 섞기(첫 쪽만 · 늦은 것 먼저 · limit · count)', () => {
    const card = ownerReportCard({ ...GOOD, kind: 'status', source: '오너' }, 'addiction');
    expect(card).toMatchObject({
      id: 'owner-gambling-status-2026q3', scenario_id: 'addiction', scope: 'owner', title_ko: GOOD.title, summary_ko: GOOD.summary,
      category: 'status', published_at: '2026-10-20T00:00:00+09:00', origin: 'owner', source_label: '오너', link_url: null,
    });
    const m = mergeReportLists(STATORY, [card], 2, 0);
    expect(m.count).toBe(3);
    expect(m.items.map((x) => (x as { id: string }).id)).toEqual(['owner-gambling-status-2026q3', 'b2']);
    expect(mergeReportLists(STATORY, [card], 3, 1).items).toHaveLength(2);
    expect(mergeReportLists(null, [card], 3, 0)).toEqual({ count: 1, items: [card] });
  });
});

describe('NEWS-Q16 ■5 — GET /reports (스위치 꺼짐 = 응답 예전 그대로)', () => {
  const ctl = (url: string | undefined) => new ReportsController({ get: () => url } as unknown as ConfigService);
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => STATORY } as Response);
  });
  afterEach(() => fetchSpy.mockRestore());

  it('꺼짐: Statory 응답 그대로(null 본문도) · 주소 없음 = 빈 목록 · owner-* 상세도 예전처럼 Statory 로', async () => {
    expect(await ctl('https://statory.example').listReports('3')).toBe(STATORY);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/reports\?scenario_id=addiction&limit=3&offset=0$/);
    expect(await ctl(undefined).listReports('3')).toEqual({ count: 0, items: [] });
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => null } as Response);
    expect(await ctl('https://statory.example').listReports('3')).toBeNull();
    expect(await ctl('https://statory.example').getReport('owner-gambling-status-2026q3')).toBe(STATORY);
    expect(String(fetchSpy.mock.calls[2][0])).toMatch(/\/api\/reports\/owner-gambling-status-2026q3\?include_sections=false$/);
  });

  it('켜짐이어도 공개 항목이 없으면 Statory 응답 그대로(다시 줄 세우지 않음)', async () => {
    const real = om.loadOwnerMaterials;
    const spy = jest.spyOn(om, 'loadOwnerMaterials').mockImplementation(() => real({ enabled: true }, '/nowhere', fileOf({ items: [] })));
    try {
      expect(await ctl('https://statory.example').listReports('3')).toBe(STATORY);
    } finally {
      spy.mockRestore();
    }
  });

  it('켜짐(이 시험에서만 · 가짜 파일): 오너 카드가 섞이고 · Statory 실패여도 나옴 · 좁힌 목록에는 안 섞임 · 상세 = body_ko', async () => {
    const real = om.loadOwnerMaterials;
    const spy = jest
      .spyOn(om, 'loadOwnerMaterials')
      .mockImplementation(() => real({ enabled: true, file: 'owner_materials.json', max_items: 20 }, '/nowhere', fileOf({ items: [GOOD] })));
    try {
      const on = (await ctl('https://statory.example').listReports('3')) as { count: number; items: Array<{ id: string }> };
      expect([on.count, on.items.map((x) => x.id)]).toEqual([3, ['owner-gambling-status-2026q3', 'b2', 'b1']]);
      fetchSpy.mockResolvedValueOnce({ ok: false } as Response);
      const down = (await ctl('https://statory.example').listReports('3')) as { items: Array<{ id: string }> };
      expect(down.items.map((x) => x.id)).toEqual(['owner-gambling-status-2026q3']);
      expect(await ctl('https://statory.example').listReports('3', '0', 'global')).toBe(STATORY);
      expect(await ctl(undefined).getReport('owner-gambling-status-2026q3')).toMatchObject({
        found: true,
        item: { id: 'owner-gambling-status-2026q3', body_ko: '본문', source_label: '오너' },
      });
      expect(await ctl(undefined).getReport('owner-nope')).toEqual({ found: false, item: null });
    } finally {
      spy.mockRestore();
    }
  });
});
