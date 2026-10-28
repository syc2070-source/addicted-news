// NEWS-Q20 ■1 · ■4: 바닥글 — 발행 표기(config.js SITE_PUBLISHER · 쪽 lang 으로 ko/en) + 작은 판 표시(version.json).
// version.json 은 assets 밖이라 하루 기억(assets/*)에 걸리지 않음 · 못 읽으면 판 표시만 비움(손님 화면 다른 곳 영향 0).
(function () {
  function fill() {
    var pub = window.SITE_PUBLISHER;
    var lang = (document.documentElement.lang || 'ko').toLowerCase().indexOf('ko') === 0 ? 'ko' : 'en';
    if (pub && pub[lang]) {
      var names = document.querySelectorAll('.footer-publisher-name');
      for (var i = 0; i < names.length; i++) names[i].textContent = pub[lang];
    }
    var el = document.getElementById('footer-build');
    if (!el || !window.fetch) return;
    fetch('version.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v || !/^[0-9a-f]{7,40}$/.test(String(v.commit || ''))) return;
        var built = String(v.built || '').replace('T', ' ').slice(0, 16);
        el.textContent = '판 ' + String(v.commit).slice(0, 7) + (built ? ' · ' + built : '');
      })
      .catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill);
  else fill();
})();
