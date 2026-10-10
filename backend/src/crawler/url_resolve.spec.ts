import axios from 'axios';
import { backfillGoogleUrls, outletNameFromTitle, planResolution, ResolveRow } from './url_resolve';
import { decodeGoogleNewsUrl } from './google_news_url';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// NEWS-Q2 ■3: 구글뉴스 링크 → 원문 주소
const ROW: ResolveRow = {
  id: 7,
  source_url: 'https://news.google.com/rss/articles/CBMiABC?oc=5',
  google_url: null,
  source: 'Google News (KR)',
  outlet_id: 'google-kr-gambling',
  title: '불법 도박 근절 대책 - 아시아경제',
  original_title: '불법 도박 근절 대책 - 아시아경제',
  url_resolve: null,
};

describe('url_resolve — 계획', () => {
  it('성공: source_url = 원문 · google_url 보존(없으면 옛 링크) · outlet = 도메인 · 매체명 = 제목 꼬리 · 바꾸기 전 값 남김', () => {
    const p = planResolution(ROW, 'https://www.asiae.co.kr/article/2026101009472840800', new Date('2026-10-11T03:00:00Z'));
    expect(p.ok).toBe(true);
    expect(p.sourceUrl).toBe('https://www.asiae.co.kr/article/2026101009472840800');
    expect(p.googleUrl).toBe(ROW.source_url);
    expect(p.outletId).toBe('asiae.co.kr');
    expect(p.source).toBe('아시아경제');
    expect(p.state).toMatchObject({ status: 'ok', attempts: 1, prev: { source_url: ROW.source_url, source: 'Google News (KR)', outlet_id: 'google-kr-gambling' } });
  });

  it('이미 google_url 이 있으면 그대로 둔다', () => {
    const p = planResolution({ ...ROW, google_url: 'https://news.google.com/rss/articles/KEEP' }, 'https://a.com/x');
    expect(p.googleUrl).toBe('https://news.google.com/rss/articles/KEEP');
  });

  it('실패: 구글 링크 유지 · 시도 수 +1 · 3회째면 failed 표시', () => {
    const p1 = planResolution(ROW, null);
    expect(p1).toMatchObject({ ok: false, sourceUrl: ROW.source_url, state: { status: 'pending', attempts: 1 } });
    const p3 = planResolution({ ...ROW, url_resolve: { status: 'pending', attempts: 2, at: '' } }, 'https://news.google.com/still');
    expect(p3.state).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('제목 꼬리 매체명은 짧을 때만', () => {
    expect(outletNameFromTitle('제목 - 뉴스1')).toBe('뉴스1');
    expect(outletNameFromTitle('대시 없는 제목')).toBeNull();
  });
});

describe('url_resolve — 기존 행 되풀이(최대 100건)', () => {
  it('성공 행은 원문으로 갱신, 실패 행은 상태만, failed 행은 고르지 않는다', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT')) {
        expect(sql).toContain("COALESCE(url_resolve->>'status', '') <> 'failed'");
        expect(sql).toContain('ORDER BY id ASC LIMIT $1');
        expect(params).toEqual([100]);
        return [ROW, { ...ROW, id: 8 }];
      }
      return [];
    });
    const decode = jest.fn(async (u: string) => (calls.length === 1 ? 'https://www.asiae.co.kr/a/1' : null));
    const r = await backfillGoogleUrls({ query, decode, gradeColumn: true, log: () => undefined });
    expect(r).toEqual({ picked: 2, ok: 1, pending: 1, failed: 0 });
    const upd = calls.filter((c) => c.sql.startsWith('UPDATE'));
    expect(upd[0].sql).toContain('source_url = $2, google_url = $3');
    expect(upd[0].sql).toContain("source_grade = 'press'");
    expect(upd[0].params?.slice(0, 3)).toEqual([7, 'https://www.asiae.co.kr/a/1', ROW.source_url]);
    expect(upd[1].sql).toBe('UPDATE articles SET url_resolve = $2::jsonb WHERE id = $1');
  });
});

describe('google_news_url — batchexecute 요청 꼴', () => {
  it('f.req 는 세 겹 배열로 보낸다(두 겹이면 400 → 해석 0%였음)', async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: '<div data-n-a-sg="SIG" data-n-a-ts="123"></div>', headers: {} } as any);
    mockedAxios.post.mockImplementationOnce(async (_url: string, body: any) => {
      const req = JSON.parse(decodeURIComponent(String(body).replace(/^f\.req=/, '')));
      expect(Array.isArray(req[0][0])).toBe(true);
      expect(req[0][0][0]).toBe('Fbv4je');
      const inner = JSON.stringify(['garturlres', 'https://www.asiae.co.kr/article/1', 1]);
      return { status: 200, data: `)]}'\n\n${JSON.stringify([['wrb.fr', 'Fbv4je', inner, null, null, null, 'generic']])}` } as any;
    });
    const url = await decodeGoogleNewsUrl('https://news.google.com/rss/articles/CBMiQUFVX3lxTE5uNkZYY0c2bUNzVmdfcWhReUxrWXo5UV9LMGlhZERxOU5NcG83YmJsTW5WVUZtNTJT?oc=5');
    expect(url).toBe('https://www.asiae.co.kr/article/1');
  });
});
