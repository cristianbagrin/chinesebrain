/* ---------- the habit: today's steps, the streak, the year. Owner: Habit (wave 3)
   The rules are HABIT's (plus/kit.js, from site/src/cbp/habit.ts, shared with the server): a day is done when its
   reviews are cleared and the essay is written; a test that day deepens its green; the first missed day of a Mon–Sun
   week is a rest (the streak holds); after a miss, the next day's bar is lower (reviews and three sentences).
   Today (#habit-steps): the streak ring and Reviews · Essay · Test, each crossed out from what happened (BUS
   reviews:done / reviews:changed, essay:written / essay:left, test). The moment the day turns done: the list folds into
   the ring, a burst, and BUS 'day:done' {date, streak}, once a day (once('day:<date>')), never for a day already done
   when the page opened. The heatmap: HB_render(el, full) into #habit-today (the weeks so far) and #pr-habit (the year);
   done, done with a test (deeper), rest (looks done: a rest is part of the habit), partial (pale), missed (blank). A tap on a day shows its numbers.
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
  m[tk]=Object.assign(HB_hold(m[tk],HB_W.writing,HB_W.counted===tk),{tt:m[tk].tt});
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

// cap: at most this many columns (the latest), so a narrow Today keeps cells big enough to read
function HB_heat(full,m,W0,cap){
  const tk=essayToday(), T=P(tk), S=W0.days, y=T.getFullYear();
  // a column a week, and every month starts its own column (HABIT.columns): the edge between two months steps where the
  // 1st falls mid-week, and an empty column parts them where it would be flush (a 1st on a Monday)
  // across the turn of a year: Today reaches back into the last year when this one has fewer weeks than fit; Progress shows
  // the twelve months ending now in January and February (kit/span.ts)
  const H=SPAN.heat(tk,full,cap), all=H.cols, from=cap&&!full?Math.max(0,all.length-cap):0, C=all.slice(from), n=C.length, thisY=ci=>from+ci>=H.n0;
  const cells=[], heads=[];
  C.forEach((c,ci)=>{
    if(c.first){const d1=P(c.days.find(Boolean));heads.push(`<span style="grid-column:${ci+1}" data-c="${ci}"${thisY(ci)&&c.month===T.getMonth()?' class="now"':d1>T?' class="later"':''}>${MO[c.month]}</span>`);}
    c.days.forEach(k=>{
      if(!k||k>tk){cells.push('<i class="hm-c off" aria-hidden="true"></i>');return;}
      const d=m[k]||HABIT.blank(), sv=S[k], st=sv?sv.st:(d.rv||d.cards||d.test)?'partial':'pre';
      const cls=st==='done'?(sv.deep?'deep':'done'):st==='open'?'open':st;
      const tip=HB_tip(d,k,sv), pop=k===tk&&st==='done'&&HB.pop;
      cells.push(`<i class="hm-c ${cls}${k===tk?' today':''}${pop?' pop':''}"${tip?` data-tip="${esc(tip)}" tabindex="-1" role="button" aria-label="${esc(k===tk?'Today':fmtDate(P(k)))}"`:''}></i>`);
    });
  });
  // a shortened year starts mid-month: its first column gets the month's name anyway, unless the next month's name is
  // right beside it
  const c1=+((heads[0]||'').match(/data-c="(\d+)"/)||[])[1];
  if(n&&(!heads.length||c1>2)&&!C[0].first) heads.unshift(`<span style="grid-column:1"${thisY(0)&&C[0].month===T.getMonth()?' class="now"':''}>${MO[C[0].month]}</span>`);
  return `<div class="hm-in" style="--w:${n};--wt:${all.length}" data-cols="${n}" data-y="${y}" data-mr="${esc(JSON.stringify(H.ranges))}">
    <div class="hm-mo" aria-hidden="true">${heads.join('')}</div>
    <div class="hm-g" role="group" aria-label="Every day this year">${cells.join('')}</div></div>`;
}

function HB_state(){
  const m=HB_map(), w=HABIT.walk(m,essayToday());
  HB.walk=w;
  return {m,w};
}
// Today: as many of the latest columns as fit with each day at least 13px (× k); the whole year when it fits
function HB_cap(el){
  const k=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k'))||.92, w=el.clientWidth;
  if(!w) return 0;
  return Math.max(8,Math.floor((w-4*k)/(13*k)));
}
let HB_capW=0;
addEventListener('resize',()=>{const el=document.getElementById('habit-today');if(el&&el.clientWidth!==HB_capW){HB_capW=el.clientWidth;HB_soon();}},{passive:true});
// el gets the tracker; full = Progress (the whole year)
function HB_render(el,full,st){
  if(!el) return;
  let html='';
  try{const {m,w}=st||HB_state();html=HB_heat(!!full,m,w,full?0:HB_cap(el));}catch(e){console.error(e);}
  el.innerHTML=`<div class="hm ${full?'hm-full':'hm-today'}">${html}</div>`;
  // one tab stop for the days (arrows move between them, Enter opens the tip): today's, else the last one with a tip
  const tabs=el.querySelectorAll('.hm-c[data-tip]'), stop=el.querySelector('.hm-c.today[data-tip]')||tabs[tabs.length-1];
  if(stop) stop.tabIndex=0;
}

/* ---------- Today: the streak ring and the day's steps (#habit-steps) ----------
   The ring fills toward the streak's next milestone (HABIT.goal: 7, 14, 21, 30, 50…), one segment a day while it has 30
   or fewer; today's segment waits in gold until the day is done. Beside it the day's steps, in his own little list:
   each one crossed out as it happens. When the last one goes, the list folds into the ring, today's segment turns
   green, the number ticks up and the week takes the list's place, so a glance tells him the day is done.
   The essay counts only once he leaves the writing box (HABIT.hold; write.js says 'essay:writing' / 'essay:left'). */
// (a browser still holding an older kit.js has no hold/goal yet: the same rules, here)
const HB_hold=(d,w,c)=>HABIT.hold?HABIT.hold(d,w,c):w&&!c?{...d,chars:0,sent:0}:d;
const HB_goal=(n,done)=>HABIT.goal?HABIT.goal(n,done):[7,14,21,30,50,75,100,150,200,250,300,365].find(m=>m>=Math.max(1,n+(done?0:1)))||Math.ceil((n+1)/100)*100;
const HB_W={writing:false,counted:lsGet('habit-essay')||'',on:null,anim:false,st:null};
BUS.on('essay:writing',()=>{if(!HB_W.writing){HB_W.writing=true;HB_soon();}});
BUS.on('essay:left',()=>{if(HB_W.writing){HB_W.writing=false;HB_soon();}});
const HB_CHECK='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 8.6l3.1 3 6.2-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// the ring: n of G days, today's segment gold while it's open (done: already counted in n)
function HB_ring(n,G,open){
  const r=44, pt=a=>{const t=(a-90)*Math.PI/180;return `${(50+r*Math.cos(t)).toFixed(2)} ${(50+r*Math.sin(t)).toFixed(2)}`;};
  const arc=(a0,a1,c)=>`<path class="hr-s ${c}" d="M${pt(a0)}A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${pt(a1)}"/>`;
  let s='';
  if(G<=30){
    const step=360/G, gap=G<=14?5:3.2;
    for(let i=0;i<G;i++) s+=arc(i*step+gap/2,(i+1)*step-gap/2,i<n?'d':i===n&&open?'t':'');
  }else{
    const a=n/G*360, b=Math.min(359.9,(n+(open?1:0))/G*360);
    s=`<circle class="hr-s" cx="50" cy="50" r="${r}"/>`+(a>0?arc(0,Math.min(359.9,a),'d'):'')+(open?arc(a,b,'t'):'');
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="hr-in" cx="50" cy="50" r="37"/>${s}</svg>`;
}
// this week, Monday to Sunday: done and rest days filled, today ringed, days to come faint
function HB_week(st){
  const tk=essayToday(), mon=HABIT.monday(tk), L='MTWTFSS';
  let h='';
  for(let i=0;i<7;i++){
    const k=HABIT.addDays(mon,i), s=st.w.days[k], c=k>tk?'later':s&&(s.st==='done'||s.st==='rest')?'d':'';
    h+=`<span class="hw ${c}${k===tk?' now':''}"><i></i>${L[i]}</span>`;
  }
  return `<div class="hc-week" aria-hidden="true">${h}</div>`;
}
function HB_card(st,o){
  o=o||{};
  const tk=essayToday(), d=st.m[tk]||HABIT.blank(), low=st.w.low, s=st.w.days[tk];
  const done=o.done!=null?o.done:!!(s&&s.st==='done'), n=o.n!=null?o.n:st.w.streak;
  const G=HB_goal(n,done);
  let test=false; try{test=!!testOpen()||!!d.tt;}catch(e){}
  const on={reviews:!!d.cleared,essay:low?d.sent>=HABIT.LOW_SENTENCES:d.chars>0,test:!!d.test};
  const fresh=o.fresh||{};
  const step=(id,label)=>`<li><button type="button" class="hc-s${on[id]?' on':''}${fresh[id]?' fresh':''}" data-go="${id}" aria-pressed="${on[id]}"><i class="hc-b">${on[id]?HB_CHECK:''}</i><span class="hc-t">${label}</span></button></li>`;
  const steps=`<ul class="hc-steps">${HB_has()?step('reviews','Reviews'):''}${step('essay',low?'3 sentences':'Essay')}${test?step('test','Test'):''}</ul>`;
  return {on,done,html:`<div class="hc${done?' done':''}">
    <div class="hc-ring" role="img" aria-label="${n}-day streak${done?', today done':''}">${HB_ring(n,G,!done)}<b class="hc-n">${n}</b><span class="hc-u">day${n===1?'':'s'}</span></div>
    ${done?HB_week(st):steps}</div>`};
}
function HB_steps(st,turned){
  const el=document.getElementById('habit-steps'); if(!el) return;
  HB_W.st=st;
  if(HB_W.anim) return;
  const prev=HB_W.on, quiet=!HB.settled||!prev;
  if(turned&&!REDUCED()&&VIEW==='today'){HB_fold(el,st,prev);return;}
  const c=HB_card(st);
  const fresh={};
  if(!quiet) for(const k in c.on) if(c.on[k]&&!prev[k]) fresh[k]=true;
  const out=Object.keys(fresh).length?HB_card(st,{fresh}):c;
  el.innerHTML=out.html; HB_W.on=c.on;
  // reduced motion: no fold, the light alone
  if(turned&&VIEW==='today'){const r=el.querySelector('.hc-ring').getBoundingClientRect();celebrate('streak',{x:r.left+r.width/2,y:r.top+r.height/2,r:r.width/2});}
}
// the day turns done: the last step is crossed out, the list folds into the ring, today's segment turns green, the
// number ticks up, the week appears; a burst out of the ring. Renders that arrive meanwhile wait for the end.
function HB_fold(el,st,prev){
  HB_W.anim=true;
  const n=st.w.streak, c=HB_card(st,{done:false,n:Math.max(0,n-1)});
  const fresh={}; for(const k in c.on) if(c.on[k]&&!(prev&&prev[k])) fresh[k]=true;
  el.innerHTML=HB_card(st,{done:false,n:Math.max(0,n-1),fresh}).html;
  const T=(f,ms)=>setTimeout(()=>{try{f();}catch(e){console.error(e);HB_end(el);}},ms);
  T(()=>{
    const ring=el.querySelector('.hc-ring'), rr=ring&&ring.getBoundingClientRect();
    if(!rr) return HB_end(el);
    el.querySelectorAll('.hc-s').forEach((b,i)=>{
      const r=b.getBoundingClientRect();
      b.style.setProperty('--dx',Math.round(rr.left+rr.width/2-(r.left+r.width/2))+'px');
      b.style.setProperty('--dy',Math.round(rr.top+rr.height/2-(r.top+r.height/2))+'px');
      b.style.setProperty('--i',i);
    });
    el.querySelector('.hc').classList.add('fold');
  },720);
  T(()=>{
    const G=HB_goal(n,true);
    el.innerHTML=HB_card(st).html.replace('class="hc done"','class="hc done land"');
    // today's segment: gold, then green on the next frame, so it fills before his eyes
    const segs=el.querySelectorAll('.hr-s.d'), last=G<=30?segs[n-1]:segs[segs.length-1];
    if(last){last.classList.replace('d','t');requestAnimationFrame(()=>requestAnimationFrame(()=>last.classList.replace('t','d')));}
    const r=el.querySelector('.hc-ring').getBoundingClientRect();
    celebrate('streak',{x:r.left+r.width/2,y:r.top+r.height/2,r:r.width/2,big:n===G});
    HB_W.on=HB_card(st).on;
    T(()=>HB_end(el),900);
  },720+560);
}
function HB_end(el){
  HB_W.anim=false;
  const c=HB_card(HB_W.st);
  el.innerHTML=c.html; HB_W.on=c.on;
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
    // the device's time zone too: the evening nudge comes at his time wherever he is
    let tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}
    const r=await HB_api('habit',{day:tk,data,low,tz});
    if(r){HB.posted=key;HB.log[tk]=r;}
  },1500);
}

// the page has its data: what the day is now is what it was when it opened, so no celebration for it
const HB_ready=()=>ES.loaded&&(!HB_has()||HB_rvReady())&&performance.now()-HB.t0>4000;
function HB_today(){
  let st;
  try{st=HB_state();}catch(e){console.error(e);return;}
  const tk=essayToday(), s=st.w.days[tk], done=!!(s&&s.st==='done');
  if(HB.k!==tk){HB.k=tk;HB.done=null;HB_W.on=null;}
  // the essay has counted (he left the box with Chinese in it): writing more doesn't take it back today
  const d=st.m[tk]; if(d&&d.chars>0&&!HB_W.writing&&HB_W.counted!==tk){HB_W.counted=tk;lsSet('habit-essay',tk);}
  // the moment the day turns done: the fold, the burst and BUS day:done, once
  const turned=HB.settled&&HB.done===false&&done&&HB_ready()&&once('day:'+tk);
  HB.pop=turned;
  HB_steps(st,turned);
  HB_render(document.getElementById('habit-today'),false,st);
  HB.pop=false;
  if(turned) BUS.emit('day:done',{date:tk,streak:st.w.streak});
  if(HB_ready()){HB.settled=true;HB.done=done;}
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
  // the days of the heatmap: arrows (a day up or down, a week left or right), Home and End, Enter or Space shows the tip
  document.addEventListener('keydown',e=>{
    const c=e.target.closest&&e.target.closest('.hm-c[data-tip]'); if(!c||e.isComposing||e.keyCode===229||e.altKey||e.ctrlKey||e.metaKey) return;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();c.click();return;}
    const g=c.parentNode, all=[...g.children], at=all.indexOf(c);
    const step={ArrowUp:-1,ArrowDown:1,ArrowLeft:-7,ArrowRight:7}[e.key];
    let to=null;
    if(step){for(let i=at+step;i>=0&&i<all.length;i+=step)if(all[i].hasAttribute('data-tip')){to=all[i];break;}}
    else if(e.key==='Home'||e.key==='End'){const t=all.filter(x=>x.hasAttribute('data-tip'));to=e.key==='Home'?t[0]:t[t.length-1];}
    else return;
    e.preventDefault();
    if(to&&to!==c){c.tabIndex=-1;to.tabIndex=0;to.focus();}
  });
  addEventListener('scroll',()=>{if(cur)hide();},{passive:true});
  addEventListener('resize',()=>{if(cur)hide();});
  BUS.on('leave',hide);
})();
