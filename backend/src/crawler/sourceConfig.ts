// backend/src/crawler/sourceConfig.ts

export type RegionCode = 'KR' | 'US' | 'EU' | 'AS' | 'OTHER';

export type CategoryName =
  | '중독정책'
  | '알코올·약물중독'
  | '도박중독'
  | '게임·디지털중독'
  | 'AI 관련 정책과 중독'
  | '공동체'
  | '종교'
  | '시사 이슈';

export type SourceType = 'institution' | 'news' | 'google';

export interface SourceConfig {
  id: string;
  type: SourceType;
  region: RegionCode;
  category: CategoryName;
  url: string;
  sourceName: string;
}

// Google News RSS 빌더
function googleRss(params: {
  q: string;
  hl?: string;
  gl?: string;
  ceid?: string;
}) {
  const hl = params.hl || 'ko';
  const gl = params.gl || 'KR';
  const ceid = params.ceid || `${gl}:${hl}`;
  const q = encodeURIComponent(params.q);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

/**
 * 주요 언론사 RSS + Google News 보조
 */
export const SOURCES: SourceConfig[] = [
  // ==================== 한국 주요 언론사 ====================
  
  // 연합뉴스 (한국 대표 통신사)
  {
    id: 'kr-yonhap-social',
    type: 'news',
    region: 'KR',
    category: '시사 이슈',
    url: 'https://www.yonhapnewsagency.co.kr/rss/0200000000.xml', // 사회
    sourceName: '연합뉴스',
  },

  // 조선일보
  {
    id: 'kr-chosun-society',
    type: 'news',
    region: 'KR',
    category: '시사 이슈',
    url: 'https://www.chosun.com/arc/outboundfeeds/rss/category/society/?outputType=xml',
    sourceName: '조선일보',
  },

  // 중앙일보
  {
    id: 'kr-joongang-society',
    type: 'news',
    region: 'KR',
    category: '시사 이슈',
    url: 'https://rss.joins.com/joins_society_list.xml',
    sourceName: '중앙일보',
  },

  // 동아일보
  {
    id: 'kr-donga-society',
    type: 'news',
    region: 'KR',
    category: '시사 이슈',
    url: 'https://rss.donga.com/society.xml',
    sourceName: '동아일보',
  },

  // 한겨레
  {
    id: 'kr-hani-society',
    type: 'news',
    region: 'KR',
    category: '시사 이슈',
    url: 'https://www.hani.co.kr/rss/society/',
    sourceName: '한겨레',
  },

  // 경향신문
  {
    id: 'kr-khan-society',
    type: 'news',
    region: 'KR',
    category: '시사 이슈',
    url: 'https://www.khan.co.kr/rss/rssdata/society_news.xml',
    sourceName: '경향신문',
  },

  // 매일경제 (경제/사회)
  {
    id: 'kr-mk-society',
    type: 'news',
    region: 'KR',
    category: '시사 이슈',
    url: 'https://www.mk.co.kr/rss/30200041/',
    sourceName: '매일경제',
  },

  // 한국경제
  {
    id: 'kr-hankyung-society',
    type: 'news',
    region: 'KR',
    category: '시사 이슈',
    url: 'https://www.hankyung.com/feed/society',
    sourceName: '한국경제',
  },

  // ==================== Google News 보조 (카테고리별) ====================
  
  {
    id: 'kr-policy-google',
    type: 'google',
    region: 'KR',
    category: '중독정책',
    url: googleRss({ 
      q: '중독 정책 OR 도박 규제 OR 알코올 정책 OR 마약 정책 OR 게임 셧다운제', 
      hl: 'ko', 
      gl: 'KR' 
    }),
    sourceName: 'Google News (KR) - 중독정책',
  },

  {
    id: 'kr-alcohol-google',
    type: 'google',
    region: 'KR',
    category: '알코올·약물중독',
    url: googleRss({ 
      q: '알코올 중독 OR 약물 중독 OR 마약 중독 OR 치료 재활 OR 단주', 
      hl: 'ko', 
      gl: 'KR' 
    }),
    sourceName: 'Google News (KR) - 알코올·약물',
  },

  {
    id: 'kr-gambling-google',
    type: 'google',
    region: 'KR',
    category: '도박중독',
    url: googleRss({ 
      q: '도박 중독 OR 온라인 카지노 OR 불법 도박 OR 스포츠 베팅 OR 토토 중독', 
      hl: 'ko', 
      gl: 'KR' 
    }),
    sourceName: 'Google News (KR) - 도박중독',
  },

  {
    id: 'kr-game-google',
    type: 'google',
    region: 'KR',
    category: '게임·디지털중독',
    url: googleRss({ 
      q: '게임 중독 OR 디지털 중독 OR 스마트폰 중독 OR SNS 중독 OR 유튜브 중독', 
      hl: 'ko', 
      gl: 'KR' 
    }),
    sourceName: 'Google News (KR) - 게임·디지털',
  },

  {
    id: 'kr-ai-google',
    type: 'google',
    region: 'KR',
    category: 'AI 관련 정책과 중독',
    url: googleRss({ 
      q: 'AI 도박 광고 OR 알고리즘 중독 OR 생성형 AI 중독 OR 추천시스템', 
      hl: 'ko', 
      gl: 'KR' 
    }),
    sourceName: 'Google News (KR) - AI/중독',
  },

  // ==================== 미국 주요 언론사 ====================
  
  {
    id: 'us-nyt-health',
    type: 'news',
    region: 'US',
    category: '알코올·약물중독',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/Health.xml',
    sourceName: 'New York Times - Health',
  },

  {
    id: 'us-wapo-health',
    type: 'news',
    region: 'US',
    category: '알코올·약물중독',
    url: 'https://feeds.washingtonpost.com/rss/national/health-science',
    sourceName: 'Washington Post - Health',
  },

  {
    id: 'us-cnn-health',
    type: 'news',
    region: 'US',
    category: '시사 이슈',
    url: 'http://rss.cnn.com/rss/cnn_health.rss',
    sourceName: 'CNN Health',
  },

  // Google News 보조
  {
    id: 'us-addiction-google',
    type: 'google',
    region: 'US',
    category: '알코올·약물중독',
    url: googleRss({ 
      q: 'addiction treatment OR opioid crisis OR substance abuse OR recovery', 
      hl: 'en', 
      gl: 'US' 
    }),
    sourceName: 'Google News (US) - Addiction',
  },

  {
    id: 'us-gambling-google',
    type: 'google',
    region: 'US',
    category: '도박중독',
    url: googleRss({ 
      q: 'gambling addiction OR sports betting harm OR problem gambling', 
      hl: 'en', 
      gl: 'US' 
    }),
    sourceName: 'Google News (US) - Gambling',
  },

  // ==================== 영국/유럽 ====================
  
  {
    id: 'uk-bbc-health',
    type: 'news',
    region: 'EU',
    category: '시사 이슈',
    url: 'http://feeds.bbci.co.uk/news/health/rss.xml',
    sourceName: 'BBC Health',
  },

  {
    id: 'uk-guardian-society',
    type: 'news',
    region: 'EU',
    category: '시사 이슈',
    url: 'https://www.theguardian.com/society/rss',
    sourceName: 'The Guardian - Society',
  },

  {
    id: 'eu-gambling-google',
    type: 'google',
    region: 'EU',
    category: '도박중독',
    url: googleRss({ 
      q: 'gambling addiction OR betting regulation OR problem gambling', 
      hl: 'en', 
      gl: 'GB' 
    }),
    sourceName: 'Google News (UK) - Gambling',
  },

  // ==================== 일본 ====================
  
  {
    id: 'jp-nhk-news',
    type: 'news',
    region: 'AS',
    category: '시사 이슈',
    url: 'https://www.nhk.or.jp/rss/news/cat0.xml',
    sourceName: 'NHK ニュース',
  },

  {
    id: 'jp-asahi-society',
    type: 'news',
    region: 'AS',
    category: '시사 이슈',
    url: 'https://www.asahi.com/rss/asahi/newsheadlines.rdf',
    sourceName: '朝日新聞',
  },

  {
    id: 'jp-addiction-google',
    type: 'google',
    region: 'AS',
    category: '시사 이슈',
    url: googleRss({ 
      q: '依存症 OR ギャンブル依存 OR ゲーム依存 OR 薬物依存', 
      hl: 'ja', 
      gl: 'JP' 
    }),
    sourceName: 'Google News (JP) - 依存症',
  },

  // ==================== 중국 ====================
  
  {
    id: 'cn-xinhua-society',
    type: 'news',
    region: 'AS',
    category: '시사 이슈',
    url: 'http://www.news.cn/society/news_society.xml',
    sourceName: '新华网',
  },

  {
    id: 'cn-addiction-google',
    type: 'google',
    region: 'AS',
    category: '시사 이슈',
    url: googleRss({ 
      q: '成瘾 OR 赌博成瘾 OR 游戏成瘾 OR 药物成瘾', 
      hl: 'zh-CN', 
      gl: 'CN' 
    }),
    sourceName: 'Google News (CN) - 成瘾',
  },

  // ==================== 글로벌 ====================
  
  {
    id: 'global-reuters-health',
    type: 'news',
    region: 'OTHER',
    category: '시사 이슈',
    url: 'https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best',
    sourceName: 'Reuters',
  },
];