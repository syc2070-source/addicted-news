// 중독백과 프론트 (정적 페이지 + fetch). main.js 의 API_BASE 와 동일 값 사용.
const API_BASE = 'http://localhost:4000';

const CAT_LABEL = {
  mechanism:'중독의 과학', psychology:'중독의 심리', substance:'물질중독',
  behavioral:'행동중독', diagnosis:'진단·공존질환', recovery:'치료와 회복',
  society:'중독과 사회', policy:'중독정책', program:'회복 프로그램', figures:'인물',
};

function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function qs(k){return new URLSearchParams(location.search).get(k);}

async function renderList(activeCat){
  const root=document.getElementById('enc-root');
  const url=new URL(API_BASE+'/encyclopedia');
  if(activeCat) url.searchParams.set('category',activeCat);
  const items=await (await fetch(url)).json();
  const cats=['',...Object.keys(CAT_LABEL)];
  const chips=cats.map(c=>`<span class="enc-chip ${c===(activeCat||'')?'active':''}" data-cat="${c}">${c?CAT_LABEL[c]:'전체'}</span>`).join('');
  const cards=items.map(t=>`
    <div class="enc-card" data-id="${t.id}">
      <h3>${esc(t.termKo)}${t.trend?'<span class="enc-badge">NEW</span>':''}</h3>
      <div class="en">${esc(t.termEn)} · ${CAT_LABEL[t.category]||t.category}</div>
      <p>${esc((t.definition||'').slice(0,80))}…</p>
    </div>`).join('');
  root.innerHTML=`<h1>중독백과</h1>
    <div class="enc-filters">${chips}</div>
    <div class="enc-grid">${cards}</div>`;
  root.querySelectorAll('.enc-chip').forEach(el=>el.onclick=()=>{const c=el.dataset.cat;history.pushState({},'',c?`?category=${c}`:'encyclopedia.html');renderList(c);});
  root.querySelectorAll('.enc-card').forEach(el=>el.onclick=()=>{location.href=`encyclopedia.html?id=${el.dataset.id}`;});
}

async function renderDetail(id){
  const root=document.getElementById('enc-root');
  const t=await (await fetch(`${API_BASE}/encyclopedia/${encodeURIComponent(id)}`)).json();
  if(!t){root.innerHTML='<p>항목을 찾을 수 없습니다.</p>';return;}
  const video=(t.videoStatus==='ready'&&t.videoUrl)
    ? `<video controls src="${esc(t.videoUrl)}"></video>` : '';
  const related=(t.related||[]).map(r=>`<a href="encyclopedia.html?id=${r.id}">${esc(r.termKo)}</a>`).join('');
  const help=t.sensitive
    ? `<div class="enc-help">이 주제로 어려움을 겪고 있다면 전문기관의 도움을 받을 수 있습니다. 방법·수치 등 자극이 될 수 있는 정보는 다루지 않습니다.</div>`:'';
  const bodyHtml=(Array.isArray(t.body)&&t.body.length)
    ? t.body.map(s=>`<h3>${esc(s.h)}</h3><p>${esc(s.p)}</p>`).join('')
    : '';
  const advancedHtml=(Array.isArray(t.advanced)&&t.advanced.length)
    ? `<details class="enc-advanced"><summary>▶ 심화 내용</summary>${t.advanced.map(s=>`<h4>${esc(s.h)}</h4><p>${esc(s.p)}</p>`).join('')}</details>`
    : '';
  root.innerHTML=`
    <a class="enc-back" href="encyclopedia.html">← 중독백과</a>
    <div class="enc-detail">
      <h1>${esc(t.termKo)}</h1>
      <div class="en">${esc(t.termEn)} · ${CAT_LABEL[t.category]||t.category}</div>
      ${video}
      <p>${esc(t.definition)}</p>
      ${bodyHtml}
      ${advancedHtml}
      <div class="enc-example">${esc(t.example)}</div>
      ${related?`<div class="enc-related"><strong>관련 항목</strong><br/>${related}</div>`:''}
      ${help}
    </div>`;
}

const id=qs('id');
if(id) renderDetail(id); else renderList(qs('category')||'');
