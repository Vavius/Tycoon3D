// UI & windows logic extracted
import { GOODS, strategy, updateCityPrices, recalcWorldGoods, suggestProfitThresholds } from '../economy/market.js';
import { t } from '../core/i18n.js';
import { world, newCaravan } from '../world/world.js';
import { camelCost, caravanCost, xpForLevel } from '../core/progression.js';
import { UPGRADE_DEFS, canPurchaseUpgrade, purchaseUpgrade, nextUpgradeCost } from '../core/upgrades.js';
import { caravanCapacity } from '../core/upgrades.js';

// Debug flags (can be toggled from console: window.DEBUG_CAMEL=true/false)
window.DEBUG_CAMEL = window.DEBUG_CAMEL ?? true;

// Currency / price symbol (easy to change in one place)
export const PRICE_SYMBOL = '💰';

// Emoji icons for goods
const GOODS_EMOJI = { spice:'🌶️', cloth:'👗', ore:'🪨' };

export function initWindowButtons(){
  const menu=document.getElementById('windowsMenu'); if(!menu) return;
  menu.querySelectorAll('button[data-win]').forEach(b=> b.addEventListener('click', ()=>toggleWindow(b.dataset.win)) );
  document.querySelectorAll('.window .close').forEach(c=> c.addEventListener('click', ()=>{ const k=c.dataset.close; const map={cities:'win-cities',strategy:'win-strategy',upgrades:'win-upgrades',caravans:'win-caravans'}; const w=document.getElementById(map[k]); if(w){ w.classList.remove('show'); const btn=document.querySelector(`#windowsMenu button[data-win="${k}"]`); if(btn) btn.classList.remove('active'); } }) );
  // drag persistence
  const wins=document.querySelectorAll('.window'); let dragTarget=null, offX=0, offY=0; let zTop=50; function save(el){ localStorage.setItem('winpos-'+el.id, JSON.stringify({left:el.style.left, top:el.style.top})); }
  wins.forEach(w=>{ const saved=localStorage.getItem('winpos-'+w.id); if(saved){ try{ const r=JSON.parse(saved); if(r.left&&r.top){ w.style.left=r.left; w.style.top=r.top; } }catch(e){} } const tb=w.querySelector('.titlebar'); if(!tb) return; tb.style.cursor='move'; tb.addEventListener('mousedown', e=>{ dragTarget=w; const rect=w.getBoundingClientRect(); offX=e.clientX-rect.left; offY=e.clientY-rect.top; w.style.zIndex=++zTop; }); });
  window.addEventListener('mousemove', e=>{ if(!dragTarget) return; dragTarget.style.left=(e.clientX-offX)+'px'; dragTarget.style.top=(e.clientY-offY)+'px'; });
  window.addEventListener('mouseup', ()=>{ if(dragTarget){ save(dragTarget); dragTarget=null; } });
}

export function toggleWindow(key){ const map={ cities:'win-cities', strategy:'win-strategy', upgrades:'win-upgrades'}; const id=map[key]; if(!id) return; const w=document.getElementById(id); if(!w) return; const btn=document.querySelector(`#windowsMenu button[data-win="${key}"]`); const showing=w.classList.toggle('show'); if(btn) btn.classList.toggle('active', showing); if(key==='strategy' && showing){ buildStrategyUI(true); buildCaravansView(); } if(key==='upgrades'&&showing){ buildUpgradesUI(true); } }

// Shared tooltip for mode cycling (styled similarly to priceTooltip)
let modeTooltip=document.getElementById('modeTooltip'); if(!modeTooltip){ modeTooltip=document.createElement('div'); modeTooltip.id='modeTooltip'; modeTooltip.style.position='fixed'; modeTooltip.style.pointerEvents='none'; modeTooltip.style.display='none'; document.body.appendChild(modeTooltip); }

let strategyBuilt=false; function buildStrategyUI(force=false){ if(strategyBuilt && !force) return; strategyBuilt=true; const grid=document.getElementById('strategyGrid'); if(!grid) return; grid.innerHTML='';
  // Headers: (mode icon blank) | Good | Buy <= | Sell >= | (auto blank)
  grid.insertAdjacentHTML('beforeend',`<div class=\"hdr empty\"></div><div class=\"hdr\">${t('strategy.good')}</div><div class=\"hdr\">${t('strategy.buyLE')}</div><div class=\"hdr\">${t('strategy.sellGE')}</div><div class=\"hdr empty\"></div>`);
  const player=world.player; const goodsVisible=Object.keys(GOODS).filter(gid=> !player || player.unlockedGoods.includes(gid));
  const MODE_ORDER=['active','hold','liquidate','disabled'];
  const MODE_ICONS={ active:'🟢', hold:'⏸️', liquidate:'💸', disabled:'🚫' };
  const MODE_DESC={
    active: t('strategy.modeDesc.active'),
    hold: t('strategy.modeDesc.hold'),
    liquidate: t('strategy.modeDesc.liquidate'),
    disabled: t('strategy.modeDesc.disabled')
  };
  for(const gid of goodsVisible){ const g=GOODS[gid];
    const curMode = strategy.mode?.[gid]||'active';
    // MODE ICON cell
    const modeCell=document.createElement('div'); modeCell.className='mode-cell';
    const modeBtn=document.createElement('button'); modeBtn.type='button'; modeBtn.className='mode-btn'; modeBtn.dataset.mode=curMode; modeBtn.textContent=MODE_ICONS[curMode]||curMode[0].toUpperCase();
    function buildModeTooltip(current, target){
      let html=`<div class='mt-head'>${t('strategy.mode')||'Mode'}: ${t('strategy.modeVals.'+current)}</div>`;
      html+='<div class="mt-list">';
      for(const m of MODE_ORDER){ const icon=MODE_ICONS[m]; const name=t('strategy.modeVals.'+m); const desc=MODE_DESC[m]; const activeCls=m===current?' mt-current':''; html+=`<div class='mt-row${activeCls}'><span class='mt-ic'>${icon}</span><div class='mt-text'><div class='mt-name'>${name}</div><div class='mt-desc'>${desc}</div></div></div>`; }
      html+='</div><div class="mt-foot">'+t('ui.clickCycle')+'</div>';
      modeTooltip.innerHTML=html; const rect=target.getBoundingClientRect(); modeTooltip.style.left=(rect.left+window.scrollX+rect.width+8)+'px'; modeTooltip.style.top=(rect.top+window.scrollY)+'px'; modeTooltip.style.display='block';
    }
    modeBtn.addEventListener('click',()=>{ const current=strategy.mode[gid]||'active'; const idx=MODE_ORDER.indexOf(current); const next=MODE_ORDER[(idx+1)%MODE_ORDER.length]; strategy.mode[gid]=next; buildStrategyUI(true); });
    modeBtn.addEventListener('mouseenter',()=>{ buildModeTooltip(strategy.mode?.[gid]||'active', modeBtn); });
    modeBtn.addEventListener('mouseleave',()=>{ modeTooltip.style.display='none'; });
    modeBtn.addEventListener('mousemove',()=>{ if(modeTooltip.style.display==='block'){ const rect=modeBtn.getBoundingClientRect(); modeTooltip.style.left=(rect.left+rect.width+8)+'px'; modeTooltip.style.top=(rect.top)+'px'; } });
    modeCell.appendChild(modeBtn); grid.appendChild(modeCell);
    // GOOD NAME cell
    const nameCell=document.createElement('div'); nameCell.className='good-name-cell'; nameCell.textContent=g.name; grid.appendChild(nameCell);
    // BUY input
    const buy=document.createElement('input'); buy.type='number'; buy.value=strategy.buyBelow[gid]; buy.className='strategy-num'; buy.addEventListener('change',()=>{ strategy.buyBelow[gid]=parseFloat(buy.value)||0; }); const buyWrap=document.createElement('div'); buyWrap.className='num-wrap'; buyWrap.appendChild(buy); const bStepper=document.createElement('div'); bStepper.className='stepper'; const bUp=document.createElement('button'); bUp.type='button'; bUp.textContent='▲'; const bDown=document.createElement('button'); bDown.type='button'; bDown.textContent='▼'; [bUp,bDown].forEach(btn=>{ btn.addEventListener('mousedown',e=>{ e.preventDefault(); }); }); bUp.addEventListener('click',()=>{ buy.stepUp(); buy.dispatchEvent(new Event('change')); }); bDown.addEventListener('click',()=>{ buy.stepDown(); buy.dispatchEvent(new Event('change')); }); bStepper.appendChild(bUp); bStepper.appendChild(bDown); buyWrap.appendChild(bStepper); grid.appendChild(buyWrap);
    // SELL input
    const sell=document.createElement('input'); sell.type='number'; sell.value=strategy.sellAbove[gid]; sell.className='strategy-num'; sell.addEventListener('change',()=>{ strategy.sellAbove[gid]=parseFloat(sell.value)||0; }); const sellWrap=document.createElement('div'); sellWrap.className='num-wrap'; sellWrap.appendChild(sell); const sStepper=document.createElement('div'); sStepper.className='stepper'; const sUp=document.createElement('button'); sUp.type='button'; sUp.textContent='▲'; const sDown=document.createElement('button'); sDown.type='button'; sDown.textContent='▼'; [sUp,sDown].forEach(btn=>{ btn.addEventListener('mousedown',e=>{ e.preventDefault(); }); }); sUp.addEventListener('click',()=>{ sell.stepUp(); sell.dispatchEvent(new Event('change')); }); sDown.addEventListener('click',()=>{ sell.stepDown(); sell.dispatchEvent(new Event('change')); }); sStepper.appendChild(sUp); sStepper.appendChild(sDown); sellWrap.appendChild(sStepper); grid.appendChild(sellWrap);
    // AUTO button
    const autoCell=document.createElement('div'); autoCell.className='auto-cell';
    const autoBtn=document.createElement('button'); autoBtn.type='button'; autoBtn.className='auto-btn'; autoBtn.textContent='🛠️'; autoBtn.title=(t('strategy.profitTip')||'Auto set buy/sell thresholds for a sensible profit range')+`\n${t('strategy.priceRange')||'Range'}: ${g.minPrice}-${g.maxPrice}`; autoBtn.addEventListener('click',()=>{ const {buy:pb,sell:ps}=suggestProfitThresholds(world,gid); strategy.buyBelow[gid]=pb; strategy.sellAbove[gid]=ps; buildStrategyUI(true); }); autoCell.appendChild(autoBtn); grid.appendChild(autoCell);
    // Disable inputs based on mode
    const mode=strategy.mode?.[gid]||'active'; if(mode==='hold'||mode==='disabled'){ buy.disabled=true; sell.disabled=true; bStepper.querySelectorAll('button').forEach(b=>b.disabled=true); sStepper.querySelectorAll('button').forEach(b=>b.disabled=true); autoBtn.disabled=true; }
    if(mode==='liquidate'){ buy.disabled=true; bStepper.querySelectorAll('button').forEach(b=>b.disabled=true); }
  }
}

function formatFlow(city,gid){ const f=city.flows[gid]; if(!f) return ''; const net=(f.prod-f.cons).toFixed(1); return `${net}`; }

let caravansDelegated=false; let caravansLastBuild=0; const CARAVANS_BUILD_INTERVAL=400; // ms
function buildCaravansView(force=false){
  const el=document.getElementById('caravansView'); if(!el) return;
  const now=performance.now();
  if(!force && (now - caravansLastBuild) < CARAVANS_BUILD_INTERVAL){ return; }
  caravansLastBuild=now;
  let html='';
  const player=world.player;
  // camelBaseCost now varies per caravan; kept variable for potential global display (unused)
  const camelBaseCostGlobal = camelCost(world);
  const caravanBuyCost = caravanCost(world);
  for(const c of world.caravans){
  const destCityObj = c.destCity ? world.cities.find(ct=>ct.id===c.destCity): null;
  const destName= destCityObj ? destCityObj.name : '—';
  // Destination tag intentionally not shown in caravan management per new requirements.
  const destTag = ''; // (previously displayed city tag)
  const state=t('caravan.state.'+c.state);
    const used=Object.values(c.cargo).reduce((a,b)=>a+(b.qty||0),0);
  const cap=caravanCapacity(c, world);
  const camelLimit = (player?.maxCamelsPerCaravan||1);
  const camelCostThis = camelCost(world, c);
  let btnDisabled=false; let btnTitle=`${t('btn.addCamel')} (${PRICE_SYMBOL}${camelCostThis})`;
  if(c.camels >= camelLimit){ btnDisabled=true; btnTitle=t('level.camelLimit',{n:camelLimit}); }
  else if(world.money < camelCostThis){ btnDisabled=true; btnTitle=t('caravan.addCamelNoMoney',{cost:camelCostThis}); }
  // Compute current and next speed for improvements popup
  const speedBonus = world.player?.upgradeStats?.speedBonus||0;
  const baseSpeed = 3 + Math.pow(c.camels,0.82)*0.35;
  const effectiveSpeed = baseSpeed * (1+speedBonus);
  const nextBaseSpeed = 3 + Math.pow(c.camels+1,0.82)*0.35;
  const nextEffectiveSpeed = nextBaseSpeed * (1+speedBonus);
  const addCamelBtn = `<button class=\"add-camel\" data-car=\"${c.id}\" title=\"${btnTitle}\" ${btnDisabled?'disabled':''}
    data-cur-cap='${cap}' data-next-cap='${(c.camels<camelLimit)?caravanCapacity({...c, camels:c.camels+1}, world):''}'
    data-cur-speed='${effectiveSpeed.toFixed(3)}' data-next-speed='${(c.camels<camelLimit)?nextEffectiveSpeed.toFixed(3):''}'
    data-cost='${camelCostThis}' data-camel-limit='${camelLimit}'
  >+🐪 ${PRICE_SYMBOL}${camelCostThis}</button>`;
  html+=`<div class=\"car\"><div class=\"car-head\"><b>${c.name||('#'+c.id)}</b> ${state} ${addCamelBtn}</div><div>${t('caravan.target')}: ${destName}${destTag}</div><div>${t('caravan.camels')}: ${c.camels}/${camelLimit}</div><div>${t('caravan.speed')}: ${effectiveSpeed.toFixed(2)}</div><div>${t('caravan.capacity')}: ${used}/${cap}</div>`;
    html+='<div class=\"cargo\">';
    for(const gid of Object.keys(GOODS)){
      if(world.player && !world.player.unlockedGoods.includes(gid)) continue;
      const slot=c.cargo[gid];
      const emoji=GOODS_EMOJI[gid]||''; html+=`<div title=\"avg ${slot.avg.toFixed(1)}\"><span class=\"gicon\">${emoji}</span>${slot.qty}</div>`;
    }
    html+='</div></div>';
  }
  const canBuyCaravan = world.caravans.length < (player?.maxCaravans||1);
  html+=`<div style=\"margin-top:6px;\"><button id=\"buyCaravanInline\" ${world.money>=caravanBuyCost && canBuyCaravan?'':'disabled'}>${canBuyCaravan? t('btn.buyCaravan'): t('btn.caravanLimit')}${canBuyCaravan?` (${PRICE_SYMBOL}${caravanBuyCost})`:''}</button></div>`;
  el.innerHTML = html || `<i>${t('caravan.none')}</i>`;
  if(!caravansDelegated){
    caravansDelegated=true;
    el.addEventListener('click', e=>{
      const btn=e.target.closest('button.add-camel');
      if(!btn) return;
      const id=btn.getAttribute('data-car');
      const car=world.caravans.find(c=>c.id==id);
      if(window.DEBUG_CAMEL){ console.log('[AddCamel][delegate] Click', {btn, id, found: !!car, camels: car?.camels, limit: world.player?.maxCamelsPerCaravan, money: world.money}); }
      if(!car){ if(window.DEBUG_CAMEL) console.warn('[AddCamel] Caravan not found for id', id); return; }
      const logEl=document.getElementById('log');
      function uiLog(m){ if(!logEl) return; const div=document.createElement('div'); div.className='entry'; div.textContent=m; logEl.appendChild(div); logEl.scrollTop=logEl.scrollHeight; }
      const limit=(world.player?.maxCamelsPerCaravan||1);
  if(car.camels>=limit){ if(window.DEBUG_CAMEL) console.log('[AddCamel] Reached camel limit', {carId:car.id, camels:car.camels, limit}); uiLog(t('caravan.addCamelLimit',{id:car.id, name:(car.name||('#'+car.id))})); return; }
  const costNow = camelCost(world, car);
  if(world.money<costNow){ if(window.DEBUG_CAMEL) console.log('[AddCamel] Not enough money', {money:world.money, costNow}); uiLog(t('caravan.addCamelNoMoney',{cost:costNow, name:(car.name||('#'+car.id))})); return; }
      const beforeMoney=world.money; const beforeCamels=car.camels;
      world.money-=costNow;
      car.camels++;
      car.faces.push(':)');
      if(car.camelTrail){ car.camelTrail.push({offset:(car.camelTrail.length)*2.2, x:car.x, z:car.z, y:car.y||0, yaw:car.yaw||0, phase:Math.random()*Math.PI*2}); }
      if(world.player){ world.player.totalCamelsPurchased=(world.player.totalCamelsPurchased||0)+1; }
      if(window.DEBUG_CAMEL){ console.log('[AddCamel] Success', {carId:car.id, beforeCamels, afterCamels:car.camels, beforeMoney, afterMoney:world.money, cost:costNow}); }
  uiLog(t('caravan.addCamelAdded',{id:car.id, name:(car.name||('#'+car.id)), count:car.camels}));
      // Force immediate rebuild to update disabled state
      buildCaravansView(true);
    });
  // Camel tooltip (rebuilt)
  let camelTooltip=document.getElementById('camelTooltip');
  if(!camelTooltip){ camelTooltip=document.createElement('div'); camelTooltip.id='camelTooltip'; camelTooltip.className='camel-popup'; camelTooltip.style.position='fixed'; camelTooltip.style.pointerEvents='none'; camelTooltip.style.display='none'; document.body.appendChild(camelTooltip); }
  let camelHideTimer=null; let currentBtn=null;
  function buildCamelTooltip(btn){
    const curCap=+btn.getAttribute('data-cur-cap'); const nextCapRaw=btn.getAttribute('data-next-cap'); const curSpeed=parseFloat(btn.getAttribute('data-cur-speed')); const nextSpeedRaw=btn.getAttribute('data-next-speed'); const cost=btn.getAttribute('data-cost');
    const hasNext= nextCapRaw && nextCapRaw!=='' && nextSpeedRaw && nextSpeedRaw!=='';
    let lines=[]; if(hasNext){
      const nextCap=+nextCapRaw; const nextSpeed=parseFloat(nextSpeedRaw);
      const capDiff=nextCap-curCap; if(capDiff>0){ lines.push(`${t('caravan.capacity')||'Capacity'} <span class='bonus'>+${capDiff}</span>`); }
      const speedDiff=nextSpeed-curSpeed; if(speedDiff>0.0001){ lines.push(`${t('caravan.speed')||'Speed'} <span class='bonus'>+${speedDiff.toFixed(2)}</span>`); }
    }
    const atLimit = !hasNext;
    if(!lines.length){ lines.push(`<i>${t('caravan.camelLimitShort')||t('caravan.addCamelLimit')||'Camel limit'}</i>`); }
    const costLine = atLimit? '' : `<div>${t('caravan.cost')||'Cost'}: ${PRICE_SYMBOL}${cost}</div>`;
    return `<div class='ct-head'><b>${t('caravan.nextCamel')||'New camel'}</b></div><div>${lines.join('</div><div>')}</div>${costLine}`;
  }
  function positionTooltip(btn){ const rect=btn.getBoundingClientRect(); let left=rect.left+rect.width+8; const w=camelTooltip.offsetWidth; if(left + w > window.innerWidth - 8){ left = rect.left - w - 8; } camelTooltip.style.left=left+'px'; camelTooltip.style.top=rect.top+'px'; }
  el.addEventListener('mouseover', e=>{ const btn=e.target.closest('button.add-camel'); if(!btn) return; currentBtn=btn; camelTooltip.innerHTML=buildCamelTooltip(btn); camelTooltip.style.display='block'; positionTooltip(btn); });
  el.addEventListener('mousemove', e=>{ if(!currentBtn || camelTooltip.style.display==='none') return; positionTooltip(currentBtn); });
  el.addEventListener('mouseout', e=>{ const related=e.relatedTarget; if(currentBtn && (!related || !related.closest || !related.closest('button.add-camel'))){ if(camelHideTimer) clearTimeout(camelHideTimer); camelHideTimer=setTimeout(()=>{ camelTooltip.style.display='none'; currentBtn=null; }, 120); } });
  }
  const buyBtn=document.getElementById('buyCaravanInline'); if(buyBtn){ buyBtn.addEventListener('click',()=>{ const cost=caravanCost(world); if(world.money>=cost && world.caravans.length < (player?.maxCaravans||1)){ world.money-=cost; newCaravan(); buildCaravansView(); } }); }
}

// Tooltip for sparkline (reused from main extraction)
let priceTooltip=document.getElementById('priceTooltip'); if(!priceTooltip){ priceTooltip=document.createElement('div'); priceTooltip.id='priceTooltip'; priceTooltip.style.position='fixed'; priceTooltip.style.pointerEvents='none'; priceTooltip.style.display='none'; document.body.appendChild(priceTooltip); }

// Cities window performance helpers
let citiesDelegated=false; let citiesLastBuild=0; const CITIES_BUILD_INTERVAL=450; // ms

export function updateUI(){
  if(document.getElementById('win-strategy')?.classList.contains('show')){
    if(world.__needsStrategyRefresh){ buildStrategyUI(true); world.__needsStrategyRefresh=false; }
    else buildStrategyUI();
    buildCaravansView();
  }
  // Hydration removed
  const avgHyd=0;
  const p=world.player;
  // Helper: format world.day (hours counter) to Day D HH:MM 24h
  function fmtDay(){ const totalHours = world.day; const day = Math.floor(totalHours/24)+1; const hour = Math.floor(totalHours % 24); const minute = Math.floor((totalHours - Math.floor(totalHours))*60); const pad=v=>v.toString().padStart(2,'0'); return `Day ${day} ${pad(hour)}:${pad(minute)}`; }
  if(p){
  const prevReq = xpForLevel(p.level);
  const curReqTotal = p.nextXp - prevReq;
  const curHave = p.xp - prevReq;
  const pct = curReqTotal>0? Math.min(100, Math.max(0, (curHave/curReqTotal)*100)):0;
  const bar = `<div style=\"margin:4px 0 6px; background:#2a333c; height:10px; border-radius:6px; overflow:hidden; box-shadow:0 0 0 1px #3d4a55 inset;\"><div style=\"height:100%; width:${pct.toFixed(1)}%; background:linear-gradient(90deg,#d0a84c,#f0d074); box-shadow:0 0 4px #d0a84c99;\"></div></div>`;
  // Build upgrade-derived stat badges
  const st=p.upgradeStats||{}; const badges=[];
  if(st.cargoBonusPct) badges.push(`<span class=\"stat-badge\">Cargo +${Math.round(st.cargoBonusPct*100)}%</span>`);
  if(st.sellBonus||st.buyDiscount) badges.push(`<span class=\"stat-badge\">Price +${Math.round((st.sellBonus||0)*100)}%/-${Math.round((st.buyDiscount||0)*100)}%</span>`);
  if(st.speedBonus) badges.push(`<span class=\"stat-badge\">Speed +${Math.round(st.speedBonus*100)}%</span>`);
  if(st.camelLossMitigation) badges.push(`<span class=\"stat-badge\">Camel -${Math.round(st.camelLossMitigation*100)}%</span>`);
  // bandit mitigation removed
  const stats=document.getElementById('stats'); if(stats) stats.innerHTML = `${t('stats.money')}: ${Math.floor(world.money)}<br/>${t('stats.level')}: ${p.level}<br/>${t('stats.xp')||'XP'}: ${curHave.toFixed(0)}/${curReqTotal.toFixed(0)}${bar}${t('stats.totalProfit')}: ${world.totalProfit.toFixed(0)}<br/>${t('stats.lastTrade')}: ${world.lastTradeProfit.toFixed(0)}<br/>${badges.length?('<div class=\"stat-badges\">'+badges.join('')+'</div>'):''}${t('stats.day')||'Day'}: ${fmtDay()}<br/>${world.paused?('<b>'+t('stats.paused')+'</b>'):''}`;
  } else {
  const stats=document.getElementById('stats'); if(stats) stats.innerHTML = `Money: ${Math.floor(world.money)}<br/>Total Profit: ${world.totalProfit.toFixed(0)}<br/>Last Trade: ${world.lastTradeProfit.toFixed(0)}<br/>${fmtDay()}<br/>${world.paused?'<b>PAUSED</b>':''}`;
  }
  const legend=document.getElementById('legend'); if(legend) legend.innerHTML = '';
  if(document.getElementById('win-cities')?.classList.contains('show')){
    const citiesView=document.getElementById('citiesView');
    if(citiesView){
      const now=performance.now();
      if(!citiesDelegated){
        citiesDelegated=true;
        const winCities=document.getElementById('win-cities');
        if(winCities){
          winCities.addEventListener('mousemove', e=>{ const tile=e.target.closest('.goods div'); if(!tile){ priceTooltip.style.display='none'; } });
          winCities.addEventListener('mouseleave', ()=>{ priceTooltip.style.display='none'; });
        }
        // Delegate tooltip handling
        citiesView.addEventListener('mouseover', e=>{
          const div=e.target.closest('.goods div'); if(!div) return;
          const cityId=div.getAttribute('data-city'); const gid=div.getAttribute('data-good');
          const city=world.cities.find(c=>c.id===cityId); if(!city) return;
          const histRaw=(city.priceHist&&city.priceHist[gid])||[]; if(histRaw.length<2){ priceTooltip.style.display='none'; return; }
          const globalMin=Math.min(...Object.values(GOODS).map(g=>g.minPrice));
          const globalMax=Math.max(...Object.values(GOODS).map(g=>g.maxPrice));
          const w=190,h=90; const margin={l:32,r:6,t:8,b:22};
          const t0=histRaw[0].t, t1=histRaw[histRaw.length-1].t; const timeSpan=Math.max(0.001, t1-t0);
          let path=''; histRaw.forEach((s,i)=>{ const relT=(s.t - t0)/timeSpan; const x=margin.l + relT*(w-margin.l-margin.r); const norm=(s.price - globalMin)/(globalMax-globalMin); const y=h - margin.b - norm*(h-margin.t-margin.b); path+=(i?'L':'M')+x.toFixed(1)+','+y.toFixed(1)+' '; });
          function yFor(val){ const norm=(val - globalMin)/(globalMax-globalMin); return h - margin.b - norm*(h-margin.t-margin.b); }
          const midPrice=(globalMin+globalMax)/2; const gridLines=[globalMin,midPrice,globalMax].map(val=>{ const y=yFor(val).toFixed(1); return `<line x1="${margin.l}" y1="${y}" x2="${w-margin.r}" y2="${y}" stroke="rgba(255,255,255,0.1)" stroke-width="1" /> <text x="${margin.l-4}" y="${(+y+4).toFixed(1)}" text-anchor="end" font-size="9" fill="#b8c4cc">${val.toFixed(0)}</text>`; }).join('');
          const timeLabelStart = `${(t0/24).toFixed(1)}d`; const timeLabelEnd = `${(t1/24).toFixed(1)}d`; const xAxisY=(h - margin.b).toFixed(1);
          const xLabels = `<text x="${margin.l}" y="${h-6}" font-size="9" fill="#b8c4cc" text-anchor="start">${timeLabelStart}</text><text x="${w-margin.r}" y="${h-6}" font-size="9" fill="#b8c4cc" text-anchor="end">${timeLabelEnd}</text><text x="${(w/2).toFixed(1)}" y="${h-6}" font-size="9" fill="#88949c" text-anchor="middle">${t('time.delta',{hours:timeSpan.toFixed(1), unit:t('time.hoursShort')})}</text>`;
          const stock=div.getAttribute('data-stock'); const capacity=div.getAttribute('data-capacity'); const stockpct=div.getAttribute('data-stockpct'); const price=div.getAttribute('data-price'); const net=div.getAttribute('data-net'); const ratio=div.getAttribute('data-ratio');
          const netNum=parseFloat(net); const netColor=netNum>0?'#49b070':(netNum<0?'#c86434':'#cccccc');
          priceTooltip.innerHTML=`<div class='pt-head'>${city.name} / ${GOODS[gid].name}</div><div class='pt-line'>${t('tooltip.price')}: <b>${PRICE_SYMBOL} ${price}</b></div><div class='pt-line'>${t('tooltip.stock')}: <b>${stock}</b>/<b>${capacity}</b> (${stockpct}%)</div><div class='pt-line'>${t('tooltip.netFlow')}: <b style=\"color:${netColor}\">${netNum>0?'+':''}${net}/${t('time.hoursShort')}</b></div><div class='pt-line'>${t('tooltip.priceRangePct')}: ${ratio}%</div><div class='pt-line' style='margin-top:2px; opacity:.7;'>${t('tooltip.axes')}</div><svg width='${w}' height='${h}' style='margin-top:4px;'><rect x='${margin.l}' y='${margin.t}' width='${w-margin.l-margin.r}' height='${h-margin.t-margin.b}' fill='rgba(255,255,255,0.03)' stroke='rgba(255,255,255,0.15)' stroke-width='1'/>${gridLines}<path d='${path}' stroke='#6fcfb2' stroke-width='2' fill='none' stroke-linejoin='round' stroke-linecap='round'/><line x1='${margin.l}' y1='${xAxisY}' x2='${w-margin.r}' y2='${xAxisY}' stroke='rgba(255,255,255,0.2)' stroke-width='1'/>${xLabels}</svg>`;
          priceTooltip.style.display='block';
        });
        citiesView.addEventListener('mousemove', e=>{ if(priceTooltip.style.display==='block'){ priceTooltip.style.left=(e.clientX+14)+'px'; priceTooltip.style.top=(e.clientY+16)+'px'; } });
        citiesView.addEventListener('mouseleave', ()=>{ priceTooltip.style.display='none'; });
      }
      if((now - citiesLastBuild) > CITIES_BUILD_INTERVAL){
        citiesLastBuild=now;
        let html='';
        for(const city of world.cities){
          if(city.locked) continue;
          updateCityPrices(city);
          const tagLine = city.tag? `<span class=\"city-tag\" style=\"opacity:.70;font-size:10px;display:inline-block;margin-top:2px;\">${city.tag}</span>`: '';
          // Display city name on first line; second line shows tag (replaces previous role/focus display)
          html+=`<div class=\"city\"><b>${city.name}</b><br/>${tagLine}<div class=\"goods\">`;
          for(const gid of Object.keys(GOODS)){
            if(world.player && !world.player.unlockedGoods.includes(gid)) continue;
            const price=city.prices[gid]; const stock=city.stocks[gid]; const f=city.flows[gid]; const net=(f.prod-f.cons); const gdef=GOODS[gid];
            const ratio=(price-gdef.minPrice)/(gdef.maxPrice-gdef.minPrice);
            let cls=''; if(price<=strategy.buyBelow[gid]) cls='good-buy'; else if(price>=strategy.sellAbove[gid]) cls='good-sell'; else if(ratio<0.33) cls='p-low'; else if(ratio<0.66) cls='p-mid'; else cls='p-high';
            // Flash animations (restored) with throttling to avoid constant blinking
            city.prevPrices=city.prevPrices||{}; const prev=city.prevPrices[gid];
            city.priceFlashMeta = city.priceFlashMeta || {};
            const flashMeta = city.priceFlashMeta[gid] || { lastFlash:0 };
            let animClass='';
            if(prev!=null){
              const diff = price - prev;
              // Require at least 1 unit change and 1.8s since last flash
              if(Math.abs(diff) >= 1 && (now - flashMeta.lastFlash) > 1800){
                animClass = diff>0? ' flash-up':' flash-down';
                flashMeta.lastFlash = now;
              }
            }
            city.priceFlashMeta[gid] = flashMeta;
            city.prevPrices[gid]=price;
            city.priceHist=city.priceHist||{}; city.priceHistMeta=city.priceHistMeta||{}; if(!city.priceHist[gid]) city.priceHist[gid]=[]; if(!city.priceHistMeta[gid]) city.priceHistMeta[gid]={ lastT:-1 }; const hist=city.priceHist[gid]; const meta=city.priceHistMeta[gid]; if((world.day - meta.lastT) >= 0.5){ if(hist.length===0 || hist[hist.length-1].price!==price){ hist.push({t:world.day, price}); meta.lastT=world.day; if(hist.length>150) hist.shift(); } }
            const stockPct=Math.max(0, Math.min(100,(stock/gdef.capacity)*100)); const emoji=GOODS_EMOJI[gid]||'';
            html+=`<div class=\"${cls+animClass}\" data-city=\"${city.id}\" data-good=\"${gid}\" data-stock=\"${stock.toFixed(0)}\" data-capacity=\"${gdef.capacity}\" data-stockpct=\"${stockPct.toFixed(0)}\" data-price=\"${price.toFixed(0)}\" data-net=\"${net.toFixed(1)}\" data-ratio=\"${(ratio*100).toFixed(0)}\" data-histlen=\"${hist.length}\"><span class=\"gicon\">${emoji}</span><div class=\"price-line\">${PRICE_SYMBOL} ${price.toFixed(0)}</div><div class=\"ratioBar\" data-stock=\"${stock.toFixed(0)}\" data-capacity=\"${gdef.capacity}\"><span style=\"width:${stockPct.toFixed(0)}%\"></span></div></div>`;
          }
          html+='</div></div>';
        }
        citiesView.innerHTML=html || '<i>—</i>';
      }
    }
  }
  // Upgrades window refresh
  if(document.getElementById('win-upgrades')?.classList.contains('show')){
    if(world.__needsUpgradesRefresh){ buildUpgradesUI(true); world.__needsUpgradesRefresh=false; }
    else buildUpgradesUI();
  }
  // caravans merged into strategy window
}

let upgradesBuilt=false; let upgradesLastBuild=0; const UPGRADES_BUILD_INTERVAL=500;
function buildUpgradesUI(force=false){
  const el=document.getElementById('upgradesView'); if(!el) return;
  const now=performance.now(); if(!force && (now - upgradesLastBuild) < UPGRADES_BUILD_INTERVAL) return; upgradesLastBuild=now;
  const p=world.player; if(!p) { el.innerHTML='<i>—</i>'; return; }
  let html='';
  html+='<div class="upg-hint">'+t('upg.hint')+'</div>';
  for(const key of Object.keys(UPGRADE_DEFS)){
    const def=UPGRADE_DEFS[key]; const owned=p.upgrades[key]||0; const max=def.max; const {ok, reason, cost}=canPurchaseUpgrade(world, key);
    // Hide upgrades not yet available by level (except always show camelLimit as the introductory one)
    if(owned<1 && key!=='camelLimit'){
      // Determine first required level (for l=0)
      if(typeof def.levelReq==='function' && !def.levelReq(p,0)){
        // Skip rendering entirely until first level requirement met
        continue;
      }
    }
    let status='';
    if(owned>=max) status=t('upg.max');
    else if(!ok){
      if(reason==='level'){
        // Find next required level by incrementing l until requirement satisfied
        let needed=null; for(let testL=owned; testL<max; testL++){ if(def.levelReq && def.levelReq(p,testL)){ needed=null; break; } else { const reqLevelGuess = (()=>{ // brute force search for first level satisfying def.levelReq(p,testL)
              for(let L=p.level; L<=p.level+40; L++){ if(def.levelReq && def.levelReq({...p, level:L}, testL)) return L; }
              return '?'; })(); needed=reqLevelGuess; break; } }
        const reqShown = needed!=null? needed: (p.level+1);
        status=t('upg.needLevel',{lvl:reqShown});
      }
      else if(reason==='money') status=t('upg.needMoney',{cost});
      else status='';
    }
    const name=t(def.nameKey);
    const desc=t(def.descKey);
    const nextCost = owned<max? nextUpgradeCost(key, owned): null;
    const pct=(owned/max)*100; const tierClass = pct>=80? 'tier-high': (pct>=50? 'tier-mid':'tier-base');
  let effectNext='';
  if(key==='cargoHarness'){ effectNext = t('upg.fx.cargoHarness',{cur:owned*12,next:Math.min(owned+1,max)*12}); }
  else if(key==='haggling'){ effectNext = t('upg.fx.haggling',{curSell:owned*2, curBuy:owned*2, nextSell:Math.min(owned+1,max)*2, nextBuy:Math.min(owned+1,max)*2}); }
  else if(key==='caravanSpeed'){ effectNext = t('upg.fx.caravanSpeed',{cur:owned*6,next:Math.min(owned+1,max)*6}); }
  else if(key==='camelCare'){ effectNext = t('upg.fx.camelCare',{cur:owned*15,next:Math.min(owned+1,max)*15}); }
  else if(key==='camelLimit'){ effectNext = t('upg.fx.camelLimit',{cur:1+owned,next:Math.min(1+owned+1,1+max)}); }
  else if(key==='caravanSlots'){ effectNext = t('upg.fx.caravanSlots',{cur:1+owned,next:Math.min(1+owned+1,1+max)}); }
    html+=`<div class=\"upg ${tierClass}\"><div class=\"upg-h\">${def.icon} <b>${name}</b> <span class=\"lvl\">${owned}/${max}</span></div><div class=\"upg-bar\"><span style=\"width:${pct.toFixed(1)}%\"></span></div><div class=\"upg-d\">${desc}<div class=\"upg-eff\">${effectNext}</div></div><div class=\"upg-a\">`;
    if(owned<max){
      html+=`<button data-upg=\"${key}\" ${ok?'':'disabled'} title=\"${effectNext}\">${t('upg.buy')} ${nextCost?('('+PRICE_SYMBOL+nextCost+')'):''}</button>`;
    } else {
      html+=`<span class=\"upg-max\">${t('upg.max')}</span>`;
    }
    if(status) html+=`<div class=\"upg-status\">${status}</div>`;
    html+='</div></div>';
  }
  el.innerHTML=html;
  if(!upgradesBuilt){
    upgradesBuilt=true;
    el.addEventListener('click', e=>{ const b=e.target.closest('button[data-upg]'); if(!b) return; const key=b.getAttribute('data-upg'); purchaseUpgrade(world, key); buildUpgradesUI(true); });
  }
}
