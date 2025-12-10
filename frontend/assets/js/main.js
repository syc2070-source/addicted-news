// 백엔드 API 주소
const API_BASE = "http://localhost:4000";

const CATEGORY_KEYS = [
  "종합",
  "중독정책",
  "알코올·약물중독",
  "도박중독",
  "게임·디지털중독",
  "AI 관련 정책과 중독",
  "공동체",
  "종교",
  "시사 이슈",
];

const DEMO_ARTICLES = [
  {
    id: 1,
    category: "중독정책",
    title: "정부, 온라인 도박 광고 규제 강화…중독 예방 종합대책 발표",
    source: "국가중독정책위원회",
    sourceUrl: "#",
    publishedAt: "2025-11-30",
    teaser:
      "온라인 도박 플랫폼의 난립과 과도한 광고에 대응하기 위한 종합적인 규제 및 예방 대책이 발표되었습니다.",
    summary:
      "정부는 온라인 도박 중독 위험이 급격히 높아지고 있다는 판단 아래, 광고 제한, 사행성 게임물 관리 강화, 상담·치료 지원 확대를 포함한 종합대책을 내놓았다. 특히 청소년이 쉽게 접속할 수 있는 SNS·동영상 플랫폼 광고를 우선 규제 대상으로 삼고, 플랫폼 사업자에게도 공동 책임을 부과하는 방안을 추진 중이다.",
    tags: ["정책", "도박", "청소년"],
    origin: "crawler",
    region: "KR",
    isTop: true,
    isFeature: false,
  },
  {
    id: 2,
    category: "도박중독",
    title: "코로나19 이후 온라인 카지노 이용 급증…중독 치료 기관 내원자 증가",
    source: "중독재활센터",
    sourceUrl: "#",
    publishedAt: "2025-11-22",
    teaser:
      "대면 카지노가 제한된 시기를 거치며 온라인 불법 카지노 이용이 늘어난 것으로 나타났습니다.",
    summary:
      "중독 재활기관들의 집계에 따르면, 팬데믹 시기 이후 온라인 불법 카지노를 이용하다 중독 상태에 이른 내원자가 지속적으로 증가하고 있다. 경기 결과나 스포츠 중계에 직접 연동된 베팅보다는, 24시간 운영되는 슬롯머신·바카라 형태의 온라인 게임이 핵심 위험 요인으로 지목됐다.",
    tags: ["도박", "온라인", "치료"],
    origin: "crawler",
    region: "KR",
    isTop: false,
    isFeature: false,
  },
  {
    id: 3,
    category: "알코올·약물중독",
    title: "야간 노동자 대상 알코올 의존 실태조사…고위험군 3배 높아",
    source: "한국중독연구원",
    sourceUrl: "#",
    publishedAt: "2025-11-15",
    teaser:
      "야간 교대 근무자의 알코올 의존 위험이 일반 인구 대비 크게 높은 것으로 조사되었습니다.",
    summary:
      "연구진은 전국의 야간 교대 근무자 2,000여 명을 대상으로 설문조사를 실시한 결과, 고위험 음주군 비율이 일반 인구의 약 3배에 달한다고 밝혔다. 수면장애와 스트레스, 사회적 고립 등이 복합적으로 작용해 알코올을 '자기 조절 도구'로 사용하는 양상이 반복되면서 중독으로 이어질 가능성이 크다고 분석했다.",
    tags: ["알코올", "직장", "보건"],
    origin: "crawler",
    region: "KR",
    isTop: false,
    isFeature: false,
  },
  {
    id: 4,
    category: "게임·디지털중독",
    title:
      "청소년 게임·SNS 사용시간, 주당 40시간 넘어…부모·학교 갈등 심화",
    source: "청소년정책연구소",
    sourceUrl: "#",
    publishedAt: "2025-11-10",
    teaser:
      "청소년의 디지털 미디어 사용이 일상생활을 잠식하면서 학업·관계 갈등이 동반되고 있습니다.",
    summary:
      "최근 조사에 따르면, 중·고등학생 상당수가 주당 40시간 이상을 게임·SNS에 사용하는 것으로 나타났다. 휴식과 소통의 수단이었던 디지털 미디어가 점차 수면 부족, 학업 부진, 가족 갈등의 중심으로 이동하면서, 단순 사용시간 규제보다 '함께 사용하는 방법'과 '자기 조절 기술'이 정책의 핵심 과제로 떠오르고 있다.",
    tags: ["게임", "청소년", "가족"],
    origin: "crawler",
    region: "KR",
    isTop: false,
    isFeature: false,
  },
  {
    id: 5,
    category: "AI 관련 정책과 중독",
    title: "생성형 AI 기반 개인맞춤형 광고, 도박·게임 중독 위험 키우나",
    source: "디지털윤리포럼",
    sourceUrl: "#",
    publishedAt: "2025-11-05",
    teaser:
      "AI가 사용자의 취약성을 분석해 고위험 광고를 반복 노출하는 것에 대한 규제 필요성이 제기됩니다.",
    summary:
      "전문가들은 생성형 AI가 이용자의 심리 상태와 소비 패턴을 정교하게 파악할수록, 도박·게임·쇼핑 중독과 관련된 광고가 더욱 공격적으로 개인에게 맞춤화될 수 있다고 경고한다. 이에 따라 알고리즘 투명성, 취약계층 보호 장치, 광고 노출 상한제 등 새로운 정책 도구가 논의되고 있다.",
    tags: ["AI", "알고리즘", "정책"],
    origin: "crawler",
    region: "EU",
    isTop: false,
    isFeature: false,
  },
  {
    id: 6,
    category: "공동체",
    title: "지역사회 기반 중독 회복 공동체, 농촌마을에서 새로운 실험",
    source: "중독사회 기획",
    sourceUrl: "#",
    publishedAt: "2025-11-01",
    teaser:
      "농촌 지역에서 중독 회복과 돌봄을 결합한 마을 단위 실험이 시작되었습니다.",
    summary:
      "도시 중심의 치료·재활 모델에서 벗어나, 농촌 마을에 거주 기반의 회복 공동체를 조성하려는 시도가 이어지고 있다. 주민 자치와 자조 모임, 소규모 일자리, 농업 활동을 결합해 '중독 이후의 삶'을 함께 설계하는 방식으로, 지역사회 전체의 회복탄력성을 높이는 효과도 기대된다.",
    tags: ["지역사회", "회복", "공동체"],
    origin: "original",
    region: "KR",
    isTop: false,
    isFeature: true,
  },
  {
    id: 7,
    category: "종교",
    title: "종교 공동체의 역할, 중독 회복 지원 네트워크로 재조명",
    source: "중독사회 분석팀",
    sourceUrl: "#",
    publishedAt: "2025-10-28",
    teaser:
      "교회·성당·사찰 등 종교 공동체가 중독 회복의 안전망으로 주목받고 있습니다.",
    summary:
      "여러 지역에서 종교 공동체가 상담·멘토링·자조 모임을 운영하며 중독 회복을 지원하는 사례가 늘고 있다. 도덕적 비난보다 공감과 동행을 중심에 두는 프로그램일수록 재발률이 낮게 나타나, 세속 기관과의 협력 모델이 요구되고 있다.",
    tags: ["종교", "공동체", "회복"],
    origin: "original",
    region: "KR",
    isTop: false,
    isFeature: true,
  },
];

let ARTICLES = [];
let state = {
  category: "종합",
  search: "",
  summaryOpen: new Set(),
  viewMode: "summary", // "summary": 5개, "full": 20개
};

// ---------- 초기 로드 ----------
document.addEventListener("DOMContentLoaded", () => {
  loadArticles();

  const input = document.getElementById("searchInput");
  input.addEventListener("input", onSearchInput);
});

// 백엔드에서 기사 불러오기 (없으면 데모 데이터)
async function loadArticles() {
  try {
    const res = await fetch(`${API_BASE}/articles/latest`, { cache: "no-store" });
    if (!res.ok) throw new Error("API error " + res.status);
    const data = await res.json();
    ARTICLES = Array.isArray(data) && data.length ? data : DEMO_ARTICLES;
  } catch (e) {
    console.error("백엔드에서 기사 불러오기 실패, 데모 사용:", e);
    ARTICLES = DEMO_ARTICLES;
  }
  applyFilters();
  renderHotIssues();
}

// ---------- 카테고리 탭 ----------
function initCategoryTabs() {
  const container = document.getElementById("categoryTabs");
  container.innerHTML = "";
  CATEGORY_KEYS.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "category-tab" + (state.category === cat ? " active" : "");
    btn.textContent = cat;
    btn.onclick = () => {
      state.category = cat;
      state.viewMode = "summary";
      state.summaryOpen.clear();
      document.getElementById("searchInput").value = "";
      state.search = "";
      applyFilters();
    };
    container.appendChild(btn);
  });
}

// ---------- 검색 + 필터 ----------
function applyFilters() {
  const searchValue = document
    .getElementById("searchInput")
    .value.trim()
    .toLowerCase();
  state.search = searchValue;
  if (searchValue) state.viewMode = "summary";

  initCategoryTabs();
  renderArticles();
}

// 검색창 입력 이벤트 (자동완성 + 필터 동시)
function onSearchInput(e) {
  const q = e.target.value.trim();
  state.search = q.toLowerCase();

  // ✅ 1글자는 자동완성 안 함, 2글자 이상만 자동완성
  if (q.length >= 2) {
    debounceFetchSuggestions(q);
  } else {
    showSuggestions([]);
  }

  // 화면 목록 필터링
  applyFilters();
}

// ---------- 자동완성 (프론트 단에서만 처리) ----------
let debounceTimer = null;

function debounceFetchSuggestions(q) {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    const keyword = q.toLowerCase();
    const list = ARTICLES.filter((a) => {
      const text = (
        a.title +
        " " +
        a.teaser +
        " " +
        a.summary +
        " " +
        (a.tags || []).join(" ")
      ).toLowerCase();
      return text.includes(keyword);
    });
    // 상위 6개만
    showSuggestions(list.slice(0, 6));
  }, 300); // 0.3초 동안 입력이 멈추면 그때 계산
}

function showSuggestions(list) {
  const box = document.getElementById("searchSuggest");

  if (!list || list.length === 0) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  const html = list
    .map(
      (a) => `
      <div class="autocomplete-item" onclick="openArticleSummary(${a.id})">
        <div class="autocomplete-title">${a.title}</div>
        <div class="autocomplete-meta">${a.category || ""} · ${
        a.publishedAt || ""
      }</div>
      </div>
    `
    )
    .join("");

  box.innerHTML = html;
  box.style.display = "block";
}

// ---------- 탑뉴스 / 기획기사 ----------
function renderHighlights(baseList) {
  const container = document.getElementById("topHighlights");
  if (!container) return;

  let list =
    baseList && baseList.length ? baseList.slice() : ARTICLES.slice();
  if (!list.length) {
    container.innerHTML = "";
    return;
  }

  list.sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );

  let topNews = list.find((a) => a.isTop) || list[0];
  const features = list
    .filter((a) => a.isFeature && a.id !== topNews.id)
    .slice(0, 2);

  const topHtml = `
      <div class="top-news-card">
        <div class="top-label">TOP NEWS</div>
        <div class="top-title">${topNews.title}</div>
        <div class="top-meta">${topNews.publishedAt} · ${
    topNews.source
  }</div>
        <div class="top-teaser">${topNews.teaser}</div>
        <div class="top-link" onclick="openArticleSummary(${topNews.id})">
          요약 보기 & 원문 바로가기
        </div>
      </div>
    `;

  let featureHtml = "";
  if (!features.length) {
    featureHtml = `
        <div class="feature-card">
          <div class="top-label">기획 기사</div>
          <div class="feature-empty">
            준비 중인 기획 기사가 없습니다. (중독사회 자체 제작 기사 영역)
          </div>
        </div>
      `;
  } else {
    featureHtml = `
        <div class="feature-card">
          <div class="top-label">기획 기사</div>
          <div class="feature-list">
            ${features
              .map(
                (f) => `
              <div class="feature-item" onclick="openArticleSummary(${f.id})">
                <div class="feature-title">${f.title}</div>
                <div class="feature-meta">${f.publishedAt} · ${f.source}</div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `;
  }

  container.innerHTML = topHtml + featureHtml;
}

function openArticleSummary(id) {
  state.summaryOpen.add(id);
  state.viewMode = "full";
  renderArticles();
  document.getElementById("articlesTitle").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

// ---------- 기사 목록 ----------
function renderArticles() {
  const container = document.getElementById("articlesWrap");
  const titleEl = document.getElementById("articlesTitle");
  const metaEl = document.getElementById("articlesMeta");
  const loadMoreEl = document.getElementById("loadMoreWrap");

  let base = ARTICLES.slice();

  if (state.category !== "종합") {
    base = base.filter((a) => a.category === state.category);
  }

  if (state.search) {
    const keyword = state.search.toLowerCase();
    base = base.filter((a) => {
      const text = (
        a.title +
        " " +
        a.teaser +
        " " +
        a.summary +
        " " +
        (a.tags || []).join(" ")
      ).toLowerCase();
      return text.includes(keyword);
    });
  }

  base.sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );

  renderHighlights(base);

  const totalCount = base.length;
  const titleElTextBase =
    state.category === "종합"
      ? "종합 최신 기사"
      : state.category + " 최신 기사";

  // 종합 + 검색 없음 → 카테고리별 3개씩
  if (state.category === "종합" && !state.search) {
    const byCat = {};
    base.forEach((a) => {
      if (!byCat[a.category]) byCat[a.category] = [];
      byCat[a.category].push(a);
    });

    const list = [];
    CATEGORY_KEYS.slice(1).forEach((cat) => {
      if (byCat[cat] && byCat[cat].length > 0) {
        byCat[cat].slice(0, 3).forEach((art) => list.push(art));
      }
    });

    titleEl.textContent = titleElTextBase;
    metaEl.textContent = `총 ${totalCount}건 (카테고리별 최대 3개씩 표시)`;

    container.innerHTML = "";
    loadMoreEl.innerHTML = "";

    if (!list.length) {
      const empty = document.createElement("div");
      empty.textContent = "조건에 맞는 기사가 없습니다.";
      empty.style.fontSize = "13px";
      empty.style.color = "#6b7280";
      container.appendChild(empty);
      return;
    }

    list.forEach(renderArticleCardInto(container));
    return;
  }

  // 나머지 경우 (카테고리별 / 검색 / 종합+검색)
  let limit;
  if (state.category === "종합" && state.search) {
    limit = base.length;
  } else {
    limit = state.viewMode === "full" ? 20 : 5;
  }
  const list = base.slice(0, limit);

  let titleText = titleElTextBase;
  if (
    state.category !== "종합" &&
    state.viewMode === "full" &&
    !state.search
  ) {
    titleText += " (전체 보기)";
  }
  titleEl.textContent = titleText;
  metaEl.textContent = `총 ${totalCount}건`;

  container.innerHTML = "";
  loadMoreEl.innerHTML = "";

  if (!list.length) {
    const empty = document.createElement("div");
    empty.textContent = "조건에 맞는 기사가 없습니다.";
    empty.style.fontSize = "13px";
    empty.style.color = "#6b7280";
    container.appendChild(empty);
    return;
  }

  list.forEach(renderArticleCardInto(container));

  // 카테고리별에서만 더보기 버튼
  if (!state.search && state.category !== "종합" && totalCount > 0) {
    const btn = document.createElement("button");
    btn.className = "btn";
    if (state.viewMode === "summary") {
      btn.textContent = "더보기 (이 카테고리 전체 기사 보기)";
      btn.onclick = () => {
        state.viewMode = "full";
        renderArticles();
      };
    } else {
      btn.textContent = "요약 목록으로 돌아가기";
      btn.onclick = () => {
        state.viewMode = "summary";
        window.scrollTo({ top: 0, behavior: "smooth" });
        renderArticles();
      };
    }
    loadMoreEl.appendChild(btn);

    const info = document.createElement("div");
    info.className = "load-more-text";
    info.textContent = "카테고리별 전체 기사는 최대 20개까지 표시됩니다.";
    loadMoreEl.appendChild(info);
  }
}

function renderArticleCardInto(container) {
  return function (article) {
    const card = document.createElement("article");
    card.className = "article-card";

    const top = document.createElement("div");
    top.className = "article-top";

    const badge = document.createElement("div");
    badge.className = "badge-category";
    const dot = document.createElement("span");
    dot.className = "badge-dot";
    const catText = document.createElement("span");
    catText.textContent = article.category;
    badge.appendChild(dot);
    badge.appendChild(catText);

    const time = document.createElement("div");
    time.className = "article-time";
    const region = article.region ? ` · ${article.region}` : "";
    time.textContent = `${article.publishedAt} · ${article.source}${region}`;

    top.appendChild(badge);
    top.appendChild(time);

    const title = document.createElement("div");
    title.className = "article-title";
    title.textContent = article.title;

    const teaser = document.createElement("div");
    teaser.className = "article-sub";
    teaser.textContent = article.teaser;

    const tags = document.createElement("div");
    tags.className = "article-tags";
    (article.tags || []).forEach((tg) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = "#" + tg;
      tags.appendChild(span);
    });

    const actions = document.createElement("div");
    actions.className = "article-actions";

    const summaryBtn = document.createElement("button");
    summaryBtn.className = "btn";
    summaryBtn.textContent = state.summaryOpen.has(article.id)
      ? "요약 닫기"
      : "요약 보기";
    summaryBtn.onclick = () => {
      if (state.summaryOpen.has(article.id)) {
        state.summaryOpen.delete(article.id);
      } else {
        state.summaryOpen.add(article.id);
      }
      renderArticles();
      renderHotIssues();
    };

    const sourceBtn = document.createElement("a");
    sourceBtn.className = "btn btn-primary";
    sourceBtn.href = article.sourceUrl;
    sourceBtn.target = "_blank";
    sourceBtn.rel = "noopener noreferrer";
    sourceBtn.textContent = "원문 보기";

    actions.appendChild(summaryBtn);
    actions.appendChild(sourceBtn);

    card.appendChild(top);
    card.appendChild(title);
    card.appendChild(teaser);
    card.appendChild(tags);
    card.appendChild(actions);

    if (state.summaryOpen.has(article.id)) {
      const summaryEl = document.createElement("div");
      summaryEl.className = "summary";
      summaryEl.textContent = article.summary;
      card.appendChild(summaryEl);
    }

    container.appendChild(card);
  };
}

// ---------- 오늘의 주요 이슈 ----------
function renderHotIssues() {
  const container = document.getElementById("hotList");
  if (!ARTICLES.length) {
    container.innerHTML =
      '<div style="font-size:13px;color:#6b7280;">데이터 대기중…</div>';
    return;
  }

  const latestByCategory = {};
  ARTICLES.forEach((a) => {
    const key = a.category;
    if (!latestByCategory[key]) {
      latestByCategory[key] = a;
    } else {
      const tOld = new Date(latestByCategory[key].publishedAt).getTime();
      const tNew = new Date(a.publishedAt).getTime();
      if (tNew > tOld) latestByCategory[key] = a;
    }
  });

  let list = Object.values(latestByCategory);
  list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  list = list.slice(0, 5);

  container.innerHTML = "";
  list.forEach((a) => {
    const div = document.createElement("div");
    div.className = "hot-card";
    div.onclick = () => {
      state.category = a.category;
      state.viewMode = "summary";
      state.summaryOpen.add(a.id);
      document.getElementById("searchInput").value = "";
      state.search = "";
      applyFilters();
      renderHotIssues();
      document.getElementById("articlesTitle").scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    };

    div.innerHTML = `
        <div class="hot-tagline">${a.category}</div>
        <div class="hot-title">${a.title}</div>
        <div class="hot-meta">${a.publishedAt} · ${a.source}</div>
        <div class="hot-more">해당 카테고리로 이동</div>
      `;
    container.appendChild(div);
  });
}
