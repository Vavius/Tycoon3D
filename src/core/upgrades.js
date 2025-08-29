// Upgrades / Research system (renamed generic "Upgrades")
// Provides purchasable upgrades gated by player level with escalating costs.
// Effects are aggregated into player.upgradeStats each time an upgrade is bought.

import { t } from './i18n.js';

// Non-linear cargo capacity mapping by camel count (total capacity, not per camel)
// Index = number of camels. 0 unused, 1->2, 2->5, 3->8, 4->12, 5->16, 6->21
export const CAPACITY_MAP = [0,2,5,8,12,16,21];

export function caravanCapacity(caravan, world){
  const camels = Math.min(caravan.camels||0, CAPACITY_MAP.length-1);
  let base = CAPACITY_MAP[camels] || 0;
  const stats = world.player?.upgradeStats;
  if(stats){
    base = Math.floor(base * (1 + (stats.cargoBonusPct||0)));
  }
  return base;
}

// Definition helper: levelReq can be number or function(player, levelOwned)->bool
// getCost(currentLevelOwned) returns next purchase cost.
export const UPGRADE_DEFS = {
  camelLimit: {
    icon:'🐪', max:5, // from 1 baseline -> +5 = 6 camels
    baseCost:120, mult:1.75,
    levelReq:(p,l)=> p.level >= [2,4,6,9,13][l] ,
    apply:(p)=>{ p.maxCamelsPerCaravan = 1 + (p.upgrades.camelLimit||0); },
    nameKey:'upg.camelLimit.name', descKey:'upg.camelLimit.desc'
  },
  caravanSlots: {
    icon:'🛶', max:5, // +5 -> 6 caravans total
    baseCost:300, mult:1.8,
    levelReq:(p,l)=> p.level >= 2 + l*2, // 2,4,6,8,10
    apply:(p)=>{ p.maxCaravans = 1 + (p.upgrades.caravanSlots||0); },
    nameKey:'upg.caravanSlots.name', descKey:'upg.caravanSlots.desc'
  },
  cargoHarness: {
    icon:'📦', max:6,
    baseCost:180, mult:1.65,
    levelReq:(p,l)=> p.level >= 3 + l*2, // 3,5,7,9,11,13
    apply:()=>{}, // aggregated separately
    nameKey:'upg.cargoHarness.name', descKey:'upg.cargoHarness.desc'
  },
  haggling: {
    icon:'🤝', max:6,
    baseCost:160, mult:1.7,
    levelReq:(p,l)=> p.level >= 4 + l*2, // 4,6,8,10,12,14
    apply:()=>{},
    nameKey:'upg.haggling.name', descKey:'upg.haggling.desc'
  },
  caravanSpeed: {
    icon:'🏁', max:6,
    baseCost:140, mult:1.6,
    levelReq:(p,l)=> p.level >= 5 + l*2, // 5,7,9,11,13,15
    apply:()=>{},
    nameKey:'upg.caravanSpeed.name', descKey:'upg.caravanSpeed.desc'
  },
  camelCare: {
    icon:'🛡️', max:4,
    baseCost:200, mult:1.85,
    levelReq:(p,l)=> p.level >= 6 + l*3, // 6,9,12,15
    apply:()=>{},
    nameKey:'upg.camelCare.name', descKey:'upg.camelCare.desc'
  }
};

export function initUpgrades(world){
  const p=world.player; if(!p.upgrades){ p.upgrades={}; }
  applyAllUpgradeEffects(world);
}

export function nextUpgradeCost(key, levelOwned){
  const def=UPGRADE_DEFS[key]; if(!def) return Infinity;
  return Math.round(def.baseCost * Math.pow(def.mult, levelOwned));
}

export function canPurchaseUpgrade(world, key){
  const p=world.player; const def=UPGRADE_DEFS[key]; if(!p||!def) return {ok:false, reason:'no'};
  const owned=p.upgrades[key]||0; if(owned>=def.max) return {ok:false, reason:'max'};
  if(typeof def.levelReq==='function' && !def.levelReq(p, owned)) return {ok:false, reason:'level'};
  const cost=nextUpgradeCost(key, owned); if(world.money < cost) return {ok:false, reason:'money'};
  return {ok:true, cost};
}

export function purchaseUpgrade(world, key){
  const {ok, cost, reason}=canPurchaseUpgrade(world, key); if(!ok) return false;
  world.money -= cost;
  const p=world.player; p.upgrades[key]=(p.upgrades[key]||0)+1;
  applyAllUpgradeEffects(world);
  if(world.__uiLog){ world.__uiLog(t('upg.purchased',{name:t(UPGRADE_DEFS[key].nameKey)}),'note'); }
  world.__needsUpgradesRefresh = true;
  return true;
}

export function applyAllUpgradeEffects(world){
  const p=world.player; if(!p) return;
  const u=p.upgrades||{};
  // Stats aggregation
  const stats={};
  stats.cargoBonusPct = (u.cargoHarness||0) * 0.12; // +12% each
  stats.sellBonus = (u.haggling||0) * 0.02; // +2% sell price
  stats.buyDiscount = (u.haggling||0) * 0.02; // -2% buy cost
  stats.speedBonus = (u.caravanSpeed||0) * 0.06; // +6% speed each
  stats.camelLossMitigation = (u.camelCare||0) * 0.15; // -15% chance camel lost
  // Derived limits
  p.maxCamelsPerCaravan = 1 + (u.camelLimit||0); // baseline 1
  p.maxCaravans = 1 + (u.caravanSlots||0);
  p.upgradeStats = stats;
  // Allow defs with custom apply to sync additional fields.
  for(const k of Object.keys(UPGRADE_DEFS)){ if(typeof UPGRADE_DEFS[k].apply==='function') UPGRADE_DEFS[k].apply(p); }
}
