// frontend/assets/js/main.js
// v2.5 - API 경로 수정 완료

var API_BASE = 'http://localhost:4000';
var ARTICLES_PER_CATEGORY = 5;

// 카테고리 API는 영문 슬러그만 사용 (한글·중점·공백 URL 경로 오류 방지, backend CATEGORY_MAP과 동일)
var CATEGORY_SLUG_BY_NAME = {
  '중독정책': 'policy',
  '알코올·약물중독': 'alcohol',
  '도박중독': 'gambling',
  '게임·디지털중독': 'game',
  '중독사회와 회복': 'issue',
};
var CATEGORY_NAME_BY_SLUG = {
  policy: '중독정책',
  alcohol: '알코올·약물중독',
  gambling: '도박중독',
  game: '게임·디지털중독',
  issue: '중독사회와 회복',
};

function categoryApiSlug(displayOrSlug) {
  if (CATEGORY_NAME_BY_SLUG[displayOrSlug]) return displayOrSlug;
  return CATEGORY_SLUG_BY_NAME[displayOrSlug] || displayOrSlug;
}

function categoryDisplayName(displayOrSlug) {
  if (CATEGORY_NAME_BY_SLUG[displayOrSlug]) return CATEGORY_NAME_BY_SLUG[displayOrSlug];
  return displayOrSlug;
}

// 초기화
document.addEventListener('DOMContentLoaded', function() {
  var path = window.location.pathname;
  
  if (path.includes('category.html')) {
    initCategoryPage();
  } else if (path.includes('rapha.html')) {
    initRaphaPage();
  } else if (path.includes('feature.html')) {
    initFeaturePage();
  } else {
    initMainPage();
  }
});

// 메인 페이지 - 순차 로드 (안정성 우선)
function initMainPage() {
  console.log('메인 페이지 초기화 시작...');
  
  // 약간의 지연 후 로드 (DOM 완전 로드 보장)
  setTimeout(function() {
    loadTopNews();
    loadRaphaNews();
    loadFeatureNews();
    loadSidebarNews();
    loadCategoryArticles('중독정책', 'cat-policy');
    loadCategoryArticles('알코올·약물중독', 'cat-alcohol');
    loadCategoryArticles('도박중독', 'cat-gambling');
    loadCategoryArticles('게임·디지털중독', 'cat-digital');
    loadCategoryArticles('중독사회와 회복', 'cat-issue');
    console.log('메인 페이지 로드 요청 완료');
  }, 100);
}

// 라파뉴스 로드
function loadRaphaNews() {
  var container = document.getElementById('rapha-news');
  if (!container) return;
  
  fetch(API_BASE + '/articles/rapha')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var articles = Array.isArray(data) ? data : (data ? [data] : []);
      
      if (articles.length === 0) {
        container.innerHTML = '<p class="no-articles-small">등록된 기사가 없습니다.</p>';
        return;
      }
      
      container.innerHTML = '';
      articles.slice(0, 2).forEach(function(article, index) {
        container.innerHTML += createSidebarItem(article, index + 1);
      });
    })
    .catch(function(e) {
      console.error('라파뉴스 로드 실패:', e);
      container.innerHTML = '<p class="no-articles-small">불러올 수 없습니다.</p>';
    });
}

// 기획기사 로드
function loadFeatureNews() {
  var container = document.getElementById('feature-news');
  if (!container) return;
  
  fetch(API_BASE + '/articles/featured')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var articles = Array.isArray(data) ? data : (data ? [data] : []);
      
      if (articles.length === 0) {
        container.innerHTML = '<p class="no-articles-small">등록된 기사가 없습니다.</p>';
        return;
      }
      
      container.innerHTML = '';
      articles.slice(0, 3).forEach(function(article, index) {
        container.innerHTML += createSidebarItem(article, index + 1);
      });
    })
    .catch(function(e) {
      console.error('기획기사 로드 실패:', e);
      container.innerHTML = '<p class="no-articles-small">불러올 수 없습니다.</p>';
    });
}

// TOP 뉴스 로드
function loadTopNews() {
  var container = document.getElementById('top-news');
  if (!container) return;
  
  fetch(API_BASE + '/articles/top')
    .then(function(res) { 
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json(); 
    })
    .then(function(data) {
      var articles = Array.isArray(data) ? data : (data ? [data] : []);
      
      if (articles.length === 0) {
        // TOP 뉴스 없으면 최신 기사로 fallback
        return fetch(API_BASE + '/articles/latest?limit=3')
          .then(function(res) { return res.json(); })
          .then(function(latestArticles) {
            var latest = Array.isArray(latestArticles) ? latestArticles : [];
            renderTopNews(container, latest);
          });
      }
      
      renderTopNews(container, articles);
    })
    .catch(function(e) {
      console.error('TOP 뉴스 로드 실패:', e);
      // 에러 시에도 최신 기사로 fallback 시도
      fetch(API_BASE + '/articles/latest?limit=3')
        .then(function(res) { return res.json(); })
        .then(function(latestArticles) {
          var latest = Array.isArray(latestArticles) ? latestArticles : [];
          if (latest.length > 0) {
            renderTopNews(container, latest);
          } else {
            container.innerHTML = '<p class="no-articles">TOP 뉴스를 불러올 수 없습니다.</p>';
          }
        })
        .catch(function() {
          container.innerHTML = '<p class="no-articles">TOP 뉴스를 불러올 수 없습니다.</p>';
        });
    });
}

function renderTopNews(container, data) {
  var articles = Array.isArray(data) ? data : (data ? [data] : []);
  
  if (articles.length === 0) {
    container.innerHTML = '<p class="no-articles">뉴스가 없습니다.</p>';
    return;
  }
  
  container.innerHTML = '';
  articles.slice(0, 3).forEach(function(article, index) {
    container.innerHTML += createTopNewsCard(article, index === 0);
  });
}

// 카테고리별 기사 로드
function loadCategoryArticles(category, containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  
  var slug = categoryApiSlug(category);
  fetch(API_BASE + '/articles/category/' + slug + '?limit=' + ARTICLES_PER_CATEGORY)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var articles = Array.isArray(data) ? data : (data ? [data] : []);
      
      if (articles.length === 0) {
        container.innerHTML = '<p class="no-articles">기사가 없습니다.</p>';
        return;
      }
      
      container.innerHTML = '';
      articles.forEach(function(article) {
        container.innerHTML += createArticleCard(article);
      });
      addArticleEventListeners(container);
    })
    .catch(function(e) {
      console.error(category + ' 기사 로드 실패:', e);
      container.innerHTML = '<p class="no-articles">기사를 불러올 수 없습니다.</p>';
    });
}

// 사이드바 뉴스 로드 (중독이슈)
function loadSidebarNews() {
  var container = document.getElementById('sidebar-news');
  if (!container) return;
  
  fetch(API_BASE + '/articles/issue?limit=5')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var articles = Array.isArray(data) ? data : (data ? [data] : []);
      
      // 비어있으면 최신 기사로 fallback
      if (articles.length === 0) {
        return fetch(API_BASE + '/articles/latest?limit=5')
          .then(function(res) { return res.json(); })
          .then(function(latestArticles) {
            var latest = Array.isArray(latestArticles) ? latestArticles : [];
            renderSidebarNews(container, latest);
          });
      }
      
      renderSidebarNews(container, articles);
    })
    .catch(function(e) {
      console.error('사이드바 뉴스 로드 실패:', e);
      // 에러 시 최신 기사로 fallback
      fetch(API_BASE + '/articles/latest?limit=5')
        .then(function(res) { return res.json(); })
        .then(function(latestArticles) {
          var latest = Array.isArray(latestArticles) ? latestArticles : [];
          renderSidebarNews(container, latest);
        })
        .catch(function() {
          container.innerHTML = '';
        });
    });
}

function renderSidebarNews(container, data) {
  var articles = Array.isArray(data) ? data : (data ? [data] : []);
  if (articles.length === 0) return;
  
  container.innerHTML = '';
  articles.forEach(function(article, index) {
    container.innerHTML += createSidebarItem(article, index + 1);
  });
}

// 라파뉴스 페이지
function initRaphaPage() {
  fetch(API_BASE + '/articles/rapha?limit=20')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var container = document.getElementById('rapha-articles');
      if (!container) return;
      
      var articles = Array.isArray(data) ? data : (data ? [data] : []);
      
      if (articles.length === 0) {
        container.innerHTML = '<p class="no-articles">라파뉴스가 없습니다.</p>';
        return;
      }
      
      container.innerHTML = '';
      articles.forEach(function(article) {
        container.innerHTML += createFullArticleCard(article);
      });
      addArticleEventListeners(container);
    })
    .catch(function(e) { console.error('라파뉴스 페이지 로드 실패:', e); });
}

// 기획기사 페이지
function initFeaturePage() {
  fetch(API_BASE + '/articles/featured?limit=20')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var container = document.getElementById('feature-articles');
      if (!container) return;
      
      var articles = Array.isArray(data) ? data : (data ? [data] : []);
      
      if (articles.length === 0) {
        container.innerHTML = '<p class="no-articles">기획기사가 없습니다.</p>';
        return;
      }
      
      container.innerHTML = '';
      articles.forEach(function(article) {
        container.innerHTML += createFullArticleCard(article);
      });
      addArticleEventListeners(container);
    })
    .catch(function(e) { console.error('기획기사 페이지 로드 실패:', e); });
}

// 카테고리 페이지
function initCategoryPage() {
  var urlParams = new URLSearchParams(window.location.search);
  var raw = urlParams.get('cat') || 'policy';
  var displayCategory = categoryDisplayName(raw);
  var apiSlug = categoryApiSlug(raw);

  var titleEl = document.getElementById('category-title');
  if (titleEl) titleEl.textContent = displayCategory;
  document.title = displayCategory + ' - 중독뉴스';

  fetch(API_BASE + '/articles/category/' + apiSlug + '?limit=30')
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var container = document.getElementById('category-articles');
      if (!container) return;
      
      var articles = Array.isArray(data) ? data : (data ? [data] : []);
      
      if (articles.length === 0) {
        container.innerHTML = '<p class="no-articles">해당 카테고리에 기사가 없습니다.</p>';
        return;
      }
      
      container.innerHTML = '';
      articles.forEach(function(article) {
        container.innerHTML += createFullArticleCard(article);
      });
      addArticleEventListeners(container);
    })
    .catch(function(e) { console.error('카테고리 기사 로드 실패:', e); });
}

// ========================================
// UI 컴포넌트
// ========================================

// 사이드바 아이템
function createSidebarItem(article, rank) {
  return '<div class="sidebar-item">' +
    '<span class="sidebar-rank">' + rank + '</span>' +
    '<div class="sidebar-item-content">' +
      '<a href="' + (article.sourceUrl || '#') + '" target="_blank" class="sidebar-item-title">' + escapeHtml(article.title) + '</a>' +
      '<p class="sidebar-item-meta">' + (article.source || '') + ' · ' + formatDate(article.publishedAt) + '</p>' +
    '</div>' +
  '</div>';
}

// TOP 뉴스 카드 (1:3 비율 - 이미지:내용)
function createTopNewsCard(article, isMain) {
  var imageHtml = article.imageUrl 
    ? '<div class="top-news-image-wrap"><img src="' + article.imageUrl + '" alt="" class="top-news-image" onerror="this.parentElement.style.display=\'none\'"></div>'
    : '';
  
  var summary = article.summary || article.teaser || '';
  var maxLength = 350;
  var displaySummary = summary.length > maxLength ? summary.substring(0, maxLength) + '...' : summary;
  
  return '<div class="top-news-card ' + (isMain ? 'main' : '') + '">' +
    imageHtml +
    '<div class="top-news-content">' +
      '<a href="' + (article.sourceUrl || '#') + '" target="_blank" class="top-news-title">' + escapeHtml(article.title) + '</a>' +
      '<p class="top-news-meta">' + formatDate(article.publishedAt) + ' · ' + (article.source || '') + '</p>' +
      '<p class="top-news-summary">' + escapeHtml(displaySummary) + '</p>' +
      '<a href="' + (article.sourceUrl || '#') + '" target="_blank" class="top-news-more">본문가기 →</a>' +
    '</div>' +
  '</div>';
}

// 일반 기사 카드
function createArticleCard(article) {
  var imageHtml = article.imageUrl 
    ? '<div class="article-thumb"><img src="' + article.imageUrl + '" alt="" onerror="this.parentElement.style.display=\'none\'"></div>'
    : '';
  
  var summary = article.summary || '';
  var teaser = article.teaser || summary.substring(0, 100);
  
  return '<div class="article-card" data-id="' + article.id + '">' +
    imageHtml +
    '<div class="article-body">' +
      '<a href="' + (article.sourceUrl || '#') + '" target="_blank" class="article-title">' + escapeHtml(article.title) + '</a>' +
      '<p class="article-meta">' + formatDate(article.publishedAt) + ' · ' + (article.source || '') + '</p>' +
      '<div class="article-summary" data-full="' + escapeHtml(summary) + '" data-teaser="' + escapeHtml(teaser) + '" data-collapsed="true">' +
        '<p>' + escapeHtml(teaser) + '</p>' +
      '</div>' +
      '<div class="article-actions">' +
        '<button class="btn-toggle">요약 보기</button>' +
        '<a href="' + (article.sourceUrl || '#') + '" target="_blank" class="btn-source">원문</a>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// 전체 기사 카드
function createFullArticleCard(article) {
  var imageHtml = article.imageUrl 
    ? '<div class="full-article-image"><img src="' + article.imageUrl + '" alt="" onerror="this.parentElement.style.display=\'none\'"></div>'
    : '';
  
  var summary = article.summary || '';
  var teaser = article.teaser || summary.substring(0, 100);
  
  return '<div class="full-article-card" data-id="' + article.id + '">' +
    imageHtml +
    '<div class="full-article-body">' +
      '<a href="' + (article.sourceUrl || '#') + '" target="_blank" class="full-article-title">' + escapeHtml(article.title) + '</a>' +
      '<p class="full-article-meta">' + formatDate(article.publishedAt) + ' · ' + (article.source || '') + ' · ' + (article.category || '') + '</p>' +
      '<div class="full-article-summary" data-full="' + escapeHtml(summary) + '" data-teaser="' + escapeHtml(teaser) + '" data-collapsed="true">' +
        '<p>' + escapeHtml(teaser) + '</p>' +
      '</div>' +
      '<div class="article-actions">' +
        '<button class="btn-toggle">요약 보기</button>' +
        '<a href="' + (article.sourceUrl || '#') + '" target="_blank" class="btn-source">원문 보기</a>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// 요약 토글 이벤트
function addArticleEventListeners(container) {
  var buttons = container.querySelectorAll('.btn-toggle');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      var card = this.closest('.article-card, .full-article-card');
      var summaryDiv = card.querySelector('.article-summary, .full-article-summary');
      var isCollapsed = summaryDiv.dataset.collapsed === 'true';
      
      if (isCollapsed) {
        var fullSummary = summaryDiv.dataset.full;
        summaryDiv.innerHTML = '<p>' + escapeHtml(fullSummary) + '</p>';
        summaryDiv.dataset.collapsed = 'false';
        this.textContent = '요약 닫기';
      } else {
        var teaser = summaryDiv.dataset.teaser;
        summaryDiv.innerHTML = '<p>' + escapeHtml(teaser) + '</p>';
        summaryDiv.dataset.collapsed = 'true';
        this.textContent = '요약 보기';
      }
    });
  }
}

// ========================================
// 유틸리티
// ========================================

function escapeHtml(text) {
  if (!text) return '';
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.split('T')[0];
}