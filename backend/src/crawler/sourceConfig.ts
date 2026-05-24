// backend/src/crawler/sourceConfig.ts
// v3.1 - 죽은 소스 10개 제거 (2026-05-05)
// 변경 이력:
//   v3.0: 중독 전문 소스 중심으로 재구성
//   v3.1: 404/403/cert/timeout 발생 소스 제거
//     제거: kr-mohw-policy, kr-mfds-narcotics, kr-ngcc-news,
//           kr-kcgp-press, kr-drugfree-kr, kr-okinews-local,
//           us-samhsa, us-nida, uk-adf, eu-emcdda
//     사유: 별도 파일 docs/REMOVED_SOURCES.md 참조 권장

// 광고성 기사 벌점 키워드 (크롤러에서 즉시 탈락 처리)
export const AD_PENALTY_KEYWORDS = [
  '가입코드', '추천인', '공식주소', '입금플러스', '꽁머니',
  '안전놀이터', '수익보장', '텔레그램 문의', '단톡방', '롤링', '마틴루틴',
];

// 카테고리 타입 (5개)
export type CategoryName = 
  | '중독정책'
  | '알코올·약물중독'
  | '도박중독'
  | '게임·디지털중독'
  | '중독사회와 회복';

export interface SourceConfig {
  id: string;
  url: string;
  sourceName: string;
  category: CategoryName;
  region: string;
  lang: string;
  /** 전문 기관/직접 RSS — 중독 점수 통과 임계값 완화(1점) */
  isSpecialized?: boolean;
  /** 수집 순서(낮을수록 먼저, 미지정 100) */
  priority?: number;
}

export const SOURCES: SourceConfig[] = [
  // ========================================
  // 한국 Google News - 중독 키워드 검색
  // ========================================
  {
    id: 'kr-google-policy',
    url: 'https://news.google.com/rss/search?q="중독"+AND+(정책+OR+규제+OR+법안+OR+대책+OR+예방)&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '중독정책',
    region: 'KR',
    lang: 'ko',
  },
  {
    id: 'kr-google-alcohol',
    url: 'https://news.google.com/rss/search?q="알코올중독"+OR+"알코올+의존"+OR+"음주+중독"+OR+"주류+중독"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '알코올·약물중독',
    region: 'KR',
    lang: 'ko',
  },
  {
    id: 'kr-google-drug',
    url: 'https://news.google.com/rss/search?q="약물중독"+OR+"마약+중독"+OR+"오피오이드"+OR+"펜타닐"+OR+"필로폰"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '알코올·약물중독',
    region: 'KR',
    lang: 'ko',
  },
  {
    id: 'kr-google-gambling',
    url: 'https://news.google.com/rss/search?q="도박중독"+OR+"도박+치료"+OR+"사행산업"+OR+"불법도박"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '도박중독',
    region: 'KR',
    lang: 'ko',
  },
  {
    id: 'kr-google-gambling2',
    url: 'https://news.google.com/rss/search?q="스포츠베팅"+OR+"토토+중독"+OR+"카지노+중독"+OR+"복권+중독"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '도박중독',
    region: 'KR',
    lang: 'ko',
  },
  {
    id: 'kr-google-game',
    url: 'https://news.google.com/rss/search?q="게임중독"+OR+"게임+과몰입"+OR+"게임+장애"+OR+"게임+의존"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '게임·디지털중독',
    region: 'KR',
    lang: 'ko',
  },
  {
    id: 'kr-google-digital',
    url: 'https://news.google.com/rss/search?q="스마트폰중독"+OR+"인터넷중독"+OR+"SNS중독"+OR+"디지털중독"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '게임·디지털중독',
    region: 'KR',
    lang: 'ko',
  },
  {
    id: 'kr-google-ai',
    url: 'https://news.google.com/rss/search?q="AI중독"+OR+"챗봇+의존"+OR+"인공지능+중독"+OR+"AI+과의존"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '게임·디지털중독',
    region: 'KR',
    lang: 'ko',
  },
  {
    id: 'kr-google-recovery',
    url: 'https://news.google.com/rss/search?q="중독+치료"+OR+"중독+재활"+OR+"중독+회복"+OR+"단주+모임"&hl=ko&gl=KR&ceid=KR:ko',
    sourceName: 'Google News (KR)',
    category: '중독사회와 회복',
    region: 'KR',
    lang: 'ko',
  },

  // ========================================
  // 한국 — 의료 전문 매체 (저수익이지만 가끔 가치)
  // ========================================
  {
    id: 'kr-docdocdoc-rss',
    url: 'http://www.docdocdoc.co.kr/rss/clickTop.xml',
    sourceName: '청년의사',
    category: '알코올·약물중독',
    region: 'KR',
    lang: 'ko',
    priority: 8,
  },
  {
    id: 'kr-kormedi-feed',
    url: 'https://kormedi.com/feed/',
    sourceName: '코메디닷컴',
    category: '알코올·약물중독',
    region: 'KR',
    lang: 'ko',
    priority: 9,
  },

  // ========================================
  // 미국 - 중독 전문 매체 & Google News
  // ========================================
  {
    id: 'us-drugfree',
    url: 'https://drugfree.org/feed/',
    sourceName: 'Partnership to End Addiction',
    category: '알코올·약물중독',
    region: 'US',
    lang: 'en',
  },
  {
    id: 'us-google-opioid',
    url: 'https://news.google.com/rss/search?q="opioid+crisis"+OR+"fentanyl+overdose"+OR+"drug+addiction+treatment"&hl=en-US&gl=US&ceid=US:en',
    sourceName: 'Google News (US)',
    category: '알코올·약물중독',
    region: 'US',
    lang: 'en',
  },
  {
    id: 'us-google-gambling',
    url: 'https://news.google.com/rss/search?q="gambling+addiction"+OR+"problem+gambling"+OR+"sports+betting+addiction"&hl=en-US&gl=US&ceid=US:en',
    sourceName: 'Google News (US)',
    category: '도박중독',
    region: 'US',
    lang: 'en',
  },
  {
    id: 'us-google-gaming',
    url: 'https://news.google.com/rss/search?q="gaming+disorder"+OR+"video+game+addiction"+OR+"internet+addiction"&hl=en-US&gl=US&ceid=US:en',
    sourceName: 'Google News (US)',
    category: '게임·디지털중독',
    region: 'US',
    lang: 'en',
  },
  {
    id: 'us-google-alcohol',
    url: 'https://news.google.com/rss/search?q="alcohol+addiction"+OR+"alcoholism+treatment"+OR+"alcohol+use+disorder"&hl=en-US&gl=US&ceid=US:en',
    sourceName: 'Google News (US)',
    category: '알코올·약물중독',
    region: 'US',
    lang: 'en',
  },

  // ========================================
  // 영국 - Google News (uk-adf 인증서 문제로 제거)
  // ========================================
  {
    id: 'uk-gov-gambling',
    url: 'https://www.gov.uk/search/news-and-communications.atom?topics%5B%5D=gambling',
    sourceName: 'UK Government',
    category: '도박중독',
    region: 'UK',
    lang: 'en',
  },
  {
    id: 'uk-google-addiction',
    url: 'https://news.google.com/rss/search?q="addiction+treatment+UK"+OR+"NHS+addiction"+OR+"gambling+UK"&hl=en-GB&gl=GB&ceid=GB:en',
    sourceName: 'Google News (UK)',
    category: '알코올·약물중독',
    region: 'UK',
    lang: 'en',
  },
  {
    id: 'uk-google-gambling',
    url: 'https://news.google.com/rss/search?q="gambling+harm"+OR+"betting+addiction"+OR+"gambling+commission"&hl=en-GB&gl=GB&ceid=GB:en',
    sourceName: 'Google News (UK)',
    category: '도박중독',
    region: 'UK',
    lang: 'en',
  },

  // ========================================
  // 호주
  // ========================================
  {
    id: 'au-google-addiction',
    url: 'https://news.google.com/rss/search?q="addiction+Australia"+OR+"gambling+addiction+Australia"+OR+"drug+treatment"&hl=en-AU&gl=AU&ceid=AU:en',
    sourceName: 'Google News (AU)',
    category: '알코올·약물중독',
    region: 'AU',
    lang: 'en',
  },

  // ========================================
  // 캐나다
  // ========================================
  {
    id: 'ca-google-addiction',
    url: 'https://news.google.com/rss/search?q="addiction+Canada"+OR+"opioid+crisis+Canada"+OR+"safe+injection"&hl=en-CA&gl=CA&ceid=CA:en',
    sourceName: 'Google News (CA)',
    category: '알코올·약물중독',
    region: 'CA',
    lang: 'en',
  },

  // ========================================
  // 일본
  // ========================================
  {
    id: 'jp-google-gambling',
    url: 'https://news.google.com/rss/search?q="ギャンブル依存症"+OR+"パチンコ依存"+OR+"カジノ規制"&hl=ja&gl=JP&ceid=JP:ja',
    sourceName: 'Google News (JP)',
    category: '도박중독',
    region: 'JP',
    lang: 'ja',
  },
  {
    id: 'jp-google-game',
    url: 'https://news.google.com/rss/search?q="ゲーム依存症"+OR+"ネット依存"+OR+"スマホ依存"&hl=ja&gl=JP&ceid=JP:ja',
    sourceName: 'Google News (JP)',
    category: '게임·디지털중독',
    region: 'JP',
    lang: 'ja',
  },
  {
    id: 'jp-google-alcohol',
    url: 'https://news.google.com/rss/search?q="アルコール依存症"+OR+"断酒"+OR+"薬物依存"&hl=ja&gl=JP&ceid=JP:ja',
    sourceName: 'Google News (JP)',
    category: '알코올·약물중독',
    region: 'JP',
    lang: 'ja',
  },

  // ========================================
  // 유럽 (eu-emcdda 도메인 변경으로 제거)
  // ========================================
  {
    id: 'eu-google-addiction',
    url: 'https://news.google.com/rss/search?q="addiction+Europe"+OR+"drug+policy+EU"+OR+"gambling+regulation+Europe"&hl=en&gl=EU&ceid=EU:en',
    sourceName: 'Google News (EU)',
    category: '중독정책',
    region: 'EU',
    lang: 'en',
  },

  // ========================================
  // 글로벌 - WHO, Google News
  // ========================================
  {
    id: 'global-who-substance',
    url: 'https://www.who.int/rss-feeds/news-english.xml',
    sourceName: 'WHO',
    category: '중독정책',
    region: 'GLOBAL',
    lang: 'en',
  },
  {
    id: 'global-google-addiction',
    url: 'https://news.google.com/rss/search?q="addiction+research"+OR+"substance+abuse"+OR+"behavioral+addiction"&hl=en&gl=US&ceid=US:en',
    sourceName: 'Google News (Global)',
    category: '중독사회와 회복',
    region: 'GLOBAL',
    lang: 'en',
  },
];
