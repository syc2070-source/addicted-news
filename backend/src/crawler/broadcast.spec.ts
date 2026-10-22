// NEWS-Q1 ■4ⓕ — 방송: RSS 파싱 · 핵심어 관문 · DeepSeek 관문 결정 · 저장 행(종류).
import {
  buildBroadcastRow, decideBroadcast, descriptionGist, kstYmd, loadBroadcastSources,
  parseBroadcastXml, passesBroadcastKeywordGate, BroadcastSource,
} from './broadcast';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>MBC PD수첩</title>
 <entry>
  <id>yt:video:AbCdEfGhIj0</id>
  <yt:videoId>AbCdEfGhIj0</yt:videoId>
  <title>도박소년이 된 내 아들 - PD수첩, MBC 260811 방송</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=AbCdEfGhIj0"/>
  <published>2026-08-11T13:30:00+00:00</published>
  <media:group>
   <media:title>도박소년이 된 내 아들</media:title>
   <media:thumbnail url="https://i1.ytimg.com/vi/AbCdEfGhIj0/hqdefault.jpg" width="480" height="360"/>
   <media:description>청소년 온라인 도박의 실태를 추적했다.
#PD수첩 #MBC
https://www.instagram.com/mbcpdnote</media:description>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:ZyXwVuTsRq9</id>
  <yt:videoId>ZyXwVuTsRq9</yt:videoId>
  <title>AI 딜레마 1부 : 일자리 종말론</title>
  <published>2026-10-08T15:10:00+00:00</published>
  <media:group><media:description>인공지능과 일자리. 재활용 산업의 변화도 다룬다.</media:description></media:group>
 </entry>
</feed>`;

const SOURCE: BroadcastSource = {
  outletId: 'mbc_pd_note', program: 'MBC PD수첩', channelTitle: 'MBC PD수첩',
  channelId: 'UCawCv9kO2UXbTtsK4EammRQ', feedUrl: 'x', sharedChannel: false, programEn: 'MBC PD Notebook',
};

describe('방송 RSS 파싱', () => {
  it('YouTube Atom → 영상 ID·제목·설명·게시 시각·URL·썸네일', async () => {
    const items = await parseBroadcastXml(FEED);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      videoId: 'AbCdEfGhIj0',
      title: '도박소년이 된 내 아들 - PD수첩, MBC 260811 방송',
      url: 'https://www.youtube.com/watch?v=AbCdEfGhIj0',
      thumbnailUrl: 'https://i1.ytimg.com/vi/AbCdEfGhIj0/hqdefault.jpg',
    });
    expect(items[0].description).toContain('청소년 온라인 도박');
    expect(Date.parse(items[0].publishedAt)).toBe(Date.parse('2026-08-11T13:30:00Z'));
  });

  it('등록된 아홉 채널의 RSS 주소를 만든다(열쇠 없음)', () => {
    const sources = loadBroadcastSources();
    expect(sources).toHaveLength(9);
    for (const s of sources) {
      expect(s.feedUrl).toBe(`https://www.youtube.com/feeds/videos.xml?channel_id=${s.channelId}`);
      expect(s.feedUrl).not.toMatch(/key=/);
    }
  });
});

describe('핵심어 관문', () => {
  it('PD수첩 「도박소년이 된 내 아들」 통과 · 무관한 편 탈락 · 재활용 은 재활 아님', async () => {
    const [gamble, ai] = await parseBroadcastXml(FEED);
    expect(passesBroadcastKeywordGate(gamble)).toBe(true);
    expect(passesBroadcastKeywordGate(ai)).toBe(false);
    expect(passesBroadcastKeywordGate({ title: '알코올 의존 회복기', description: '' })).toBe(true);
  });
});

describe('DeepSeek 관문 결정', () => {
  const item = { title: '도박소년이 된 내 아들', description: '' };
  it('핵심어 탈락이면 DeepSeek 를 부르지 않는다', () => {
    expect(decideBroadcast({ title: '날씨', description: '' }, null, true)).toEqual({ action: 'skip', reason: 'keyword_miss' });
  });
  it('DeepSeek 없음·판정 없음 → 저장 안 함(fail-closed)', () => {
    expect(decideBroadcast(item, null, false)).toEqual({ action: 'skip', reason: 'no_deepseek' });
    expect(decideBroadcast(item, null, true)).toEqual({ action: 'reject', reason: 'judgment_missing' });
  });
  it('입구 게이트 기준: high·fit·비사건만 채택', () => {
    expect(decideBroadcast(item, { categoryFit: true, isIncident: false, confidence: 'high' }, true)).toEqual({ action: 'accept' });
    expect(decideBroadcast(item, { categoryFit: true, isIncident: true, confidence: 'high' }, true)).toEqual({ action: 'reject', reason: 'is_incident' });
    expect(decideBroadcast(item, { categoryFit: true, isIncident: false, confidence: 'medium' }, true).action).toBe('reject');
  });
});

describe('저장 행', () => {
  it('종류=broadcast(source_type) · 프로그램 · 영상 URL · KST 날짜 · 설명 요지 · 원자료에 정확한 시각', async () => {
    const [gamble] = await parseBroadcastXml(FEED);
    const row = buildBroadcastRow(SOURCE, gamble, { summary: null, category: '도박중독' });
    expect(row.sourceType).toBe('broadcast');
    expect(row.source).toBe('MBC PD수첩');
    expect(row.sourceUrl).toBe('https://www.youtube.com/watch?v=AbCdEfGhIj0');
    expect(row.googleUrl).toBeNull();
    expect(row.publishedAt).toBe('2026-08-11'); // 13:30Z = 22:30 KST
    expect(row.summary).toBe('청소년 온라인 도박의 실태를 추적했다.');
    expect(row.rawBody).toContain('게시 시각: ');
    expect(row.rawBody).toContain('MBC PD수첩');
    expect(row.category).toBe('도박중독');
  });

  it('KST 날짜 경계 · 요지에서 해시태그·링크 줄 제거', () => {
    expect(kstYmd('2026-10-09T15:30:00Z')).toBe('2026-10-10');
    expect(kstYmd('not a date')).toBeNull();
    expect(descriptionGist('본문 한 줄\n#태그 #둘\nhttps://x.y/z')).toBe('본문 한 줄');
  });
});
