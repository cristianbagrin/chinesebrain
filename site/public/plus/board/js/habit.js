/* ---------- the habit: today's steps, the streak, the year. Owner: Habit (wave 3)
   The rules are HABIT's (plus/kit.js, from site/src/cbp/habit.ts, shared with the server): a day is done when its
   reviews are cleared and the essay is written; a test that day deepens its green; the first missed day of a Mon–Sun
   week is a rest (the streak holds); after a miss, the next day's bar is lower (reviews and three sentences).
   Today (#habit-steps, first on Today): Reviews · Essay · Test, each ticking itself off from what happened (BUS
   reviews:done / reviews:changed, essay:written, test), and the streak, once, big. The moment the day turns done:
   a celebration and BUS 'day:done' {date, streak}, once a day (once('day:<date>')), never for a day already done when
   the page opened. The heatmap: HB_render(el, full) into #habit-today (the weeks so far) and #pr-habit (the year);
   done, done with a test (deeper), rest (a ring), partial (pale), missed (blank). A tap on a day shows its numbers.
   Reviews come from the collection on this device (RVH, review/main.ts: Anki's imported log plus every review since);
   the server keeps a log of each day's report (GET/POST /api/plus/habit) for the evening nudge (Settings › Habit).
   Also here: the one tap tip anything on the board can use ([data-tip]): a click or tap shows it, never a hover. ---------- */
const HB={done:null,pop:false,k:null,log:{},rv:null,posted:'',settled:false,t0:performance.now(),walk:null};
// Chinese characters only: English words inside an essay don't count as writing Chinese
const HB_han=t=>(String(t||'').match(/[㐀-鿿豈-﫿]/g)||[]).length;
const HB_fmt=n=>Number(n||0).toLocaleString('en-US');
const HB_api=(path,body)=>fetch('/api/plus/'+path,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+(lsGet('cb-token')||''),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}).then(r=>r.ok?r.json():null).catch(()=>null);
const HB_has=()=>!!(window.RVH);
const HB_rvReady=()=>HB_has()&&window.RVH.ready();

// reviews a day and the days that ended with reviews left, from the collection (date keys); kept until it changes
function HB_reviews(){
  if(HB.rv||!HB_rvReady()) return HB.rv;
  try{
    const R=window.RVH, {count,open}=HABIT.reviewDays(R.cards(),R.dayOf,R.today()), c={}, o=new Set();
    count.forEach((n,d)=>{c[R.date(d)]=n;});
    open.forEach(d=>o.add(R.date(d)));
    HB.rv={count:c,open:o};
  }catch(e){console.error(e);}
  return HB.rv;
}

// today's reviews are cleared: the queue is empty now, or it was earlier today (it stays ticked when a learning card
// comes back later), or another device said so
function HB_clearedToday(tk){
  if(!HB_has()) return true;
  if(lsGet('habit-cleared')===tk||(HB.log[tk]&&HB.log[tk].cleared)) return true;
  const l=window.RVH.left();
  if(l===0){lsSet('habit-cleared',tk);return true;}
  return false;
}
function HB_testDone(){
  try{return !!(testOpen()&&steps().length&&steps().every(s=>s.a.answer));}catch(e){return false;}
}

// date -> HABIT Day {rv, cleared, chars, sent, cards, test}, and the extra the tip shows (test [passed, answered])
function HB_map(){
  const m={}, D=STATE||{}, tk=essayToday(), rv=HB_reviews();
  const get=k=>m[k]||(m[k]={...HABIT.blank(),tt:null});
  (ES.essays||[]).forEach(e=>{if(e&&e.date&&String(e.text||'').trim()){const d=get(e.date);d.chars=Math.max(1,HB_han(e.text));d.sent=HABIT.sentences(e.text);}});
  for(const [k,v] of Object.entries(D.words||{})) if(+v>0) get(k).cards+=+v;
  for(const [k,v] of Object.entries(D.tests||{})) if(Array.isArray(v)&&+v[1]>0){const d=get(k);d.tt=[+v[0]||0,+v[1]];d.test=true;}
  // the open test: answers given that board/data hasn't counted yet
  try{
    const live={};
    steps().forEach(s=>{const a=s.a||{};if(a.answer&&a.at){const x=live[a.at]||(live[a.at]=[0,0]);x[1]++;if(a.result==='pass')x[0]++;}});
    for(const [k,v] of Object.entries(live)){const d=get(k);if(!d.tt)d.tt=v;}
  }catch(e){}
  if(HB_testDone()) get(tk).test=true;
  if(rv) for(const [k,n] of Object.entries(rv.count)) get(k).rv=n;
  // a past day is cleared unless the log of reviews says cards were left due when it ended (or the server heard so)
  for(const [k,v] of Object.entries(HB.log)) if(v&&v.cleared) get(k);
  for(const k of Object.keys(m)) m[k].cleared=k===tk?HB_clearedToday(tk):!(rv&&rv.open.has(k))||!!(HB.log[k]&&HB.log[k].cleared);
  if(!m[tk]) get(tk).cleared=HB_clearedToday(tk);
  return m;
}

function HB_tip(d,k,s){
  const L=[], st=s?s.st:'pre';
  if(d.rv) L.push(`<span class="hb-tl"><i class="hm-k ${d.cleared?'l3':'l1'}"></i>${HB_fmt(d.rv)} review${d.rv>1?'s':''}</span>`);
  if(d.chars) L.push(`<span class="hb-tl"><i class="hm-k l3"></i>${HB_fmt(d.chars)} characters</span>`);
  if(d.cards) L.push(`<span class="hb-tl"><i class="hm-k l1"></i>${d.cards} new card${d.cards>1?'s':''}</span>`);
  if(d.tt) L.push(`<span class="hb-tl"><i class="hm-k l4"></i>Test, ${d.tt[0]} of ${d.tt[1]}</span>`);
  if(st==='rest') L.unshift('<span class="hb-tl"><i class="hm-k rest"></i>Rest day</span>');
  if(!L.length){
    if(st==='pre') return '';
    L.push(`<span class="hb-tl q">${st==='open'?'Not yet':'Nothing'}</span>`);
  }
  return `<span class="hb-th">${k===essayToday()?'Today':fmtDate(P(k))}</span>${L.join('')}`;
}

function HB_heat(full,m,W0){
  const tk=essayToday(), T=P(tk), S=W0.days;
  const y=T.getFullYear(), j1=new Date(y,0,1), d31=new Date(y,11,31);
  const first=monday(j1), lastMon=monday(T);
  const total=days(first,monday(d31))/7+1, W=full?total:days(first,lastMon)/7+1;
  const cells=[], heads=[];
  for(let w=0;w<W;w++){
    const mon=add(first,7*w);
    for(let i=0;i<7;i++){
      const dt=add(mon,i), k=K(dt);
      if(dt.getDate()===1&&dt.getFullYear()===y&&(dt<=T||full)) heads.push(`<span style="grid-column:${w+1}"${dt.getMonth()===T.getMonth()?' class="now"':dt>T?' class="later"':''}>${MO[dt.getMonth()]}</span>`);
      if(dt<j1||dt>T){cells.push('<i class="hm-c off" aria-hidden="true"></i>');continue;}
      const d=m[k]||HABIT.blank(), s=S[k], st=s?s.st:(d.rv||d.cards||d.test)?'partial':'pre';
      const cls=st==='done'?(s.deep?'deep':'done'):st==='open'?'open':st;
      const tip=HB_tip(d,k,s), pop=k===tk&&st==='done'&&HB.pop;
      cells.push(`<i class="hm-c ${cls}${k===tk?' today':''}${pop?' pop':''}"${tip?` data-tip="${esc(tip)}"`:''}></i>`);
    }
  }
  // the 1st of January sits mid-week: its label goes on the first column anyway
  if(!heads.length||!/grid-column:1"/.test(heads[0])) heads.unshift(`<span style="grid-column:1">${MO[0]}</span>`);
  return `<div class="hm-in" style="--w:${W};--wt:${total}" data-cols="${W}" data-y="${y}">
    <div class="hm-mo" aria-hidden="true">${heads.join('')}</div>
    <div class="hm-wd" aria-hidden="true"><span>M</span><span></span><span>W</span><span></span><span>F</span><span></span><span></span></div>
    <div class="hm-g" role="img" aria-label="Every day this year">${cells.join('')}</div></div>`;
}

function HB_state(){
  const m=HB_map(), w=HABIT.walk(m,essayToday());
  HB.walk=w;
  return {m,w};
}
// el gets the tracker; full = Progress (the whole year)
function HB_render(el,full,st){
  if(!el) return;
  let html='';
  try{const {m,w}=st||HB_state();html=HB_heat(!!full,m,w);}catch(e){console.error(e);}
  el.innerHTML=`<div class="hm ${full?'hm-full':'hm-today'}">${html}</div>`;
}

/* ---------- Today: the three steps and the streak ---------- */
const HB_CHECK='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function HB_steps(st){
  const el=document.getElementById('habit-steps'); if(!el) return;
  const tk=essayToday(), d=st.m[tk]||HABIT.blank(), low=st.w.low, s=st.w.days[tk];
  const done=!!(s&&s.st==='done');
  let test=false; try{test=!!testOpen()||!!d.tt;}catch(e){}
  const step=(id,label,on)=>`<button type="button" class="hs-s${on?' on':''}" data-go="${id}" aria-pressed="${on}"><i class="hs-c">${on?HB_CHECK:''}</i><span>${label}</span></button>`;
  const essayOn=low?d.sent>=HABIT.LOW_SENTENCES:d.chars>0;
  const n=st.w.streak;
  el.classList.toggle('done',done);
  el.innerHTML=`<div class="hs-steps">${HB_has()?step('reviews','Reviews',d.cleared):''}${step('essay',low?'3 sentences':'Essay',essayOn)}${test?step('test','Test',d.test):''}</div>
    <div class="hs-streak"${n?'':' hidden'}><b>${n}</b><span>day${n===1?'':'s'}</span></div>`;
}
document.getElementById('habit-steps')?.addEventListener('click',e=>{
  const b=e.target.closest('[data-go]'); if(!b) return;
  sfx('tap');
  const go=b.dataset.go;
  if(go==='reviews'){if(VIEWS.includes('reviews'))setView('reviews');return;}
  const el=document.getElementById(go==='essay'?'write':'quiz'); if(!el||el.hidden) return;
  el.scrollIntoView({behavior:REDUCED()?'auto':'smooth',block:'start'});
  if(go==='essay'){const sh=document.getElementById('sheet');if(sh)setTimeout(()=>{sh.focus({preventScroll:true});placeCaret(sh,null);},REDUCED()?0:350);}
});

// what this device knows about today goes to the server (for the evening nudge), when it changes
let HB_postT=0;
function HB_post(st){
  const tk=essayToday(), d=st.m[tk]; if(!d||!ES.loaded) return;
  const data={rv:d.rv,cleared:d.cleared,chars:d.chars,sent:d.sent,cards:d.cards,test:d.test}, low=st.w.low;
  const key=tk+JSON.stringify(data)+low;
  if(key===HB.posted) return;
  clearTimeout(HB_postT);
  HB_postT=setTimeout(async()=>{
    const r=await HB_api('habit',{day:tk,data,low});
    if(r){HB.posted=key;HB.log[tk]=r;}
  },1500);
}

// the page has its data: what the day is now is what it was when it opened, so no celebration for it
const HB_ready=()=>ES.loaded&&(!HB_has()||HB_rvReady())&&performance.now()-HB.t0>4000;
function HB_today(){
  let st;
  try{st=HB_state();}catch(e){console.error(e);return;}
  const tk=essayToday(), s=st.w.days[tk], done=!!(s&&s.st==='done');
  if(HB.k!==tk){HB.k=tk;HB.done=null;}
  // the moment the day turns done: a celebration and BUS day:done, once
  const turned=HB.settled&&HB.done===false&&done;
  HB.pop=turned;
  HB_steps(st);
  HB_render(document.getElementById('habit-today'),false,st);
  HB.pop=false;
  if(HB_ready()){
    if(turned&&once('day:'+tk)){
      const b=document.querySelector('#habit-steps .hs-streak b')||document.getElementById('habit-steps');
      const r=b&&b.getBoundingClientRect();
      if(VIEW==='today'&&r&&r.width) celebrate('test',{x:r.left+r.width/2,y:r.top+r.height/2});
      BUS.emit('day:done',{date:tk,streak:st.w.streak});
    }
    HB.settled=true;HB.done=done;
  }
  HB_post(st);
  BUS.emit('habit');
}
let HB_t=0;
const HB_soon=()=>{clearTimeout(HB_t);HB_t=setTimeout(HB_today,120);};
['data','essays','test','nodb','essay:written','reviews:done'].forEach(ev=>BUS.on(ev,HB_soon));
BUS.on('reviews:changed',()=>{HB.rv=null;HB_soon();});
BUS.on('view',v=>{if(v==='today')HB_soon();});
// the day turns over at 4 am: a board left open overnight moves on by itself (and a new week gets its column);
// and once the page has settled, today's state counts as the baseline
setInterval(()=>{if(HB.k&&HB.k!==essayToday()){HB.rv=null;HB_today();}},60000);
setTimeout(HB_soon,4200);
HB_api('habit').then(r=>{if(r&&r.days){HB.log=r.days;HB_soon();}});

/* ---------- Settings › Habit: the nudge on this phone (Web Push; the time is LAB 'nudge', kit/settings.ts) ---------- */
const HBP={state:'',busy:false};
const HB_ios=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const HB_standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
async function HB_pushState(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)) return HB_ios()&&!HB_standalone()?'install':'none';
  if(Notification.permission==='denied') return 'denied';
  try{const r=await navigator.serviceWorker.getRegistration('/plus');const s=r&&await r.pushManager.getSubscription();return s?'on':'off';}catch(e){return 'off';}
}
const HB_key=s=>{const t=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4));return Uint8Array.from(t,c=>c.charCodeAt(0));};
async function HB_pushOn(){
  // the permission first, inside the tap (iOS asks only then)
  const p=await Notification.requestPermission();
  if(p!=='granted') return p==='denied'?'denied':'off';
  const reg=(await navigator.serviceWorker.getRegistration('/plus'))||(await navigator.serviceWorker.register('/plus/sw.js',{scope:'/plus'}));
  await navigator.serviceWorker.ready;
  const k=await HB_api('nudge/key'); if(!k||!k.key) return 'off';
  let sub=await reg.pushManager.getSubscription();
  if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:HB_key(k.key)});
  const r=await HB_api('nudge/sub',sub.toJSON());
  return r&&r.ok?'on':'off';
}
async function HB_pushOff(){
  const reg=await navigator.serviceWorker.getRegistration('/plus'), sub=reg&&await reg.pushManager.getSubscription();
  if(sub){await HB_api('nudge/unsub',{endpoint:sub.endpoint});await sub.unsubscribe().catch(()=>{});}
  return 'off';
}
const HB_SAY={install:'Add to Home Screen first',none:'Not in this browser',denied:'Blocked in Settings'};
LAB.row('habit-push','Habit',{
  html:()=>{
    const s=HBP.state;
    if(!s||LAB.get('nudge')==='off') return '';
    if(HB_SAY[s]) return `<div class="st-row"><span class="st-l">On this device</span><span class="st-say">${HB_SAY[s]}</span></div>`;
    const on=s==='on';
    return `<div class="st-row"><span class="st-l">On this device</span><button type="button" role="switch" class="st-tg hb-push" aria-checked="${on}" aria-label="On this device"${HBP.busy?' disabled':''}><i></i></button></div>`;
  },
  bind(el){
    const b=el&&el.querySelector('.hb-push'); if(!b) return;
    b.onclick=async e=>{
      e.stopPropagation();
      if(HBP.busy) return;
      HBP.busy=true;
      const on=HBP.state!=='on';
      sfx(on?'stamp-known':'unstamp');
      try{HBP.state=on?await HB_pushOn():await HB_pushOff();}catch(err){console.error(err);HBP.state=await HB_pushState();}
      HBP.busy=false;
      SETTINGS.redraw();
    };
  }
});
HB_pushState().then(s=>{HBP.state=s;SETTINGS.redraw();});

/* ---------- the tip: one small floating note for anything with data-tip, on a click or tap (never on hover) ---------- */
(()=>{
  const tip=document.createElement('div');
  tip.className='hb-tip';tip.setAttribute('role','tooltip');tip.hidden=true;
  document.body.appendChild(tip);
  let cur=null;
  const find=e=>e.target&&e.target.closest?e.target.closest('[data-tip]'):null;
  function show(el){
    const h=el.getAttribute('data-tip');if(!h){hide();return;}
    if(cur&&cur!==el)cur.classList.remove('hb-hot');
    cur=el;el.classList.add('hb-hot');
    tip.innerHTML=h;tip.hidden=false;
    const r=el.getBoundingClientRect(), w=tip.offsetWidth, ht=tip.offsetHeight;
    const x=Math.max(8,Math.min(innerWidth-w-8,r.left+r.width/2-w/2));
    let y=r.top-ht-10; if(y<76) y=r.bottom+10;
    tip.style.left=Math.round(x)+'px';tip.style.top=Math.round(y)+'px';
  }
  function hide(){if(cur)cur.classList.remove('hb-hot');cur=null;tip.hidden=true;}
  document.addEventListener('click',e=>{const el=find(e);if(el){if(el===cur)hide();else show(el);}else if(cur)hide();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&cur)hide();});
  addEventListener('scroll',()=>{if(cur)hide();},{passive:true});
  addEventListener('resize',()=>{if(cur)hide();});
  BUS.on('leave',hide);
})();
