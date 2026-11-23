/* ---------- Settings: the few choices he keeps on this device. Owner: lead
   Modules register with LAB.define(id,label,[[value,label],...],default,group) (the API keeps its old name) and
   re-render on BUS 'lab'. Choices are saved under lab:<id>. ?lab=card-ahead:on in the URL picks one for screenshots.
   The panel is a popover under the gear (Cmd+, or Ctrl+, opens it too); a click outside, ×, the gear or Esc close it.
   Show, don't tell (his call, 2026-11-23): Sound lives here as a switch that plays a stamp when it comes on, the text
   sizes preview themselves, and an on/off choice is a switch. ---------- */
(()=>{
  LAB.define('text-size','Text size',[['normal','Normal'],['larger','Larger']],'normal','Board');
  const btn=document.getElementById('settingsbtn'), box=document.getElementById('settings');
  btn.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
  btn.setAttribute('aria-keyshortcuts',/Mac|iPhone|iPad/.test(navigator.platform)?'Meta+,':'Control+,');
  const ORDER=['text-size','card-model','card-ahead'];
  const ids=()=>[...ORDER.filter(id=>LAB.defs[id]),...LAB.order.filter(id=>!ORDER.includes(id))];
  const isSwitch=d=>d.options.length===2&&d.options[0][0]==='on'&&d.options[1][0]==='off';
  // a choice: a switch for on/off, else the options side by side (text size shows its own size)
  function row(d){
    if(isSwitch(d)) return `<label class="st-row st-sw"><span class="st-l">${esc(d.label)}</span><button type="button" role="switch" class="sw" aria-checked="${d.v==='on'}" data-x="${d.id}" data-v="${d.v==='on'?'off':'on'}"><i></i></button></label>`;
    const big=d.id==='text-size';
    return `<div class="st-row"><span class="st-l">${esc(d.label)}</span><span class="st-o${big?' st-sz':''}" role="radiogroup" aria-label="${esc(d.label)}">${d.options.map(([v,l])=>`<button type="button" role="radio" aria-checked="${d.v===v}" data-x="${d.id}" data-v="${esc(v)}"${big?` aria-label="${esc(l)}"`:''}>${big?`<span class="sz-${esc(v)}">Aa <span class="zh">中文</span></span>`:esc(l)}</button>`).join('')}</span></div>`;
  }
  function draw(){
    const a=document.activeElement, keep=box.contains(a)?(a.dataset.x||(a.dataset.sound!=null?'sound':''))+'|'+(a.dataset.x?a.getAttribute('aria-checked')==='true'||a.getAttribute('role')==='radio'?a.dataset.v:'':''):'';
    const groups={};
    ids().forEach(id=>{const d=LAB.defs[id];(groups[d.group]=groups[d.group]||[]).push(d);});
    box.innerHTML=`<div class="st-in" role="dialog" aria-label="Settings">
      <div class="st-top"><b>Settings</b><button class="btn-q" type="button" id="st-reset">Reset</button><button class="st-x" type="button" id="st-close" aria-label="Close">×</button></div>
      ${Object.entries(groups).map(([g,ds],i)=>`<section class="st-g"><h3>${esc(g)}</h3>
        ${i===0?`<label class="st-row st-sw"><span class="st-l">Sound</span><button type="button" role="switch" class="sw" aria-checked="${SND.on}" data-sound><i></i></button></label>`:''}
        ${ds.map(row).join('')}</section>`).join('')}
    </div>`;
    if(keep){const [x]=keep.split('|');const b=x==='sound'?box.querySelector('[data-sound]'):box.querySelector(`[data-x="${x}"][aria-checked="true"]`)||box.querySelector(`[data-x="${x}"]`);b&&b.focus();}
  }
  function open(on,back){box.hidden=!on;btn.setAttribute('aria-expanded',String(on));if(on){draw();(box.querySelector('[aria-checked="true"]')||box.querySelector('button')).focus();}else if(back)btn.focus();}
  btn.onclick=e=>{e.stopPropagation();sfx('tap');open(box.hidden);};
  box.addEventListener('click',e=>{
    e.stopPropagation();
    const b=e.target.closest('[data-x]');
    if(b){LAB.set(b.dataset.x,b.dataset.v);sfx(b.getAttribute('role')==='switch'?(b.dataset.v==='on'?'stamp-known':'unstamp'):'tap');draw();return;}
    const s=e.target.closest('[data-sound]');
    // the switch plays what it turns on
    if(s){SNDB.click();if(SND.on)setTimeout(()=>sfx('stamp-known'),60);draw();return;}
    if(e.target.id==='st-close'){sfx('tap');open(false,true);return;}
    if(e.target.id==='st-reset'){LAB.order.forEach(id=>LAB.set(id,LAB.defs[id].def));sfx('swish');draw();}
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!box.hidden)open(false,true);
    // Cmd+, (Ctrl+, off a Mac), as in every Mac app
    if(e.key===','&&(/Mac|iPhone|iPad/.test(navigator.platform)?e.metaKey:e.ctrlKey)&&!e.altKey&&!e.shiftKey){e.preventDefault();sfx('tap');open(box.hidden,true);}
  });
  // a click anywhere outside the panel (and not on the gear) closes it
  document.addEventListener('pointerdown',e=>{if(!box.hidden&&!box.contains(e.target)&&!btn.contains(e.target))open(false);},true);
})();
