/* ---------- Essays view: the diary, newest day first, in Mon–Sun weeks counted from DAY 1. Owner: essays agent ----------
   essays/dNNN: {day, date, text, created, edited, tz}, written here. reviews/dNNN: {day, review, marks}, written by
   the weekly review; marks in reading order: {t: fix|better|good|word, mine, nat, note}. A mark is found by its
   words (`mine`) from where the last one ended; one whose words he has since changed drops.
   Each day is a sheet of paper (paper.css, B's); a day the weekly review has read carries the red stamp. Reading is the default: the
   essay reads as the corrected text, only the changed characters marked with one light, slightly messy highlighter
   (every kind of correction alike; well done is plain text). The tip opens when the pointer rests on highlighted
   characters (one hit test, ES_hit) or on any word of his, and stays while the pointer travels to it (Chinese Brain's
   way, src/content/popup.ts); a tap opens it on a phone. Pinyin shows only over words he doesn't know yet (KNOWN). Editing is a double-click on the text (or Enter on it) and happens on the
   page itself, with the same type: his own words come back with the corrected spots faintly marked; Esc, Cmd+Enter or a click
   away ends it, and the whole edit is one Cmd+Z step. ---------- */
document.getElementById('view-essays').innerHTML=`<div class="es">
  <div class="es-main">
    <div class="es-top" id="es-top">
      <button class="es-sw" id="mine" type="button" role="switch" aria-checked="false">My version<i aria-hidden="true"></i></button>
    </div>
    <div class="es-days" id="ess-days"></div>
  </div>
  <aside class="es-side" aria-labelledby="ess-lh">
    <button class="es-disc" id="es-disc" type="button" aria-expanded="false" aria-controls="ess-stick"><span>To improve</span><span class="es-dd" id="es-dd"></span><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 7 5 3.5 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <div class="es-stick" id="ess-stick">
    <div class="im-head"><h2 class="side-h" id="ess-lh">To improve</h2></div>
    <div id="ess-open"></div>
    <button class="im-new" id="ess-new" type="button"><span aria-hidden="true">+</span>New</button>
    <div id="ess-done"></div>
  </div></aside>
</div>`;
let IMP=null;
const ES_D=document.getElementById('ess-days');
const ES_PIN='<i class="es-pin" aria-label="on your list"></i>';
const ES_ICON_ON='<svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// 2026-11-01: sizes, the yellow highlighter at 30%, black ink and double-click editing are his picks (css/essays.css).
// The page type is still open: a different page each week (Noted's different pages), or one he picks.

// where each mark sits: the most marks that still appear in reading order. A mark whose words he changed drops, and
// only that one (a short mark like 他 can't jump to a later 他 and push the marks after it out).
function ES_anchor(text,marks){
  const ms=[];
  (Array.isArray(marks)?marks:[]).forEach((m,k)=>{
    const mine=String(m&&m.mine||'');
    if(!mine.trim()||mine.includes('\n')||!['fix','better','good','word'].includes(m.t)) return;
    const occ=[];for(let i=text.indexOf(mine);i>=0&&occ.length<40;i=text.indexOf(mine,i+1))occ.push(i);
    if(occ.length) ms.push({m,mine,k,occ});
  });
  const N=[];ms.forEach((x,a)=>x.occ.forEach(i=>N.push({a,i,j:i+x.mine.length})));
  const best=N.map(()=>1), prev=N.map(()=>-1);
  for(let q=0;q<N.length;q++)for(let p=0;p<q;p++)
    if(N[p].a<N[q].a&&N[p].j<=N[q].i&&best[p]+1>best[q]){best[q]=best[p]+1;prev[q]=p;}
  let e=-1;N.forEach((_,q)=>{if(e<0||best[q]>best[e])e=q;});
  const out=[];
  for(let q=e;q>=0;q=prev[q]){const x=ms[N[q].a];out.push({...x.m,mine:x.mine,k:x.k,i:N[q].i,j:N[q].j});}
  return out.reverse();
}
const ES_chunk=(t,a,b)=>a<b?`<span data-o="${a}">${mix(t.slice(a,b)).replace(/\n/g,'<br>')}</span>`:'';
function ES_essayHTML(e){
  const text=norm(e.text), rv=ES.reviews[e.day];
  const marks=ES_anchor(text,rv&&rv.marks);
  // one Enter or a blank line: a paragraph either way (the board's sheet saves single breaks)
  const paras=[]; const re=/\n+/g; let last=0,m;
  while((m=re.exec(text))){paras.push([last,m.index]);last=re.lastIndex;}
  paras.push([last,text.length]);
  let mi=0;
  return paras.map(([a,b])=>{
    let h='',pos=a;
    while(mi<marks.length&&marks[mi].i<b){
      const mk=marks[mi++]; if(mk.i<pos) continue;
      const s={...mk,id:e.day+'-'+mk.k,day:e.day}; ES.seg[s.id]=s;
      h+=ES_chunk(text,pos,mk.i)+ES_segHTML(s); pos=mk.j;
    }
    return `<p>${h+ES_chunk(text,pos,b)}</p>`;
  }).join('');
}
// a real highlighter is never the same twice: each mark gets its own slight tilt and height (from its id,
// so it doesn't change between renders)
function ES_messy(id){
  let h=2166136261;for(const c of String(id)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}
  const r=n=>{h=Math.imul(h^(h>>>15),2246822507);h^=h>>>13;return ((h>>>0)%1000)/1000*n;};
  return `--hl-t:${(178.6+r(2.8)).toFixed(2)}deg;--hl-0:${(14+r(14)).toFixed(1)}%;--hl-1:${(82+r(13)).toFixed(1)}%;`
    +`--hl-e:${(.45+r(.5)).toFixed(2)}`;
}
// only the characters that changed get the highlighter; a correction that only deletes marks the whole corrected run
function ES_hlHTML(s){
  if(s.t==='word') return `<u class="d">${mix(s.nat)}</u>`;
  const h=diffHTML(s.mine,s.nat);
  return h.includes('<u')?h:`<u class="d">${mix(s.nat)}</u>`;
}
function ES_segHTML(s){
  // well done, or nothing to say: his text, plain
  if(s.t==='good'||!s.nat) return `<span data-o="${s.i}">${mix(s.mine)}</span>`;
  // a mark he hasn't dealt with yet shows only what's wrong: his own words under the highlighter (the fix waits in the
  // tip for his try); My version still shows the corrected text whole (css: .es-c.try)
  const fresh=!ES_tryOf(s), fix=ES_hlHTML(s);
  // what he wrote shows in the tip, or inline (struck) with My version
  return `<span class="es-c ${s.t}${fresh?' try':''}" data-k="${s.id}" data-i="${s.i}"><s class="x-out">${mix(s.mine)}</s><span class="es-n" tabindex="0" role="button" style="${ES_messy(s.id)}">${fresh?`<u class="d es-own">${mix(s.mine)}</u><span class="es-fx">${fix}</span>`:fix}</span></span>`;
}
/* ---------- prompts first (TRIES, site/src/cbp/tries.ts): a mark asks him to fix it before it shows the fix. Its outcome
   (right, wrong, shown) is kept on the day's review doc (`tries`), and a try counts toward its To improve item. ---------- */
const ES_tryOf=s=>typeof TRIES==='undefined'?'shown':TRIES.stateOf(ES.reviews[s.day]&&ES.reviews[s.day].tries,s);
function ES_setTry(s,t){
  const rv=ES.reviews[s.day]; if(!rv||typeof TRIES==='undefined') return;
  rv.tries=TRIES.record(rv.tries,s,t);
  if(ES.db) ES.db.collection('reviews').doc('d'+String(s.day).padStart(3,'0')).update({tries:rv.tries}).catch(e=>console.error(e));
  // the mark in the essay now reads corrected; the diary's html is noted so the snapshot's echo changes nothing
  const c=ES_D.querySelector(`.es-c[data-k="${s.id}"]`);
  if(c){const on=c.classList.contains('on');c.insertAdjacentHTML('afterend',ES_segHTML(s));c.remove();if(on)ES_D.querySelector(`.es-c[data-k="${s.id}"]`)?.classList.add('on');}
  const h=ES_html(); if(h!=null) ES_D._h=h;
}
// his try into To improve: right is a use of the item the mark belongs to, wrong a miss (TRIES.credit)
function ES_credit(s,ok){
  const x=TRIES.itemFor(Object.values(ES.items||{}),s); if(!x) return;
  IM_write(x.id,TRIES.credit(x,+s.day,s.nat.trim(),ok));
  try{IM_render();}catch(e){}
}
// editing shows his own words; the spots Claude corrected keep a faint mark until he changes them
// a past day open to edit: one block per paragraph, as Today's box (write.js PARA_*), the corrected spots still marked
// (a mark that runs over a paragraph's end isn't shown while he edits)
function ES_editHTML(e){
  const text=norm(e.text), rv=ES.reviews[e.day], ms=[];
  let pos=0;
  ES_anchor(text,rv&&rv.marks).forEach(m=>{if(m.i<pos||m.t==='good'||!m.nat)return;ms.push(m);pos=m.j;});
  let off=0;
  return text?text.split('\n').map(l=>{
    const a=off,b=a+l.length; off=b+1;
    let h='',p=a;
    for(const m of ms){if(m.i<a||m.j>b)continue;h+=esc(text.slice(p,m.i))+`<span class="es-was ${m.t}" data-mine="${esc(m.mine)}" style="${ES_messy(e.day+'-'+m.k)}">${esc(m.mine)}</span>`;p=m.j;}
    h+=esc(text.slice(p,b));
    return `<div>${h||'<br>'}</div>`;
  }).join(''):'';
}

/* weeks: "Week N" (Week 1 = the Mon–Sun week of DAY 1) and seven dots, Monday to Sunday; green = a written day,
   gold ring = today. The count is the point: it grows with every week he keeps going. */
function ES_weekNo(mon){
  const d1=ES.essays.find(e=>e&&+e.day===1&&e.date)||sorted().slice(-1)[0];
  if(!d1) return 1;
  return Math.max(1,Math.floor(days(monday(P(d1.date)),mon)/7)+1);
}
function ES_dots(mon,have){
  const t=P(essayToday()); let n=0;
  const dots=[0,1,2,3,4,5,6].map(i=>{
    const d=add(mon,i), k=K(d), on=have.has(k); if(on) n++;
    const c=on?'on':k===K(t)?'now':d>t?'later':'miss';
    return `<i class="${c}"></i>`;
  }).join('');
  return `<span class="es-dots" role="img" aria-label="${n} of 7 days written">${dots}</span>`;
}
// a day the weekly review has read carries the teacher's red stamp. A hand-pressed stamp never lands the same way
// twice: its spot, tilt, ink and wear come from the day number, so a day keeps its own stamp between renders.
function ES_stampHTML(e){
  if(!ES.reviews[e.day]) return '';
  let h=e.day*2654435761>>>0;const r=()=>{h=Math.imul(h^h>>>15,2246822507)>>>0;h^=h>>>13;return (h>>>0)%10000/10000;};
  // the tilt: most land nearly straight, a few more askew (his call, 2026-11-22): a small lean left, then a spread
  // that thins out fast (u^2.6), at most about 8 degrees either way
  const s=r()<.5?-1:1, tilt=-1.2+s*7*Math.pow(r(),2.6);
  const fr=ES_fresh(e);
  // a fresh stamp is wet ink: full and even, so the recent ones read alike; older ones mellow, each its own way
  const st=`--st-rot:${tilt.toFixed(1)}deg;--st-x:${(r()*34).toFixed(0)}px;--st-y:${(r()*18-4).toFixed(0)}px;`
    +(fr?'':`--st-o:${(.62+r()*.24).toFixed(2)};--st-fade:${(r()*360).toFixed(0)}deg;--st-fa:${(.18+r()*.62).toFixed(2)}`);
  return `<i class="paper-stamp read wear-${fr?1:1+(e.day*7%6)}" style="${st}" aria-hidden="true"></i>`;
}
// a day the review read in the last five days is fresh: its 閱 stamp in wet ink, until it ages out
const ES_FRESH_DAYS=5;
function ES_fresh(e){
  const r=ES.reviews[e.day], d=r&&String(r.review||'');
  return !!d&&/^\d{4}-\d\d-\d\d/.test(d)&&(P(essayToday())-P(d.slice(0,10)))/864e5<ES_FRESH_DAYS;
}
function ES_dayHTML(e,wk){
  const fr=ES_fresh(e);
  return `<article class="es-day paper${fr?' fresh':''}" data-paper="plain" id="day-${e.day}"><i class="paper-tex" aria-hidden="true"></i>
    <header class="es-dh"><b>Day ${e.day}</b><span>${fmtDate(e.date)}</span><span class="saved" data-saved="${e.date}" aria-live="polite"></span></header>
    <div class="es-text pen" lang="zh-Hant" data-day="${e.day}" tabindex="0">${ES_essayHTML(e)}</div>${ES_stampHTML(e)}</article>`;
}
// the diary's html (null: no essays yet)
function ES_html(){
  const all=sorted();
  ES.seg={};
  if(!all.length) return null;
  // the newest days, rounded out to whole weeks
  let n=Math.min(ES.show,all.length);
  if(n<all.length){const wk=K(monday(P(all[n-1].date)));while(n<all.length&&K(monday(P(all[n].date)))===wk)n++;}
  const have=new Set(all.map(e=>e.date)), weeks=[];
  all.slice(0,n).forEach(e=>{const mon=monday(P(e.date)),k=K(mon);let w=weeks[weeks.length-1];if(!w||w.k!==k){w={k,mon,days:[]};weeks.push(w);}w.days.push(e);});
  const html=weeks.map(w=>{const n=ES_weekNo(w.mon),l='Week '+n;return `<section class="es-wk" aria-label="${l}"><header class="es-wh"><h2>${l}</h2>${ES_dots(w.mon,have)}</header>${w.days.map(e=>ES_dayHTML(e,n)).join('')}</section>`;}).join('')
    +(all.length>n?'<button class="es-more btn-q" id="es-more" type="button">Earlier weeks</button>':'');
  return html;
}
function ES_render(){
  if(VIEW!=='essays'||ES.editDay!=null){ES.stale=true;return;}
  ES.stale=false;
  const html=ES_html();
  if(html==null){ES_closeTip();ES_D._h=null;ES_D.innerHTML=ES.loaded?'<p class="es-none">Your essays show up here.</p>':'';return;}
  // the same diary (a snapshot that changed nothing here): leave it, and any open tip, alone. Pins come from ES_refreshPins.
  if(ES_D._h===html) return;
  ES_closeTip(); ES_D._h=html; ES_D.innerHTML=html;
}
// one day again (after an edit), so the rest of the diary doesn't move
function ES_renderDay(e,box,art){
  Object.keys(ES.seg).forEach(k=>{if(ES.seg[k].day===e.day)delete ES.seg[k];});
  box.innerHTML=ES_essayHTML(e);
  art.classList.add('back');setTimeout(()=>art.classList.remove('back'),600);
}
function ES_refreshPins(){
  document.querySelectorAll('.es-c[data-k]').forEach(el=>{
    const s=ES.seg[el.dataset.k], pin=el.querySelector('.es-pin');
    if(!s) return;
    if(IM_listed(s)&&!pin) el.insertAdjacentHTML('beforeend',ES_PIN);
    if(!IM_listed(s)&&pin) pin.remove();
  });
}

/* a place in his text (offsets i..j in what he wrote, e.g. where he got a crossed-off item right): the view goes
   there and the words light up for a moment. Runs of his text carry data-o, marks data-i; a point inside a mark
   snaps to the edge of its corrected words. */
function ES_point(box,o,end){
  for(const el of box.querySelectorAll('[data-o],.es-c[data-k]')){
    if(el.classList.contains('es-c')){
      const s=ES.seg[el.dataset.k], a=+el.dataset.i, b=a+(s?s.mine.length:0);
      if(end?(o>a&&o<=b):(o>=a&&o<b)){const n=el.querySelector('.es-n'),w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t=w.nextNode(),l=t;if(end)while(t){l=t;t=w.nextNode();}return l?{node:l,off:end?l.length:0}:null;}
      continue;
    }
    if(el.closest('.es-c')) continue;
    let n=+el.dataset.o; const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
    for(let x=w.nextNode();x;x=w.nextNode()){
      if(x.nodeType===3){if(end?(o>n&&o<=n+x.length):(o>=n&&o<n+x.length))return {node:x,off:o-n};n+=x.length;}
      else if(x.nodeName==='BR') n+=1;
    }
  }
  return null;
}
function ES_goPlace(p){
  if(!p) return;
  if(VIEW!=='essays') setView('essays');
  if(ES.editDay!=null) ES_stopEdit();
  if(!document.getElementById('day-'+p.day)){const idx=sorted().findIndex(e=>e.day===p.day);if(idx>=0){ES.show=Math.max(ES.show,idx+1);ES_render();ES_refreshPins();}}
  const box=document.querySelector(`#day-${p.day} .es-text`); if(!box) return;
  const a=ES_point(box,p.i,false), b=ES_point(box,p.j,true); if(!a||!b) return;
  const r=document.createRange(); try{r.setStart(a.node,a.off);r.setEnd(b.node,b.off);}catch(e){return;}
  ES_D.querySelectorAll('.es-spot').forEach(x=>x.remove());
  // the glyphs' own boxes (text nodes only), one band per line
  const h=ES_D.getBoundingClientRect(), rs=[], w=document.createTreeWalker(r.commonAncestorContainer.nodeType===3?r.commonAncestorContainer.parentNode:r.commonAncestorContainer,NodeFilter.SHOW_TEXT);
  for(let t=w.nextNode();t;t=w.nextNode()){
    if(!r.intersectsNode(t)) continue;
    const q=document.createRange(); q.selectNodeContents(t);
    if(t===a.node) q.setStart(t,a.off); if(t===b.node) q.setEnd(t,b.off);
    for(const c of q.getClientRects()){
      if(c.width<1) continue;
      const l=rs.find(x=>Math.abs((x.top+x.bottom)/2-(c.top+c.bottom)/2)<c.height/2);
      if(l){l.left=Math.min(l.left,c.left);l.right=Math.max(l.right,c.right);l.top=Math.min(l.top,c.top);l.bottom=Math.max(l.bottom,c.bottom);}
      else rs.push({left:c.left,right:c.right,top:c.top,bottom:c.bottom});
    }
  }
  if(!rs.length) return;
  rs.forEach(q=>{q.width=q.right-q.left;q.height=q.bottom-q.top;});
  rs.forEach(q=>{const d=document.createElement('i');d.className='es-spot';d.setAttribute('aria-hidden','true');
    d.style.cssText=`left:${q.left-h.left-3}px;top:${q.top-h.top}px;width:${q.width+6}px;height:${q.height}px`;ES_D.appendChild(d);});
  const top=rs[0].top+scrollY-innerHeight/2+rs[0].height/2;
  window.scrollTo({top:Math.max(0,top),behavior:REDUCED()?'auto':'smooth'});
  setTimeout(()=>ES_D.querySelectorAll('.es-spot').forEach(x=>x.remove()),2200);
}

/* the tip, one look for every mark: what he wrote → the right way (pinyin over the words that changed), why, what the
   new words mean (the dictionary, by code), and one button: a correction can go on his list, a new word becomes a card.
   A tap on any other word of his gives its pinyin and meaning the same way. */
const ES_FINE=matchMedia('(hover:hover) and (pointer:fine)').matches;
/* the one hit test, for hover, click and tap alike: the mark whose highlighted characters are under the point. Only
   the glyphs count: not the line's leading, never his struck words (My version).
   `tol` (px) widens it for a finger. */
function ES_hit(x,y,tol=0){
  const pts=tol?[[x,y],[x-tol,y],[x+tol,y],[x,y-tol],[x,y+tol]]:[[x,y]];
  for(const [px,py] of pts){
    const el=document.elementFromPoint(px,py), u=el&&el.closest&&el.closest('.es-c[data-k] .es-n u.d');
    if(!u||!ES_D.contains(u)) continue;
    const cs=getComputedStyle(u), pl=parseFloat(cs.paddingLeft)||0, pr=parseFloat(cs.paddingRight)||0;
    for(const r of u.getClientRects())
      if(px>=r.left+pl-tol&&px<=r.right-pr+tol&&py>=r.top-tol&&py<=r.bottom+tol) return u.closest('.es-c[data-k]');
  }
  return null;
}
function ES_closeTip(){clearTimeout(ES.timer);clearTimeout(ES.wordT);ES_cancelHide();ES.span=null;document.getElementById('es-tip')?.remove();ES_D.querySelectorAll('.es-look').forEach(x=>x.remove());document.querySelectorAll('.es-c.on').forEach(c=>c.classList.remove('on'));ES.tip=null;ES.pinned=false;ES.anchor=null;}
const ES_addLabel=on=>on?ES_ICON_ON+'On my list':'Add to my list';

/* the meaning of a word, by code: /api/plus/look (site/src/cbp/look.ts, the dictionary), kept for the visit */
const ES_LOOK=new Map();
function ES_look(t,at){
  const k=t+'\u0001'+(at??'');
  if(!ES_LOOK.has(k)) ES_LOOK.set(k,fetch('/api/plus/look?'+new URLSearchParams(at==null?{t}:{t,at:String(at)}),{headers:{Authorization:'Bearer '+(lsGet('cb-token')||'')}})
    .then(r=>r.ok?r.json():{words:[]}).then(j=>Array.isArray(j.words)?j.words:[]).catch(()=>{ES_LOOK.delete(k);return [];}));
  return ES_LOOK.get(k);
}
const ES_HAN=/[㐀-䶿一-鿿豈-﫿]/;
// pinyin only over words he doesn't know yet (KNOWN, plus/kit.js, over the card kit's list: board/cardkit, known-words.txt's
// K words). Until the kit has loaded every word counts as new, so pinyin is never missing where it's needed.
const ES_kit=()=>typeof cardKit==='function'?cardKit().catch(()=>null):Promise.resolve(null);
const ES_new=w=>typeof KNOWN==='undefined'||KNOWN.needsPinyin(w,KNOWN.of(typeof CD!=='undefined'?CD.kit:null));
// the right way with pinyin over the words that changed and are new to him (RUBY), the changed characters marked.
// The highlighter goes on the characters only (a <u class="d"> inside the <ruby>), never over the pinyin above them.
async function ES_fixHTML(s){
  const ch=[]; diffSegs(s.t==='word'?'':s.mine,s.nat).forEach(([t,c])=>[...t].forEach(()=>ch.push(c)));
  await ES_kit();
  const box=document.createElement('span'); box.innerHTML=await RUBY.html(s.nat);
  const hl=c=>{const u=document.createElement('u');u.className='d';u.textContent=c;return u;};
  let k=0;
  const walk=n=>{for(const c of [...n.childNodes]){
    if(c.nodeType===3){const f=document.createDocumentFragment();[...c.nodeValue].forEach(x=>f.appendChild(ch[k++]?hl(x):document.createTextNode(x)));c.replaceWith(f);}
    else if(c.nodeName==='RUBY'){if(ch[k])c.dataset.d='1';k++;}
    else if(c.nodeName!=='RT') walk(c);
  }};
  walk(box);
  box.querySelectorAll('.rbw').forEach(w=>{
    const rs=[...w.querySelectorAll('ruby')], word=rs.map(r=>r.firstChild.nodeValue).join('');
    if(rs.some(r=>r.dataset.d)&&ES_new(word)) rs.forEach(r=>{if(r.dataset.d){r.firstChild.replaceWith(hl(r.firstChild.nodeValue));delete r.dataset.d;}});
    else{const f=document.createDocumentFragment();rs.forEach(r=>f.appendChild(r.dataset.d?hl(r.firstChild.nodeValue):document.createTextNode(r.firstChild.nodeValue)));w.replaceWith(f);}
  });
  return box.innerHTML;
}
// the meanings of the words that changed (a word mark: of the Chinese it gives)
async function ES_meanHTML(s){
  const ch=[]; diffSegs(s.t==='word'?'':s.mine,s.nat).forEach(([t,c])=>[...t].forEach(()=>ch.push(c)));
  const ws=(await ES_look(s.nat.slice(0,60))).filter(w=>w.g&&[...w.w].some((_,i)=>ch[w.i+i])).slice(0,2);
  if(!ws.length) return '';
  if(ws.length===1&&ws[0].w===s.nat.trim()) return esc(ws[0].g);
  return ws.map(w=>`<span class="zh" lang="zh-Hant">${esc(w.w)}</span> ${esc(w.g)}`).join('<br>');
}
// res: the try he just made ({t:'right'|'wrong', a: what he typed})
function ES_markTip(s,res){
  const word=s.t==='word', on=!!IM_listed(s), st=res?res.t:ES_tryOf(s);
  // not dealt with yet: his words, a field to fix them, and Show
  if(!st) return `<p class="es-tx"><span class="es-tm${word?' en':''}"${word?'':' lang="zh-Hant"'}>${word?esc(s.mine.trim()):mix(s.mine.trim())}</span></p>`
    +`<div class="es-try"><input class="es-ti" type="text" lang="zh-Hant" enterkeyhint="done" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Your fix"><button class="es-show" type="button">Show</button></div>`;
  const was=res&&res.t==='wrong'?`<s class="x-out es-tm" lang="zh-Hant">${mix(res.a.trim())}</s>`
    :word?`<span class="es-tm en">${esc(s.mine.trim())}</span>`:`<s class="x-out es-tm" lang="zh-Hant">${mix(s.mine.trim())}</s>`;
  return `<p class="es-tx">${st==='right'?`<span class="es-ok" aria-label="right">${ES_ICON_ON}</span>`:''}${was}<span class="es-ta" aria-hidden="true">→</span></p>`
    +`<p class="es-tf" lang="zh-Hant" data-fill="fix">${ES_hlHTML(s)}</p>`
    +(s.note?`<p class="es-tn">${zh(s.note)}</p>`:'')
    +`<p class="es-tg" data-fill="mean" hidden></p>`
    +(word?`<button class="es-add" type="button" data-card="${esc(s.nat.trim())}">Make a card</button>`
      :`<button class="es-add" id="es-add" type="button" aria-pressed="${on}">${ES_addLabel(on)}</button>`);
}
function ES_wordTip(w){
  return `<p class="es-tf es-tw1" lang="zh-Hant" data-fill="py">${esc(w.w)}</p><p class="es-tg" data-fill="mean"${w.g?'':' hidden'}>${esc(w.g||'')}</p>`
    +`<button class="es-add" type="button" data-card="${esc(w.w)}">Make a card</button>`;
}
// the tip sits over (or under) the line it opened on, inside the column and the screen
function ES_place(){
  const tip=document.getElementById('es-tip'), A=ES.anchor; if(!tip||!A) return;
  const h=ES_D.getBoundingClientRect(), r=ES_anchorRects()[A.ri]||A.r;
  const vw=document.documentElement.clientWidth, minL=Math.max(0,8-h.left), maxL=Math.min(h.width,vw-8-h.left)-tip.offsetWidth;
  const left=Math.max(minL,Math.min(A.x-h.left-28,maxL));
  const barBottom=BAR.getBoundingClientRect().bottom;
  tip.classList.remove('below');
  if(r.top-tip.offsetHeight-12>=barBottom) tip.style.top=(r.top-h.top-tip.offsetHeight-12)+'px';
  else{tip.classList.add('below');tip.style.top=(r.bottom-h.top+12)+'px';}
  tip.style.left=left+'px';
  tip.style.setProperty('--ox',Math.max(14,A.x-h.left-left)+'px');
}
function ES_showTip(id,html,r,px,onClick,pin=true,bands=[r]){
  ES_closeTip();
  ES.tip=id;ES.pinned=!!pin;
  const tip=document.createElement('div');
  tip.className='es-tip';tip.id='es-tip';tip.innerHTML=html;ES_D.appendChild(tip);
  const h=ES_D.getBoundingClientRect();
  // the words it belongs to, kept relative to the diary so they stay right after a scroll (the hover's corridor uses them)
  ES.anchor={r,x:px!=null?Math.min(Math.max(px,r.left),r.right):r.left+Math.min(24,r.width/2),
    rel:bands.map(q=>({l:q.left-h.left,t:q.top-h.top,w:q.right-q.left,h:q.bottom-q.top})),ri:Math.max(0,bands.indexOf(r))};
  tip.addEventListener('mouseenter',()=>{ES_HOV.on=true;ES_cancelHide();});
  tip.addEventListener('mouseleave',()=>{ES_HOV.on=false;if(!ES.pinned)ES_hideSoon();});
  ES_place();
  tip.addEventListener('click',e=>{
    e.stopPropagation();
    const c=e.target.closest('[data-card]');
    if(c){sfx('tap');const w=c.dataset.card;ES_closeTip();openCard(w,'essay');return;}
    if(onClick) onClick(e,tip);
  });
  return tip;
}
const ES_fill=(tip,k,html)=>{const el=tip.isConnected&&tip.querySelector(`[data-fill="${k}"]`);if(!el||!html)return;el.innerHTML=html;el.hidden=false;ES_place();};
function ES_openTip(c,pin,px,py){
  const s=ES.seg[c.dataset.k]; if(!s) return;
  if(ES.tip===s.id) return;
  const rs=[...c.querySelector('.es-n').getClientRects()];
  if(!rs.length){ES_closeTip();return;}
  // the line of the mark the pointer is on (a mark can wrap), else its first line
  let r=rs[0];
  if(py!=null) r=rs.reduce((b,q)=>Math.abs((q.top+q.bottom)/2-py)<Math.abs((b.top+b.bottom)/2-py)?q:b,rs[0]);
  const tip=ES_showTip(s.id,ES_markTip(s),r,px,e=>{
    if(e.target.closest('.es-show')){sfx('tap');ES_setTry(s,'shown');ES_fullTip(tip,s);return;}
    if(!e.target.closest('#es-add')) return;
    IM_toggle(s);
    const on=!!IM_listed(s), b=tip.querySelector('#es-add');
    sfx(on?'save':'unstamp');
    b.setAttribute('aria-pressed',on);b.innerHTML=ES_addLabel(on);
  },pin,rs);
  c.classList.add('on');
  const inp=tip.querySelector('.es-ti');
  if(!inp){ES_fullTip(tip,s,null,true);return;}
  // typing in it keeps the tip open; Enter checks (never mid-composition: Chinese is typed through an input method)
  inp.addEventListener('focus',()=>{ES.pinned=true;});
  inp.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.isComposing||e.keyCode===229) return;
    e.preventDefault();
    const a=inp.value; if(!a.trim()) return;
    const ok=TRIES.same(a,s.nat);
    ES_setTry(s,ok?'right':'wrong');
    ES_credit(s,ok);
    if(ok){sfx('save');const b=inp.getBoundingClientRect();celebrate('crossoff',{x:b.left+Math.min(b.width/2,60),y:b.top+b.height/2});}
    else sfx('tap');
    ES_fullTip(tip,s,{t:ok?'right':'wrong',a});
  });
  if(pin&&ES_FINE) inp.focus({preventScroll:true});
}
// the whole tip: the fix with its pinyin, why, the meaning, and the button
function ES_fullTip(tip,s,res,drawn){
  if(!drawn){tip.innerHTML=ES_markTip(s,res);ES_place();}
  ES_fixHTML(s).then(h=>ES_fill(tip,'fix',h)).catch(()=>{});
  ES_meanHTML(s).then(h=>ES_fill(tip,'mean',h)).catch(()=>{});
}
// the bands of the screen a run of his text takes, one per line (text nodes only)
function ES_bands(box,i,j){
  const a=ES_point(box,i,false), b=ES_point(box,j,true); if(!a||!b) return [];
  const r=document.createRange(); try{r.setStart(a.node,a.off);r.setEnd(b.node,b.off);}catch(e){return [];}
  const rs=[]; const root=r.commonAncestorContainer.nodeType===3?r.commonAncestorContainer.parentNode:r.commonAncestorContainer;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  for(let t=w.nextNode();t;t=w.nextNode()){
    if(!r.intersectsNode(t)) continue;
    const q=document.createRange(); q.selectNodeContents(t);
    if(t===a.node) q.setStart(t,a.off); if(t===b.node) q.setEnd(t,b.off);
    for(const c of q.getClientRects()){
      if(c.width<1) continue;
      const l=rs.find(x=>Math.abs((x.top+x.bottom)/2-(c.top+c.bottom)/2)<c.height/2);
      if(l){l.left=Math.min(l.left,c.left);l.right=Math.max(l.right,c.right);l.top=Math.min(l.top,c.top);l.bottom=Math.max(l.bottom,c.bottom);}
      else rs.push({left:c.left,right:c.right,top:c.top,bottom:c.bottom});
    }
  }
  rs.forEach(q=>{q.width=q.right-q.left;q.height=q.bottom-q.top;});
  return rs;
}
/* any word of his: rest the pointer on it (or tap it) for its pinyin and meaning, by code, extension or not */
// the character under the point (a caret falls on either side of it), or -1
function ES_charAt(box,o,px,py){
  const e=ES.essays.find(x=>x.day===+box.dataset.day); if(!e||o==null) return -1;
  const text=norm(e.text);
  const under=k=>{if(k<0||k>=text.length||!ES_HAN.test(text[k]))return false;const b=ES_bands(box,k,k+1)[0];return !!b&&px>=b.left-2&&px<=b.right+2&&py>=b.top-4&&py<=b.bottom+4;};
  return under(o)?o:under(o-1)?o-1:-1;
}
async function ES_openWord(box,o,px,py,pin=true){
  const e=ES.essays.find(x=>x.day===+box.dataset.day); if(!e) return;
  const text=norm(e.text);
  const at=ES_charAt(box,o,px,py);
  if(at<0){ES_closeTip();return;}
  let a=at,z=at+1;
  while(a>0&&at-a<24&&text[a-1]!=='\n')a--;
  while(z<text.length&&z-at<24&&text[z]!=='\n')z++;
  const id='w:'+e.day+':'+at; if(ES.tip===id) return;
  const show=(w,i,j)=>{
    const rs=ES_bands(box,i,j); if(!rs.length) return null;
    const r=rs.reduce((b,q)=>Math.abs((q.top+q.bottom)/2-py)<Math.abs((b.top+b.bottom)/2-py)?q:b,rs[0]);
    const tip=ES_showTip(id,ES_wordTip(w),r,px,null,pin,rs);
    const h=ES_D.getBoundingClientRect();
    rs.forEach(q=>{const d=document.createElement('i');d.className='es-look';d.setAttribute('aria-hidden','true');
      d.style.cssText=`left:${q.left-h.left-2}px;top:${q.top-h.top}px;width:${q.width+4}px;height:${q.height}px`;ES_D.appendChild(d);});
    if(w.g) ES_kit().then(()=>ES_new(w.w)?RUBY.html(w.w):null).then(x=>x&&ES_fill(tip,'py',x)).catch(()=>{});
    ES.span={day:e.day,i,j};
    return tip;
  };
  let tip=show({w:text[at],g:''},at,at+1);
  const ws=await ES_look(text.slice(a,z),at-a), w=ws[0];
  if(!w||ES.tip!==id) return;
  const keep=ES.pinned;
  ES_D.querySelectorAll('.es-look').forEach(x=>x.remove());
  tip=show(w,a+w.i,a+w.i+w.w.length);
  if(tip){ES.tip=id;ES.pinned=keep;}
}

/* hover, with a mouse: Chinese Brain's popup (src/content/popup.ts). The tip opens once the pointer rests a moment on a
   highlighted mark or a word; it stays while the pointer is on its words, on the tip, or on its way between them: the
   corridor from the words' edge to the tip's facing edge, and the "safe triangle" from the last point on the words to
   the tip's two near corners. Leaving any of those, it goes after a short grace. A click pins it (until a click away). */
const ES_HOV={x:-1,y:-1,exit:null,on:false,hiding:false,soft:0,intent:0,raf:0,ev:null};
const ES_INTENT=110, ES_GRACE=140;
function ES_inTri(p,a,b,c,pad){
  const side=(u,v,w,q)=>{const len=Math.hypot(v.x-u.x,v.y-u.y)||1,sq=(v.x-u.x)*(q.y-u.y)-(v.y-u.y)*(q.x-u.x),sw=(v.x-u.x)*(w.y-u.y)-(v.y-u.y)*(w.x-u.x);return sq*Math.sign(sw||1)>=-pad*len;};
  return side(a,b,c,p)&&side(b,c,a,p)&&side(c,a,b,p);
}
function ES_inTrap(p,from,to,lo0,hi0,lo1,hi1,q,pad){
  const len=Math.abs(to-from), t=(p-from)*(to>=from?1:-1);
  if(t<=0||t>len+pad) return false;
  const f=len?Math.min(1,t/len):0;
  return q>=lo0+(lo1-lo0)*f-pad&&q<=hi0+(hi1-hi0)*f+pad;
}
// the open tip's words, on screen now
function ES_anchorRects(){
  const A=ES.anchor; if(!A||!A.rel) return [];
  const h=ES_D.getBoundingClientRect();
  return A.rel.map(q=>({left:q.l+h.left,top:q.t+h.top,right:q.l+q.w+h.left,bottom:q.t+q.h+h.top}));
}
const ES_onAnchor=(x,y)=>ES_anchorRects().some(a=>x>=a.left-2&&x<=a.right+2&&y>=a.top-2&&y<=a.bottom+2);
function ES_inBridge(x,y){
  const tip=document.getElementById('es-tip'), rs=ES_anchorRects(); if(!tip||!rs.length||x<0) return false;
  if(ES_onAnchor(x,y)) return false;
  const c=tip.getBoundingClientRect(), pad=8, e=ES_HOV.exit;
  // the band nearest the tip is the one the pointer leaves from
  const a=rs.reduce((b,q)=>Math.min(Math.abs(q.top-c.bottom),Math.abs(q.bottom-c.top))<Math.min(Math.abs(b.top-c.bottom),Math.abs(b.bottom-c.top))?q:b,rs[0]);
  let near=null,lane=false;
  if(c.top>=a.bottom-2){lane=ES_inTrap(y,a.bottom,c.top,a.left,a.right,c.left,c.right,x,pad);near=[{x:c.left,y:c.top},{x:c.right,y:c.top}];}
  else if(c.bottom<=a.top+2){lane=ES_inTrap(y,a.top,c.bottom,a.left,a.right,c.left,c.right,x,pad);near=[{x:c.left,y:c.bottom},{x:c.right,y:c.bottom}];}
  // the triangle only counts past the words' edge, so the words beside them on their line still open their own tips
  const past=c.top>=a.bottom-2?y>a.bottom:c.bottom<=a.top+2?y<a.top:true;
  return lane||(past&&!!near&&!!e&&ES_inTri({x,y},e,near[0],near[1],pad));
}
function ES_cancelHide(){clearTimeout(ES_HOV.soft);ES_HOV.hiding=false;}
function ES_hideSoon(ms=ES_GRACE){
  if(!ES.tip||ES.pinned||ES_HOV.hiding) return;
  ES_HOV.hiding=true;
  const check=()=>{
    if(!ES.tip||ES.pinned||ES_HOV.on){ES_HOV.hiding=false;return;}
    if(ES_inBridge(ES_HOV.x,ES_HOV.y)||ES_onAnchor(ES_HOV.x,ES_HOV.y)){ES_HOV.soft=setTimeout(check,50);return;}
    ES_HOV.hiding=false;ES_closeTip();
  };
  ES_HOV.soft=setTimeout(check,ms);
}
// what's under the pointer: a mark, or a word of his (null for neither)
function ES_under(ev){
  const x=ev.clientX,y=ev.clientY, c=ES_hit(x,y);
  if(c) return {key:c.dataset.k,open:()=>ES_openTip(c,false,x,y)};
  const box=ev.target.closest&&ev.target.closest('.es-text');
  if(!box||ev.target.closest('.es-c')||+box.dataset.day===ES.editDay) return null;
  const o=ES_caretOffset(ev,box), at=ES_charAt(box,o,x,y); if(at<0) return null;
  const day=+box.dataset.day, S=ES.span;
  if(S&&S.day===day&&at>=S.i&&at<S.j&&String(ES.tip).startsWith('w:')) return {key:ES.tip,open:()=>{}};
  return {key:'w:'+day+':'+at,open:()=>ES_openWord(box,o,x,y,false)};
}
function ES_hover(ev){
  const x=ev.clientX,y=ev.clientY;
  if(ES.pinned||ES.editDay!=null||String(getSelection()||'').trim()) return;
  // on the open tip's words: it stays, and this is where the safe triangle starts
  if(ES.tip&&ES_onAnchor(x,y)){ES_HOV.exit={x,y};ES_cancelHide();clearTimeout(ES_HOV.intent);return;}
  const t=ES_under(ev);
  if(t&&t.key===ES.tip){ES_cancelHide();clearTimeout(ES_HOV.intent);return;}
  // on the way to the tip: nothing else opens, however slowly he moves
  if(ES.tip&&ES_inBridge(x,y)){clearTimeout(ES_HOV.intent);return;}
  clearTimeout(ES_HOV.intent);
  if(!t){if(ES.tip)ES_hideSoon();return;}
  ES_HOV.intent=setTimeout(()=>{ES_HOV.exit={x,y};t.open();},ES_INTENT);
}
document.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'){ES_HOV.x=e.clientX;ES_HOV.y=e.clientY;}},{capture:true,passive:true});
ES_D.addEventListener('pointermove',e=>{
  if(e.pointerType!=='mouse'||e.buttons||e.target.closest('#es-tip')) return;
  // once a frame at most: the hit tests read the layout
  ES_HOV.ev=e; if(ES_HOV.raf) return;
  ES_HOV.raf=requestAnimationFrame(()=>{ES_HOV.raf=0;const ev=ES_HOV.ev;if(ev&&VIEW==='essays')ES_hover(ev);});
},{passive:true});
ES_D.addEventListener('pointerleave',e=>{if(e.pointerType!=='mouse')return;clearTimeout(ES_HOV.intent);if(ES.tip&&!ES.pinned&&!ES_HOV.on)ES_hideSoon();});

/* editing a past day, in place: the same box, the same type; it saves as he types */
function ES_caretOffset(ev,box){
  let node=null,off=0;
  try{
    if(document.caretPositionFromPoint){const p=document.caretPositionFromPoint(ev.clientX,ev.clientY);if(p){node=p.offsetNode;off=p.offset;}}
    else if(document.caretRangeFromPoint){const r=document.caretRangeFromPoint(ev.clientX,ev.clientY);if(r){node=r.startContainer;off=r.startOffset;}}
  }catch(e){}
  if(!node) return null;
  const el=node.nodeType===1?node:node.parentElement;
  const mk=el&&el.closest('[data-i]'); if(mk&&box.contains(mk)) return +mk.dataset.i;
  const host=el&&el.closest('[data-o]'); if(!host||!box.contains(host)) return null;
  // characters before the caret inside this run of his text; a <br> stands for one newline
  let n=0; const w=document.createTreeWalker(host,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
  for(let x=w.nextNode();x;x=w.nextNode()){
    if(x===node){n+=x.nodeType===3?off:0;break;}
    if(x.nodeType===3) n+=x.length; else if(x.nodeName==='BR') n+=1;
  }
  return +host.dataset.o+n;
}
function ES_startEdit(day,offset){
  if(ES.editDay===day) return;
  ES_stopEdit(); ES_closeTip();
  const e=ES.essays.find(x=>x.day===day), art=document.getElementById('day-'+day), box=art&&art.querySelector('.es-text');
  if(!e||!box) return;
  ES.editDay=day; ES.editBefore=e.text||'';
  box.innerHTML=ES_editHTML(e);
  PARA_attach(box); box.spellcheck=false;
  box.setAttribute('role','textbox'); box.setAttribute('aria-multiline','true'); box.setAttribute('aria-label','Day '+day);
  art.classList.add('editing');
  box.focus({preventScroll:true});
  PARA_caret(box,offset==null?null:Math.max(0,Math.min(offset,norm(e.text).length)));
}
function ES_stopEdit(){
  const day=ES.editDay; if(day==null) return;
  ES.editDay=null;
  const e=ES.essays.find(x=>x.day===day), art=document.getElementById('day-'+day), box=art&&art.querySelector('.es-text');
  if(e) flushNow(e.date);
  // a past-day edit is one step for Cmd+Z
  if(e&&ES.editBefore!=null&&norm(e.text)!==norm(ES.editBefore)) record({essay:{day,date:e.date,before:ES.editBefore,after:e.text||''}});
  ES.editBefore=null;
  if(box){box.removeAttribute('contenteditable');['role','aria-multiline','aria-label'].forEach(a=>box.removeAttribute(a));}
  if(art) art.classList.remove('editing');
  if(ES.stale||!e||!String(e.text||'').trim()||!box||VIEW!=='essays') ES_render(); else ES_renderDay(e,box,art);
  ES_refreshPins(); IM_render(); renderHints();
}
ES_D.addEventListener('input',ev=>{
  const box=ev.target.closest&&ev.target.closest('.es-text'); if(!box||+box.dataset.day!==ES.editDay) return;
  const e=ES.essays.find(x=>x.day===ES.editDay); if(!e) return;
  // a corrected spot he has rewritten loses its mark (the correction drops when he leaves)
  box.querySelectorAll('.es-was').forEach(s=>s.classList.toggle('gone',s.textContent!==s.dataset.mine));
  scheduleSave(e.day,e.date,PARA_text(box));
});
ES_D.addEventListener('focusout',ev=>{
  const box=ev.target.closest&&ev.target.closest('.es-text'); if(!box||+box.dataset.day!==ES.editDay) return;
  setTimeout(()=>{if(ES.editDay===+box.dataset.day&&document.activeElement!==box)ES_stopEdit();},0);
});
ES_D.addEventListener('click',e=>{
  if(e.target.closest('#es-tip')) return;
  if(e.target.id==='es-more'){sfx('tap');ES.show+=14;ES_render();ES_refreshPins();return;}
  const box=e.target.closest('.es-text');
  if(box&&+box.dataset.day===ES.editDay) return;
  const c=e.clientX||e.clientY?ES_hit(e.clientX,e.clientY,ES_FINE?0:8):e.target.closest('.es-c[data-k]');
  if(c){
    e.stopPropagation();
    // a click on the words of the tip the hover opened pins it; on a pinned one it closes it
    if(ES.tip===c.dataset.k){if(!ES.pinned){ES.pinned=true;return;}ES_closeTip();return;}
    ES_openTip(c,true,e.clientX||null,e.clientY||null);
    return;
  }
  // a word of his own text: its pinyin and meaning. With a mouse it waits a moment, so a double-click still edits.
  if(box&&(e.clientX||e.clientY)&&!e.target.closest('.es-c')&&!String(getSelection()||'').trim()){
    const o=ES_caretOffset(e,box), x=e.clientX, y=e.clientY;
    if(o!=null){
      clearTimeout(ES.wordT);
      if(e.detail>1) return;
      const at=ES_charAt(box,o,x,y), S=ES.span;
      if(at>=0&&S&&S.day===+box.dataset.day&&at>=S.i&&at<S.j&&!ES.pinned){ES.pinned=true;return;}
      ES.wordT=setTimeout(()=>ES_openWord(box,o,x,y),ES_FINE?260:0);
      return;
    }
  }
  if(ES.tip) ES_closeTip();
});
ES_D.addEventListener('dblclick',e=>{
  clearTimeout(ES.wordT);
  const box=e.target.closest('.es-text'); if(!box||+box.dataset.day===ES.editDay) return;
  ES_startEdit(+box.dataset.day,ES_caretOffset(e,box));
});
ES_D.addEventListener('keydown',e=>{
  const box=e.target.closest('.es-text');
  if(box&&+box.dataset.day===ES.editDay){
    if(e.key==='Escape'||(e.key==='Enter'&&(e.metaKey||e.ctrlKey))){e.preventDefault();e.stopPropagation();box.blur();}
    return;
  }
  const c=e.target.closest('.es-c[data-k]');
  if(c&&(e.key==='Enter'||e.key===' ')){e.preventDefault();ES_openTip(c,true);return;}
  if(e.target.classList.contains('es-text')&&e.key==='Enter'){e.preventDefault();ES_startEdit(+e.target.dataset.day,null);}
});
// a tap (or Enter) opens a mark too, and pins it; with a mouse, resting on it opens it (his rule, 2026-11-26)
document.addEventListener('click',e=>{if(ES.tip&&!e.target.closest('#es-tip')&&!e.target.closest('#ess-days'))ES_closeTip();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')ES_closeTip();});
// the tip follows its words when the page reflows (a phone turning, the window resizing)
// (a phone's keyboard coming up for his try resizes the window: the tip stays, and follows)
addEventListener('resize',()=>{if(!ES.tip)return;if(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#es-tip'))ES_place();else ES_closeTip();});
// his own text inline is off by default (the essay reads clean); the choice stays on this device
const ES_MINE=document.getElementById('mine');
function ES_showMine(on){ES_MINE.setAttribute('aria-checked',String(on));ES_D.classList.toggle('es-hide-mine',!on);}
ES_showMine(lsGet('show-mine')==='1');
// phones: To improve is folded above the diary; the disclosure opens it
document.getElementById('es-disc').onclick=function(){
  const side=this.closest('.es-side'), on=!side.classList.contains('open');
  side.classList.toggle('open',on);this.setAttribute('aria-expanded',String(on));sfx('tap');
};
// it rides along at the top while he scrolls (sticky, css), and only then gets a soft pill behind it
const ES_TOP=document.getElementById('es-top');
const ES_stuck=()=>{if(VIEW!=='essays')return;const t=parseFloat(getComputedStyle(ES_TOP).top)||0;ES_TOP.classList.toggle('stuck',ES_D.getBoundingClientRect().top<t-6);};
addEventListener('scroll',ES_stuck,{passive:true});BUS.on('view',v=>{if(v==='essays')setTimeout(ES_stuck,0);});
ES_MINE.onclick=()=>{ES_closeTip();const on=ES_MINE.getAttribute('aria-checked')!=='true';ES_showMine(on);lsSet('show-mine',on?'1':'0');sfx('tap');};

BUS.on('leave',()=>{ES_closeTip();ES_stopEdit();});
// on every visit: a day he finished on Today since gets its stamp (the render is a no-op when nothing changed)
BUS.on('view',v=>{if(v==='essays'){ES_render();ES_refreshPins();}});
BUS.on('essays',()=>{ES_render();ES_refreshPins();});
BUS.on('reviews',()=>{ES_render();ES_refreshPins();});
BUS.on('items',()=>ES_refreshPins());
