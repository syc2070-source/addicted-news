// NEWS-Q25 ■1 · ■2 — 신문 대문 미리보기의 규칙(순수 함수 · 화면 없음 · LLM 0).
// 브라우저에서는 window.PaperRules, 시험(backend jest)에서는 require 로 같은 파일을 읽는다.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PaperRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var KST = 9 * 3600000;

  function kstDay(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? '' : new Date(t + KST).toISOString().slice(0, 10);
  }

  // 제목 꼬리 「 - 매체」 떼기(두 번 붙은 것까지 · 꼬리 30자 안)
  function cleanTitle(t) {
    var s = String(t || '');
    for (var n = 0; n < 2; n++) {
      var i = s.lastIndexOf(' - ');
      if (i > 0 && s.length - i - 3 <= 30) s = s.slice(0, i);
    }
    return s.trim();
  }

  // 이름 재료: 매체 꼬리 · [머리표] · 따옴표 · 말줄임 · 괄호 속 사람 이름 뗌
  function bareTitle(t) {
    return cleanTitle(t)
      .replace(/\[[^\]]{0,12}\]|【[^】]{0,12}】|<[^>]{0,12}>/g, ' ')
      .replace(/\([^)]{0,20}\)/g, ' ')
      .replace(/["'“”‘’「」『』《》〈〉]/g, ' ')
      .replace(/…|\.{2,}|···|⋯/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var PARTICLE = /(으로|에서|에게|까지|부터|라는|이라|이다|에는|에도|와의|과의|은|는|이|가|을|를|에|의|로|와|과|도|만)$/;
  var STOP = { '등': 1, '및': 1, '또': 1, '첫': 1, '더': 1, '위해': 1, '대한': 1, '관련': 1, '통해': 1, '속보': 1, '단독': 1, '종합': 1, '오늘': 1, '오늘부터': 1, '내년': 1 };

  // 낱말 → 견줄 열쇠(조사 뗌 · 두 글자 이상만 뗌)
  function keyOf(w) {
    var k = w.replace(/[,.:;!?·•…~\-–—/]+$/g, '').replace(/^[,.:;!?·•…~\-–—/]+/g, '');
    if (k.length > 2) k = k.replace(PARTICLE, '');
    return k;
  }

  function wordsOf(t) {
    return bareTitle(t).split(/[\s,·…]+/).map(function (w) {
      return { raw: w.replace(/[,.:;!?·•~]+$/g, ''), key: keyOf(w) };
    }).filter(function (w) { return w.key.length >= 2 && !STOP[w.key] && !/^\d+$/.test(w.key); });
  }

  function clip(s, max) {
    if (s.length <= max) return s;
    var cut = s.slice(0, max);
    var sp = cut.lastIndexOf(' ');
    return (sp >= max / 2 ? cut.slice(0, sp) : cut).trim();
  }

  /**
   * 이슈 이름(결정 8): 묶음 제목들에 공통으로 나오는 핵심 낱말을 대표 제목 차례로 이음 · 24자 안.
   * 공통 낱말 = 제목 절반 이상(최소 둘)에 나온 낱말. 둘 미만이면 대표 제목을 24자 안으로 줄임.
   * 반환 { name, rule: 'common' | 'lead' }.
   */
  function issueName(titles, max) {
    max = max || 24;
    var list = (titles || []).filter(Boolean);
    if (!list.length) return { name: '', rule: 'lead' };
    var docs = list.map(wordsOf);
    var df = {};
    docs.forEach(function (ws) {
      var seen = {};
      ws.forEach(function (w) { if (!seen[w.key]) { seen[w.key] = 1; df[w.key] = (df[w.key] || 0) + 1; } });
    });
    var need = Math.max(2, Math.ceil(list.length / 2));
    // 대표 = 공통 낱말을 가장 많이 가진 제목(같으면 짧은 것)
    var best = 0, bestScore = -1;
    docs.forEach(function (ws, i) {
      var sc = ws.filter(function (w) { return df[w.key] >= need; }).length;
      if (sc > bestScore || (sc === bestScore && bareTitle(list[i]).length < bareTitle(list[best]).length)) { best = i; bestScore = sc; }
    });
    var used = {};
    var picked = docs[best].filter(function (w) {
      if (df[w.key] < need || used[w.key]) return false;
      used[w.key] = 1;
      return true;
    }).map(function (w) { return w.raw; }); // 견주기는 열쇠(조사 뗌) · 보이는 낱말은 제목에 쓰인 그대로(「어린이」가 「어린」으로 잘리지 않게)
    if (picked.length >= 2) {
      var out = '';
      for (var i = 0; i < picked.length; i++) {
        var next = out ? out + ' ' + picked[i] : picked[i];
        if (next.length > max) break;
        out = next;
      }
      if (out.split(' ').length >= 2) return { name: out, rule: 'common' };
    }
    return { name: clip(bareTitle(list[best]), max), rule: 'lead' };
  }

  function outletsOf(a) {
    var s = {};
    [a].concat(a.clusterMembers || []).forEach(function (m) { if (m && m.source) s[m.source] = 1; });
    return Object.keys(s);
  }

  /**
   * 중독이슈(결정 8): 묶음 단위 목록에서 최근 days 일 안 · 매체 minOutlets 이상인 묶음.
   * 묶음이 minIssues 미만이면 빈 배열(구간을 접음 · 낱개 기사를 이슈로 부르지 않음).
   */
  function buildIssues(grouped, nowMs, opts) {
    opts = opts || {};
    var days = opts.days || 14, minOutlets = opts.minOutlets || 3, minIssues = opts.minIssues || 3;
    var since = nowMs - days * DAY;
    var out = [];
    (grouped || []).forEach(function (a) {
      var t = Date.parse(a.createdAt || a.publishedAt);
      if (isNaN(t) || t < since) return;
      var outlets = outletsOf(a);
      if (outlets.length < minOutlets) return;
      // 대표가 clusterMembers 에도 들어 있을 수 있음 → id 로 한 번만(제목이 두 번 세여 「공통」이 부풀지 않게) · 빈 칸 뺌
      var seenId = {};
      var members = [a].concat(a.clusterMembers || []).filter(function (m) {
        if (!m || seenId[m.id]) return false;
        seenId[m.id] = 1;
        return true;
      });
      var nm = issueName(members.map(function (m) { return m.title; }));
      var last = members.reduce(function (mx, m) { return Math.max(mx, Date.parse(m.publishedTs || m.publishedAt) || 0); }, 0);
      out.push({ id: a.id, name: nm.name, rule: nm.rule, outlets: outlets.length, size: members.length, lead: a, members: members, last: last });
    });
    out.sort(function (x, y) { return y.outlets - x.outlets || y.last - x.last; });
    return out.length >= minIssues ? out : [];
  }

  /** 오늘 들어온 기사(결정 7): 가장 늦은 수집 날(KST)에 들어온 기사(한 기사 한 줄 목록) · 새것 먼저. */
  function todayArticles(plain) {
    var list = (plain || []).filter(function (a) { return a.createdAt; });
    var day = list.reduce(function (d, a) { var k = kstDay(a.createdAt); return k > d ? k : d; }, '');
    var items = list.filter(function (a) { return kstDay(a.createdAt) === day; })
      .sort(function (a, b) { return String(b.publishedTs || b.createdAt).localeCompare(String(a.publishedTs || a.createdAt)); });
    return { day: day, items: items };
  }

  /** 분야 단(결정 11): 국내 기사 · 분야별 새 묶음 n 개(묶음 대표만 · 이미 위에 보인 id 뺌). */
  function categoryColumns(grouped, cats, n, skip) {
    var out = {};
    cats.forEach(function (c) { out[c] = []; });
    (grouped || []).forEach(function (a) {
      if (a.isForeign || (skip && skip[a.id])) return;
      var c = a.category;
      if (out[c] && out[c].length < n) out[c].push(a);
    });
    return out;
  }

  // 나라(결정 10): 매체 표 → 주소 꼬리 · 모르면 ''(화면은 「해외」)
  var OUTLET_COUNTRY = {
    'la tercera': '칠레', 'o estado de s. paulo': '브라질', 'the star': '말레이시아', 'south china morning post': '홍콩',
    'al jazeera english': '카타르', 'the times of india': '인도', 'the guardian (world)': '영국', 'euronews': '유럽',
    'the conversation (au)': '호주', 'mail & guardian': '남아공', 'business daily': '케냐', 'codeblue': '말레이시아',
    'iceland review': '아이슬란드', 'knews, kathimerini': '키프로스', 'fbc news': '피지', 'cbc': '캐나다', 'ctv news': '캐나다',
    'the independent': '영국', 'new statesman': '영국', 'manx radio': '맨섬', 'cbs news': '미국', 'sciencedaily': '미국',
    'eurekalert!': '미국', 'the washington post': '미국', 'the new york times': '미국', 'the wall street journal': '미국',
    'bangkok post': '태국', 'the straits times': '싱가포르', 'arab news': '사우디아라비아', 'infobae': '아르헨티나',
    'the irish times': '아일랜드', 'deutsche welle (english)': '독일', 'hoodline': '미국', 'tobacco reporter': '미국',
    'cdc gaming': '미국', 'gambling news': '미국', 'yogonet': '아르헨티나', 'spectrum news': '미국', 'kpbs': '미국',
    'audacy': '미국', '9and10news.com': '미국', 'vending times': '미국', 'clarksville now': '미국', 'hilton head island packet': '미국',
    'the boulder reporting lab': '미국', 'your ohio news': '미국', 'positively osceola': '미국', 'proactive financial news': '영국',
    'fox 9 minneapolis-st. paul': '미국', 'valley news live': '미국', 'nbc connecticut': '미국', 'cstore decisions': '미국',
    'fanduel': '미국', 'optometry advisor': '미국', 'sports business journal': '미국', 'saskatoon starphoenix': '캐나다',
    'the real wv': '미국', 'north edinburgh news': '영국', 'the manitoulin expositor': '캐나다', '95.7 ben fm': '미국',
    'your valley': '미국', 'fox43.com': '미국', 'cbs19.tv': '미국', 'scienceblog': '미국', 'tradingview': '미국',
    // 미국 지역 방송(호출부호 · 11-11 공개 목록에서 본 이름 그대로)
    'wset': '미국', 'whas11': '미국', 'kvue': '미국', 'ksl news': '미국', 'kimt': '미국', 'kttc': '미국', 'whec.com': '미국',
    'weny news': '미국', 'wilx': '미국', 'knoe': '미국', 'wbrc 6 news': '미국', 'wvtm': '미국', 'wxxv news 25': '미국',
    'wsyx': '미국', 'wfie | 14 news': '미국', 'koki fox 23': '미국', 'sdpb': '미국', 'wlio': '미국',
  };
  var TLD_COUNTRY = [
    ['.co.uk', '영국'], ['.org.uk', '영국'], ['.uk', '영국'], ['.ca', '캐나다'], ['.com.au', '호주'], ['.au', '호주'],
    ['.co.nz', '뉴질랜드'], ['.org.nz', '뉴질랜드'], ['.nz', '뉴질랜드'], ['.com.my', '말레이시아'], ['.my', '말레이시아'],
    ['.co.za', '남아공'], ['.com.br', '브라질'], ['.br', '브라질'], ['.cl', '칠레'], ['.com.ar', '아르헨티나'], ['.mx', '멕시코'],
    ['.com.fj', '피지'], ['.fj', '피지'], ['.com.cy', '키프로스'], ['.cy', '키프로스'], ['.ie', '아일랜드'], ['.de', '독일'],
    ['.fr', '프랑스'], ['.es', '스페인'], ['.it', '이탈리아'], ['.nl', '네덜란드'], ['.se', '스웨덴'], ['.jp', '일본'],
    ['.sg', '싱가포르'], ['.in', '인도'], ['.ph', '필리핀'], ['.th', '태국'], ['.is', '아이슬란드'], ['.ke', '케냐'], ['.ng', '나이지리아'],
  ];
  function hostOf(u) {
    var m = /^https?:\/\/([^/:?#]+)/i.exec(String(u || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function countryOf(a) {
    var src = String(a.source || '').toLowerCase().trim();
    if (OUTLET_COUNTRY[src]) return OUTLET_COUNTRY[src];
    var h = hostOf(a.sourceUrl);
    for (var i = 0; i < TLD_COUNTRY.length; i++) {
      var tld = TLD_COUNTRY[i][0];
      if (h.slice(-tld.length) === tld) return TLD_COUNTRY[i][1];
    }
    // 호출부호(K·W) 짐작은 쓰지 않음(리뷰: KBS World · WHO · wwf.org 가 「미국」이 됨) — 미국 지역 방송은 위 표에 이름으로만.
    return '';
  }

  /** 방송 한 구간(결정 9): 원 방송일 새것 먼저 · 앞 n 편은 카드 · 나머지는 해마다 접기. */
  function broadcastBlocks(items, n) {
    var list = (items || []).slice().sort(function (a, b) {
      return String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')) || (b.id || 0) - (a.id || 0);
    });
    var head = list.slice(0, n), rest = list.slice(n), years = [], byYear = {};
    rest.forEach(function (a) {
      var y = String(a.publishedAt || '').slice(0, 4) || '----';
      if (!byYear[y]) { byYear[y] = []; years.push(y); }
      byYear[y].push(a);
    });
    return { head: head, years: years.map(function (y) { return { year: y, items: byYear[y] }; }), total: list.length };
  }

  return {
    kstDay: kstDay, cleanTitle: cleanTitle, bareTitle: bareTitle, issueName: issueName, outletsOf: outletsOf,
    buildIssues: buildIssues, todayArticles: todayArticles, categoryColumns: categoryColumns, countryOf: countryOf,
    broadcastBlocks: broadcastBlocks,
  };
});
