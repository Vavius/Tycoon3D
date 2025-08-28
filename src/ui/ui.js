// UI & windows logic extracted
import { GOODS, strategy, updateCityPrices, recalcWorldGoods } from '../economy/market.js';
import { t } from '../core/i18n.js';
import { world, newCaravan } from '../world/world.js';
import { camelCost, caravanCost, xpForLevel } from '../core/progression.js';

// Debug flags (can be toggled from console: window.DEBUG_CAMEL=true/false)
window.DEBUG_CAMEL = window.DEBUG_CAMEL ?? true;

// Currency / price symbol (easy to change in one place)
export const PRICE_SYMBOL = '💰';

// Emoji icons for goods
const GOODS_EMOJI = { spice:'🌶️', cloth:'👗', ore:'🪨' };

export function initWindowButtons(){
  const menu=document.getElementById('windowsMenu'); if(!menu) return;
  menu.querySelectorAll('button[data-win]').forEach(b=> b.addEventListener('click', ()=>toggleWindow(b.dataset.win)) );
  document.querySelectorAll('.window .close').forEach(c=> c.addEventListener('click', ()=>{ const k=c.dataset.close; const map={cities:'win-cities',strategy:'win-strategy',caravans:'win-caravans'}; const w=document.getElementById(map[k]); if(w){ w.classList.remove('show'); const btn=document.querySelector(`#windowsMenu button[data-win="${k}"]`); if(btn) btn.classList.remove('active'); } }) );
  // drag persistence
  const wins=document.querySelectorAll('.window'); let dragTarget=null, offX=0, offY=0; let zTop=50; function save(el){ localStorage.setItem('winpos-'+el.id, JSON.stringify({left:el.style.left, top:el.style.top})); }
  wins.forEach(w=>{ const saved=localStorage.getItem('winpos-'+w.id); if(saved){ try{ const r=JSON.parse(saved); if(r.left&&r.top){ w.style.left=r.left; w.style.top=r.top; } }catch(e){} } const tb=w.querySelector('.titlebar'); if(!tb) return; tb.style.cursor='move'; tb.addEventListener('mousedown', e=>{ dragTarget=w; const rect=w.getBoundingClientRect(); offX=e.clientX-rect.left; offY=e.clientY-rect.top; w.style.zIndex=++zTop; }); });
  window.addEventListener('mousemove', e=>{ if(!dragTarget) return; dragTarget.style.left=(e.clientX-offX)+'px'; dragTarget.style.top=(e.clientY-offY)+'px'; });
  window.addEventListener('mouseup', ()=>{ if(dragTarget){ save(dragTarget); dragTarget=null; } });
}

export function toggleWindow(key){ const map={ cities:'win-cities', strategy:'win-strategy'}; const id=map[key]; if(!id) return; const w=document.getElementById(id); if(!w) return; const btn=document.querySelector(`#windowsMenu button[data-win="${key}"]`); const showing=w.classList.toggle('show'); if(btn) btn.classList.toggle('active', showing); if(key==='strategy' && showing){ buildStrategyUI(true); buildCaravansView(); } }

let strategyBuilt=false; function buildStrategyUI(force=false){ if(strategyBuilt && !force) return; strategyBuilt=true; const grid=document.getElementById('strategyGrid'); if(!grid) return; grid.innerHTML=''; grid.insertAdjacentHTML('beforeend',`<div class=\"hdr\">${t('strategy.good')}</div><div class=\"hdr\">${t('strategy.buyLE')}</div><div class=\"hdr\">${t('strategy.sellGE')}</div><div class=\"hdr\">${t('strategy.range')}</div>`); const player=world.player; const goodsVisible=Object.keys(GOODS).filter(gid=> !player || player.unlockedGoods.includes(gid)); for(const gid of goodsVisible){ const g=GOODS[gid]; const row=document.createElement('div'); row.textContent=g.name; grid.appendChild(row); // BUY input
  const buy=document.createElement('input'); buy.type='number'; buy.value=strategy.buyBelow[gid]; buy.className='strategy-num'; buy.addEventListener('change',()=>{ strategy.buyBelow[gid]=parseFloat(buy.value)||0; }); const buyWrap=document.createElement('div'); buyWrap.className='num-wrap'; buyWrap.appendChild(buy); const bStepper=document.createElement('div'); bStepper.className='stepper'; const bUp=document.createElement('button'); bUp.type='button'; bUp.textContent='▲'; const bDown=document.createElement('button'); bDown.type='button'; bDown.textContent='▼'; [bUp,bDown].forEach(btn=>{ btn.addEventListener('mousedown',e=>{ e.preventDefault(); }); }); bUp.addEventListener('click',()=>{ buy.stepUp(); buy.dispatchEvent(new Event('change')); }); bDown.addEventListener('click',()=>{ buy.stepDown(); buy.dispatchEvent(new Event('change')); }); bStepper.appendChild(bUp); bStepper.appendChild(bDown); buyWrap.appendChild(bStepper); grid.appendChild(buyWrap); // SELL input
  const sell=document.createElement('input'); sell.type='number'; sell.value=strategy.sellAbove[gid]; sell.className='strategy-num'; sell.addEventListener('change',()=>{ strategy.sellAbove[gid]=parseFloat(sell.value)||0; }); const sellWrap=document.createElement('div'); sellWrap.className='num-wrap'; sellWrap.appendChild(sell); const sStepper=document.createElement('div'); sStepper.className='stepper'; const sUp=document.createElement('button'); sUp.type='button'; sUp.textContent='▲'; const sDown=document.createElement('button'); sDown.type='button'; sDown.textContent='▼'; [sUp,sDown].forEach(btn=>{ btn.addEventListener('mousedown',e=>{ e.preventDefault(); }); }); sUp.addEventListener('click',()=>{ sell.stepUp(); sell.dispatchEvent(new Event('change')); }); sDown.addEventListener('click',()=>{ sell.stepDown(); sell.dispatchEvent(new Event('change')); }); sStepper.appendChild(sUp); sStepper.appendChild(sDown); sellWrap.appendChild(sStepper); grid.appendChild(sellWrap); // range span
  const span=document.createElement('div'); span.style.opacity='0.65'; span.style.fontSize='10px'; span.textContent=`${g.minPrice}-${g.maxPrice}`; grid.appendChild(span); } }

function formatFlow(city,gid){ const f=city.flows[gid]; if(!f) return ''; const net=(f.prod-f.cons).toFixed(1); return `${net}`; }

let caravansDelegated=false; let caravansLastBuild=0; const CARAVANS_BUILD_INTERVAL=400; // ms
function buildCaravansView(force=false){
  const el=document.getElementById('caravansView'); if(!el) return;
  const now=performance.now();
  if(!force && (now - caravansLastBuild) < CARAVANS_BUILD_INTERVAL){ return; }
  caravansLastBuild=now;
  const capPerCamel=10; let html='';
  const player=world.player;
  const camelBaseCost = camelCost(world);
  const caravanBuyCost = caravanCost(world);
  for(const c of world.caravans){
  const destName=c.destCity ? (world.cities.find(ct=>ct.id===c.destCity)?.name||'?') : '—';
  const state=t('caravan.state.'+c.state);
    const used=Object.values(c.cargo).reduce((a,b)=>a+(b.qty||0),0);
    const cap=c.camels*capPerCamel;
  const camelLimit = (player?.maxCamelsPerCaravan||1);
  let btnDisabled=false; let btnTitle=`${t('btn.addCamel')} (${PRICE_SYMBOL}${camelBaseCost})`;
  if(c.camels >= camelLimit){ btnDisabled=true; btnTitle=t('level.camelLimit',{n:camelLimit}); }
  else if(world.money < camelBaseCost){ btnDisabled=true; btnTitle=t('caravan.addCamelNoMoney',{cost:camelBaseCost}); }
  const addCamelBtn = `<button class=\"add-camel\" data-car=\"${c.id}\" title=\"${btnTitle}\" ${btnDisabled?'disabled':''}>+🐪 ${PRICE_SYMBOL}${camelBaseCost}</button>`;
  html+=`<div class=\"car\"><div class=\"car-head\"><b>#${c.id}</b> ${state} ${addCamelBtn}</div><div>${t('caravan.target')}: ${destName}</div><div>${t('caravan.camels')}: ${c.camels}</div><div>${t('caravan.filled')}: ${used}/${cap}</div>`;
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
      if(car.camels>=limit){ if(window.DEBUG_CAMEL) console.log('[AddCamel] Reached camel limit', {carId:car.id, camels:car.camels, limit}); uiLog(t('caravan.addCamelLimit',{id:car.id})); return; }
      const costNow = camelCost(world);
      if(world.money<costNow){ if(window.DEBUG_CAMEL) console.log('[AddCamel] Not enough money', {money:world.money, costNow}); uiLog(t('caravan.addCamelNoMoney',{cost:costNow})); return; }
      const beforeMoney=world.money; const beforeCamels=car.camels;
      world.money-=costNow;
      car.camels++;
      car.faces.push(':)');
      if(car.camelTrail){ car.camelTrail.push({offset:(car.camelTrail.length)*2.2, x:car.x, z:car.z, y:car.y||0, yaw:car.yaw||0, phase:Math.random()*Math.PI*2}); }
      if(world.player){ world.player.totalCamelsPurchased=(world.player.totalCamelsPurchased||0)+1; }
      if(window.DEBUG_CAMEL){ console.log('[AddCamel] Success', {carId:car.id, beforeCamels, afterCamels:car.camels, beforeMoney, afterMoney:world.money, cost:costNow}); }
      uiLog(t('caravan.addCamelAdded',{id:car.id, count:car.camels}));
      // Force immediate rebuild to update disabled state
      buildCaravansView(true);
    });
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
  const stats=document.getElementById('stats'); if(stats) stats.innerHTML = `Money: ${Math.floor(world.money)}<br/>Level: ${p.level}<br/>XP: ${curHave.toFixed(0)}/${curReqTotal.toFixed(0)}${bar}Total Profit: ${world.totalProfit.toFixed(0)}<br/>Last Trade: ${world.lastTradeProfit.toFixed(0)}<br/>${fmtDay()}<br/>${world.paused?'<b>PAUSED</b>':''}`;
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
          html+=`<div class=\"city\"><b>${city.name}</b><br/><span style=\"opacity:.55;font-size:10px;\">${city.role} / ${city.focus}</span><div class=\"goods\">`;
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
  // caravans merged into strategy window
}
