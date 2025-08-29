// Player progression system: XP, levels, unlocks.
// Responsibilities:
// - Track player XP / Level
// - Define XP curve
// - Award XP from trade profits (hooked from caravanAutoTrade)
// - Apply unlocks (cities, goods, camel cap, caravan cap) one per level per predefined sequence
// - Provide cost scaling for camels and caravans
// - Trigger city visual growth on size upgrade

import { adjustCityVisuals, spawnCityVisualsIfNeeded } from '../world/world.js';
import { t } from '../core/i18n.js';
import { initUpgrades } from './upgrades.js';

export function initProgression(world){
  if(world.player) return world.player; // already
  const player = {
    level:1,
    xp:0,
    nextXp:xpForLevel(2),
    unlockedGoods:['spice'],
  maxCamelsPerCaravan:1,
    maxCaravans:1,
    totalCamelsPurchased:0,
    unlockQueue:buildUnlockQueue(world),
  };
  world.player = player;
  // Initialize upgrades subsystem
  initUpgrades(world);
  // Lock all but first two cities (game starts with 2 cities visible)
  world.cities.forEach((c,i)=>{ c.locked = i>1; });
  return player;
}

function buildUnlockQueue(world){
  // Goal: always 6 cities. Start with 1; unlock 5 more across levels.
  // Sizes target: two tiny (initial + next), then grow earlier ones: small, medium, and finally one large city (only one large).
  // We interleave with camel/caravan/goods unlocks.
  const actions = [];
  // Camel / caravan limits moved to upgrades system.
  const camelUp = ()=> null;
  const caravanUp = ()=> null;

  // Level 2 previously camel capacity -> now empty (upgrades)
  actions[2] = null;
  // Level 3: third city (first locked one)
  actions[3] = unlockCity;
  actions[4] = null;
  // Level 5: unlock cloth
  actions[5] = (w,p)=> unlockGood(w,p,'cloth');
  actions[6] = null;
  // Level 7: unlock fourth city
  actions[7] = unlockCity;
  // Level 8: first growth (tiny->small)
  actions[8] = (w,p)=>{ upgradeCitySize(w); return t('level.cityGrew1'); };
  actions[9] = null;
  // Level 10: unlock fifth city
  actions[10] = unlockCity;
  // Level 11: upgrade (toward medium)
  actions[11] = (w,p)=>{ upgradeCitySize(w); return t('level.cityGrew2'); };
  // Level 12: unlock ore
  actions[12] = (w,p)=> unlockGood(w,p,'ore');
  actions[13] = null;
  // Level 14: unlock sixth (final) city
  actions[14] = unlockCity;
  actions[15] = null;
  // Level 16: upgrade (promote toward large)
  actions[16] = (w,p)=>{ upgradeCitySize(w); return t('level.cityGrowth'); };
  // Level 17: final upgrade to large
  actions[17] = (w,p)=>{ upgradeCitySize(w); return t('level.cityLarge'); };
  return actions;
}

export function xpForLevel(level){
  // Total XP needed to reach given level from level 1 (cumulative).
  // New curve: smaller early costs for faster initial progression, much steeper later growth.
  // Per-level requirement = base * growth^(n-2) for n>=2.
  // Tuned: base=45, growth=1.70
  if(level<=1) return 0;
  let base=45, growth=1.70, total=0; for(let l=2;l<=level;l++){ total += Math.round(base); base*=growth; }
  return total;
}

export function awardXP(world, amount){
  const p=world.player; if(!p) return; if(amount<=0) return; p.xp += amount; checkLevelUp(world);
}

function checkLevelUp(world){
  const p=world.player; if(!p) return; let leveled=false; let safety=0;
  while(p.xp >= p.nextXp && safety<50){
    safety++;
    p.level++;
    leveled=true;
    // Preserve overflow: keep surplus above required threshold
    const nextReq = xpForLevel(p.level+1);
    p.nextXp = nextReq;
    applyUnlock(world,p);
  }
  if(leveled){ if(typeof world.__showLevelUp==='function'){} }
}

function applyUnlock(world, player){
  const action = player.unlockQueue[player.level];
  let desc = null; if(action){ desc = action(world, player); }
  if(!desc){ desc = t('level.newLevel'); }
  showLevelUp(world, player, desc);
}

function unlockCity(world, player){
  const locked = world.cities.find(c=>c.locked); if(locked){
    locked.locked=false;
    spawnCityVisualsIfNeeded(world, locked);
    // Reveal its oasis tiles now that it's unlocked
    if(typeof world.__needsTerrainRebuild !== 'undefined'){
      // ensureOasisRadius called inside spawnCityVisualsIfNeeded; that sets rebuild flag
      world.__needsTerrainRebuild = true;
    }
    // After unlocking, ensure for each currently unlocked good we still have at least one producer & consumer.
    for(const gid of player.unlockedGoods){
      const list = world.cities.filter(c=>!c.locked);
      let hasProd=false, hasCons=false; for(const c of list){ const net=(c.flows[gid].prod - c.flows[gid].cons); if(net>0.5) hasProd=true; if(net<-0.5) hasCons=true; }
      if(!hasProd || !hasCons){
        // Choose city with highest stock as producer, lowest stock as consumer
        let maxCity=null, minCity=null, maxStock=-1e9, minStock=1e9; for(const c of list){ const stock=c.stocks[gid]; if(stock>maxStock){ maxStock=stock; maxCity=c; } if(stock<minStock){ minStock=stock; minCity=c; } }
        if(maxCity){ maxCity.flows[gid].prod *=1.2; maxCity.flows[gid].cons *=0.9; }
        if(minCity){ minCity.flows[gid].prod *=0.85; minCity.flows[gid].cons *=1.15; }
      }
    }
  return t('level.cityUnlocked',{name:locked.name});
  }
  return null;
}

function unlockGood(world, player, gid){
  if(!player.unlockedGoods.includes(gid)){
    player.unlockedGoods.push(gid);
    // Signal UI to rebuild strategy grid to show new good pricing & thresholds
    world.__needsStrategyRefresh = true;
    return t('level.goodUnlocked',{name:gidToName(gid)});
  }
  return null;
}

function upgradeCitySize(world){
  const playerLevel = world.player? world.player.level : 1;
  const unlocked = world.cities.filter(c=>!c.locked);
  if(!unlocked.length) return;
  const order=['tiny','small','medium','large'];
  const count = {tiny:0, small:0, medium:0, large:0}; unlocked.forEach(c=>count[c.size]++);
  let candidate=null;
  // Level-gated evolution path to guarantee a single chain reaches large at last upgrade (>=17)
  if(playerLevel>=17){ // try promote a medium to large (only one large allowed)
    candidate = unlocked.find(c=>c.size==='medium');
  }
  if(!candidate && playerLevel>=14){ // get a small to medium (if no medium yet)
    if(count.medium<1){ candidate = unlocked.find(c=>c.size==='small'); }
  }
  if(!candidate && playerLevel>=10){ // ensure we have at least two smalls before making medium later
    if(count.small<2){ candidate = unlocked.find(c=>c.size==='tiny'); }
  }
  if(!candidate && playerLevel>=7){ // first small
    if(count.small<1){ candidate = unlocked.find(c=>c.size==='tiny'); }
  }
  // Fallback: pick smallest non-large to gently grow economy
  if(!candidate){ candidate = unlocked.filter(c=>c.size!=='large').sort((a,b)=>order.indexOf(a.size)-order.indexOf(b.size))[0]; }
  if(!candidate) return;
  const idx = order.indexOf(candidate.size);
  if(idx>=order.length-1) return; // already max
  if(order[idx+1]==='large' && count.large>=1) return; // only one large
  candidate.size = order[idx+1];
  Object.keys(candidate.flows).forEach(gid=>{ const scale = candidate.size==='large'?1.45:1.25; candidate.flows[gid].prod*=scale; candidate.flows[gid].cons*=scale; });
  adjustCityVisuals(world, candidate);
  if(world.__uiLog) world.__uiLog(t('level.cityGrewLog',{name:candidate.name,size:candidate.size}),'note');
}

function gidToName(g){ const map={ spice:t('goods.spice'), cloth:t('goods.cloth'), ore:t('goods.ore') }; return map[g]||g; }

// Cost scaling ------------------------------------------------
export function camelCost(world){
  const p=world.player; const base=50; const growth=1.35; return Math.round(base * Math.pow(growth, p.totalCamelsPurchased||0));
}
export function caravanCost(world){
  const base=300; const growth=1.55; const count=world.caravans.length; return Math.round(base * Math.pow(growth, count));
}

// Level-up dialog UI -----------------------------------------
function ensureDialogRoot(){ let el=document.getElementById('levelUpDialog'); if(!el){ el=document.createElement('div'); el.id='levelUpDialog'; document.body.appendChild(el); } return el; }

export function attachLevelUpHelper(world){
  world.__showLevelUp = (html)=>{ const el=ensureDialogRoot(); el.innerHTML=html; el.classList.add('show'); setTimeout(()=>{ el.classList.remove('show'); }, 5500); };
}

function showLevelUp(world, player, desc){
  if(!world.__showLevelUp) return; const percent = ((player.xp - xpForLevel(player.level))/(player.nextXp - xpForLevel(player.level))*100).toFixed(0);
  world.__showLevelUp(`<div class="lv-head">${t('level.up',{n:player.level})}</div><div class="lv-desc">${desc}</div>`);
}
