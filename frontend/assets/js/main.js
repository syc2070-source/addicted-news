// frontend/assets/js/main.js
// v2.5 - API 경로 수정 완료

var API_BASE = window.API_BASE || 'http://localhost:4000';
// N-3 배포 시 중독사회 운영 URL 주입. 빈값이면 보고서 deep link 비활성.
var ADDICTION_SOCIETY_URL = window.ADDICTION_SOCIETY_URL || '';
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

// ============================================================
// 중독백과 용어 자동 링크 (main.js 에 추가)
// - escapeHtml 된 HTML 문자열에서 각 용어 "첫 등장만" 백과 링크로 감싼다.
// - 긴 별칭 우선 매칭, <a> 중첩/태그 내부 침범 없음(테스트 완료).
// - 링크: encyclopedia.html?id=<id>
// ============================================================

var ENC_LINK_MAP = null; // { 별칭: id } 캐시

async function loadEncLinkMap() {
  if (ENC_LINK_MAP) return ENC_LINK_MAP;
  try {
    var res = await fetch(API_BASE + '/encyclopedia/link-map');
    if (!res.ok) throw new Error('link-map fetch failed');
    ENC_LINK_MAP = await res.json();
  } catch (e) {
    console.warn('용어 링크맵 로드 실패, 자동 링크 비활성:', e);
    ENC_LINK_MAP = {};
  }
  return ENC_LINK_MAP;
}

/**
 * safeHtml: 이미 escapeHtml() 된 문자열
 * map: { 별칭: id }  (없으면 ENC_LINK_MAP 사용)
 * 반환: 용어 첫 등장이 <a>로 감싸진 HTML
 */
function linkifyTerms(safeHtml, map) {
  map = map || ENC_LINK_MAP;
  if (!safeHtml || !map) return safeHtml;
  var aliases = Object.keys(map).sort(function(a, b) { return b.length - a.length; });
  if (aliases.length === 0) return safeHtml;

  var linked = {};            // 이미 링크한 별칭(첫 등장만)
  var parts = safeHtml.split(/(<[^>]+>)/g); // 홀수 인덱스=태그
  var insideAnchor = false;

  for (var i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      if (/^<a\b/i.test(parts[i])) insideAnchor = true;
      else if (/^<\/a>/i.test(parts[i])) insideAnchor = false;
      continue;
    }
    if (insideAnchor || !parts[i]) continue;

    var remaining = parts[i];
    var rebuilt = '';
    var progress = true;
    while (progress) {
      progress = false;
      var best = null;
      for (var ai = 0; ai < aliases.length; ai++) {
        var alias = aliases[ai];
        if (linked[alias]) continue;
        var idx = remaining.indexOf(alias);
        if (idx < 0) continue;
        if (
          best === null ||
          idx < best.idx ||
          (idx === best.idx && alias.length > best.alias.length)
        ) {
          best = { idx: idx, alias: alias };
        }
      }
      if (best) {
        var id = map[best.alias];
        var hit = best.alias;
        rebuilt += remaining.slice(0, best.idx);
        rebuilt +=
          '<a class="enc-term-link" href="encyclopedia.html?id=' + encodeURIComponent(id) + '" ' +
          'title="중독백과: ' + hit + '">' + hit + '</a>';
        remaining = remaining.slice(best.idx + hit.length);
        linked[best.alias] = true;
        progress = true;
      }
    }
    parts[i] = rebuilt + remaining;
  }
  return parts.join('');
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
async function initMainPage() {
  console.log('메인 페이지 초기화 시작...');
  await loadEncLinkMap();

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
    loadEncWidget();
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

// Statory ReportCard → 기획 슬롯 표시 객체
function reportToSlotItem(report) {
  var base = (typeof ADDICTION_SOCIETY_URL === 'string' ? ADDICTION_SOCIETY_URL : '').replace(/\/+$/, '');
  var link = null;
  if (base && report && report.id) {
    link = base + '/reports/' + report.id;
  }
  var summary = report.summary_ko || '';
  return {
    title: report.title_ko || '',
    summary: summary,
    teaser: summary.substring(0, 100),
    source: 'Statory 보고서',
    publishedAt: report.published_at || '',
    sourceUrl: link,
    category: report.domain || '',
    id: report.id || '',
    isReport: true,
  };
}

function parseArticlesResponse(data) {
  return Array.isArray(data) ? data : (data ? [data] : []);
}

function fetchReportSlotItems(limit) {
  return fetch(API_BASE + '/reports?limit=' + limit)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var items = data && Array.isArray(data.items) ? data.items : [];
      return items.map(reportToSlotItem);
    })
    .catch(function(e) {
      console.warn('기획 보고서(reports) 로드 실패:', e);
      return [];
    });
}

// 기획기사 로드
function loadFeatureNews() {
  var container = document.getElementById('feature-news');
  if (!container) return;

  var featuredPromise = fetch(API_BASE + '/articles/featured')
    .then(function(res) { return res.json(); })
    .then(parseArticlesResponse)
    .catch(function(e) {
      console.error('기획기사(featured) 로드 실패:', e);
      return [];
    });

  Promise.all([featuredPromise, fetchReportSlotItems(3)])
    .then(function(results) {
      var articles = results[0].slice(0, 3);
      var reports = results[1];
      var combined = articles.concat(reports);

      if (combined.length === 0) {
        container.innerHTML = '<p class="no-articles-small">등록된 기사가 없습니다.</p>';
        return;
      }

      container.innerHTML = '';
      combined.forEach(function(item, index) {
        container.innerHTML += createSidebarItem(item, index + 1);
      });
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
async function initRaphaPage() {
  await loadEncLinkMap();
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
async function initFeaturePage() {
  await loadEncLinkMap();
  var featuredPromise = fetch(API_BASE + '/articles/featured?limit=20')
    .then(function(res) { return res.json(); })
    .then(parseArticlesResponse)
    .catch(function(e) {
      console.error('기획기사(featured) 페이지 로드 실패:', e);
      return [];
    });

  Promise.all([featuredPromise, fetchReportSlotItems(20)])
    .then(function(results) {
      var container = document.getElementById('feature-articles');
      if (!container) return;

      var combined = results[0].concat(results[1]);

      if (combined.length === 0) {
        container.innerHTML = '<p class="no-articles">기획기사가 없습니다.</p>';
        return;
      }

      container.innerHTML = '';
      combined.forEach(function(item) {
        container.innerHTML += createFullArticleCard(item);
      });
      addArticleEventListeners(container);
    });
}

// 카테고리 페이지
async function initCategoryPage() {
  await loadEncLinkMap();
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
  var titleHtml = article.sourceUrl
    ? '<a href="' + article.sourceUrl + '" target="_blank" class="sidebar-item-title">' + escapeHtml(article.title) + '</a>'
    : '<span class="sidebar-item-title">' + escapeHtml(article.title) + '</span>';
  return '<div class="sidebar-item">' +
    '<span class="sidebar-rank">' + rank + '</span>' +
    '<div class="sidebar-item-content">' +
      titleHtml +
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
  // 본문(요약 전문) 표시 영역만 용어 링크. data-* 는 평문 유지.
  var teaserHtml = linkifyTerms(escapeHtml(teaser));
  
  return '<div class="article-card" data-id="' + article.id + '">' +
    imageHtml +
    '<div class="article-body">' +
      '<a href="' + (article.sourceUrl || '#') + '" target="_blank" class="article-title">' + escapeHtml(article.title) + '</a>' +
      '<p class="article-meta">' + formatDate(article.publishedAt) + ' · ' + (article.source || '') + '</p>' +
      '<div class="article-summary" data-full="' + escapeHtml(summary) + '" data-teaser="' + escapeHtml(teaser) + '" data-collapsed="true">' +
        '<p>' + teaserHtml + '</p>' +
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
  var titleHtml = article.sourceUrl
    ? '<a href="' + article.sourceUrl + '" target="_blank" class="full-article-title">' + escapeHtml(article.title) + '</a>'
    : '<span class="full-article-title">' + escapeHtml(article.title) + '</span>';
  var sourceBtnHtml = article.sourceUrl
    ? '<a href="' + article.sourceUrl + '" target="_blank" class="btn-source">' + (article.isReport ? '보고서 보기' : '원문 보기') + '</a>'
    : (article.isReport ? '<span class="btn-source">보고서 준비 중</span>' : '<a href="#" class="btn-source">원문 보기</a>');
  var teaserHtml = linkifyTerms(escapeHtml(teaser));
  
  return '<div class="full-article-card" data-id="' + (article.id || '') + '">' +
    imageHtml +
    '<div class="full-article-body">' +
      titleHtml +
      '<p class="full-article-meta">' + formatDate(article.publishedAt) + ' · ' + (article.source || '') + ' · ' + (article.category || '') + '</p>' +
      '<div class="full-article-summary" data-full="' + escapeHtml(summary) + '" data-teaser="' + escapeHtml(teaser) + '" data-collapsed="true">' +
        '<p>' + teaserHtml + '</p>' +
      '</div>' +
      '<div class="article-actions">' +
        '<button class="btn-toggle">요약 보기</button>' +
        sourceBtnHtml +
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
        summaryDiv.innerHTML = '<p>' + linkifyTerms(escapeHtml(fullSummary)) + '</p>';
        summaryDiv.dataset.collapsed = 'false';
        this.textContent = '요약 닫기';
      } else {
        var teaser = summaryDiv.dataset.teaser;
        summaryDiv.innerHTML = '<p>' + linkifyTerms(escapeHtml(teaser)) + '</p>';
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

// 오늘의 중독백과 위젯 (메인 우측)
async function loadEncWidget() {
  const el = document.getElementById('enc-widget');
  if (!el) return;
  try {
    const res = await fetch(API_BASE + '/encyclopedia');
    const items = await res.json();
    if (!items || !items.length) return;
    // 최근 조류(trend) 항목 우선, 없으면 전체에서 무작위
    const pool = items.filter(function(x) { return x.trend; });
    const list = pool.length ? pool : items;
    const t = list[Math.floor(Math.random() * list.length)];
    el.innerHTML =
      '<a href="encyclopedia.html?id=' + encodeURIComponent(t.id) + '" style="text-decoration:none;color:inherit;display:block">' +
        '<div style="font-weight:700;font-size:16px;margin-bottom:4px">' + escapeHtml(t.termKo) + '</div>' +
        '<div style="font-size:12px;color:#888;margin-bottom:6px">' + escapeHtml(t.termEn) + '</div>' +
        '<div style="font-size:13px;color:#444;line-height:1.5">' + escapeHtml((t.definition || '').slice(0, 70)) + '…</div>' +
        '<div style="margin-top:8px;font-size:12px;color:#c0392b">중독백과에서 더 보기 →</div>' +
      '</a>';
  } catch (e) {
    console.error('Enc widget error', e);
    el.textContent = '불러오기 실패';
  }
}