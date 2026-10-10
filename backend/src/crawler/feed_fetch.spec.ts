import Parser from 'rss-parser';
import { BROWSER_UA, expandUrlTemplate, fetchFeed, fetchFeedText, parseHtmlList, parseJsonList, sanitizeXml } from './feed_fetch';
import { fieldProfile } from './field_profile';
import { buildAllSources, buildSources } from './sourceConfig';

// NEWS-Q2 ■4: 피드 건강 — 헤더 · 403 재시도 · 깨진 XML · 비활성 건너뜀
const RSS = (title: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>${title}</title><link>https://a.com/1?x=1&amp;y=2</link><pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;

describe('feed_fetch', () => {
  it('처음 요청부터 브라우저 UA·Accept 를 보낸다', async () => {
    const get = jest.fn(async () => ({ status: 200, data: RSS('a') }));
    await fetchFeedText('https://feed.example/rss', { get });
    const cfg = (get.mock.calls[0] as any)[1];
    expect(cfg.headers['User-Agent']).toBe(BROWSER_UA);
    expect(cfg.headers.Accept).toMatch(/application\/rss\+xml/);
  });

  it('403 이면 쉬었다가 다른 UA 로 1회만 다시 · 그래도 실패면 status code 오류', async () => {
    const get = jest.fn()
      .mockResolvedValueOnce({ status: 403, data: '' })
      .mockResolvedValueOnce({ status: 200, data: RSS('ok') });
    const r = await fetchFeedText('https://feed.example/rss', { get, waitMs: 0 });
    expect(r.retried).toBe(true);
    expect((get.mock.calls[1] as any)[1].headers['User-Agent']).not.toBe(BROWSER_UA);
    const get2 = jest.fn(async () => ({ status: 403, data: '' }));
    await expect(fetchFeedText('https://feed.example/rss', { get: get2, waitMs: 0 })).rejects.toThrow('status code 403');
    expect(get2).toHaveBeenCalledTimes(2);
  });

  it('깨진 XML(맨 &·앞 쓰레기)은 고쳐서 1회 더 파싱한다', async () => {
    const broken = '\n﻿junk' + RSS('A & B').replace('</channel>', '<item><title>x</title><link>https://a.com/?a=1&b=2</link></item></channel>');
    expect(sanitizeXml('<a href="?a=1&b=2">&amp; &#39; &x</a>')).toBe('<a href="?a=1&amp;b=2">&amp; &#39; &amp;x</a>');
    const get = jest.fn(async () => ({ status: 200, data: broken }));
    const r = await fetchFeed({ url: 'https://x/rss' }, new Parser(), { get });
    expect(r.repaired).toBe(true);
    expect(r.feed.items?.[0].title).toBe('A & B');
  });

  it('HTML 공지 목록 · JSON 기관 뉴스 → 항목', async () => {
    const html = '<li><a href="/n/1">첫 소식</a><span>2026.10.02</span></li><li><a href="/n/2">둘째 &amp; 소식</a><span>2026-10-01</span></li>';
    const items = parseHtmlList(html, '<a href="(?<link>[^"]+)">(?<title>.*?)</a><span>(?<date>[^<]+)</span>', 'https://inst.go.kr/list');
    expect(items).toEqual([
      { title: '첫 소식', link: 'https://inst.go.kr/n/1', isoDate: expect.any(String) },
      { title: '둘째 & 소식', link: 'https://inst.go.kr/n/2', isoDate: expect.any(String) },
    ]);
    const json = JSON.stringify({ value: [{ Title: 'WHO news', ItemDefaultUrl: '/09-10-2026-x', PublicationDateAndTime: '2026-10-09T12:30:33Z' }] });
    expect(parseJsonList(json, { items: 'value', title: 'Title', link: 'ItemDefaultUrl', date: 'PublicationDateAndTime', link_prefix: 'https://www.who.int/news/item' }))
      .toEqual([{ title: 'WHO news', link: 'https://www.who.int/news/item/09-10-2026-x', isoDate: '2026-10-09T12:30:33.000Z' }]);
    expect(expandUrlTemplate('https://e.org/b?date={yesterday_mdy}', new Date('2026-10-10T05:00:00Z'))).toBe('https://e.org/b?date=10/09/2026');
  });

  it('비활성 피드(대체 없음)는 크롤 목록에서 빠지고, 점검 목록에는 사유와 함께 남는다', () => {
    const p = fieldProfile();
    const all = buildAllSources(p);
    const live = buildSources(p);
    const off = all.filter((s) => !s.active);
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((s) => !!s.inactiveReason)).toBe(true);
    expect(live.some((s) => !s.active)).toBe(false);
    expect(live.length).toBe(all.length - off.length);
    expect(off.map((s) => s.id)).toEqual(expect.arrayContaining(['wp-wpr-022', 'us-drugfree']));
  });
});
