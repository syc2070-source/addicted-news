// NEWS-Q23 ■2 · Q24 ■3 · 대문 한 벌: 운영 / (body data-home="live" = B · 글 /messages/ko.json · 바닥글은 index.html) ·
// 미리보기 /preview/home(A = 기본 · B = ?v=b · 글 /messages/preview/ko.json). 자료 = 공개 API(읽기만).
// 구간 순서: TOP → 오늘 들어온 소식 → 중독이슈 → 방송(실림만) → 세계 → 오늘의 중독백과(운영만) → 연대기 → 바닥.
// 운영 수·로그(수집 소스 수 · 차단 · 수동 확인)는 읽지도 싣지도 않는다.
(function () {
  'use strict';
  var API = window.API_BASE;
  var SOCIETY = 'https://www.addictionsociety.net';
  var LIVE = document.body.getAttribute('data-home') === 'live';
  var planB = LIVE || new URLSearchParams(window.location.search).get('v') === 'b';
  var app = document.getElementById('app');
  var M = {};

  // 유형 판정(규칙만 · 제목에서 가장 많이 나온 유형 · 제목에 없으면 요약에서 · 같으면 아래 차례). 색만으로 가르지 않게 이름이 언제나 옆에 붙는다.
  var TYPE_RULES = [
    ['gambling', /도박|카지노|바카라|토토|사행|베팅|경마|gambl|casino|betting/gi],
    ['drug', /마약|약물|펜타닐|대마|필로폰|투약|오피오이드|위해\s?감소|해악\s?감소|drug|opioid|fentanyl|cannabis|overdose/gi],
    ['tobacco', /담배|흡연|금연|니코틴|베이프|노담|tobacco|nicotine|vap(e|ing)|smok/gi],
    ['alcohol', /알코올|음주|절주|단주|주류|alcohol|drink/gi],
    ['game', /게임|gaming/gi],
    ['smartphone', /스마트폰|디지털|인터넷\s?중독|도파민|스크롤|숏폼|과의존|과몰입|(^|[\s'"])폰(?=[은는이가을를과에의\s])|SNS|smartphone|social media/gi],
  ];

  function typeOf(a) {
    var fields = [a.title || '', a.summary || ''];
    for (var f = 0; f < fields.length; f++) {
      var best = 'none', bestN = 0;
      for (var i = 0; i < TYPE_RULES.length; i++) {
        var n = (fields[f].match(TYPE_RULES[i][1]) || []).length;
        if (n > bestN) { best = TYPE_RULES[i][0]; bestN = n; }
      }
      if (bestN) return best;
    }
    return 'none';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function href(u) {
    var s = String(u || '');
    return /^https?:\/\//i.test(s) ? esc(s) : '#';
  }
  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (_m, k) { return vars[k]; });
  }
  // 제목 꼬리 「 - 매체」 떼기(매체는 따로 보임 · 두 번 붙은 것까지)
  function cleanTitle(t) {
    var s = String(t || '');
    for (var n = 0; n < 2; n++) {
      var i = s.lastIndexOf(' - ');
      if (i > 0 && s.length - i - 3 <= 30) s = s.slice(0, i);
    }
    return s;
  }
  function ymd(a) {
    return String(a.publishedAt || '').slice(0, 10);
  }
  function kstDay(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? '' : new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function monthDay(day) {
    return Number(day.slice(5, 7)) + '월 ' + Number(day.slice(8, 10)) + '일';
  }
  function json(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function api(path) {
    return json(API + path).catch(function (e) {
      console.warn('대문 자료 실패', path, e);
      return null;
    });
  }
  function typeTag(a) {
    var t = typeOf(a);
    return '<span class="type"><span class="dot ' + t + '"></span>' + esc(M.types[t]) + '</span>';
  }
  function metaLine(a) {
    return '<p class="meta">' + typeTag(a) + '<span>' + esc(a.source || '') + '</span><span>' + esc(ymd(a)) + '</span></p>';
  }
  function img(src) {
    return /^https?:\/\//i.test(String(src || '')) ? '<img src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '';
  }

  function section(tone, kicker, title, desc, body) {
    return '<section class="section ' + tone + '">' +
      '<div class="sectionHead"><div class="inner">' +
        '<p class="kicker">' + esc(kicker) + '</p>' +
        '<h2 class="title">' + esc(title) + '</h2>' +
        (desc ? '<p class="desc">' + esc(desc) + '</p>' : '') +
      '</div></div>' +
      '<div class="sectionBody"><div class="inner body">' + body + '</div></div>' +
    '</section>';
  }

  function sameBlock(a) {
    var members = a.clusterMembers || [];
    var n = a.clusterSize || 1;
    if (n < 2 || !members.length) return '';
    return '<details class="same"><summary>' + esc(fill(M.top.cluster, { n: n })) + '</summary><ul>' +
      members.map(function (m) {
        return '<li><a href="' + href(m.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(cleanTitle(m.title)) + '</a> · ' + esc(m.source || '') + '</li>';
      }).join('') + '</ul></details>';
  }

  function topSection(top) {
    if (!top || !top.length) return section('', M.top.kicker, M.top.title, '', '<p class="empty">' + esc(top ? M.empty : M.failed) + '</p>');
    var first = top[0];
    var win = first.topWindow === '7d' ? M.top.window7d : M.top.window72h;
    var card = '<article class="topCard">' +
      '<div class="topImage">' + img(first.imageUrl) + '</div>' +
      '<div class="topText">' + metaLine(first) +
        '<h3 class="topTitle"><a href="' + href(first.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(cleanTitle(first.title)) + '</a></h3>' +
        '<p class="summary3">' + esc(first.summary || first.teaser || '') + '</p>' +
        sameBlock(first) +
      '</div></article>';
    var minis = top.slice(1, 3).map(function (a, i) {
      return '<div class="mini"><span class="miniRank">' + (i + 2) + '</span>' +
        '<a class="miniTitle" href="' + href(a.sourceUrl) + '" target="_blank" rel="noopener noreferrer" title="' + esc(cleanTitle(a.title)) + '">' + esc(cleanTitle(a.title)) + '</a>' +
        metaLine(a) + '</div>';
    }).join('');
    return section('', M.top.kicker + ' · ' + win, M.top.title, '', card + '<div class="topMinis">' + minis + '</div>');
  }

  // 큰 수 = 전용 수 API(NEWS-Q24 ■3 · 목록 앞 100행 한계 없음). 날 = 가장 늦은 수집 날(KST) — 정오 앞이면 어제 수이고 날짜가 그대로 보인다.
  function todaySection(counts) {
    if (!counts || !counts.day) return section('toneUp', M.today.titleToday, M.today.titleToday, '', '<p class="empty">' + esc(counts ? M.empty : M.failed) + '</p>');
    var day = counts.day;
    var isToday = day === kstDay(new Date().toISOString());
    var tile = function (label, n, note) {
      return '<div class="tile"><p class="tileLabel">' + esc(label) + '</p>' +
        '<p class="tileNumber">' + n + '<span class="tileUnit">' + esc(M.today.unit) + '</span></p>' +
        '<p class="tileNote">' + esc(note) + '</p></div>';
    };
    return section('toneUp', fill(M.today.kicker, { date: monthDay(day) }),
      isToday ? M.today.titleToday : fill(M.today.title, { date: monthDay(day) }), M.today.desc,
      '<div class="tiles">' +
        tile(M.today.articles, Number(counts.articles) || 0, M.today.articlesNote) +
        tile(M.today.broadcasts, Number(counts.broadcasts) || 0, fill(M.today.broadcastsNote, { n: Number(counts.broadcastsTotal) || 0 })) +
        tile(M.today.world, Number(counts.world) || 0, M.today.worldNote) +
      '</div>');
  }

  function rowsHtml(list) {
    return '<div class="rows">' + list.map(function (a) {
      return '<article class="row"><a class="rowTitle" href="' + href(a.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(cleanTitle(a.title)) + '</a>' +
        (a.summary ? '<p class="rowSummary">' + esc(a.summary) + '</p>' : '') + metaLine(a) + '</article>';
    }).join('') + '</div>';
  }

  function issueSection(issue, top) {
    var seen = {};
    (top || []).forEach(function (a) { seen[a.id] = 1; });
    // TOP 에 보인 것 · 세계 구간 몫(해외 보도)은 뺌 — 한 화면에 같은 기사 두 번 0
    var list = (issue || []).filter(function (a) { return !seen[a.id] && !a.isForeign; }).slice(0, 6);
    var body = list.length ? rowsHtml(list) : '<p class="empty">' + esc(issue ? M.empty : M.failed) + '</p>';
    return section('', M.issue.kicker, M.issue.title, M.issue.desc,
      body + '<p class="more"><a class="link" href="/category.html?cat=' + encodeURIComponent('중독정책') + '">' + esc(M.issue.more) + '</a></p>');
  }

  function byAired(broadcasts) {
    return ((broadcasts && broadcasts.items) || []).slice().sort(function (a, b) { return ymd(b).localeCompare(ymd(a)); });
  }

  function broadcastSection(broadcasts) {
    var list = byAired(broadcasts).slice(0, 6);
    var body = list.length ? '<div class="cards">' + list.map(function (a) {
      return '<article class="card"><div class="cardImage">' + img(a.imageUrl) + '</div><div class="cardText">' +
        '<a class="cardTitle" href="' + href(a.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(a.title) + '</a>' +
        metaLine(a) + '</div></article>';
    }).join('') + '</div>' : '<p class="empty">' + esc(broadcasts ? M.empty : M.failed) + '</p>';
    return section('toneDown', M.broadcast.kicker, M.broadcast.title, M.broadcast.desc, body);
  }

  function worldSection(grouped) {
    var list = ((grouped && grouped.items) || []).filter(function (a) { return a.isForeign; }).slice(0, 6);
    var body = list.length ? rowsHtml(list) : '<p class="empty">' + esc(grouped ? M.empty : M.failed) + '</p>';
    return section('', M.world.kicker, M.world.title, M.world.desc, body);
  }

  // 오늘의 중독백과(Q24 판 2): 옛 대문과 같은 길 · 같은 후보(최근 조류 우선, 없으면 전체). 「오늘의」이므로 새로 열어도 하루 한 항목(KST 날 번호로 고름).
  function encPick(items) {
    var pool = items.filter(function (x) { return x.trend; });
    var list = pool.length ? pool : items;
    var dayNo = Math.floor(Date.parse(kstDay(new Date().toISOString())) / 86400000);
    return list[dayNo % list.length];
  }

  function encyclopediaSection(items) {
    var t = items && items.length ? encPick(items) : null;
    var body = t
      ? '<article class="encCard"><h3 class="encTerm"><a href="/encyclopedia.html?id=' + encodeURIComponent(t.id) + '">' + esc(t.termKo) + '</a></h3>' +
        '<p class="encEn">' + esc(t.termEn) + '</p><p class="summary3">' + esc(t.definition) + '</p></article>' +
        '<p class="more"><a class="link" href="/encyclopedia.html?id=' + encodeURIComponent(t.id) + '">' + esc(M.enc.more) + '</a></p>'
      : '<p class="empty">' + esc(items ? M.empty : M.failed) + '</p>';
    return section('toneDown', M.enc.kicker, M.enc.title, '', body);
  }

  // 연대기: 방송 구간에 보인 6 편 뒤를 원 방송일 차례로(겹침 0)
  function chronicleSection(broadcasts) {
    var list = byAired(broadcasts).slice(6, 14);
    var body = list.length ? '<ul>' + list.map(function (a) {
      var t = typeOf(a);
      return '<li class="event"><span class="eventDate">' + esc(ymd(a)) + '</span><span class="dot ' + t + '"></span>' +
        '<div class="eventBody"><a href="' + href(a.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(a.title) + '</a>' +
        '<p class="meta"><span>' + esc(M.types[t]) + '</span><span>' + esc(a.source || '') + '</span></p></div></li>';
    }).join('') + '</ul>' : '<p class="empty">' + esc(broadcasts ? M.empty : M.failed) + '</p>';
    return section('toneUp', M.chronicle.kicker, M.chronicle.title, M.chronicle.desc,
      body + '<p class="more"><a class="link" href="' + SOCIETY + '/timeline" target="_blank" rel="noopener noreferrer">' + esc(M.chronicle.more) + '</a></p>');
  }

  function headHtml() {
    var n = M.nav;
    var cat = function (name, label) {
      return '<a href="/category.html?cat=' + encodeURIComponent(name) + '">' + esc(label) + '</a>';
    };
    var band = LIVE ? '' : '<div class="band"><span>' + esc(M.band.label) + '</span>' +
        '<a href="/preview/home"' + (planB ? '' : ' aria-current="true"') + '>' + esc(M.band.a) + '</a>' +
        '<a href="/preview/home?v=b"' + (planB ? ' aria-current="true"' : '') + '>' + esc(M.band.b) + '</a></div>';
    var brandHref = LIVE ? '/' : '/preview/home' + (planB ? '?v=b' : '');
    return band +
      '<header class="head"><div class="headInner">' +
        '<a class="brand" href="' + brandHref + '"><span class="brandKo">' + esc(M.brand) + '</span><span class="brandEn">' + esc(M.brandEn) + '</span></a>' +
        '<nav class="nav"><a href="/" aria-current="page">' + esc(n.home) + '</a>' +
          cat('중독정책', n.policy) + cat('알코올·약물중독', n.alcohol) + cat('도박중독', n.gambling) +
          cat('게임·디지털중독', n.game) + cat('중독사회와 회복', n.issue) +
          (n.rapha ? '<a href="/rapha.html">' + esc(n.rapha) + '</a>' : '') +
          (n.feature ? '<a href="/feature.html">' + esc(n.feature) + '</a>' : '') +
          '<a href="/encyclopedia.html">' + esc(n.encyclopedia) + '</a><a href="/reports.html">' + esc(n.reports) + '</a>' +
          (n.about ? '<a href="/about.html">' + esc(n.about) + '</a>' : '') +
          '<a class="out" href="' + SOCIETY + '" target="_blank" rel="noopener noreferrer">' + esc(n.society) + '</a></nav>' +
      '</div></header>';
  }

  function bottomHtml(version) {
    if (LIVE) return ''; // 운영 바닥글은 index.html + footer.js
    var b = M.bottom;
    var publisher = (window.SITE_PUBLISHER && window.SITE_PUBLISHER.ko) || '';
    var commit = version && /^[0-9a-f]{7,40}$/.test(String(version.commit || '')) ? String(version.commit).slice(0, 7) : '';
    return '<footer class="bottom"><div class="bottomInner">' +
        '<p>' + esc(publisher) + ' · ' + esc(b.address) + '</p>' +
        '<p>' + esc(b.together) + ' <a href="' + SOCIETY + '" target="_blank" rel="noopener noreferrer">' + esc(b.society) + '</a> · ' +
          '<a href="https://statory.org" target="_blank" rel="noopener noreferrer">' + esc(b.statory) + '</a> · ' +
          '<a href="https://www.raphacom.net" target="_blank" rel="noopener noreferrer">' + esc(b.rapha) + '</a></p>' +
      '</div><div class="bottomInner bottomSmall">' +
        '<p>' + esc(b.copyright) + '</p>' +
        '<p>' + (commit ? esc(fill(b.build, { commit: commit })) + ' · ' : '') + '<a href="/admin.html" rel="nofollow">' + esc(b.admin) + '</a></p>' +
      '</div></footer>';
  }

  var encLoad = null;
  json(LIVE ? '/messages/ko.json' : '/messages/preview/ko.json').then(function (messages) {
    M = messages;
    document.title = M.pageTitle;
    if (planB) app.classList.add('planB');
    app.innerHTML = headHtml();
    // 백과 응답은 큼(900KB 남짓 · 옛 대문과 같은 길) — 다른 구간을 기다리게 하지 않고 따로 채운다. 글이 없는 미리보기는 부르지 않음.
    encLoad = M.enc ? api('/encyclopedia') : null;
    return Promise.all([
      api('/articles/top'),
      api('/articles/today-counts'),
      api('/articles/latest-paged?kind=broadcast&limit=100&page=1&group=none'),
      api('/articles/issue?limit=12'),
      api('/articles/latest-paged?limit=60&page=1'),
      LIVE ? null : json('/version.json').catch(function () { return null; }),
    ]);
  }).then(function (r) {
    var top = r[0], counts = r[1], casts = r[2], issue = r[3], grouped = r[4], version = r[5];
    app.innerHTML = headHtml() + '<main>' +
      topSection(top) + todaySection(counts) + issueSection(issue, top) +
      broadcastSection(casts) + worldSection(grouped) + (M.enc ? '<div id="encSlot"></div>' : '') + chronicleSection(casts) +
      '</main>' + bottomHtml(version);
    app.setAttribute('data-ready', '1');
    if (encLoad) {
      encLoad.then(function (items) {
        document.getElementById('encSlot').outerHTML = encyclopediaSection(items);
      });
    }
    // 그림이 깨지면 빈 파랑 칸으로(외부 그림 · 대체 글 없음)
    var imgs = app.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].addEventListener('error', function () { this.remove(); });
    }
  }).catch(function (e) {
    // 글 파일을 못 읽었거나 그리다 깨짐 — 빈 화면 대신 한 줄(글 파일이 없으면 영어 한 줄)
    console.error('대문 실패', e);
    app.insertAdjacentHTML('beforeend', '<p class="empty" style="padding:24px">' + esc(M.failed || 'Failed to load.') + '</p>');
  });
})();
