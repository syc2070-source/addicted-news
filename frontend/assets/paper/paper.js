// NEWS-Q25 ■1 · ■2 · ■3 — 신문 대문 미리보기(/preview/paper). 운영 대문(/ · assets/home)은 건드리지 않는다.
// 모양(결정 11): 머리기사 하나 + 버금 넷 | 오른쪽 좁은 단(오늘 들어온 기사 · 오늘의 중독백과) → 분야 단 넷 → 중독이슈 → 해외 → 중독을 다룬 방송.
// 자료 = 공개 API GET 만 · 규칙 = paper_rules.js · 글 = messages/preview/paper.ko.json · LLM 0.
(function () {
  'use strict';
  var API = window.API_BASE;
  var R = window.PaperRules;
  var SOCIETY = 'https://www.addictionsociety.net';
  var app = document.getElementById('app');
  var M = {};
  var loadedAt = Date.now();

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
  function ymd(a) { return String(a.publishedAt || '').slice(0, 10); }
  function monthDay(day) { return Number(day.slice(5, 7)) + '월 ' + Number(day.slice(8, 10)) + '일'; }
  function hm(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? '' : new Date(t + 9 * 3600000).toISOString().slice(11, 16);
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
  function link(a, cls, text) {
    return '<a class="' + cls + '" href="' + href(a.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(text == null ? R.cleanTitle(a.title) : text) + '</a>';
  }
  function typeTag(a) {
    var t = typeOf(a);
    return '<span class="type"><span class="dot ' + t + '"></span>' + esc(M.types[t]) + '</span>';
  }
  function place(a) {
    return a.isForeign ? '<span class="abroadTag">' + esc(R.countryOf(a) || M.abroad.unknown) + '</span>' : '';
  }
  function meta(a, withDate) {
    return '<p class="meta">' + typeTag(a) + place(a) + '<span>' + esc(a.source || '') + '</span>' + (withDate === false ? '' : '<span>' + esc(ymd(a)) + '</span>') + '</p>';
  }
  function validImg(src) { return /^https?:\/\//i.test(String(src || '')); }
  function oneLine(a) {
    // 첫 문장(뒤 보기 정규식 0 — 옛 iOS Safari 가 파일 전체를 못 읽음 · 리뷰 2)
    var s = String(a.summary || a.teaser || '');
    var m = /^[\s\S]*?[.다](?=\s|$)/.exec(s);
    return m ? m[0] : s;
  }
  function sectionHead(title, count, desc) {
    return '<div class="secHead"><h2 class="secTitle">' + esc(title) + '</h2>' +
      (count ? '<span class="secCount">' + esc(count) + '</span>' : '') + '</div>' +
      (desc ? '<p class="secDesc">' + esc(desc) + '</p>' : '');
  }
  function emptyLine(data) { return '<p class="empty">' + esc(data ? M.empty : M.failed) + '</p>'; }

  // ── 머리 ──
  function dateLine() {
    var d = new Date(Date.now() + 9 * 3600000);
    return fill(M.dateLine, { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: M.weekdays[d.getUTCDay()] });
  }
  function headHtml() {
    var n = M.nav;
    var cat = function (name, label) { return '<a href="/category.html?cat=' + encodeURIComponent(name) + '">' + esc(label) + '</a>'; };
    return '<div class="band">' + esc(M.band) + ' · <a href="/">운영 대문</a></div>' +
      '<div class="mast"><div class="mastInner">' +
        '<p class="mastDate">' + esc(dateLine()) + '</p>' +
        '<a class="mastBrand" href="/preview/paper/"><img src="/assets/images/logo.png" alt="" width="40" height="40"><span class="mastKo">' + esc(M.brand) + '</span></a>' +
        '<p class="mastEn">' + esc(M.brandEn) + '</p>' +
      '</div></div>' +
      '<header class="head"><div class="headInner"><nav class="nav">' +
        '<a href="/preview/paper/" aria-current="page">' + esc(n.home) + '</a>' +
        cat('중독정책', n.policy) + cat('알코올·약물중독', n.alcohol) + cat('도박중독', n.gambling) +
        cat('게임·디지털중독', n.game) + cat('중독사회와 회복', n.issue) +
        '<a href="/rapha.html">' + esc(n.rapha) + '</a><a href="/feature.html">' + esc(n.feature) + '</a>' +
        '<a href="/encyclopedia.html">' + esc(n.encyclopedia) + '</a><a href="/reports.html">' + esc(n.reports) + '</a>' +
        '<a href="/about.html">' + esc(n.about) + '</a>' +
        '<a class="out" href="' + SOCIETY + '" target="_blank" rel="noopener noreferrer">' + esc(n.society) + '</a></nav>' +
      '</div></header>';
  }

  // ── 머리기사 + 버금 넷(결정 11) ──
  function sameList(a) {
    var members = (a.clusterMembers || []).filter(function (m) { return m.id !== a.id; });
    if (!members.length) return '';
    return '<details class="same"><summary>' + esc(fill(M.lead.same, { n: members.length + 1 })) + '</summary><ul>' +
      members.map(function (m) { return '<li>' + link(m, 'sameLink') + ' · ' + esc(m.source || '') + '</li>'; }).join('') + '</ul></details>';
  }
  function leadBlock(lead, subs) {
    if (!lead) return '<section class="lead">' + sectionHead(M.lead.title) + emptyLine(null) + '</section>';
    var pic = validImg(lead.imageUrl);
    var main = '<article class="leadStory' + (pic ? ' hasPic' : ' noPic') + '">' +
      (pic ? '<div class="leadPic"><img src="' + esc(lead.imageUrl) + '" alt="" referrerpolicy="no-referrer"></div>' : '') +
      '<div class="leadText">' + meta(lead) +
        '<h3 class="leadTitle">' + link(lead, '') + '</h3>' +
        '<p class="leadSummary">' + esc(lead.summary || lead.teaser || '') + '</p>' + sameList(lead) +
      '</div></article>';
    var sub = subs.map(function (a) {
      return '<article class="sub"><h3 class="subTitle">' + link(a, '') + '</h3>' +
        '<p class="subLine">' + esc(oneLine(a)) + '</p>' + meta(a) + '</article>';
    }).join('');
    return '<section class="lead">' + sectionHead(M.lead.title) + main + '<div class="subs">' + sub + '</div></section>';
  }

  // ── 오른쪽 단: 오늘 들어온 기사(결정 7) ──
  function todayBlock(plain) {
    if (!plain) return '<section class="today side">' + sectionHead(M.today.title) + emptyLine(null) + '</section>';
    var t = R.todayArticles(plain.items || []);
    if (!t.items.length) return '<section class="today side">' + sectionHead(M.today.title) + emptyLine(plain) + '</section>';
    var isToday = t.day === R.kstDay(new Date().toISOString());
    var row = function (a) {
      var cat = M.categories[a.category] || '';
      return '<li class="todayRow">' + link(a, 'todayTitle') +
        '<p class="meta"><span class="time">' + esc(hm(a.publishedTs || a.createdAt)) + '</span>' + place(a) +
        '<span>' + esc(a.source || '') + '</span>' + (cat ? '<span>' + esc(cat) + '</span>' : '') + '</p></li>';
    };
    var first = t.items.slice(0, 10), rest = t.items.slice(10);
    return '<section class="today side">' +
      sectionHead(isToday ? M.today.title : fill(M.today.titleDay, { date: monthDay(t.day) }), fill(M.today.count, { n: t.items.length })) +
      '<ul class="todayList">' + first.map(row).join('') + '</ul>' +
      (rest.length ? '<details class="todayMore"><summary>' + esc(fill(M.today.more, { n: rest.length })) + '</summary><ul class="todayList">' + rest.map(row).join('') + '</ul></details>' : '') +
      '<p class="note">' + esc(M.today.note) + '</p></section>';
  }

  // ── 오른쪽 단: 오늘의 중독백과(자리를 미리 잡음 · 결정 12) ──
  function encPick(items) {
    var pool = items.filter(function (x) { return x.trend; });
    var list = pool.length ? pool : items;
    var dayNo = Math.floor(Date.parse(R.kstDay(new Date().toISOString())) / 86400000);
    return list[dayNo % list.length];
  }
  function encBody(items) {
    var t = items && items.length ? encPick(items) : null;
    if (!t) return emptyLine(items);
    return '<h3 class="encTerm"><a href="/encyclopedia.html?id=' + encodeURIComponent(t.id) + '">' + esc(t.termKo) + '</a></h3>' +
      '<p class="encEn">' + esc(t.termEn) + '</p><p class="encDef">' + esc(t.definition) + '</p>' +
      '<p class="more"><a class="moreLink" href="/encyclopedia.html?id=' + encodeURIComponent(t.id) + '">' + esc(M.enc.more) + '</a></p>';
  }

  // ── 분야 단 넷(결정 11) ──
  function columnsBlock(grouped, skip) {
    if (!grouped) return '<section class="columns">' + sectionHead(M.columns.title) + emptyLine(null) + '</section>';
    var cats = M.columns.list.map(function (c) { return c.cat; });
    var cols = R.categoryColumns(grouped.items || [], cats, 5, skip);
    return '<section class="columns">' + sectionHead(M.columns.title) + '<div class="colGrid">' +
      M.columns.list.map(function (c) {
        var list = cols[c.cat];
        return '<div class="col"><h3 class="colTitle">' + esc(c.label) + '</h3>' +
          (list.length ? '<ul>' + list.map(function (a) {
            return '<li>' + link(a, 'colLink') + '<p class="meta"><span>' + esc(a.source || '') + '</span><span>' + esc(ymd(a)) + '</span></p></li>';
          }).join('') + '</ul>' : emptyLine(grouped)) +
          '<p class="more"><a class="moreLink" href="/category.html?cat=' + encodeURIComponent(c.cat) + '">' + esc(M.columns.more) + '</a></p></div>';
      }).join('') + '</div></section>';
  }

  // ── 중독이슈(결정 8 · 이슈 셋 미만이면 구간을 접음) ──
  function issuesBlock(issues, total) {
    if (!issues.length) return '';
    return '<section class="issues">' + sectionHead(M.issues.title, fill(M.issues.count, { n: total, k: issues.length }), M.issues.desc) +
      '<div class="issueGrid">' + issues.map(function (x) {
        var shown = x.members.slice(0, 4), rest = x.members.slice(4);
        var li = function (m) {
          return '<li>' + link(m, 'issueLink') + '<span class="issueSrc">' + (m.isForeign || isForeignMember(m) ? '<span class="abroadTag">' + esc(M.issues.abroad) + '</span>' : '') + esc(m.source || '') + '</span></li>';
        };
        return '<article class="issue"><h3 class="issueName">' + esc(x.name) + '</h3>' +
          '<p class="issueMeta"><span class="type"><span class="dot ' + typeOf(x.lead) + '"></span>' + esc(M.types[typeOf(x.lead)]) + '</span>' +
          '<span>' + esc(fill(M.issues.outlets, { n: x.outlets })) + '</span></p>' +
          '<ul class="issueList">' + shown.map(li).join('') + '</ul>' +
          (rest.length ? '<details class="issueMore"><summary>' + esc(fill(M.issues.more, { n: rest.length })) + '</summary><ul class="issueList">' + rest.map(li).join('') + '</ul></details>' : '') +
        '</article>';
      }).join('') + '</div></section>';
  }
  // 묶음 매체 줄(clusterMembers)에는 isForeign 칸이 없음 → 해외 매체 목록(같은 응답의 해외 대표 매체)으로 가림
  var foreignSources = {};
  function isForeignMember(m) { return !!foreignSources[m.source]; }

  // ── 해외(결정 10) ──
  function abroadBlock(grouped, skip) {
    if (!grouped) return '<section class="abroad">' + sectionHead(M.abroad.title) + emptyLine(null) + '</section>';
    var list = (grouped.items || []).filter(function (a) { return a.isForeign && !skip[a.id]; }).slice(0, 8);
    return '<section class="abroad">' + sectionHead(M.abroad.title, '', M.abroad.desc) +
      (list.length ? '<div class="abroadGrid">' + list.map(function (a) {
        return '<article class="abroadRow"><p class="country">' + esc(R.countryOf(a) || M.abroad.unknown) + '</p>' + link(a, 'abroadTitle') +
          '<p class="subLine">' + esc(oneLine(a)) + '</p>' + meta(a) + '</article>';
      }).join('') + '</div>' : emptyLine(grouped)) + '</section>';
  }

  // ── 중독을 다룬 방송 한 구간(결정 9) ──
  function broadcastBlock(casts) {
    if (!casts) return '<section class="casts">' + sectionHead(M.broadcast.title) + emptyLine(null) + '</section>';
    var b = R.broadcastBlocks(casts.items || [], 6);
    var cards = b.head.map(function (a) {
      return '<article class="castCard"><div class="castPic">' + (validImg(a.imageUrl) ? '<img src="' + esc(a.imageUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</div>' +
        '<div class="castText">' + link(a, 'castTitle', a.title) + meta(a) + '</div></article>';
    }).join('');
    var years = b.years.map(function (y) {
      return '<details class="year"><summary>' + esc(fill(M.broadcast.year, { y: y.year, n: y.items.length })) + '</summary><ul>' +
        y.items.map(function (a) {
          return '<li><span class="eventDate">' + esc(ymd(a)) + '</span>' + link(a, 'yearLink', a.title) + '<span class="yearSrc">' + esc(a.source || '') + '</span></li>';
        }).join('') + '</ul></details>';
    }).join('');
    return '<section class="casts">' + sectionHead(M.broadcast.title, fill(M.broadcast.count, { n: b.total }), M.broadcast.desc) +
      (b.total ? '<div class="castGrid">' + cards + '</div>' : emptyLine(casts)) +
      (years ? '<div class="years"><h3 class="yearsTitle">' + esc(M.broadcast.older) + '</h3>' + years + '</div>' : '') + '</section>';
  }

  function bottomHtml(version) {
    var b = M.bottom;
    var commit = version && /^[0-9a-f]{7,40}$/.test(String(version.commit || '')) ? String(version.commit).slice(0, 7) : '';
    return '<footer class="bottom"><div class="bottomInner">' +
        '<p>' + esc(b.publisher) + ' · ' + esc(b.address) + '</p>' +
        '<p>' + esc(b.together) + ' <a href="' + SOCIETY + '" target="_blank" rel="noopener noreferrer">' + esc(b.society) + '</a> · ' +
          '<a href="https://statory.org" target="_blank" rel="noopener noreferrer">' + esc(b.statory) + '</a> · ' +
          '<a href="https://www.raphacom.net" target="_blank" rel="noopener noreferrer">' + esc(b.rapha) + '</a></p>' +
      '</div><div class="bottomInner bottomSmall"><p>' + esc(b.copyright) + '</p>' +
        '<p>' + (commit ? esc(fill(b.build, { commit: commit })) + ' · ' : '') + '<a href="/admin.html" rel="nofollow">' + esc(b.admin) + '</a></p></div></footer>';
  }

  function render(r) {
    var top = r[0] || [], grouped = r[1], plain = r[2], casts = r[3], version = r[4];
    var items = (grouped && grouped.items) || [];
    items.forEach(function (a) { if (a.isForeign && a.source) foreignSources[a.source] = 1; });
    var issues = R.buildIssues(items, Date.now());
    // 머리기사 = 주요 뉴스 1위. 이슈 구간은 머리기사 묶음만 빼고 매체 많은 차례로 여덟.
    // 버금 넷 = 주요 뉴스 2·3위 → 이슈 구간에 안 실린 여러 매체 묶음 → 새 기사(겹침 0 · 해외 뺌 · 이슈의 큰 묶음을 버금이 빼앗지 않게)
    var lead = top[0] || items[0] || null;
    var takeKey = function (a) { return a.clusterId ? 'c' + a.clusterId : 'i' + a.id; };
    var taken = {};
    if (lead) taken[takeKey(lead)] = 1;
    var shownIssues = issues.filter(function (x) { return !taken[takeKey(x.lead)]; }).slice(0, 8);
    if (shownIssues.length < 3) shownIssues = [];
    var inIssue = {};
    shownIssues.forEach(function (x) { inIssue[takeKey(x.lead)] = 1; });
    var subs = [];
    var multi = items.filter(function (a) { return (a.clusterSize || 1) > 1; });
    top.slice(1).concat(multi).concat(items).forEach(function (a) {
      if (subs.length >= 4 || !a || a.isForeign || taken[takeKey(a)] || inIssue[takeKey(a)]) return;
      taken[takeKey(a)] = 1;
      subs.push(a);
    });
    var skip = {};
    items.forEach(function (a) { if (taken[takeKey(a)] || inIssue[takeKey(a)]) skip[a.id] = 1; });

    app.innerHTML = headHtml() + '<main class="paper">' +
      '<div class="front"><div class="frontMain">' + leadBlock(lead, subs) + '</div>' +
        '<aside class="frontSide">' + todayBlock(plain) +
          '<section class="enc side">' + sectionHead(M.enc.title) + '<div id="encSlot" class="encSlot"><p class="empty">' + esc(M.enc.loading) + '</p></div></section>' +
        '</aside></div>' +
      columnsBlock(grouped, skip) + issuesBlock(shownIssues, issues.length) + abroadBlock(grouped, skip) + broadcastBlock(casts) +
      '</main>' + bottomHtml(version);
    app.setAttribute('data-ready', '1');
    // 머리기사 그림이 깨지면 글만 넓게(빈 남색 판 0)
    var leadImg = app.querySelector('.leadPic img');
    if (leadImg) leadImg.addEventListener('error', function () {
      var story = app.querySelector('.leadStory');
      this.parentNode.remove();
      story.classList.remove('hasPic');
      story.classList.add('noPic');
    });
    var imgs = app.querySelectorAll('.castPic img');
    for (var i = 0; i < imgs.length; i++) imgs[i].addEventListener('error', function () { this.remove(); });
  }

  var encLoad = null;
  json('/messages/preview/paper.ko.json').then(function (messages) {
    M = messages;
    document.title = M.pageTitle;
    app.innerHTML = headHtml();
    encLoad = api('/encyclopedia');
    return Promise.all([
      api('/articles/top'),
      api('/articles/latest-paged?limit=220&page=1'),
      api('/articles/latest-paged?limit=100&page=1&group=none'),
      api('/articles/latest-paged?kind=broadcast&limit=200&page=1&group=none'),
      json('/version.json').catch(function () { return null; }),
    ]);
  }).then(function (r) {
    render(r);
    encLoad.then(function (items) {
      var slot = document.getElementById('encSlot');
      if (slot) slot.innerHTML = encBody(items);
    });
  }).catch(function (e) {
    console.error('대문 실패', e);
    app.insertAdjacentHTML('beforeend', '<p class="empty" style="padding:24px">' + esc(M.failed || 'Failed to load.') + '</p>');
  });

  // 오래 열어 둔 창(NEWS-Q25 ■0 ①): 30분 넘게 지난 뒤 다시 보이거나 뒤로가기 기억에서 살아나면 새로 읽는다 — 「○월 ○일」이 멈춰 보이지 않게.
  function staleCheck() {
    if (document.visibilityState === 'visible' && Date.now() - loadedAt > 30 * 60000) window.location.reload();
  }
  document.addEventListener('visibilitychange', staleCheck);
  window.addEventListener('pageshow', function (e) { if (e.persisted) staleCheck(); });
})();
