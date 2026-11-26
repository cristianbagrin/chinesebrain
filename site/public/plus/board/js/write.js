/* ---------- Today's essay: the writing page. Owner: B (writing + tests)
   A sheet of paper on the ground (css/paper.css, shared with the Essays view): Day and the save status in its header,
   his text in ink on a plain sheet (unlined since 2026-11-26, like the Essays page), two other pages askew underneath. Writes through store.js (scheduleSave /
   flushNow / saveState). The day turns over at 4 am (essayToday()). The sheet is one block per paragraph while he writes
   (WR_set / WR_text below), so a new paragraph gets the same larger gap as on the Essays page; what's saved is still
   plain text, one line a paragraph. Chinese Brain's hover reads its text nodes. Today dims while he types; a real mouse move, a scroll, Esc or leaving brings it back.
   No finishing step (2026-11-01): a day he wrote in is a day written, once he leaves the box (BUS 'essay:writing' while
   he types, 'essay:left' when he steps away: habit.js ticks the step then, never mid-sentence). ---------- */

const WR_EL=document.getElementById('write');
WR_EL.innerHTML=`
  <div class="paper stacked w-paper" id="w-paper" data-paper="plain"><i class="paper-tex" aria-hidden="true"></i>
    <div class="w-top"><h2 class="w-day" id="w-day">Day</h2><span class="saved" id="w-saved" aria-live="polite"></span><div class="w-focus" id="w-focus" hidden></div></div>
    <div class="sheet" id="sheet" role="textbox" aria-multiline="true" data-ph="今天發生了什麼事？" aria-label="Today's essay" lang="zh-Hant" spellcheck="false"></div>
  </div>`;
const SHEET=document.getElementById('sheet'), SAVED=document.getElementById('w-saved');
const WR_PAPER=document.getElementById('w-paper'), WR_DAY=document.getElementById('w-day');
const W={date:null,day:null,waiting:false};
const WR={move:0,xy:null};

function renderWrite(){
  // the sheet moves to the new day only while he isn't writing in it, so a late essay stays one essay
  const date=essayToday();
  if(W.date!==date&&(!W.date||document.activeElement!==SHEET)){
    if(W.date)WR_set('');
    W.date=date; SAVED.dataset.saved=date; SAVED.className='saved';
  }
  const cur=ES.essays.find(e=>e.date===W.date);
  W.day=cur?cur.day:(ES.loaded?nextDay():null);
  WR_DAY.textContent=W.day?`Day ${W.day}`:'Day';
  const s=SV[W.date];
  if(cur&&document.activeElement!==SHEET&&!(s&&(s.next||s.busy))&&WR_text()!==norm(cur.text||''))WR_set(cur.text||'');
  if(W.waiting&&W.day){W.waiting=false;scheduleSave(W.day,W.date,WR_text(),true);}
  WR_focus();
}

/* ---------- the day's focus: one item from To improve, to use today. The least practiced comes first (fewest essays
   that got it right, then fewest days shown), and it stays for the whole day: its `seen` dates tell the 5 am marker
   which one he was practicing (jobs.ts focusOn), and three right uses in different essays retire it. Tap: what he
   wrote and why. ---------- */
const WR_FOCUS=document.getElementById('w-focus');
const WR_FX={items:false,open:false,id:null};
const WR_FICON='<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.4" fill="currentColor"/></svg>';
function WR_pick(){
  if(!WR_FX.items||ES.nodb||!IMP||!W.date||typeof IM_open!=='function') return null;
  const open=IM_open().filter(x=>x.nat&&x.mine);
  const had=open.find(x=>(x.seen||[]).includes(W.date)); if(had) return had;
  const n=x=>new Set((x.uses||[]).map(u=>u.day)).size;
  open.sort((a,b)=>n(a)-n(b)||(a.seen||[]).length-(b.seen||[]).length||String(a.added||'').localeCompare(String(b.added||'')));
  const x=open[0]; if(!x) return null;
  IM_write(x.id,{seen:[...(x.seen||[]).filter(d=>d!==W.date).slice(-19),W.date]});
  return x;
}
function WR_focus(){
  const x=WR_pick();
  if(!x){WR_FOCUS.hidden=true;WR_FOCUS._h='';return;}
  if(x.id!==WR_FX.id){WR_FX.id=x.id;WR_FX.open=false;}
  const more=WR_FX.open?`<p class="w-fo" lang="zh-Hant"><s class="x-out">${mix(x.mine)}</s>${x.note?`<span class="w-fw">${zh(x.note)}</span>`:''}</p>`:'';
  const html=`<button class="w-fx" type="button" aria-expanded="${WR_FX.open}">${WR_FICON}<span class="w-fn" lang="zh-Hant">${IM_natHTML(x)}</span></button>${more}`;
  if(WR_FOCUS._h!==html){WR_FOCUS._h=html;WR_FOCUS.innerHTML=html;}
  WR_FOCUS.hidden=false;
}
WR_FOCUS.addEventListener('click',e=>{if(!e.target.closest('.w-fx'))return;WR_FX.open=!WR_FX.open;sfx('tap');WR_focus();});
const WR_fclose=()=>{if(WR_FX.open){WR_FX.open=false;WR_focus();}};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#w-focus'))WR_fclose();},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')WR_fclose();},true);
BUS.on('leave',WR_fclose);
BUS.on('items',()=>{WR_FX.items=true;WR_focus();});

/* ---------- focus: Today dims while he types ---------- */
function WR_dim(){if(WR_EL.classList.contains('wr-dim'))return;WR.move=0;WR.xy=null;WR_EL.classList.add('wr-dim');}
function WR_undim(){WR_EL.classList.remove('wr-dim');}
document.addEventListener('pointermove',e=>{
  if(!WR_EL.classList.contains('wr-dim')||e.pointerType==='touch') return;
  const p=[e.clientX,e.clientY];
  if(WR.xy){WR.move+=Math.hypot(p[0]-WR.xy[0],p[1]-WR.xy[1]);if(WR.move>40)WR_undim();}
  WR.xy=p;
},{passive:true});
addEventListener('wheel',()=>{if(WR_EL.classList.contains('wr-dim'))WR_undim();},{passive:true});
SHEET.addEventListener('keydown',e=>{if(e.key==='Escape')WR_undim();});

/* ---------- paragraphs: one <div> per line of the saved text ----------
   The browser splits a paragraph on Enter by itself (its own undo, IME untouched); this only keeps the shape: an empty
   sheet gets its first <div> when he starts, Shift+Enter is a new paragraph too (a line break inside one wouldn't
   survive the round trip), a paste goes in as plain text, a paragraph at a time, and no bold or italic. */
try{document.execCommand('defaultParagraphSeparator',false,'div');}catch(e){}
SHEET.setAttribute('contenteditable','true');
const WR_BLK=n=>n.nodeType===1&&(n.nodeName==='DIV'||n.nodeName==='P');
function WR_set(t){
  t=norm(t);
  SHEET.innerHTML=t?t.split('\n').map(l=>`<div>${l?esc(l):'<br>'}</div>`).join(''):'';
  WR_ph();
}
// the text, one line a paragraph (what store.js saves): a <div> is a line; a <br> inside one (or a pasted newline)
// starts another; the <br> that only holds an empty paragraph open is nothing
function WR_text(){
  const out=[]; let line=null;
  const end=()=>{if(line!==null){out.push(line);line=null;}};
  const walk=el=>{for(const n of el.childNodes){
    if(n.nodeType===3){n.data.split('\n').forEach((p,i)=>{if(i){out.push(line||'');line='';}line=(line||'')+p;});}
    else if(n.nodeName==='BR'){if(n.nextSibling===null&&el!==SHEET&&WR_BLK(el)){if(line===null)line='';}else{out.push(line||'');line=null;}}
    else if(WR_BLK(n)){end();walk(n);if(line===null)line='';end();}
    else if(n.nodeType===1) walk(n);
  }};
  walk(SHEET); end();
  const t=out.join('\n').replace(/\u00a0/g,' ');
  return t.trim()?norm(t):'';
}
// the placeholder shows on an empty sheet (an empty paragraph counts as empty)
function WR_ph(){SHEET.classList.toggle('blank',!SHEET.textContent);}
// typing into a bare sheet: the first paragraph's <div> is there first, so every line is a block
function WR_seed(){
  if(SHEET.querySelector('div')) return;
  const t=SHEET.textContent;
  SHEET.innerHTML=`<div>${t?esc(t):'<br>'}</div>`;
  placeCaret(SHEET,t.length);
}
SHEET.addEventListener('focus',()=>{if(!SHEET.textContent)WR_seed();});
SHEET.addEventListener('beforeinput',e=>{
  const t=e.inputType||'';
  if(/^format/.test(t)){e.preventDefault();return;}
  if(t==='insertLineBreak'){e.preventDefault();document.execCommand('insertParagraph');return;}
  if(!e.isComposing&&/^insert/.test(t)&&!SHEET.querySelector('div')) WR_seed();
});
SHEET.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.shiftKey&&!e.isComposing){e.preventDefault();document.execCommand('insertParagraph');}});
function WR_paste(text){
  const L=String(text||'').replace(/\r\n?/g,'\n').split('\n');
  L.forEach((l,i)=>{if(i)document.execCommand('insertParagraph');if(l)document.execCommand('insertText',false,l);});
}
SHEET.addEventListener('paste',e=>{
  e.preventDefault(); e.stopPropagation();
  WR_paste((e.clipboardData||window.clipboardData).getData('text/plain'));
});
SHEET.addEventListener('drop',e=>{
  const t=e.dataTransfer&&e.dataTransfer.getData('text/plain'); if(!t) return;
  e.preventDefault();
  const r=document.caretRangeFromPoint?document.caretRangeFromPoint(e.clientX,e.clientY):null;
  if(r){const s=getSelection();s.removeAllRanges();s.addRange(r);}
  WR_paste(t);
});

/* ---------- typing and saving ---------- */
SHEET.addEventListener('input',()=>{
  const v=WR_text();
  WR_ph();
  WR_dim();
  BUS.emit('essay:writing');
  if(!W.day){W.waiting=true;draftPut(W.date,null,v);if(ES.nodb)saveState(W.date,'local');return;}
  scheduleSave(W.day,W.date,v);
});
SHEET.addEventListener('blur',()=>{
  // an empty paragraph he left behind on an empty sheet goes, so the placeholder shows again
  if(!SHEET.textContent&&SHEET.innerHTML)SHEET.innerHTML='';
  WR_ph();
  if(W.date)flushNow(W.date);
  BUS.emit('essay:left');
  WR_undim();
  setTimeout(()=>{if(essayToday()!==W.date)renderWrite();},0);
});
// a click anywhere on the paper (below the text, in the margins) writes at the end
WR_EL.addEventListener('mousedown',e=>{
  if(e.button!==0||e.target.closest('#sheet,#w-focus')) return;
  e.preventDefault(); SHEET.focus(); placeCaret(SHEET,null);
});
// a page left open overnight moves to the new day
setInterval(()=>{if(essayToday()!==W.date)renderWrite();},60000);
document.addEventListener('visibilitychange',()=>{if(document.hidden){Object.keys(SV).forEach(flushNow);BUS.emit('essay:left');}else renderWrite();});
addEventListener('pagehide',()=>BUS.emit('essay:left'));
BUS.on('essays',()=>renderWrite());
BUS.on('draft',(date,text)=>{if(date===W.date&&document.activeElement!==SHEET)WR_set(text);});
BUS.on('nodb',()=>{if(WR_text())saveState(W.date,'local');});
BUS.on('leave',v=>{if(v==='today')WR_undim();});
renderWrite();
