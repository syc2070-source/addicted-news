// NEWS-Q25 ■1 · ■2 · ■3 — 신문 대문 미리보기(/preview/paper). 운영 대문(/ · assets/home)은 건드리지 않는다.
// NEWS-Q26(오너 11-12): 위 띠(바깥 사이트 다섯) → 제호(운영 대문 글자 제호를 크게) → 머리기사 + 버금 넷 | 오늘의 중독백과(강조 칸)
//   → 오늘 들어온 기사(가로 · 두 줄) → 분야 단 넷 → 기획(Statory 랩 공개 호 · 없으면 숨김) → 해외 → 중독을 다룬 방송(「지난 방송 보기」) → 라파뉴스.
//   중독이슈 구간은 부르지 않는다(함수와 이름 규칙은 남김 · 지우기 0).
// 자료 = 공개 API GET 만 · 규칙 = paper_rules.js · 글 = messages/preview/paper.ko.json · LLM 0.
(function () {
  'use strict';
  var API = window.API_BASE;
  var R = window.PaperRules;
  var SOCIETY = 'https://www.addictionsociety.net';
  // 기획 공개 호 목록 주소(결정 3). ■0 ②(11-12): Statory 공개 주소에 중독 주간 보고서 공개 호 목록 없음
  // (/ko/lab/reports 는 로그인한 사람 자기 리포트 · /ko/lab 의 Addiction Lab 은 도박 자가점검 하나) → 비움 = 읽지 않음 = 구간 숨김.
  // 공개 목록(JSON · { items: [{ title, summary, date, url }] })이 서면 여기에 그 주소 한 줄.
  var FEATURE_SOURCE = '';
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
  // 위 띠 바깥 사이트(결정 6): 찾은 것만(messages outs.list · 주소 없는 줄은 그리지 않음) · 새 창 · 390 에서는 「관련 사이트」 하나로 접음
  function outLinks(cls) {
    return (M.outs.list || []).filter(function (o) { return /^https:\/\//.test(String(o.url || '')); }).map(function (o) {
      return '<a class="' + cls + '" href="' + href(o.url) + '" target="_blank" rel="noopener noreferrer">' + esc(o.label) +
        (o.kind ? '<span class="outKind">' + esc(o.kind) + '</span>' : '') + '</a>';
    }).join('');
  }
  function headHtml() {
    var n = M.nav;
    var cat = function (name, label) { return '<a href="/category.html?cat=' + encodeURIComponent(name) + '">' + esc(label) + '</a>'; };
    return '<div class="band">' + esc(M.band) + ' · <a href="/">운영 대문</a></div>' +
      '<div class="topBar"><div class="topInner">' +
        '<p class="mastDate">' + esc(dateLine()) + '</p>' +
        '<nav class="outs" aria-label="' + esc(M.outs.label) + '"><span class="outsLabel">' + esc(M.outs.label) + '</span>' + outLinks('outLink') + '</nav>' +
        '<details class="outsFold"><summary>' + esc(M.outs.label) + '</summary><div class="outsMenu">' + outLinks('outLink') + '</div></details>' +
      '</div></div>' +
      // 제호(결정 5): 운영 대문의 제호 = 글자 「중독뉴스」 + 「addiction news」(Noto Serif KR · head.css .brand) — 그림을 새로 그리지 않고 같은 글 · 같은 글꼴을 크게
      '<div class="mast"><div class="mastInner">' +
        '<h1 class="mastTitle"><a class="brand mastBrand" href="/preview/paper/"><span class="brandKo">' + esc(M.brand) + '</span><span class="brandEn">' + esc(M.brandEn) + '</span></a></h1>' +
      '</div></div>' +
      '<header class="head"><div class="headInner"><nav class="nav">' +
        '<a href="/preview/paper/" aria-current="page">' + esc(n.home) + '</a>' +
        cat('중독정책', n.policy) + cat('알코올·약물중독', n.alcohol) + cat('도박중독', n.gambling) +
        cat('게임·디지털중독', n.game) + cat('중독사회와 회복', n.issue) +
        '<a href="/rapha.html">' + esc(n.rapha) + '</a><a href="/feature.html">' + esc(n.feature) + '</a>' +
        '<a href="/encyclopedia.html">' + esc(n.encyclopedia) + '</a><a href="/reports.html">' + esc(n.reports) + '</a>' +
        '<a href="/about.html">' + esc(n.about) + '</a></nav>' +
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

  // ── 오늘 들어온 기사: 주요 뉴스 바로 아래 가로 · 두 줄(넓은 화면 네 칸 × 두 줄 = 여덟) · 나머지는 「더 보기」(NEWS-Q26 결정 1) ──
  var TODAY_FIRST = 8;
  function todayBlock(plain) {
    if (!plain) return '<section class="today strip">' + sectionHead(M.today.title) + emptyLine(null) + '</section>';
    var t = R.todayArticles(plain.items || []);
    if (!t.items.length) return '<section class="today strip">' + sectionHead(M.today.title) + emptyLine(plain) + '</section>';
    var isToday = t.day === R.kstDay(new Date().toISOString());
    var cell = function (a) {
      var cat = M.categories[a.category] || '';
      return '<li class="todayCell"><p class="meta"><span class="time">' + esc(hm(a.publishedTs || a.createdAt)) + '</span>' +
        (cat ? '<span>' + esc(cat) + '</span>' : '') + place(a) + '</p>' + link(a, 'todayTitle') +
        '<p class="todaySrc">' + esc(a.source || '') + '</p></li>';
    };
    var first = t.items.slice(0, TODAY_FIRST), rest = t.items.slice(TODAY_FIRST);
    return '<section class="today strip">' +
      sectionHead(isToday ? M.today.title : fill(M.today.titleDay, { date: monthDay(t.day) }), fill(M.today.count, { n: t.items.length })) +
      '<ul class="todayGrid">' + first.map(cell).join('') + '</ul>' +
      (rest.length ? '<details class="todayMore"><summary>' + esc(fill(M.today.more, { n: rest.length })) + '</summary><ul class="todayGrid">' + rest.map(cell).join('') + '</ul></details>' : '') +
      '<p class="note">' + esc(M.today.note) + '</p></section>';
  }

  // ── 오른쪽 단 맨 위: 오늘의 중독백과 강조 칸(자리를 미리 잡음 · NEWS-Q25 결정 12 · NEWS-Q26 결정 2) ──
  function encBlock() {
    return '<section class="enc emph">' + '<h2 class="encKicker">' + esc(M.enc.title) + '</h2>' +
      '<div id="encSlot" class="encSlot"><p class="empty">' + esc(M.enc.loading) + '</p></div></section>';
  }
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

  // ── 기획(NEWS-Q26 결정 3): Statory 랩 중독 주간 보고서 공개 호 · 최신 차례 · 호 0 이거나 읽기 실패면 구간 자체를 그리지 않음 ──
  function featureBlock(data) {
    var list = R.featureIssues(data, 6);
    if (!list.length) return '';
    return '<section class="feature">' + sectionHead(M.feature.title, '', M.feature.desc) +
      '<div class="featureGrid">' + list.map(function (x) {
        return '<article class="featureItem emph"><p class="featureDate">' + esc(x.date) + '</p>' +
          '<h3 class="featureTitle"><a href="' + href(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.title) + '</a></h3>' +
          (x.summary ? '<p class="featureSummary">' + esc(x.summary) + '</p>' : '') +
          '<p class="more"><a class="moreLink" href="' + href(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(M.feature.more) + '</a></p></article>';
      }).join('') + '</div></section>';
  }

  // ── 라파뉴스(NEWS-Q26 결정 6): 라파공동체 유튜브 최신 영상 · 실패 · 0 이면 그리지 않음 ──
  function raphaBlock(data) {
    var list = R.raphaVideos(data, 4);
    if (!list.length) return '';
    var ch = data && /^https:\/\/www\.youtube\.com\/channel\/UC[\w-]{22}$/.test(String(data.channelUrl || '')) ? data.channelUrl : '';
    return '<section class="rapha">' + sectionHead(M.rapha.title, '', M.rapha.desc) +
      '<div class="raphaGrid">' + list.map(function (v) {
        return '<article class="castCard"><div class="castPic"><img src="' + esc(v.thumb) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>' +
          '<div class="castText"><a class="castTitle" href="' + href(v.url) + '" target="_blank" rel="noopener noreferrer">' + esc(v.title) + '</a>' +
          '<p class="meta"><span>' + esc(R.kstDay(v.publishedAt)) + '</span></p></div></article>';
      }).join('') + '</div>' +
      (ch ? '<p class="more"><a class="moreLink" href="' + href(ch) + '" target="_blank" rel="noopener noreferrer">' + esc(M.rapha.more) + '</a></p>' : '') +
      '</section>';
  }

  // ── 중독이슈(NEWS-Q25 결정 8) — NEWS-Q26 결정 3 으로 대문에서 부르지 않음(지우기 0 · 이름 규칙은 paper_rules.js 에 남김) ──
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
    // 지난 방송(NEWS-Q26 결정 4): 처음에는 단추 하나 · 누르면 해마다 목록(강조 칸)
    var pastN = 0;
    var years = b.years.map(function (y) {
      pastN += y.items.length;
      return '<div class="year"><h3 class="yearTitle">' + esc(fill(M.broadcast.year, { y: y.year, n: y.items.length })) + '</h3><ul>' +
        y.items.map(function (a) {
          return '<li><span class="eventDate">' + esc(ymd(a)) + '</span>' + link(a, 'yearLink', a.title) + '<span class="yearSrc">' + esc(a.source || '') + '</span></li>';
        }).join('') + '</ul></div>';
    }).join('');
    return '<section class="casts">' + sectionHead(M.broadcast.title, fill(M.broadcast.count, { n: b.total }), M.broadcast.desc) +
      (b.total ? '<div class="castGrid">' + cards + '</div>' : emptyLine(casts)) +
      (years ? '<details class="past"><summary class="pastBtn">' + esc(fill(M.broadcast.older, { n: pastN })) + '</summary>' +
        '<div class="pastBody emph">' + years + '</div></details>' : '') + '</section>';
  }

  function bottomHtml(version) {
    var b = M.bottom;
    var commit = version && /^[0-9a-f]{7,40}$/.test(String(version.commit || '')) ? String(version.commit).slice(0, 7) : '';
    return '<footer class="bottom"><div class="bottomInner">' +
        '<p>' + esc(b.publisher) + ' · ' + esc(b.address) + '</p>' +
        '<p>' + esc(b.together) + ' <a href="' + SOCIETY + '" target="_blank" rel="noopener noreferrer">' + esc(b.society) + '</a> · ' +
          '<a href="https://statory.org" target="_blank" rel="noopener noreferrer">' + esc(b.statory) + '</a> · ' +
          '<a href="https://raphacom.org/" target="_blank" rel="noopener noreferrer">' + esc(b.rapha) + '</a></p>' +
      '</div><div class="bottomInner bottomSmall"><p>' + esc(b.copyright) + '</p>' +
        '<p>' + (commit ? esc(fill(b.build, { commit: commit })) + ' · ' : '') + '<a href="/admin.html" rel="nofollow">' + esc(b.admin) + '</a></p></div></footer>';
  }

  function render(r) {
    var top = r[0] || [], grouped = r[1], plain = r[2], casts = r[3], version = r[4], feature = r[5];
    var items = (grouped && grouped.items) || [];
    items.forEach(function (a) { if (a.isForeign && a.source) foreignSources[a.source] = 1; });
    // 머리기사 = 주요 뉴스 1위(같은 소식 n건 모아 보기 = 묶음 계산 그대로).
    // 버금 넷 = 주요 뉴스 2·3위 → 여러 매체 묶음 → 새 기사(겹침 0 · 해외 뺌). 중독이슈 구간은 NEWS-Q26 에서 내림.
    var lead = top[0] || items[0] || null;
    var takeKey = function (a) { return a.clusterId ? 'c' + a.clusterId : 'i' + a.id; };
    var taken = {};
    if (lead) taken[takeKey(lead)] = 1;
    var subs = [];
    var multi = items.filter(function (a) { return (a.clusterSize || 1) > 1; });
    top.slice(1).concat(multi).concat(items).forEach(function (a) {
      if (subs.length >= 4 || !a || a.isForeign || taken[takeKey(a)]) return;
      taken[takeKey(a)] = 1;
      subs.push(a);
    });
    var skip = {};
    items.forEach(function (a) { if (taken[takeKey(a)]) skip[a.id] = 1; });

    app.innerHTML = headHtml() + '<main class="paper">' +
      '<div class="front"><div class="frontMain">' + leadBlock(lead, subs) + '</div>' +
        '<aside class="frontSide">' + encBlock() + '</aside></div>' +
      todayBlock(plain) +
      columnsBlock(grouped, skip) + featureBlock(feature) + abroadBlock(grouped, skip) + broadcastBlock(casts) +
      '<div id="raphaSlot"></div>' +
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

  var encLoad = null, raphaLoad = null;
  json('/messages/preview/paper.ko.json').then(function (messages) {
    M = messages;
    document.title = M.pageTitle;
    app.innerHTML = headHtml();
    encLoad = api('/encyclopedia');
    raphaLoad = api('/articles/rapha-videos?limit=4'); // 따로 읽음 — 유튜브가 늦어도 위 구간을 잡지 않게(맨 아래라 밀리는 것은 바닥글뿐)
    return Promise.all([
      api('/articles/top'),
      api('/articles/latest-paged?limit=220&page=1'),
      api('/articles/latest-paged?limit=100&page=1&group=none'),
      api('/articles/latest-paged?kind=broadcast&limit=200&page=1&group=none'),
      json('/version.json').catch(function () { return null; }),
      FEATURE_SOURCE ? json(FEATURE_SOURCE).catch(function () { return null; }) : null,
    ]);
  }).then(function (r) {
    render(r);
    encLoad.then(function (items) {
      var slot = document.getElementById('encSlot');
      if (slot) slot.innerHTML = encBody(items);
    });
    raphaLoad.then(function (data) {
      var slot = document.getElementById('raphaSlot');
      if (!slot) return;
      slot.outerHTML = raphaBlock(data);
      var imgs = app.querySelectorAll('.rapha .castPic img');
      for (var i = 0; i < imgs.length; i++) imgs[i].addEventListener('error', function () { this.remove(); });
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
