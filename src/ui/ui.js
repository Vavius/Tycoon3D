// UI & windows logic extracted
import { GOODS, strategy, updateCityPrices, recalcWorldGoods } from '../economy/market.js';
import { world } from '../world/world.js';

// Currency / price symbol (easy to change in one place)
export const PRICE_SYMBOL = '¤'; // change this symbol as needed

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

export function toggleWindow(key){ const map={ cities:'win-cities', strategy:'win-strategy', caravans:'win-caravans'}; const id=map[key]; if(!id) return; const w=document.getElementById(id); if(!w) return; const btn=document.querySelector(`#windowsMenu button[data-win="${key}"]`); const showing=w.classList.toggle('show'); if(btn) btn.classList.toggle('active', showing); if(key==='strategy' && showing) buildStrategyUI(true); }

let strategyBuilt=false; function buildStrategyUI(force=false){ if(strategyBuilt && !force) return; strategyBuilt=true; const grid=document.getElementById('strategyGrid'); if(!grid) return; grid.innerHTML=''; grid.insertAdjacentHTML('beforeend','<div class="hdr">Товар</div><div class="hdr">BUY<=</div><div class="hdr">SELL>=</div><div class="hdr">Диапазон</div>'); for(const gid of Object.keys(GOODS)){ const g=GOODS[gid]; const row=document.createElement('div'); row.textContent=g.name; grid.appendChild(row); const buy=document.createElement('input'); buy.type='number'; buy.value=strategy.buyBelow[gid]; buy.addEventListener('change',()=>{ strategy.buyBelow[gid]=parseFloat(buy.value)||0; }); grid.appendChild(buy); const sell=document.createElement('input'); sell.type='number'; sell.value=strategy.sellAbove[gid]; sell.addEventListener('change',()=>{ strategy.sellAbove[gid]=parseFloat(sell.value)||0; }); grid.appendChild(sell); const span=document.createElement('div'); span.style.opacity='0.65'; span.style.fontSize='10px'; span.textContent=`${g.minPrice}-${g.maxPrice}`; grid.appendChild(span); } }

function formatFlow(city,gid){ const f=city.flows[gid]; if(!f) return ''; const net=(f.prod-f.cons).toFixed(1); return `${net}`; }

function buildCaravansView(){ const el=document.getElementById('caravansView'); if(!el) return; const capPerCamel=10; let html=''; for(const c of world.caravans){ const destName=c.destCity ? (world.cities.find(ct=>ct.id===c.destCity)?.name||'?') : '—'; const state=c.state==='travel'?'в пути': (c.state==='trade'?'торгует':'ожидает'); const used=Object.values(c.cargo).reduce((a,b)=>a+(b.qty||0),0); const cap=c.camels*capPerCamel; html+=`<div class="car"><b>#${c.id}</b> ${state}<br/>Цель: ${destName}<br/>Заполн: ${used}/${cap}`; html+='<div class="cargo">'; for(const gid of Object.keys(GOODS)){ const slot=c.cargo[gid]; const iconClass=gid==='spice'?'g-spice': gid==='cloth'?'g-cloth':'g-ore'; html+=`<div title="avg ${slot.avg.toFixed(1)}"><span class="gicon ${iconClass}"></span>${slot.qty}</div>`; } html+='</div></div>'; } el.innerHTML= html || '<i>Нет караванов</i>'; }

// Tooltip for sparkline (reused from main extraction)
let priceTooltip=document.getElementById('priceTooltip'); if(!priceTooltip){ priceTooltip=document.createElement('div'); priceTooltip.id='priceTooltip'; priceTooltip.style.position='fixed'; priceTooltip.style.pointerEvents='none'; priceTooltip.style.display='none'; document.body.appendChild(priceTooltip); }

export function updateUI(){
  if(document.getElementById('win-strategy')?.classList.contains('show')) buildStrategyUI();
  const avgHyd= world.caravans.length? (world.caravans.reduce((a,c)=>a+c.hydration,0)/world.caravans.length)*100 : 0;
  const stats=document.getElementById('stats'); if(stats) stats.innerHTML = `Money: ${Math.floor(world.money)}<br/>Total Profit: ${world.totalProfit.toFixed(0)}<br/>Last Trade: ${world.lastTradeProfit.toFixed(0)}<br/>Goods store: ${world.goods}<br/>Caravans: ${world.caravans.length}<br/>Camels total: ${world.caravans.reduce((a,c)=>a+c.camels,0)}<br/>Avg hydration: ${avgHyd.toFixed(0)}%<br/>Inns: ${world.inns.length}<br/>Day: ${(world.day/24).toFixed(1)}<br/>${world.paused?'<b>PAUSED</b>':''}`;
  const legend=document.getElementById('legend'); if(legend) legend.innerHTML = `<div class="row"><div class="sw" style="background:#cfa968"></div><span>Пустыня</span></div>`+`<div class="row"><div class="sw" style="background:#1e5f38"></div><span>Оазис</span></div>`+`<div class="row"><div class="sw" style="background:#e15a10"></div><span>Маршрут</span></div>`+`<div class="row"><div class="sw" style="background:#b48a60"></div><span>Караван (${world.caravans.length})</span></div>`+`<div class="row"><div class="sw" style="background:#8c7a6a"></div><span>Инн (${world.inns.length})</span></div>`+`<div class="row"><div class="sw" style="background:#46221a"></div><span>Бандиты (${world.bandits.length})</span></div>`;
  if(document.getElementById('win-cities')?.classList.contains('show')){
    const citiesView=document.getElementById('citiesView');
    if(citiesView){
      let html='';
      for(const city of world.cities){
        updateCityPrices(city);
        html+=`<div class="city"><b>${city.name}</b><br/><span style="opacity:.55;font-size:10px;">${city.role} / ${city.focus}</span><div class="goods">`;
        for(const gid of Object.keys(GOODS)){
          const price=city.prices[gid];
          const stock=city.stocks[gid];
          const f=city.flows[gid];
            const net=(f.prod-f.cons);
          const gdef=GOODS[gid];
          const ratio=(price-gdef.minPrice)/(gdef.maxPrice-gdef.minPrice);
          let cls='';
          if(price<=strategy.buyBelow[gid]) cls='good-buy';
          else if(price>=strategy.sellAbove[gid]) cls='good-sell';
          else if(ratio<0.33) cls='p-low';
          else if(ratio<0.66) cls='p-mid';
          else cls='p-high';
          city.prevPrices=city.prevPrices||{};
          const prev=city.prevPrices[gid];
          let animClass='';
          if(prev!=null){ if(price>prev) animClass=' flash-up'; else if(price<prev) animClass=' flash-down'; }
          city.prevPrices[gid]=price;
          city.priceHist=city.priceHist||{};
          if(!city.priceHist[gid]) city.priceHist[gid]=[];
          const hist=city.priceHist[gid];
          if(hist.length===0 || hist[hist.length-1]!==price){ hist.push(price); if(hist.length>80) hist.shift(); }
          const ratioPct=Math.max(0, Math.min(100, ratio*100));
          const iconClass=gid==='spice'?'g-spice': gid==='cloth'?'g-cloth':'g-ore';
          // Removed native title tooltip; store data-* for custom tooltip
          html+=`<div class="${cls+animClass}" data-city="${city.id}" data-good="${gid}" data-stock="${stock.toFixed(0)}" data-price="${price.toFixed(0)}" data-net="${net.toFixed(1)}" data-ratio="${(ratio*100).toFixed(0)}" data-histlen="${hist.length}"><span class="gicon ${iconClass}"></span>${PRICE_SYMBOL} ${price.toFixed(0)}<span class="ratioBar"><span style="width:${ratioPct.toFixed(0)}%"></span></span></div>`;
        }
        html+='</div></div>';
      }
      citiesView.innerHTML=html;
      // Enhanced unified tooltip
      citiesView.querySelectorAll('.goods div').forEach(div=>{
        div.addEventListener('mouseenter',()=>{
          const cityId=div.getAttribute('data-city');
          const gid=div.getAttribute('data-good');
          const city=world.cities.find(c=>c.id===cityId); if(!city) return;
          const hist=(city.priceHist&&city.priceHist[gid])||[];
          if(hist.length<2){ priceTooltip.style.display='none'; return; }
          const w=140,h=46;
          const min=Math.min(...hist), max=Math.max(...hist); const span=max-min||1;
          let path='';
          hist.forEach((p,i)=>{ const x=i/(hist.length-1)*(w-6)+3; const y=h-3-((p-min)/span)*(h-10); path+=(i?'L':'M')+x.toFixed(1)+','+y.toFixed(1)+' '; });
          const stock=div.getAttribute('data-stock');
          const price=div.getAttribute('data-price');
          const net=div.getAttribute('data-net');
          const ratio=div.getAttribute('data-ratio');
          priceTooltip.innerHTML=`<div class='pt-head'>${city.name} / ${GOODS[gid].name}</div><div style='font-size:10px; opacity:.85; margin-bottom:4px;'>Цена: <b>${price}${PRICE_SYMBOL}</b> · Запасы: <b>${stock}</b> · Net/hr: <b>${net}</b> · ${ratio}%</div><svg width='${w}' height='${h}'><path d='${path}' stroke='#6fcfb2' stroke-width='2' fill='none' stroke-linejoin='round' stroke-linecap='round'/></svg>`;
          priceTooltip.innerHTML=`<div class='pt-head'>${city.name} / ${GOODS[gid].name}</div><div style='font-size:10px; opacity:.85; margin-bottom:4px;'>Цена: <b>${PRICE_SYMBOL} ${price}</b> · Запасы: <b>${stock}</b> · Net/hr: <b>${net}</b> · ${ratio}%</div><svg width='${w}' height='${h}'><path d='${path}' stroke='#6fcfb2' stroke-width='2' fill='none' stroke-linejoin='round' stroke-linecap='round'/></svg>`;
          priceTooltip.style.display='block';
        });
        div.addEventListener('mousemove',e=>{ if(priceTooltip.style.display==='block'){ priceTooltip.style.left=(e.clientX+14)+'px'; priceTooltip.style.top=(e.clientY+16)+'px'; } });
        div.addEventListener('mouseleave',()=>{ priceTooltip.style.display='none'; });
      });
    }
  }
  if(document.getElementById('win-caravans')?.classList.contains('show')) buildCaravansView();
}
