// =============================================
// 중독뉴스 - 조선일보 3단 레이아웃 v2
// 1:2:1 비율 / AI중독 카테고리명 변경
// =============================================

const API_BASE = "http://localhost:4000";

// 카테고리 정의 (AI중독으로 변경)
const CATEGORIES = [
  { key: "종합", slug: null, label: "종합" },
  { key: "중독정책", slug: "policy", label: "중독정책" },
  { key: "알코올·약물중독", slug: "alcohol", label: "알코올·약물" },
  { key: "도박중독", slug: "gambling", label: "도박중독" },
  { key: "게임·디지털중독", slug: "game", label: "게임·디지털" },
  { key: "AI중독", slug: "ai", label: "AI중독" },  // 변경됨
  { key: "공동체", slug: "community", label: "공동체" },
  { key: "종교", slug: "religion", label: "종교" },
  { key: "시사 이슈", slug: "issue", label: "시사이슈" },
];

// 데모 데이터 (AI중독으로 변경)
const DEMO_ARTICLES = [
  {
    id: 1,
    category: "중독정책",
    title: "정부, 온라인 도박 광고 규제 강화…중독 예방 종합대책 발표",
    source: "국가중독정책위원회",
    sourceUrl: "#",
    publishedAt: "2025-12-23",
    teaser: "온라인 도박 플랫폼의 난립과 과도한 광고에 대응하기 위한 종합적인 규제 및 예방 대책이 발표되었습니다.",
    summary: "정부는 온라인 도박 중독 위험이 급격히 높아지고 있다는 판단 아래, 광고 제한, 사행성 게임물 관리 강화, 상담·치료 지원 확대를 포함한 종합대책을 내놓았다.",
    tags: ["정책", "도박", "청소년"],
    isTop: true,
    isFeature: false,
  },
  {
    id: 2,
    category: "도박중독",
    title: "테리 로지어, NBA 도박 혐의 기각 요청 새로운 소송 제기",
    source: "Google News (US)",
    sourceUrl: "#",
    publishedAt: "2025-12-23",
    teaser: "Terry Rozier files new motion to have NBA gambling charges dismissed",
    summary: "NBA 선수 테리 로지어가 도박 관련 혐의 기각을 요청하는 새로운 소송을 제기했다.",
    tags: ["도박", "스포츠", "NBA"],
    isTop: false,
    isFeature: false,
  },
  {
    id: 3,
    category: "도박중독",
    title: "미주리주 스포츠 베팅 시장 공식 출범",
    source: "CBS Sports",
    sourceUrl: "#",
    publishedAt: "2025-12-23",
    teaser: "Missouri sports betting market officially launched",
    summary: "미주리주에서 스포츠 베팅 시장이 공식적으로 출범했다.",
    tags: ["도박", "스포츠베팅", "미국"],
    isTop: false,
    isFeature: false,
  },
  {
    id: 4,
    category: "게임·디지털중독",
    title: "청소년 게임·SNS 사용시간, 주당 40시간 넘어",
    source: "청소년정책연구소",
    sourceUrl: "#",
    publishedAt: "2025-12-20",
    teaser: "청소년의 디지털 미디어 사용이 일상생활을 잠식하면서 학업·관계 갈등이 동반되고 있습니다.",
    summary: "최근 조사에 따르면, 중·고등학생 상당수가 주당 40시간 이상을 게임·SNS에 사용하는 것으로 나타났다.",
    tags: ["게임", "청소년", "가족"],
    isTop: false,
    isFeature: false,
  },
  {
    id: 5,
    category: "AI중독",  // 변경됨
    title: "생성형 AI 기반 개인맞춤형 광고, 도박·게임 중독 위험 키우나",
    source: "디지털윤리포럼",
    sourceUrl: "#",
    publishedAt: "2025-12-18",
    teaser: "AI가 사용자의 취약성을 분석해 고위험 광고를 반복 노출하는 것에 대한 규제 필요성이 제기됩니다.",
    summary: "전문가들은 생성형 AI가 이용자의 심리 상태와 소비 패턴을 정교하게 파악할수록, 도박·게임·쇼핑 중독과 관련된 광고가 더욱 공격적으로 개인에게 맞춤화될 수 있다고 경고한다.",
    tags: ["AI", "알고리즘", "정책"],
    isTop: false,
    isFeature: false,
  },
  {
    id: 6,
    category: "공동체",
    title: "지역사회 기반 중독 회복 공동체, 농촌마을에서 새로운 실험",
    source: "중독사회 기획",
    sourceUrl: "#",
    publishedAt: "2025-12-15",
    teaser: "농촌 지역에서 중독 회복과 돌봄을 결합한 마을 단위 실험이 시작되었습니다.",
    summary: "도시 중심의 치료·재활 모델에서 벗어나, 농촌 마을에 거주 기반의 회복 공동체를 조성하려는 시도가 이어지고 있다.",
    tags: ["지역사회", "회복", "공동체"],
    isTop: false,
    isFeature: true,
  },
  {
    id: 7,
    category: "종교",
    title: "종교 공동체의 역할, 중독 회복 지원 네트워크로 재조명",
    source: "중독사회 분석팀",
    sourceUrl: "#",
    publishedAt: "2025-12-12",
    teaser: "교회·성당·사찰 등 종교 공동체가 중독 회복의 안전망으로 주목받고 있습니다.",
    summary: "여러 지역에서 종교 공동체가 상담·멘토링·자조 모임을 운영하며 중독 회복을 지원하는 사례가 늘고 있다.",
    tags: ["종교", "공동체", "회복"],
    isTop: false,
    isFeature: true,
  },
  {
    id: 8,
    category: "알코올·약물중독",
    title: "야간 노동자 대상 알코올 의존 실태조사…고위험군 3배 높아",
    source: "한국중독연구원",
    sourceUrl: "#",
    publishedAt: "2025-12-10",
    teaser: "야간 교대 근무자의 알코올 의존 위험이 일반 인구 대비 크게 높은 것으로 조사되었습니다.",
    summary: "연구진은 전국의 야간 교대 근무자 2,000여 명을 대상으로 설문조사를 실시한 결과, 고위험 음주군 비율이 일반 인구의 약 3배에 달한다고 밝혔다.",
    tags: ["알코올", "직장", "보건"],
    isTop: false,
    isFeature: false,
  },
  {
    id: 9,
    category: "시사 이슈",
    title: "짧은 영상 중독 경고: 집중력이 소모될 수 있다",
    source: "Google News (CN)",
    sourceUrl: "#",
    publishedAt: "2025-12-23",
    teaser: "短影音成癮警訊!小心专注力被掏空",
    summary: "짧은 영상 콘텐츠에 대한 과도한 소비가 집중력 저하를 유발할 수 있다는 경고가 제기되고 있다.",
    tags: ["디지털", "영상", "집중력"],
    isTop: false,
    isFeature: false,
  },
  {
    id: 10,
    category: "중독정책",
    title: "EU, 온라인 도박 광고 규제 강화 법안 추진",
    source: "EU 정책뉴스",
    sourceUrl: "#",
    publishedAt: "2025-12-22",
    teaser: "유럽연합이 온라인 도박 광고에 대한 강화된 규제 법안을 추진 중입니다.",
    summary: "EU는 특히 청소년과 취약계층을 보호하기 위한 온라인 도박 광고 규제를 강화하는 법안을 준비 중이다.",
    tags: ["정책", "EU", "도박"],
    isTop: false,
    isFeature: false,
  },
  {
    id: 11,
    category: "AI중독",  // 변경됨
    title: "AI 챗봇과의 대화 중독, 새로운 사회 문제로 부상",
    source: "디지털문화연구소",
    sourceUrl: "#",
    publishedAt: "2025-12-17",
    teaser: "AI 챗봇과 과도하게 대화하며 현실 관계를 소홀히 하는 사례가 늘고 있습니다.",
    summary: "전문가들은 AI 챗봇과의 대화가 실제 인간관계를 대체하면서 사회적 고립을 심화시킬 수 있다고 경고한다.",
    tags: ["AI", "챗봇", "사회"],
    isTop: false,
    isFeature: true,
  },
  {
    id: 12,
    category: "AI중독",  // 변경됨
    title: "AI 생성 콘텐츠 과소비, 디지털 중독의 새로운 양상",
    source: "테크윤리센터",
    sourceUrl: "#",
    publishedAt: "2025-12-15",
    teaser: "AI가 생성한 무한한 콘텐츠가 새로운 형태의 디지털 중독을 유발하고 있습니다.",
    summary: "AI가 실시간으로 생성하는 맞춤형 콘텐츠가 사용자의 시간과 주의력을 과도하게 소비하게 만든다는 연구 결과가 발표되었다.",
    tags: ["AI", "콘텐츠", "디지털"],
    isTop: false,
    isFeature: false,
  },
];

// 상태
let ARTICLES = [];
let state = {
  currentView: "main",
  currentCategory: null,
  summaryOpen: new Set(),
};

// =============================================
// 초기화
// =============================================
document.addEventListener("DOMContentLoaded", () => {
  loadArticles();
  
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", onSearchInput);
  }
});

// 백엔드에서 기사 로드
async function loadArticles() {
  try {
    const res = await fetch(`${API_BASE}/articles/latest`, { cache: "no-store" });
    if (!res.ok) throw new Error("API error");
    const data = await res.json();
    ARTICLES = Array.isArray(data) && data.length ? data : DEMO_ARTICLES;
  } catch (e) {
    console.log("백엔드 연결 실패, 데모 데이터 사용");
    ARTICLES = DEMO_ARTICLES;
  }
  
  renderAll();
}

// 전체 렌더링
function renderAll() {
  renderCategoryTabs();
  renderFeatureArticles();
  renderIssueList();
  renderMainView();
}

// =============================================
// 카테고리 탭
// =============================================
function renderCategoryTabs() {
  const container = document.getElementById("categoryTabs");
  if (!container) return;
  
  container.innerHTML = CATEGORIES.map(cat => `
    <button class="category-tab" data-category="${cat.key}" onclick="scrollToCategory('${cat.key}')">
      ${cat.label}
    </button>
  `).join("");
}

// 카테고리로 스크롤
function scrollToCategory(categoryKey) {
  if (state.currentView !== "main") {
    showMainView();
  }
  
  if (categoryKey === "종합") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  
  const sectionId = `section-${categoryKey.replace(/[·\s]/g, "-")}`;
  const section = document.getElementById(sectionId);
  if (section) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// =============================================
// 왼쪽: 중독 기획기사 (5개)
// =============================================
function renderFeatureArticles() {
  const container = document.getElementById("featureList");
  if (!container) return;
  
  const features = ARTICLES.filter(a => a.isFeature).slice(0, 5);
  
  if (features.length === 0) {
    container.innerHTML = `
      <div class="feature-empty">
        기획기사가 없습니다.<br>
        (편집자가 선정 예정)
      </div>
    `;
    return;
  }
  
  let html = features.map((article, idx) => `
    <div class="feature-item" onclick="openArticle(${article.id})">
      <div class="feature-num">${idx + 1}</div>
      <div class="feature-title">${article.title}</div>
      <div class="feature-meta">${article.publishedAt}</div>
    </div>
  `).join("");
  
  // 빈 슬롯 채우기 (5개까지)
  for (let i = features.length; i < 5; i++) {
    html += `
      <div class="feature-item" style="opacity: 0.4; cursor: default;">
        <div class="feature-num">${i + 1}</div>
        <div class="feature-title" style="color: var(--color-text-light);">기획기사 준비중</div>
      </div>
    `;
  }
  
  container.innerHTML = html;
}

// =============================================
// 오른쪽: 중독이슈 (5개)
// =============================================
function renderIssueList() {
  const container = document.getElementById("issueList");
  if (!container) return;
  
  const issues = ARTICLES.slice(0, 5);
  
  if (issues.length === 0) {
    container.innerHTML = `<div style="color: var(--color-text-muted); font-size: 13px;">이슈가 없습니다.</div>`;
    return;
  }
  
  container.innerHTML = issues.map((article, idx) => `
    <div class="issue-item" onclick="openArticle(${article.id})">
      <div class="issue-num">${idx + 1}</div>
      <div class="issue-title">${article.title}</div>
      <div class="issue-meta">${article.category} · ${article.publishedAt}</div>
    </div>
  `).join("");
}

// =============================================
// 가운데: 메인 뷰
// =============================================
function renderMainView() {
  renderTopNews();
  renderCategorySections();
}

// 탑뉴스
function renderTopNews() {
  const container = document.getElementById("topNews");
  if (!container) return;
  
  const topArticle = ARTICLES.find(a => a.isTop) || ARTICLES[0];
  
  if (!topArticle) {
    container.innerHTML = `<div style="color: var(--color-text-muted);">기사가 없습니다.</div>`;
    return;
  }
  
  container.innerHTML = `
    <div class="top-news-label">TOP NEWS</div>
    <div class="top-news-title" onclick="openArticle(${topArticle.id})">${topArticle.title}</div>
    <div class="top-news-meta">${topArticle.publishedAt} · ${topArticle.source}</div>
    <div class="top-news-teaser">${topArticle.teaser}</div>
    <div class="top-news-link" onclick="toggleSummary(${topArticle.id})">
      요약 보기 & 원문 바로가기
    </div>
    ${state.summaryOpen.has(topArticle.id) ? `
      <div class="summary-box">${topArticle.summary}</div>
      <div style="margin-top: 10px;">
        <a href="${topArticle.sourceUrl}" target="_blank" class="btn btn-primary">원문 보기</a>
      </div>
    ` : ""}
  `;
}

// 카테고리별 섹션
function renderCategorySections() {
  const container = document.getElementById("categorySections");
  if (!container) return;
  
  const categoriesWithoutAll = CATEGORIES.filter(c => c.key !== "종합");
  
  let html = "";
  
  categoriesWithoutAll.forEach(cat => {
    const articles = ARTICLES.filter(a => a.category === cat.key).slice(0, 3);
    const sectionId = `section-${cat.key.replace(/[·\s]/g, "-")}`;
    
    html += `
      <div class="category-section" id="${sectionId}">
        <div class="category-header">
          <div class="category-name">${cat.key}</div>
          <button class="category-more" onclick="showCategoryDetail('${cat.key}')">더보기</button>
        </div>
        <div class="category-articles">
          ${articles.length > 0 ? articles.map(article => `
            <div class="article-row" onclick="openArticle(${article.id})">
              <div class="article-row-title">${article.title}</div>
              <div class="article-row-meta">${article.publishedAt} · ${article.source}</div>
            </div>
          `).join("") : `
            <div class="category-empty">이 카테고리의 기사가 없습니다.</div>
          `}
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

// =============================================
// 카테고리 상세 페이지
// =============================================
function showCategoryDetail(categoryKey) {
  state.currentView = "category";
  state.currentCategory = categoryKey;
  
  const mainView = document.getElementById("mainView");
  const detailPage = document.getElementById("categoryDetailPage");
  
  mainView.style.display = "none";
  detailPage.classList.add("active");
  
  loadCategoryDetail(categoryKey);
  
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadCategoryDetail(categoryKey) {
  const container = document.getElementById("categoryDetailPage");
  const cat = CATEGORIES.find(c => c.key === categoryKey);
  
  container.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">${categoryKey} 최신 기사</div>
      <button class="detail-back" onclick="showMainView()">← 메인으로</button>
    </div>
    <div style="color: var(--color-text-muted);">기사를 불러오는 중...</div>
  `;
  
  let articles = [];
  
  if (cat && cat.slug) {
    try {
      const res = await fetch(`${API_BASE}/articles/category/${cat.slug}/paged?page=1&limit=20`);
      if (res.ok) {
        const data = await res.json();
        articles = data.items || [];
      }
    } catch (e) {
      console.log("백엔드 로드 실패, 로컬 데이터 사용");
    }
  }
  
  if (articles.length === 0) {
    articles = ARTICLES.filter(a => a.category === categoryKey).slice(0, 20);
  }
  
  container.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">${categoryKey} 최신 기사</div>
      <button class="detail-back" onclick="showMainView()">← 메인으로</button>
    </div>
    <div class="detail-count">총 ${articles.length}건</div>
    <div class="detail-list">
      ${articles.length > 0 ? articles.map(article => `
        <div class="detail-article">
          <div class="detail-article-badge">${article.category || categoryKey}</div>
          <div class="detail-article-title" onclick="toggleSummary(${article.id})">${article.title}</div>
          <div class="detail-article-teaser">${article.teaser || ""}</div>
          <div class="detail-article-meta">${article.publishedAt} · ${article.source}</div>
          <div class="detail-article-actions">
            <button class="btn" onclick="toggleSummary(${article.id})">
              ${state.summaryOpen.has(article.id) ? "요약 닫기" : "요약 보기"}
            </button>
            <a href="${article.sourceUrl || "#"}" target="_blank" class="btn btn-primary">원문 보기</a>
          </div>
          ${state.summaryOpen.has(article.id) ? `
            <div class="summary-box">${article.summary || "요약 정보가 없습니다."}</div>
          ` : ""}
        </div>
      `).join("") : `
        <div style="color: var(--color-text-muted); padding: 20px 0;">
          이 카테고리의 기사가 없습니다.
        </div>
      `}
    </div>
  `;
}

// 메인 뷰로 돌아가기
function showMainView() {
  state.currentView = "main";
  state.currentCategory = null;
  
  const mainView = document.getElementById("mainView");
  const detailPage = document.getElementById("categoryDetailPage");
  
  mainView.style.display = "block";
  detailPage.classList.remove("active");
  detailPage.innerHTML = "";
}

// =============================================
// 기사 상호작용
// =============================================
function openArticle(id) {
  state.summaryOpen.add(id);
  
  if (state.currentView === "main") {
    renderTopNews();
  } else {
    loadCategoryDetail(state.currentCategory);
  }
}

function toggleSummary(id) {
  if (state.summaryOpen.has(id)) {
    state.summaryOpen.delete(id);
  } else {
    state.summaryOpen.add(id);
  }
  
  if (state.currentView === "main") {
    renderTopNews();
  } else {
    loadCategoryDetail(state.currentCategory);
  }
}

// =============================================
// 검색
// =============================================
let searchTimer = null;

function onSearchInput(e) {
  const q = e.target.value.trim();
  
  if (searchTimer) clearTimeout(searchTimer);
  
  if (q.length < 2) {
    showSuggestions([]);
    return;
  }
  
  searchTimer = setTimeout(() => {
    const keyword = q.toLowerCase();
    const results = ARTICLES.filter(a => {
      const text = `${a.title} ${a.teaser || ""} ${a.summary || ""} ${(a.tags || []).join(" ")}`.toLowerCase();
      return text.includes(keyword);
    }).slice(0, 6);
    
    showSuggestions(results);
  }, 300);
}

function showSuggestions(list) {
  const box = document.getElementById("searchSuggest");
  if (!box) return;
  
  if (!list || list.length === 0) {
    box.style.display = "none";
    return;
  }
  
  box.innerHTML = list.map(a => `
    <div class="autocomplete-item" onclick="selectSuggestion(${a.id})">
      <div class="autocomplete-title">${a.title}</div>
      <div class="autocomplete-meta">${a.category} · ${a.publishedAt}</div>
    </div>
  `).join("");
  
  box.style.display = "block";
}

function selectSuggestion(id) {
  document.getElementById("searchSuggest").style.display = "none";
  document.getElementById("searchInput").value = "";
  
  state.summaryOpen.add(id);
  
  const article = ARTICLES.find(a => a.id === id);
  if (article) {
    scrollToCategory(article.category);
  }
}

// 바깥 클릭 시 자동완성 닫기
document.addEventListener("click", (e) => {
  const searchWrap = document.querySelector(".search-wrap");
  if (searchWrap && !searchWrap.contains(e.target)) {
    const box = document.getElementById("searchSuggest");
    if (box) box.style.display = "none";
  }
});