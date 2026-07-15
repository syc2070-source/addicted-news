// 중독백과 프론트 (정적 페이지 + fetch). config.js 의 window.API_BASE 와 동일 값 사용.
const API_BASE = window.API_BASE || 'http://localhost:4000';

const CAT_LABEL = {
  mechanism:'중독의 과학', psychology:'중독의 심리', substance:'물질중독',
  behavioral:'행동중독', diagnosis:'진단·공존질환', recovery:'치료와 회복',
  society:'중독과 사회', policy:'중독정책', program:'회복 프로그램', figures:'인물',
};

function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function qs(k){return new URLSearchParams(location.search).get(k);}

function curLang(){ return qs('lang') === 'en' ? 'en' : 'ko'; }
function isEn(){ return curLang() === 'en'; }
// 링크에 현재 lang 을 이어붙이는 헬퍼(백과 내부 이동 시 언어 유지)
function withLang(href){
  if(!isEn()) return href;
  return href + (href.includes('?') ? '&' : '?') + 'lang=en';
}
function langHref(lang){
  const u=new URL(location.href);
  if(lang==='en') u.searchParams.set('lang','en'); else u.searchParams.delete('lang');
  return u.pathname + u.search;
}
function langToggleHtml(){
  return `<div class="enc-lang"><a class="${!isEn()?'active':''}" href="${langHref('ko')}">한국어</a><a class="${isEn()?'active':''}" href="${langHref('en')}">EN</a></div>`;
}
// 카테고리 라벨: 영어면 영문 라벨 사용
const CAT_LABEL_EN = {
  mechanism:'Mechanisms', psychology:'Psychology', substance:'Substances',
  behavioral:'Behavioral', diagnosis:'Diagnosis', recovery:'Treatment & Recovery',
  society:'Society', policy:'Policy', program:'Programs', figures:'Figures',
};
function catLabel(c){ return (isEn() ? CAT_LABEL_EN[c] : CAT_LABEL[c]) || c; }

async function renderList(activeCat){
  const root=document.getElementById('enc-root');
  const url=new URL(API_BASE+'/encyclopedia');
  if(activeCat) url.searchParams.set('category',activeCat);
  if(isEn()) url.searchParams.set('locale','en');
  const items=await (await fetch(url)).json();
  const cats=['',...Object.keys(CAT_LABEL)];
  const chips=cats.map(c=>`<span class="enc-chip ${c===(activeCat||'')?'active':''}" data-cat="${c}">${c?esc(catLabel(c)):(isEn()?'All':'전체')}</span>`).join('');
  const cards=items.map(t=>{
    const title=isEn()?t.termEn:t.termKo;
    const other=isEn()?t.termKo:t.termEn;
    return `
    <div class="enc-card" data-id="${t.id}">
      <h3>${esc(title)}${t.trend?'<span class="enc-badge">NEW</span>':''}</h3>
      <div class="en">${esc(other)} · ${esc(catLabel(t.category))}</div>
      <p>${esc((t.definition||'').slice(0,80))}…</p>
    </div>`;
  }).join('');
  root.innerHTML=`<div class="enc-header"><h1>${isEn()?'Encyclopedia':'중독백과'}</h1>${langToggleHtml()}</div>
    <div class="enc-filters">${chips}</div>
    <div class="enc-grid">${cards}</div>`;
  root.querySelectorAll('.enc-chip').forEach(el=>el.onclick=()=>{
    const c=el.dataset.cat;
    history.pushState({},'',withLang(c?`encyclopedia.html?category=${encodeURIComponent(c)}`:'encyclopedia.html'));
    renderList(c);
  });
  root.querySelectorAll('.enc-card').forEach(el=>el.onclick=()=>{
    location.href=withLang(`encyclopedia.html?id=${el.dataset.id}`);
  });
}

async function renderDetail(id){
  const root=document.getElementById('enc-root');
  const t=await (await fetch(`${API_BASE}/encyclopedia/${encodeURIComponent(id)}${isEn()?'?locale=en':''}`)).json();
  if(!t){root.innerHTML=`<p>${isEn()?'Entry not found.':'항목을 찾을 수 없습니다.'}</p>`;return;}
  const video=(t.videoStatus==='ready'&&t.videoUrl)
    ? `<video controls src="${esc(t.videoUrl)}"></video>` : '';
  const related=(t.related||[]).map(r=>`<a href="${withLang(`encyclopedia.html?id=${r.id}`)}">${esc(isEn()?r.termEn:r.termKo)}</a>`).join('');
  const help=t.sensitive
    ? `<div class="enc-help">${isEn()
      ?'If you are struggling with this topic, professional help is available. We do not include methods or figures that could be triggering.'
      :'이 주제로 어려움을 겪고 있다면 전문기관의 도움을 받을 수 있습니다. 방법·수치 등 자극이 될 수 있는 정보는 다루지 않습니다.'}</div>`:'';
  const bodyHtml=(Array.isArray(t.body)&&t.body.length)
    ? t.body.map(s=>`<h3>${esc(s.h)}</h3><p>${esc(s.p)}</p>`).join('')
    : '';
  const advancedHtml=(Array.isArray(t.advanced)&&t.advanced.length)
    ? `<details class="enc-advanced"><summary>${isEn()?'▶ Advanced':'▶ 심화 내용'}</summary>${t.advanced.map(s=>`<h4>${esc(s.h)}</h4><p>${esc(s.p)}</p>`).join('')}</details>`
    : '';
  const title=isEn()?t.termEn:t.termKo;
  const other=isEn()?t.termKo:t.termEn;
  root.innerHTML=`
    <div class="enc-header">
      <a class="enc-back" href="${withLang('encyclopedia.html')}">${isEn()?'← Encyclopedia':'← 중독백과'}</a>
      ${langToggleHtml()}
    </div>
    <div class="enc-detail">
      <h1>${esc(title)}</h1>
      <div class="en">${esc(other)} · ${esc(catLabel(t.category))}</div>
      ${video}
      <p>${esc(t.definition)}</p>
      ${bodyHtml}
      ${advancedHtml}
      <div class="enc-example">${esc(t.example)}</div>
      ${related?`<div class="enc-related"><strong>${isEn()?'Related':'관련 항목'}</strong><br/>${related}</div>`:''}
      ${help}
    </div>`;
}

const id=qs('id');
if(id) renderDetail(id); else renderList(qs('category')||'');
