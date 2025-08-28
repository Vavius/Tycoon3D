// Economy / Market simulation module
// Defines goods, pricing model, and trading helpers.

export const GOODS = {
  spice: { id: 'spice', name: 'Пряности', minPrice: 30, maxPrice: 90, baseStock: 120, capacity: 240 },
  cloth: { id: 'cloth', name: 'Текстиль', minPrice: 18, maxPrice: 55, baseStock: 160, capacity: 320 },
  ore:   { id: 'ore',   name: 'Руда',     minPrice: 25, maxPrice: 80, baseStock: 100, capacity: 220 }
};

// Player strategy thresholds (mutable through UI)
export const strategy = {
  buyBelow: { spice: 50, cloth: 32, ore: 45 },
  sellAbove: { spice: 68, cloth: 42, ore: 62 }
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
  // capacity per camel
  const capPerCamel = 10; // tweakable
  const totalCap = caravan.camels * capPerCamel;
  const used = Object.values(caravan.cargo).reduce((a,b)=>a+(b.qty||0),0);
  let free = Math.max(0, totalCap - used);
  const log = world.__log || console.log;
  let tradeProfit = 0;

  // 1. Sell phase (honor sell thresholds first to free space)
  for(const gid of Object.keys(GOODS)){
    const slot = caravan.cargo[gid]; const qty = slot.qty; if(qty<=0) continue;
    const price = city.prices[gid];
    if(price >= strategy.sellAbove[gid]){
      const revenue = qty * price;
      const profit = qty * (price - slot.avg);
      tradeProfit += profit;
      world.money += revenue;
      city.stocks[gid] = Math.min(GOODS[gid].capacity, city.stocks[gid] + qty);
      slot.qty = 0; slot.avg = 0;
      log(`Караван #${caravan.id} продал ${qty} ${GOODS[gid].name} в ${city.name} по ${price.toFixed(0)} (профит ${profit.toFixed(0)}).`);
    }
  }

  // Recompute free after selling
  const used2 = Object.values(caravan.cargo).reduce((a,b)=>a+(b.qty||0),0);
  free = Math.max(0, totalCap - used2);

  // 2. Buy phase
  if(free>0){
    // Try goods in order of highest upside (difference between sellAbove - current price)
    const order = Object.keys(GOODS).map(gid=>({gid, upside: strategy.sellAbove[gid] - city.prices[gid]}))
      .filter(o=>city.prices[o.gid] <= strategy.buyBelow[o.gid])
      .sort((a,b)=>b.upside - a.upside);
    for(const o of order){
      if(free<=0) break; const gid=o.gid; const price=city.prices[gid];
      if(price > strategy.buyBelow[gid]) continue; // double check
      const avail = city.stocks[gid]; if(avail<=0) continue;
      const buyQty = Math.min(avail, free);
      const cost = buyQty * price;
      if(world.money < cost) continue; // can't afford
      world.money -= cost;
      city.stocks[gid] -= buyQty;
      const slot = caravan.cargo[gid];
      const newQty = slot.qty + buyQty;
      slot.avg = (slot.avg * slot.qty + buyQty * price) / newQty;
      slot.qty = newQty;
      free -= buyQty;
      log(`Караван #${caravan.id} купил ${buyQty} ${GOODS[gid].name} в городе ${city.name} по ${price.toFixed(0)}.`);
    }
  }
  if(tradeProfit!==0){
    world.totalProfit = (world.totalProfit||0) + tradeProfit;
    world.lastTradeProfit = tradeProfit;
  }
}

// Helper to aggregate cargo across caravans.
export function recalcWorldGoods(world){
  let sum=0; for(const c of world.caravans){ if(c.cargo){ sum += Object.values(c.cargo).reduce((a,b)=>a+(b.qty||0),0); } }
  world.goods = sum;
}

// City flow update (production & consumption) per in-game hour delta.
export function applyCityFlows(world, hoursDelta){
  for(const city of world.cities){
    if(!city.flows) continue;
    for(const gid of Object.keys(GOODS)){
      const g=GOODS[gid];
      const flow = city.flows[gid] || {prod:0, cons:0};
      // stochastic factor on consumption
      const consRand = 0.85 + Math.random()*0.3;
      let d = flow.prod * hoursDelta - flow.cons * consRand * hoursDelta;
      if(d!==0){ city.stocks[gid] = Math.min(g.capacity, Math.max(0, city.stocks[gid] + d)); }
    }
  }
}
