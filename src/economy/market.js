// Economy / Market simulation module
// Defines goods, pricing model, and trading helpers.
import { t, applyGoodsNames } from '../core/i18n.js';
import { caravanCapacity } from '../core/upgrades.js';

export const GOODS = {
  spice: { id: 'spice', name: 'spice', minPrice: 30, maxPrice: 90, baseStock: 120, capacity: 240 },
  cloth: { id: 'cloth', name: 'cloth', minPrice: 18, maxPrice: 55, baseStock: 160, capacity: 320 },
  ore:   { id: 'ore',   name: 'ore',     minPrice: 25, maxPrice: 80, baseStock: 100, capacity: 220 }
};
applyGoodsNames(GOODS);

// Player strategy thresholds (mutable through UI)
export const strategy = {
  buyBelow: { spice: 50, cloth: 32, ore: 45 },
  sellAbove: { spice: 68, cloth: 42, ore: 62 },
  // Trading mode per good: 'active' | 'hold' | 'disabled' | 'liquidate'
  // active: normal threshold-based buy & sell
  // hold: do nothing (keep existing cargo, no buy, no sell)
  // disabled: ignore (no buy, no sell, thresholds inert)
  // liquidate: force-sell all current cargo once, then switch to disabled
  mode: { spice: 'active', cloth: 'active', ore: 'active' }
};

// Compute dynamic price for a specific city & good based on its stock.
export function computePrice(city, goodId){
  const g = GOODS[goodId];
  const stock = city.stocks[goodId];
  // Normalize: 0 stock -> maxPrice, full capacity -> minPrice
  const t = Math.min(1, Math.max(0, stock / g.capacity));
  const price = g.maxPrice - (g.maxPrice - g.minPrice) * t;
  return price;
}

// Recalculate and cache prices for a city (optional optimization)
export function updateCityPrices(city){
  city.prices = city.prices || {};
  for(const k of Object.keys(GOODS)){
    city.prices[k] = computePrice(city, k);
  }
}

// Attempt autonomous trading for a caravan on arrival at a city.
// Player has global money (world.money). Caravan has cargo + capacity.
export function caravanAutoTrade(caravan, city, world){
  updateCityPrices(city);
  // Ensure cargo object
  if(!caravan.cargo){ caravan.cargo = { spice:{qty:0,avg:0}, cloth:{qty:0,avg:0}, ore:{qty:0,avg:0} }; }
  // Non-linear capacity with upgrades
  const totalCap = caravanCapacity(caravan, world);
  const used = Object.values(caravan.cargo).reduce((a,b)=>a+(b.qty||0),0);
  let free = Math.max(0, totalCap - used);
  const uiLog = world.__uiLog || world.__log || console.log;
  const beforeMoney = world.money;
  let anySell=false, anyBuy=false;
  let tradeProfit = 0;

  // 1. Sell phase (honor modes & thresholds to free space)
  for(const gid of Object.keys(GOODS)){
    const mode = strategy.mode?.[gid] || 'active';
    if(mode==='hold' || mode==='disabled') continue; // no selling in these modes
    const slot = caravan.cargo[gid]; const qty = slot.qty; if(qty<=0) continue;
    let price = city.prices[gid];
    // Liquidate mode: sell regardless of threshold at current price
    const forceSell = (mode==='liquidate');
    // Sell bonus improves revenue (applied as price multiplier for profit calculation)
    const sellBonus = world.player?.upgradeStats?.sellBonus||0;
    if(sellBonus>0){ price *= (1+sellBonus); }
    if(forceSell || price >= strategy.sellAbove[gid]){
      const revenue = qty * price;
      const profit = qty * (price - slot.avg);
      tradeProfit += profit;
      world.money += revenue;
      city.stocks[gid] = Math.min(GOODS[gid].capacity, city.stocks[gid] + qty);
      slot.qty = 0; slot.avg = 0;
  uiLog(t('trade.sold',{id:caravan.id, name: (caravan.name||('#'+caravan.id)), qty, good:GOODS[gid].name, city:city.name, price:price.toFixed(0), profit:profit.toFixed(0)}), 'sell');
      if(profit>0) uiLog(t('trade.profit',{profit:profit.toFixed(0)}), 'profit');
      anySell=true;
      // After liquidating, switch to disabled so we don't buy again
      if(forceSell){ strategy.mode[gid] = 'disabled'; }
    }
  }

  // Recompute free after selling
  const used2 = Object.values(caravan.cargo).reduce((a,b)=>a+(b.qty||0),0);
  free = Math.max(0, totalCap - used2);

  // 2. Buy phase
  if(free>0){
    // Try goods in order of highest upside (difference between sellAbove - current price)
    const order = Object.keys(GOODS).map(gid=>({gid, upside: strategy.sellAbove[gid] - city.prices[gid]}))
      .filter(o=>{
        const mode = strategy.mode?.[o.gid] || 'active';
        if(mode==='hold' || mode==='disabled' || mode==='liquidate') return false; // no new buys
        return city.prices[o.gid] <= strategy.buyBelow[o.gid];
      })
  .filter(o=>{ return !world.player || world.player.unlockedGoods.includes(o.gid); })
      .sort((a,b)=>b.upside - a.upside);
    for(const o of order){
  if(free<=0) break; const gid=o.gid; let price=city.prices[gid];
      if(price > strategy.buyBelow[gid]) continue; // double check
  if(world.player && !world.player.unlockedGoods.includes(gid)) continue; // safety gate
      const avail = city.stocks[gid]; if(avail<=0) continue;
  // Determine quantity to buy. Previous logic skipped purchase entirely if not enough
  // money to fill all free capacity (buyQty * price). This caused caravans with limited
  // funds to buy nothing even when they could afford a partial load. Fix: cap by affordable.
  let buyQty = Math.min(avail, free);
  // Apply buy discount (reduces effective cost)
  const buyDiscount = world.player?.upgradeStats?.buyDiscount||0;
  const effectivePrice = price * (1 - buyDiscount);
  const affordable = Math.floor(world.money / effectivePrice);
  if(affordable <= 0) continue; // can't afford even one unit
  if(buyQty > affordable) buyQty = affordable; // partial fill with what we can afford
  const cost = buyQty * effectivePrice;
      world.money -= cost;
      city.stocks[gid] -= buyQty;
      const slot = caravan.cargo[gid];
      const newQty = slot.qty + buyQty;
  slot.avg = (slot.avg * slot.qty + buyQty * price) / newQty; // avg based on base price (not modified by discount)
      slot.qty = newQty;
      free -= buyQty;
  uiLog(t('trade.bought',{id:caravan.id, name:(caravan.name||('#'+caravan.id)), qty:buyQty, good:GOODS[gid].name, city:city.name, price:price.toFixed(0)}), 'buy');
    anyBuy=true;
    }
  }
  if(tradeProfit!==0){
    world.totalProfit = (world.totalProfit||0) + tradeProfit;
    world.lastTradeProfit = tradeProfit;
    // Award XP proportional to profit (tunable 1 xp per 5 profit)
    if(world.player && tradeProfit>0){
      // Increased XP per profit: 1 XP per 2 profit (was per 5)
      const per=2; const xp=Math.max(1, Math.floor(tradeProfit / per));
      if(world.__awardXP){ world.__awardXP(xp); }
    }
  }
  const delta = world.money - beforeMoney;
  if(delta!==0){ uiLog(t('trade.balance',{delta:(delta>0?'+':'')+delta.toFixed(0)}), delta>0? 'profit':'balance-minus'); }
  if(!anySell && !anyBuy){ uiLog(t('trade.nothing',{id:caravan.id, name:(caravan.name||('#'+caravan.id)), city:city.name}), 'note'); }
}

// Helper to aggregate cargo across caravans.
export function recalcWorldGoods(world){
  let sum=0; for(const c of world.caravans){ if(c.cargo){ sum += Object.values(c.cargo).reduce((a,b)=>a+(b.qty||0),0); } }
  world.goods = sum;
}

// City flow update (production & consumption) per in-game hour delta.
export function applyCityFlows(world, hoursDelta){
  // Daily variation: once per in-game day (24 hours) re-roll broader production/consumption multipliers
  const dayIndex = Math.floor(world.day/24);
  if(world.__lastDayIndex==null) world.__lastDayIndex = dayIndex;
  if(dayIndex !== world.__lastDayIndex){
    world.__lastDayIndex = dayIndex;
    // For each unlocked good, vary prod/cons per city; allow sign flips occasionally
    const unlocked = world.player? world.player.unlockedGoods.slice(): Object.keys(GOODS);
    for(const city of world.cities){
      for(const gid of Object.keys(GOODS)){
        if(unlocked.indexOf(gid)===-1) continue; // ignore locked goods for variation
        const f = city.flows[gid]; if(!f) continue;
        // Base variation factors: producers focus goods vary more
        const isFocus = city.focus===gid;
        const prodVar = 1 + (Math.random()* (isFocus?0.55:0.35) - (isFocus?0.28:0.18));
        const consVar = 1 + (Math.random()* (isFocus?0.55:0.35) - (isFocus?0.28:0.18));
        f.prod *= prodVar; f.cons *= consVar;
        // Chance to flip (if net small) so city can switch role temporarily for this good
        const net = f.prod - f.cons;
        if(Math.abs(net) < GOODS[gid].capacity*0.01 && Math.random()<0.20){
          const tmp=f.prod; f.prod=f.cons; f.cons=tmp; // swap to invert
        }
      }
    }
    // After variation ensure at least one producer & one consumer per unlocked good and slight positive average
    for(const gid of unlocked){
      let producers=0, consumers=0, netSum=0; for(const c of world.cities){ const f=c.flows[gid]; if(!f) continue; const net=f.prod-f.cons; netSum+=net; if(net>0.5) producers++; else if(net<-0.5) consumers++; }
      const cap=GOODS[gid].capacity; if(producers===0 || consumers===0 || netSum < 0){
        // pick extremes
        let maxCity=null,minCity=null,maxNet=-1e9,minNet=1e9; for(const c of world.cities){ const f=c.flows[gid]; if(!f) continue; const net=f.prod-f.cons; if(net>maxNet){ maxNet=net; maxCity=c; } if(net<minNet){ minNet=net; minCity=c; } }
        if(maxCity && minCity && maxCity!==minCity){
          if(producers===0 || netSum<0){ maxCity.flows[gid].prod *=1.25; maxCity.flows[gid].cons *=0.85; }
          if(consumers===0){ minCity.flows[gid].prod *=0.80; minCity.flows[gid].cons *=1.25; }
        }
        // If still globally negative, scale up all production slightly
        if(netSum < 0){ const scale = 1 + Math.min(0.25, (-netSum)/(cap*world.cities.length*0.01)); for(const c of world.cities){ c.flows[gid].prod *= scale; }}
      }
    }
  }
  for(const city of world.cities){
    if(!city.flows) continue;
    for(const gid of Object.keys(GOODS)){
      // Skip simulation for goods not yet unlocked to avoid pre-unlock depletion
      if(world.player && world.player.unlockedGoods.indexOf(gid)===-1) continue;
      const g=GOODS[gid];
      const flow = city.flows[gid] || {prod:0, cons:0};
      // stochastic factor on consumption
      const consRand = 0.85 + Math.random()*0.3;
      let d = flow.prod * hoursDelta - flow.cons * consRand * hoursDelta;
      if(d!==0){ city.stocks[gid] = Math.min(g.capacity, Math.max(0, city.stocks[gid] + d)); }
    }
  }
  // Slow drift of production/consumption every in-game hour group (approx each call) using small random walk, plus periodic rebalance.
  world.__flowDriftTimer = (world.__flowDriftTimer||0) + hoursDelta;
  if(world.__flowDriftTimer >= 6){ // every 6 in-game hours apply slight drift (small after daily variation)
    world.__flowDriftTimer = 0;
    for(const city of world.cities){ if(!city.flows) continue; for(const gid of Object.keys(GOODS)){
      const f = city.flows[gid];
      if(world.player && world.player.unlockedGoods.indexOf(gid)===-1) continue;
      // Drift factors keep ratio roughly stable but allow city to shift role
      const driftProd = 1 + (Math.random()-0.5)*0.08; // +/-4%
      const driftCons = 1 + (Math.random()-0.5)*0.08;
      f.prod *= driftProd; f.cons *= driftCons;
      // Clamp to reasonable band relative to capacity
      const cap = GOODS[gid].capacity;
      const maxRate = cap * 0.05; // 5% capacity per hour cap
      f.prod = Math.min(maxRate, Math.max(0, f.prod));
      f.cons = Math.min(maxRate, Math.max(0, f.cons));
    } }
    // Light global rebalancing: ensure for each good there is at least one net producer and one net consumer.
    for(const gid of Object.keys(GOODS)){
      if(world.player && world.player.unlockedGoods.indexOf(gid)===-1) continue;
      let producers=0, consumers=0; for(const c of world.cities){ const net=c.flows[gid].prod - c.flows[gid].cons; if(net>0.5) producers++; else if(net<-0.5) consumers++; }
      if(producers===0||consumers===0){
        // pick extremes and nudge
        let maxCity=null, minCity=null, maxNet=-1e9, minNet=1e9; for(const c of world.cities){ const net=c.flows[gid].prod - c.flows[gid].cons; if(net>maxNet){ maxNet=net; maxCity=c; } if(net<minNet){ minNet=net; minCity=c; } }
        if(maxCity && minCity && maxCity!==minCity){ // enforce divergence
          maxCity.flows[gid].prod *= 1.10; maxCity.flows[gid].cons *= 0.92;
          minCity.flows[gid].prod *= 0.90; minCity.flows[gid].cons *= 1.10;
        }
      }
      // Ensure slight positive global net to prevent attrition
      let netSum=0; for(const c of world.cities){ netSum += c.flows[gid].prod - c.flows[gid].cons; }
      if(netSum < 0){ const cap=GOODS[gid].capacity; const scale=1 + Math.min(0.15, (-netSum)/(cap*world.cities.length*0.02)); for(const c of world.cities){ c.flows[gid].prod *= scale; } }
    }
  }
}

// Compute min & max current prices across unlocked (and un-locked) cities for a given good.
export function currentPriceSpread(world, gid){
  let min=Infinity, max=-Infinity; const unlocked = !world.player? true: world.player.unlockedGoods.includes(gid);
  if(!unlocked) return {min:0,max:0};
  for(const city of world.cities){ if(city.locked) continue; updateCityPrices(city); const p=city.prices[gid]; if(p<min) min=p; if(p>max) max=p; }
  if(min===Infinity){ min=0; max=0; }
  return {min, max};
}

// Profit-oriented thresholds: choose buy slightly above global min and sell slightly below global max to increase trade frequency and margin.
export function suggestProfitThresholds(world, gid){
  const {min,max} = currentPriceSpread(world, gid);
  if(max<=min){ return { buy:min, sell:max+1 }; }
  const range = max - min;
  const buy = Math.round(min + range*0.05); // 5% in from min
  const sell = Math.round(max - range*0.05); // 5% in from max
  if(sell <= buy){ return { buy, sell: buy+1 }; }
  return { buy, sell };
}
