// ============================================================
// 국내 언론사 RSS 생존 확인 (로컬에서 실행)
// 실행: node check_kr_rss.js
// 살아있고 item 이 있는 피드만 골라 kr_press_rss.json 으로 저장.
// 중독뉴스 크롤러가 이 목록을 소스로 씀.
// ============================================================
const fs = require('fs');

// 후보: 연합 + 주요지 + 지상파 + 통신/기타. 매체당 여러 경로 후보를 둠.
// (실제 살아있는 것만 결과에 남음. 죽은 건 자동 제외)
const CANDIDATES = [
  // 통신사(원천 — 커버리지 넓음)
  { outlet: '연합뉴스', region: 'kr', lang: 'ko', urls: [
    'https://www.yna.co.kr/rss/news.xml',
    'https://www.yna.co.kr/rss/all.xml',
    'https://www.yna.co.kr/rss/society.xml',
  ]},
  { outlet: '뉴시스', region: 'kr', lang: 'ko', urls: [
    'https://newsis.com/RSS/society.xml',
    'https://www.newsis.com/rss/',
  ]},
  // 지상파
  { outlet: 'KBS', region: 'kr', lang: 'ko', urls: [
    'https://news.kbs.co.kr/rss/rss.do',
    'https://news.kbs.co.kr/rss/rss.do?ctcd=0004', // 사회
    'http://world.kbs.co.kr/rss/rss_news.htm?lang=k',
  ]},
  { outlet: 'MBC', region: 'kr', lang: 'ko', urls: [
    'https://imnews.imbc.com/rss/news/news_00.xml',
    'https://imnews.imbc.com/rss/news/news_society.xml',
  ]},
  { outlet: 'SBS', region: 'kr', lang: 'ko', urls: [
    'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01&plink=RSSREADER',
    'https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER',
  ]},
  // 주요 신문
  { outlet: '경향신문', region: 'kr', lang: 'ko', urls: [
    'https://www.khan.co.kr/rss/rssdata/total_news.xml',
    'https://www.khan.co.kr/rss/rssdata/society_news.xml',
  ]},
  { outlet: '한겨레', region: 'kr', lang: 'ko', urls: [
    'https://www.hani.co.kr/rss/',
    'https://www.hani.co.kr/rss/society/',
  ]},
  { outlet: '동아일보', region: 'kr', lang: 'ko', urls: [
    'https://rss.donga.com/total.xml',
    'https://rss.donga.com/national.xml',
  ]},
  { outlet: '한국일보', region: 'kr', lang: 'ko', urls: [
    'https://www.hankookilbo.com/rss/all',
    'https://www.hankookilbo.com/rss/Society',
  ]},
  { outlet: '서울신문', region: 'kr', lang: 'ko', urls: [
    'https://www.seoul.co.kr/xml/rss/rss_society.php',
    'https://www.seoul.co.kr/xml/rss/rss_all.php',
  ]},
  { outlet: '국민일보', region: 'kr', lang: 'ko', urls: [
    'http://rss.kmib.co.kr/data/kmibRssAll.xml',
    'https://www.kmib.co.kr/rss/data/kmibRssAll.xml',
  ]},
  { outlet: '노컷뉴스', region: 'kr', lang: 'ko', urls: [
    'https://rss.nocutnews.co.kr/news.xml',
    'https://www.nocutnews.co.kr/rss/news',
  ]},
  { outlet: '오마이뉴스', region: 'kr', lang: 'ko', urls: [
    'http://rss.ohmynews.com/rss/ohmynews.xml',
  ]},
  { outlet: '프레시안', region: 'kr', lang: 'ko', urls: [
    'https://www.pressian.com/api/v3/site/rss/news',
  ]},
  { outlet: '세계일보', region: 'kr', lang: 'ko', urls: [
    'https://www.segye.com/Articles/RSSList/segye_recent.xml',
  ]},
];

function fetchText(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AddictedNewsBot/1.0)' },
      timeout: timeoutMs,
    }, (res) => {
      // 리다이렉트 따라가기
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return done(fetchText(new URL(res.headers.location, url).href, timeoutMs));
      }
      if (res.statusCode !== 200) { res.resume(); return done({ code: res.statusCode, body: '' }); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        data += c;
        if (data.length > 200000) {
          req.destroy();
          done({ code: 200, body: data });
        }
      });
      res.on('end', () => done({ code: 200, body: data }));
      res.on('error', () => done({ code: 0, body: data }));
    });
    req.on('error', () => done({ code: 0, body: '' }));
    req.on('timeout', () => { req.destroy(); done({ code: 0, body: '' }); });
  });
}

function countItems(xml) {
  const items = (xml.match(/<item[\s>]/gi) || []).length;
  const entries = (xml.match(/<entry[\s>]/gi) || []).length;
  return items + entries;
}

(async () => {
  const alive = [];
  console.log('국내 RSS 생존 확인 중...\n');
  for (const c of CANDIDATES) {
    let picked = null;
    try {
      for (const url of c.urls) {
        try {
          const { code, body } = await fetchText(url);
          const n = body ? countItems(body) : 0;
          const ok = code === 200 && (body.includes('<rss') || body.includes('<feed') || n > 0) && n >= 3;
          console.log(`${ok ? '[OK]' : '[--]'} ${c.outlet.padEnd(8)} items=${String(n).padStart(3)} ${url}`);
          if (ok && !picked) { picked = { url, items: n }; }
        } catch (e) {
          console.log(`[ERR] ${c.outlet.padEnd(8)} ${url} ${(e && e.message) || e}`);
        }
      }
    } catch (e) {
      console.log(`[ERR] ${c.outlet} ${(e && e.message) || e}`);
    }
    if (picked) {
      alive.push({
        outlet_id: c.outlet, region_id: c.region, lang_primary: c.lang,
        rss_url: picked.url, items_seen: picked.items,
      });
    }
    console.log('');
  }
  fs.writeFileSync('kr_press_rss.json', JSON.stringify({ feeds: alive }, null, 2), 'utf8');
  console.log(`\n=== 살아있는 국내 피드 ${alive.length}개 → kr_press_rss.json 저장 ===`);
  alive.forEach((f) => console.log(`  ${f.outlet_id}: ${f.rss_url} (item ${f.items_seen})`));
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
