// World generation & entity helpers extracted from main.js
import { GOODS } from '../economy/market.js';
import { currentLang } from '../core/i18n.js';
import { ident } from '../math/matrix.js';

export const world = { size:64, tiles:[], oases:[], caravans:[], houses:[], trees:[], money:400, goods:0, day:0, speed:1, paused:false, cities:[], totalProfit:0, lastTradeProfit:0 };
world.__log = (msg)=>console.log(msg);
world.bandits = [];
// Track used caravan name words across current run (reset on world regen)
const usedCaravanWords = new Set();

// --- Utility sampling (duplicated small helpers kept local) ---
function hash2d(x,z){ return (Math.sin(x*12.9898 + z*78.233)*43758.5453)%1; }
export function baseHeight(x,z){
  const h1 = (Math.sin(x*0.32)+Math.cos(z*0.29))*0.30;
  const h2 = (Math.sin(x*0.06)*Math.cos(z*0.05))*0.25;
  const n = (hash2d(x,z)-0.5)*0.10; return h1 + h2 + n;
}

// Planned initial size (all spawn tiny, growth handled by progression)
function sizeForIndex(i){ return 'tiny'; }

function oasisRadiusForSize(size){
  switch(size){
    case 'tiny': return 2.2;
    case 'small': return 3.0;
    case 'medium': return 3.6;
    case 'large': return 4.4;
    default: return 2.5;
  }
}

function targetCountsForSize(size){
  // Adjusted per requirements: large city has more houses but fewer trees.
  switch(size){
    case 'tiny': return {houses:2, trees:5};
    case 'small': return {houses:4, trees:6};
    case 'medium': return {houses:7, trees:7};
    case 'large': return {houses:12, trees:5};
    default: return {houses:3, trees:5};
  }
}

function placeEntityNonOverlapping(listRefA, listRefB, city, type){
  // type: 'house' or 'tree'
  const maxTries=40; const minDist=0.9; let tries=0;
  while(tries++<maxTries){
    const ang=Math.random()*Math.PI*2; const dist = type==='house' ? (1.2+Math.random()*2.0) : (1+Math.random()*2.8);
    const x=city.x+Math.cos(ang)*dist, z=city.z+Math.sin(ang)*dist;
    let ok=true; for(const h of listRefA){ const dx=h.x-x, dz=h.z-z; if(dx*dx+dz*dz < minDist*minDist){ ok=false; break; } }
    if(ok){ for(const t of listRefB){ const dx=t.x-x, dz=t.z-z; if(dx*dx+dz*dz < minDist*minDist){ ok=false; break; } } }
    if(ok){ if(type==='house') world.houses.push({x,z,city:city.id}); else world.trees.push({x,z,swayPhase:Math.random()*Math.PI*2, city:city.id}); return; }
  }
  // Fallback simple placement
  if(type==='house') world.houses.push({x:city.x+Math.random()*0.5, z:city.z+Math.random()*0.5, city:city.id});
  else world.trees.push({x:city.x+Math.random()*0.5, z:city.z+Math.random()*0.5, swayPhase:Math.random()*Math.PI*2, city:city.id});
}

export function ensureOasisRadius(city){
  if(!city || city.locked) return; const desired = oasisRadiusForSize(city.size); const s=world.size; const radius=Math.ceil(desired);
  let changed=false;
  for(let dz=-radius; dz<=radius; dz++) for(let dx=-radius; dx<=radius; dx++){
    const tx=city.x+dx, tz=city.z+dz; if(tx<0||tz<0||tx>=s||tz>=s) continue; const d=Math.hypot(dx,dz); if(d>desired+0.35) continue; const tile=world.tiles[tz*s+tx]; if(!tile.oasis){ tile.oasis=true; changed=true; } }
  if(changed) world.__needsTerrainRebuild = true;
}

export function genWorld(){
  const s=world.size; world.tiles=[]; world.oases=[]; world.houses=[]; world.trees=[];
  // Reset caravan name uniqueness guard for a fresh world
  usedCaravanWords.clear();
  const chosenCenters=[]; const MIN_OASIS_DIST=10; function farEnough(nx,nz){ for(const c of chosenCenters){ const dx=c.x-nx, dz=c.z-nz; if(dx*dx+dz*dz < MIN_OASIS_DIST*MIN_OASIS_DIST) return false; } return true; }
  for(let z=0; z<s; z++) for(let x=0; x<s; x++){ const h=baseHeight(x,z); world.tiles.push({x,z,h,oasis:false}); }
  // Try to discover natural oasis candidates
  for(let i=0;i<s*s;i++){ if(Math.random()<0.0030 && chosenCenters.length<6){ const x=i%s, z=Math.floor(i/s); if(x<4||z<4||x>=s-4||z>=s-4) continue; if(!farEnough(x,z)) continue; chosenCenters.push({x,z}); } }
  // If fewer than 6, procedurally add until we have 6
  for(let i=chosenCenters.length;i<6;i++){ let nx, nz, tries=0; do { nx=Math.floor(Math.random()*(s-12))+6; nz=Math.floor(Math.random()*(s-12))+6; tries++; } while(!farEnough(nx,nz)&&tries<240); chosenCenters.push({x:nx,z:nz}); }
  // Register oases (all 6)
  for(const c of chosenCenters){ world.oases.push(c); }
  // Pre-create exactly 6 cities (always) – first TWO unlocked at start. Locked cities don't reveal oasis until unlock.
  // Tag generator: neutral desert / trade themed descriptors + nouns. Not intentionally comedic.
  const usedTagWords=new Set();
  function generateCityTag(){
    // Helper to attempt building a candidate respecting uniqueness of content words
    function buildCandidate(){
      if(currentLang==='ru'){
        const desc=['Песчаный','Тенистый','Солнечный','Древний','Лунный','Янтарный','Спокойный','Тихий','Пряный','Караванный','Пальмовый','Звёздный','Миражный','Ветреный'];
        const noun=['Базар','Перевал','Оазис','Колодец','Рынок','Перекрёсток','Приют','Лагерь','Портал','Проход','Удел','Край','Предел'];
        const pattern=Math.random();
        if(pattern<0.55){ return desc[Math.floor(Math.random()*desc.length)]+' '+noun[Math.floor(Math.random()*noun.length)]; }
        else if(pattern<0.80){ return noun[Math.floor(Math.random()*noun.length)]+' Дюн'; }
        else { return 'Оазис '+desc[Math.floor(Math.random()*desc.length)]; }
      } else {
        const desc=['Sand','Shaded','Sun','Ancient','Moon','Amber','Quiet','Calm','Spice','Caravan','Palm','Star','Mirage','Wind','Golden','Hidden','Red','Dune','Copper'];
        const noun=['Bazaar','Pass','Oasis','Well','Market','Crossroads','Haven','Camp','Gate','Harbor','Reach','Quarter','Rise','Dunes'];
        const pattern=Math.random();
        if(pattern<0.50){ return desc[Math.floor(Math.random()*desc.length)]+' '+noun[Math.floor(Math.random()*noun.length)]; }
        else if(pattern<0.78){ return noun[Math.floor(Math.random()*noun.length)]+' of the '+['Moon','Sun','Spice','Palms','Stars','Trade','Dunes'][Math.floor(Math.random()*7)]; }
        else { return 'Oasis of '+['Calm','Amber','Winds','Shadows','Echoes','Light'][Math.floor(Math.random()*6)]; }
      }
    }
    const ignoreWords = currentLang==='ru'
      ? new Set(['Оазис','Дюн'])
      : new Set(['of','the','Oasis','of the']);
    for(let attempt=0; attempt<25; attempt++){
      const cand=buildCandidate();
      const words=cand.split(/\s+/).map(w=>w.replace(/[^A-Za-zА-Яа-яЁё'-]/g,'')).filter(w=>w && !ignoreWords.has(w));
      const conflict=words.some(w=>usedTagWords.has(w));
      if(!conflict){ words.forEach(w=>usedTagWords.add(w)); return cand; }
      if(attempt===24){ // fallback, accept even with conflicts
        words.forEach(w=>usedTagWords.add(w));
        return cand;
      }
    }
  }
  world.cities = world.oases.slice(0,6).map((o,i)=>({ id:'city'+i, name: randomCityName(), tag: generateCityTag(), x:o.x, z:o.z, stocks:Object.fromEntries(Object.keys(GOODS).map(k=>[k, GOODS[k].baseStock])), prices:{}, flows:{}, role:null, focus:null, prevPrices:{}, priceHist:{}, size:sizeForIndex(i), locked: i>1 }));
  // Reveal starting two cities' oases
  if(world.cities[0]) ensureOasisRadius(world.cities[0]);
  if(world.cities[1]) ensureOasisRadius(world.cities[1]);
  // Place visuals for the two starting cities
  [world.cities[0], world.cities[1]].forEach(startCity=>{ if(!startCity) return; const {houses, trees}=targetCountsForSize(startCity.size); for(let h=0; h<houses; h++){ placeEntityNonOverlapping(world.houses, world.trees, startCity, 'house'); } for(let t=0; t<trees; t++){ placeEntityNonOverlapping(world.trees, world.houses, startCity, 'tree'); } });
  const goodsKeys=Object.keys(GOODS);
  const flowPresets=[
    {pf:0.028, cf:0.006, po:0.006, co:0.010}, // producer-like
    {pf:0.006, cf:0.028, po:0.004, co:0.016}, // consumer-like
    {pf:0.014, cf:0.014, po:0.010, co:0.012}, // hub-like
    {pf:0.025, cf:0.020, po:0.005, co:0.014}, // mixed
    {pf:0.004, cf:0.020, po:0.003, co:0.017} // scarce-like
  ];
  world.cities.forEach((city, idx)=>{ city.focus=goodsKeys[idx%goodsKeys.length]; const preset=flowPresets[idx%flowPresets.length]; goodsKeys.forEach(gid=>{ city.flows[gid]={prod:0,cons:0}; }); goodsKeys.forEach(gid=>{ const cap=GOODS[gid].capacity; const sizeScale = city.size==='tiny'?0.55: (city.size==='small'?0.78: (city.size==='medium'?1.0:1.18)); const focus=gid===city.focus; const prodRate=focus?preset.pf:preset.po; const consRate=focus?preset.cf:preset.co; city.flows[gid].prod=cap*prodRate*sizeScale; city.flows[gid].cons=cap*consRate*sizeScale; }); });
  // Global initial balancing: previously slightly negative causing gradual depletion.
  // Set small positive/neutral target so stocks don't vanish over time.
  const targetDeltaRatio=0.001; // 0.1% capacity per city aggregate surplus per hour
  goodsKeys.forEach(gid=>{ const cap=GOODS[gid].capacity; let net=0; world.cities.forEach(c=>{ net+=c.flows[gid].prod - c.flows[gid].cons; }); const totalCap=cap*world.cities.length; const desiredNet=totalCap*targetDeltaRatio; if(Math.abs(net)>1e-6){ const scale=desiredNet/net; world.cities.forEach(c=>{ c.flows[gid].prod*=scale; }); } });
  // Ensure initial unlocked cities (0 and 1) have a strong spice producer vs mild consumer contrast
  // Earlier balancing across ALL (locked+unlocked) cities could make both appear net consumers to the player.
  // We aggressively boost city0 (producer) and dampen city1 (consumer) so early game has a reliable spice source.
  if(world.cities.length>=2){
    const c0=world.cities[0], c1=world.cities[1]; const g='spice';
    if(c0.flows[g] && c1.flows[g]){
      // New tuned multipliers (prev 1.35/0.75 & 0.70/1.40)
      c0.flows[g].prod *= 1.85; // higher production
      c0.flows[g].cons *= 0.65; // lower self-consumption
      c1.flows[g].prod *= 0.60; // reduce production
      c1.flows[g].cons *= 1.50; // increase consumption
      // Safeguard: if after scaling city0 still not positive, force a margin
      const net0 = c0.flows[g].prod - c0.flows[g].cons;
      if(net0 <= 0){ c0.flows[g].prod = c0.flows[g].cons * 1.6; }
      // Keep city1 a mild consumer (avoid extreme shortage): cap its net consumption magnitude
      const net1 = c1.flows[g].prod - c1.flows[g].cons; // negative desired
      const maxAbsConsumption = GOODS[g].capacity * 0.05; // limit to 5% of capacity per hour
      if(-net1 > maxAbsConsumption){
        // scale down its consumption to the cap
        const desiredNet = -maxAbsConsumption; // negative
        const neededProd = c1.flows[g].cons + desiredNet; // prod = cons + net
        if(neededProd > 0){ c1.flows[g].prod = neededProd; }
      }
    }
  }
}

export function adjustCityVisuals(world, city){
  if(!city) return; ensureOasisRadius(city); const targets = targetCountsForSize(city.size);
  const housesForCity = world.houses.filter(h=>h.city===city.id);
  const treesForCity = world.trees.filter(t=>t.city===city.id);
  while(world.houses.filter(h=>h.city===city.id).length < targets.houses){ placeEntityNonOverlapping(world.houses.filter(h=>h.city===city.id), world.trees.filter(t=>t.city===city.id), city, 'house'); }
  while(world.trees.filter(t=>t.city===city.id).length < targets.trees){ placeEntityNonOverlapping(world.trees.filter(t=>t.city===city.id), world.houses.filter(h=>h.city===city.id), city, 'tree'); }
  // Trim excess if size reduced (unlikely) or targets decreased (trees for large size)
  if(world.trees.filter(t=>t.city===city.id).length > targets.trees){ let excess = world.trees.filter(t=>t.city===city.id).length - targets.trees; for(let i=world.trees.length-1;i>=0 && excess>0;i--){ if(world.trees[i].city===city.id){ world.trees.splice(i,1); excess--; } } }
  if(world.houses.filter(h=>h.city===city.id).length > targets.houses){ let excess = world.houses.filter(h=>h.city===city.id).length - targets.houses; for(let i=world.houses.length-1;i>=0 && excess>0;i--){ if(world.houses[i].city===city.id){ world.houses.splice(i,1); excess--; } } }
}

export function spawnCityVisualsIfNeeded(world, city){
  if(!city) return;
  const existing = world.houses.some(h=>h.city===city.id) || world.trees.some(t=>t.city===city.id);
  if(existing) return;
  ensureOasisRadius(city);
  const {houses, trees} = targetCountsForSize(city.size);
  for(let h=0; h<houses; h++){ placeEntityNonOverlapping(world.houses.filter(hh=>hh.city===city.id), world.trees.filter(tt=>tt.city===city.id), city, 'house'); }
  for(let t=0; t<trees; t++){ placeEntityNonOverlapping(world.trees.filter(tt=>tt.city===city.id), world.houses.filter(hh=>hh.city===city.id), city, 'tree'); }
}

export function randomCityName(){
  if(currentLang==='ru'){
    const starts=['Аль','Эль','Ба','Ка','На','Ра','Та','За','Аш','Ис','Оу'];
    const mids=['ра','ри','ру','ша','сса','фра','дара','хан','му','зир','лам','бар','тал'];
    const ends=['ум','ад','ар','ун','им','ах','еш','ор','ет','ам','ур'];
    return (starts[Math.floor(Math.random()*starts.length)]+mids[Math.floor(Math.random()*mids.length)]+(Math.random()<0.7? ends[Math.floor(Math.random()*ends.length)] : '')).replace(/(.)(.+)/,(m,a,b)=>a+b);
  } else {
    // Desert / Arabic‑inspired pseudo name generator (lightweight, no transliteration accuracy claimed)
    const starts = [
      'Al','Ab','Ad','Ak','Am','An','Ar','Ash','Az','Ba','Bar','Dar','Dam','El','Far','Gar','Har','Jab','Jal','Kad','Kal','Kas','Mar','Maz','Nar','Qad','Qal','Qas','Rak','Ras','Sab','Sar','Shar','Tal','Tar','Um','Zaf','Zah','Zar'
    ];
    const mids = [
      'a','aba','adi','aka','ali','ama','ara','ari','ash','azza','afa','aha','ara','ida','ira','uba','ula','una','ush','im','ir','ul','ur','az','ar','at','ad'
    ];
    const ends = [
      'ah','an','ar','as','at','em','en','er','ia','im','ir','is','it','on','or','os','un','um','ur','ya','yin'
    ];
    const s = starts[Math.floor(Math.random()*starts.length)];
    const mid = Math.random()<0.75? mids[Math.floor(Math.random()*mids.length)] : '';
    const end = ends[Math.floor(Math.random()*ends.length)];
    let name = s + mid + end;
    // Occasional article or separator adjustments
    if(Math.random()<0.22 && !/^Al/i.test(name)) name = 'Al-' + name;
    // Occasional apostrophe style (e.g., Qas'ir) if not already hyphenated
    if(Math.random()<0.15 && !name.includes("'") && !name.includes('-')){
      const cut = Math.floor(2 + Math.random()* (name.length-3));
      name = name.slice(0,cut) + "'" + name.slice(cut);
    }
    // Capitalize first char after any hyphen/apostrophe segments
    name = name.split(/([-'])/).map(part=>(/[a-z]/.test(part[0])? part[0].toUpperCase()+part.slice(1): part)).join('');
    return name;
  }
}

let caravanId=1;
function nextCaravanName(){
  // Similar approach to city tag uniqueness: ensure no content word repeats across caravan names.
  function buildCandidate(){
    if(currentLang==='ru'){
      const adj=['Песчаный','Быстрый','Тихий','Лунный','Солнечный','Янтарный','Звёздный','Легкий','Дальний','Торговый','Караванный','Шелковый','Ветряной','Ночной'];
      const noun=['Бегун','Караван','Странник','Вестник','Курьер','След','Путь','Ход','Гонец','Путник'];
      const tail=['Дюн','Звёзд','Тени','Ветра','Ночи','Специй'];
      const pattern=Math.random();
      if(pattern<0.55){ return adj[Math.floor(Math.random()*adj.length)]+' '+noun[Math.floor(Math.random()*noun.length)]; }
      else if(pattern<0.80){ return noun[Math.floor(Math.random()*noun.length)]+' '+tail[Math.floor(Math.random()*tail.length)]; }
      else { return 'Караван '+tail[Math.floor(Math.random()*tail.length)]; }
    } else {
      const adj=['Dust','Swift','Quiet','Moon','Sun','Amber','Red','Star','Light','Far','Trade','Silk','Wind','Night','Golden','Hidden'];
      const noun=['Runner','Caravan','Nomad','Courier','Messenger','Trail','Path','Route','Rider','Voyager','Wanderer','Ledger','Track'];
      const tail=['Dunes','Sands','Stars','Shadows','Winds','Night','Spice','Trade'];
      const pattern=Math.random();
      if(pattern<0.50){ return adj[Math.floor(Math.random()*adj.length)]+' '+noun[Math.floor(Math.random()*noun.length)]; }
      else if(pattern<0.78){ return noun[Math.floor(Math.random()*noun.length)]+' of the '+tail[Math.floor(Math.random()*tail.length)]; }
      else if(pattern<0.90){ return adj[Math.floor(Math.random()*adj.length)]+' '+tail[Math.floor(Math.random()*tail.length)]; }
      else { return 'Caravan of '+tail[Math.floor(Math.random()*tail.length)]; }
    }
  }
  const ignore = currentLang==='ru'? new Set(['Караван']) : new Set(['of','the','Caravan']);
  for(let attempt=0; attempt<30; attempt++){
    const cand=buildCandidate();
    const words=cand.split(/\s+/).map(w=>w.replace(/[^A-Za-zА-Яа-яЁё'-]/g,'')).filter(w=>w && !ignore.has(w));
    const conflict=words.some(w=>usedCaravanWords.has(w));
    if(!conflict){ words.forEach(w=>usedCaravanWords.add(w)); return cand; }
    if(attempt===29){ words.forEach(w=>usedCaravanWords.add(w)); return cand; }
  }
}
function makeFaceSeed(){ const eyes=["^ ^","• •","- -","o o","x x"][Math.floor(Math.random()*5)]; const mouth=["_","~","ᵕ","д","︿"][Math.floor(Math.random()*5)]; return eyes+mouth; }
export function newCaravan(){
  // Prefer spawning at an unlocked city to avoid appearing at hidden (locked) locations.
  const unlockedCities = world.cities.filter(c=>!c.locked);
  let spawnX, spawnZ;
  if(unlockedCities.length){ const city = unlockedCities[Math.floor(Math.random()*unlockedCities.length)]; spawnX=city.x; spawnZ=city.z; }
  else if(world.cities.length){ spawnX=world.cities[0].x; spawnZ=world.cities[0].z; }
  else if(world.oases.length){ const o=world.oases[0]; spawnX=o.x; spawnZ=o.z; }
  else { spawnX=0; spawnZ=0; }
  const baseCargo={ spice:{qty:0,avg:0}, cloth:{qty:0,avg:0}, ore:{qty:0,avg:0} }; if(world.player){ for(const gid of Object.keys(baseCargo)){ if(!world.player.unlockedGoods.includes(gid)){ baseCargo[gid]={qty:0,avg:0}; } } }
  const c={ id:caravanId++, name: nextCaravanName(), x:spawnX, z:spawnZ, camels:1, guardReliability:0.55, goods:0, target:null, timer:0, state:'idle', faces:[], start:{x:spawnX,z:spawnZ}, progress:0, speed:(3+Math.random()*1.5), yaw:0, camelTrail:[], cargo:baseCargo };
  c.faces.push(makeFaceSeed()); c.camelTrail=[{offset:0,x:c.x,z:c.z,y:sampleHeight(c.x,c.z),yaw:0,phase:Math.random()*Math.PI*2}]; world.caravans.push(c); return c; }

export function sampleHeight(tx,tz){ const maxC=world.size-2; const fx=Math.min(Math.max(tx,0), maxC+0.9999); const fz=Math.min(Math.max(tz,0), maxC+0.9999); const x=Math.floor(fx), z=Math.floor(fz); const lx=fx-x, lz=fz-z; function getTile(x,z){ if(x<0||z<0||x>=world.size||z>=world.size) return {h:0}; return world.tiles[z*world.size + x]; } const h00=getTile(x,z).h, h10=getTile(x+1,z).h, h01=getTile(x,z+1).h, h11=getTile(x+1,z+1).h; const h0=h00+(h10-h00)*lx; const h1=h01+(h11-h01)*lx; return 1.2*(h0+(h1-h0)*lz)-0.05; }

export const CAMEL_SPACING=2.2; export const CAMEL_MAX=6;

// Re-export lightweight helpers needed by main (minimal to avoid circular)
export function makeFaceForUI(){ return makeFaceSeed(); }

// (Optional placeholder) World-level rendering data holders so they can be rebuilt from outside
export const worldRender = { worldMesh:null, worldCount:0, backgroundMesh:null, backgroundCount:0, farPlane:null, farPlaneCount:0 };

// ------------------------------------------------------------
// Rendering helpers (moved from main.js)
// ------------------------------------------------------------
function pushBox(arr, x,y,z, sx,sy,sz, color, yaw=0){
  const faces = [
    [0,1,0,  -1,1,-1, 1,1,-1, 1,1,1,  -1,1,-1, 1,1,1, -1,1,1],
    [0,-1,0, -1,-1,-1,-1,-1,1, 1,-1,1,  -1,-1,-1, 1,-1,1, 1,-1,-1],
    [0,0,1,  -1,-1,1, -1,1,1, 1,1,1,  -1,-1,1, 1,1,1, 1,-1,1],
    [0,0,-1, -1,-1,-1, 1,-1,-1, 1,1,-1,  -1,-1,-1, 1,1,-1, -1,1,-1],
    [1,0,0,  1,-1,-1, 1,-1,1, 1,1,1,  1,-1,-1, 1,1,1, 1,1,-1],
    [-1,0,0, -1,-1,-1, -1,1,-1, -1,1,1, -1,-1,-1, -1,1,1, -1,-1,1]
  ];
  const cosY=Math.cos(yaw), sinY=Math.sin(yaw);
  for(const f of faces){
    const nx=f[0],ny=f[1],nz=f[2]; const shade = 0.5 + 0.5*Math.max(0,(ny*0.9 + nz*0.1 + nx*0.2));
    for(let i=3;i<f.length;i+=3){
      const lx=f[i]*0.5*sx, ly=f[i+1]*0.5*sy, lz=f[i+2]*0.5*sz;
      const rx = lx*cosY - lz*sinY; const rz = lx*sinY + lz*cosY;
      arr.push(x+rx,y+ly,z+rz, color[0],color[1],color[2], shade);
    }
  }
}

function pushCamel(arr, x,y,z, yaw, baseY, t=0, phase=0, gaitAmp=1){
  const colorBody=[0.78,0.6,0.28]; const colorLeg=[0.65,0.5,0.23]; const colorHead=[0.82,0.68,0.36];
  const cosY=Math.cos(yaw), sinY=Math.sin(yaw);
  function place(lx,ly,lz, sx,sy,sz, col){ const wx = x + (lx*cosY - lz*sinY); const wz = z + (lx*sinY + lz*cosY); pushBox(arr, wx, baseY+ly, wz, sx, sy, sz, col, yaw); }
  place(0, 0.55, 0, 1.4,0.8,0.6, colorBody); place(-0.25, 1.05, 0, 0.5,0.5,0.45, colorBody); place(0.35, 1.00, 0, 0.55,0.55,0.48, colorBody);
  place(0.85, 0.95, 0, 0.35,0.7,0.35, colorBody);
  // Slightly larger head (was 0.35 cube) for better readability
  place(1.05, 1.25, 0, 0.36,0.36,0.36, colorHead);
  const legH=0.7; const speed=9.5; const waveA=Math.sin(t*speed + phase); const waveB=Math.sin(t*speed + phase + Math.PI);
  function leg(lx,lz,isA){ const w=isA?waveA:waveB; const lift=gaitAmp * Math.max(0,w)*0.15; place(lx, legH/2 + lift, lz, 0.25, legH, 0.25, colorLeg); }
  leg(-0.5,-0.18,true); leg(0.1,0.18,true); leg(-0.5,0.18,false); leg(0.1,-0.18,false);
}

function makeVAO(gl, floatData){
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, floatData, gl.STATIC_DRAW);
  const stride=7*4; gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,stride,3*4);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,stride,6*4);
  return {vao,vbo};
}

function buildWorldMesh(gl){
  const arr=[]; const step=2; const s=world.size;
  for(let z=0; z<s; z+=step){ for(let x=0; x<s; x+=step){ let hAcc=0,oasisFlag=false,samples=0; for(let dz=0; dz<step; dz++) for(let dx=0; dx<step; dx++){ const tx=x+dx,tz=z+dz; if(tx>=s||tz>=s) continue; const tile=world.tiles[tz*s+tx]; hAcc+=tile.h; samples++; if(tile.oasis) oasisFlag=true; } const baseH=(hAcc/(samples||1)); const wx = x + step*0.5 - s/2; const wz = z + step*0.5 - s/2; const desertCol=[0.70+Math.random()*0.03,0.60+Math.random()*0.03,0.44+Math.random()*0.03]; const oasisCol=[0.12,0.42+Math.random()*0.1,0.24]; const col=oasisFlag?oasisCol:desertCol; pushBox(arr, wx, baseH-0.6, wz, step, 1+baseH*0.35, step, col); if(oasisFlag){ pushBox(arr, wx, baseH-0.15, wz, step*0.55, 0.12, step*0.55, [0.05,0.25,0.15]); } } }
  const f=new Float32Array(arr); const m=makeVAO(gl,f); worldRender.worldMesh=m; worldRender.worldCount=f.length/7;
}
function buildFarPlane(gl){
  const S=2000; const y=-1.2; const c=[0.74,0.63,0.46]; const verts=[ -S,y,-S, c[0],c[1],c[2],0.9,  S,y,-S, c[0],c[1],c[2],0.9,  S,y, S, c[0],c[1],c[2],0.9, -S,y,-S, c[0],c[1],c[2],0.9,  S,y, S, c[0],c[1],c[2],0.9, -S,y, S, c[0],c[1],c[2],0.9];
  const f=new Float32Array(verts); worldRender.farPlane=makeVAO(gl,f); worldRender.farPlaneCount=f.length/7;
}
function buildBackgroundMesh(gl){
  const arr=[]; const s=world.size; const step=2; for(let ox=-1; ox<=1; ox++) for(let oz=-1; oz<=1; oz++){ if(ox===0&&oz===0) continue; for(let z=0; z<s; z+=step){ for(let x=0; x<s; x+=step){ const gx=x+ox*s, gz=z+oz*s; const h=baseHeight(gx,gz); const wx=gx - s/2; const wz=gz - s/2; const seed=Math.random(); const baseColor=[0.70+seed*0.05,0.60+seed*0.05,0.44+seed*0.04]; pushBox(arr, wx+step*0.5, h-0.6, wz+step*0.5, step, 1+h*0.35, step, baseColor); } } }
  const f=new Float32Array(arr); worldRender.backgroundMesh=makeVAO(gl,f); worldRender.backgroundCount=f.length/7;
}

function buildInstanced(gl){
  const arr=[];
  for(const c of world.caravans){ if(!c.camelTrail) c.camelTrail=[]; while(c.camelTrail.length < c.camels) c.camelTrail.push({offset:c.camelTrail.length*CAMEL_SPACING, x:c.x, z:c.z, y:sampleHeight(c.x,c.z), yaw:c.yaw, phase:Math.random()*Math.PI*2}); if(c.state==='travel' && c.path){ for(const camel of c.camelTrail){ const targetDist=Math.max(0,c.t - camel.offset); const pts=c.path; let j=1; while(j<pts.length && pts[j].dist < targetDist) j++; const a=pts[Math.max(0,j-1)], b=pts[Math.min(pts.length-1,j)]; if(!a||!b){ camel.x=c.x; camel.z=c.z; camel.y=c.y; camel.yaw=c.yaw; continue; } const span=(b.dist - a.dist)||1; const segT=Math.min(1, Math.max(0,(targetDist - a.dist)/span)); camel.x=a.x + (b.x-a.x)*segT; camel.z=a.z + (b.z-a.z)*segT; camel.y=a.y + (b.y-a.y)*segT; const yawNow=Math.atan2(b.z-a.z, b.x-a.x); const dy=((yawNow - camel.yaw + Math.PI+Math.PI*4)%(Math.PI*2)) - Math.PI; camel.yaw += dy*0.2; } } else { for(const camel of c.camelTrail){ camel.y = sampleHeight(camel.x, camel.z); } } const time=performance.now()/1000; const traveling=(c.state==='travel'); for(let i=0;i<c.camels;i++){ const camel=c.camelTrail[i]; let baseY=(camel.y||0)+0.05; if(traveling){ const bounce=Math.sin(time*8.0 + camel.phase*0.85)*0.025 + Math.sin(time*12.0 + camel.phase*1.37)*0.012; baseY += bounce; } pushCamel(arr, camel.x - world.size/2, (camel.y||0), camel.z - world.size/2, (camel.yaw||0), baseY, traveling?time:0, traveling?camel.phase:0, traveling?1:0); }
    // Crate bundle visuals correspond to cargoHarness upgrade level
    const cargoLevel = world.player?.upgrades?.cargoHarness||0; if(cargoLevel>0){ const baseX=c.camelTrail[0]?c.camelTrail[0].x:c.x; const baseZ=c.camelTrail[0]?c.camelTrail[0].z:c.z; const baseY=(c.camelTrail[0]?c.camelTrail[0].y:sampleHeight(baseX,baseZ))+0.55; const palette=[[0.55,0.42,0.24],[0.60,0.45,0.28],[0.64,0.48,0.30],[0.68,0.50,0.32],[0.55,0.58,0.35],[0.52,0.66,0.55]]; const count=Math.min(cargoLevel,palette.length); for(let k=0;k<count;k++){ const col=palette[k]; const offX=(k-(count-1)/2)*0.55; pushBox(arr, baseX + offX - world.size/2, baseY + (k%2)*0.15, baseZ - world.size/2, 0.5,0.28,0.5, col); } }
  }
  for(const house of world.houses){
    const city = world.cities.find(c=>c.id===house.city);
    if(city && city.locked) continue; // don't render locked city visuals
    const h=sampleHeight(house.x, house.z);
    pushBox(arr, house.x-world.size/2, h+0.35, house.z-world.size/2, 0.9,0.7,0.9, [0.52,0.43,0.28]);
    pushBox(arr, house.x-world.size/2, h+0.9, house.z-world.size/2, 0.95,0.25,0.95, [0.4,0.32,0.2]);
  }
  const time=performance.now()/1000; for(const tree of world.trees){
    const city = world.cities.find(c=>c.id===tree.city);
    if(city && city.locked) continue;
    const baseH=sampleHeight(tree.x, tree.z);
    const sway=Math.sin(time*0.6 + tree.swayPhase)*0.15;
    pushBox(arr, tree.x-world.size/2 + sway*0.2, baseH+0.9, tree.z-world.size/2, 0.25,1.8,0.25, [0.35,0.23,0.12]);
    pushBox(arr, tree.x-world.size/2, baseH+1.9, tree.z-world.size/2, 1.4,0.15,1.4, [0.07,0.35,0.18]);
    pushBox(arr, tree.x-world.size/2, baseH+2.05, tree.z-world.size/2, 1.0,0.12,1.0, [0.06,0.32,0.16]);
    pushBox(arr, tree.x-world.size/2, baseH+2.18, tree.z-world.size/2, 0.7,0.1,0.7, [0.05,0.28,0.14]);
  }
  for(const b of world.bandits){ const h=sampleHeight(b.x,b.z); pushBox(arr, b.x-world.size/2, h+0.15, b.z-world.size/2, 1,0.6,1,[0.3,0.1,0.1]); pushBox(arr, b.x-world.size/2, h+0.9, b.z-world.size/2, 0.4,0.8,0.4,[0.2,0.05,0.05]); }
  const f=new Float32Array(arr); const mesh=makeVAO(gl,f); return {mesh, count:f.length/7};
}

function renderRoutes(gl, program){
  const routeColor=[0.88,0.35,0.06]; for(const c of world.caravans){ if(!c.path || c.path.length<2 || c.state!=='travel') continue; const arr=[]; for(const p of c.path){ const x=p.x - world.size/2; const z=p.z - world.size/2; const y=p.y + 0.15; arr.push(x,y,z, routeColor[0],routeColor[1],routeColor[2], 0.8); } const f=new Float32Array(arr); const vao=gl.createVertexArray(); gl.bindVertexArray(vao); const vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vbo); gl.bufferData(gl.ARRAY_BUFFER,f,gl.DYNAMIC_DRAW); const stride=7*4; gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,stride,3*4); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,stride,6*4); gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident())); gl.drawArrays(gl.LINE_STRIP,0,f.length/7); }
}

function renderEffects(gl, program){
  const nowEffects=[]; if(!world.effects) return; for(const e of world.effects){ e.t += 1/60; const p=e.t/e.dur; if(p>=1){ continue; } else nowEffects.push(e); const arr=[]; const segs = e.kind==='sand'?8:14; const baseRadius = e.kind==='sand'?0.05:0.2; const grow = e.kind==='sand'?0.6:1.8; const radius=baseRadius + p*grow; const yBase=sampleHeight(e.x,e.z); let y = yBase + (e.kind==='camelLoss'?0.4 + p*0.6: (e.kind==='sand'?0.15 + p*0.25:0.3 + p*0.4)); let color=[1.0,0.85,0.3]; if(e.kind==='sand') color=[0.75,0.65,0.45]; else if(e.kind==='camelLoss') color=[1.0,0.45,0.25]; for(let i=0;i<segs;i++){ const a0=(i/segs)*Math.PI*2; const a1=((i+1)/segs)*Math.PI*2; const mx=((Math.cos(a0)+Math.cos(a1))*0.5)*radius; const mz=((Math.sin(a0)+Math.sin(a1))*0.5)*radius; pushBox(arr, e.x + mx - world.size/2, y, e.z + mz - world.size/2, 0.12,0.12,0.12,color); } const f=new Float32Array(arr); const vao=gl.createVertexArray(); gl.bindVertexArray(vao); const vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vbo); gl.bufferData(gl.ARRAY_BUFFER,f,gl.DYNAMIC_DRAW); const stride=7*4; gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,stride,3*4); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,stride,6*4); gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident())); gl.drawArrays(gl.TRIANGLES,0,f.length/7); }
  world.effects=nowEffects;
}

export function initWorldGeometry(gl){ buildWorldMesh(gl); buildFarPlane(gl); buildBackgroundMesh(gl); }

export function renderWorldScene(gl, program){
  if(world.__needsTerrainRebuild){
    // Rebuild terrain mesh to show new oasis tiles
    world.__needsTerrainRebuild=false;
    // rebuild only world mesh (leave background/far plane unchanged)
    const arr=[]; const step=2; const s=world.size;
    // reuse buildWorldMesh logic inline (cannot call directly due to closure) -> call initWorldGeometry? but that rebuilds backgrounds unnecessarily
    // Simpler: call initWorldGeometry
    initWorldGeometry(gl);
  }
  const wr=worldRender; gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident()));
  if(wr.worldMesh){ gl.bindVertexArray(wr.worldMesh.vao); gl.drawArrays(gl.TRIANGLES,0,wr.worldCount); }
  if(wr.backgroundMesh){ gl.bindVertexArray(wr.backgroundMesh.vao); gl.drawArrays(gl.TRIANGLES,0,wr.backgroundCount); }
  if(wr.farPlane){ gl.bindVertexArray(wr.farPlane.vao); gl.drawArrays(gl.TRIANGLES,0,wr.farPlaneCount); }
  gl.lineWidth(2); renderRoutes(gl, program);
  const inst=buildInstanced(gl); gl.bindVertexArray(inst.mesh.vao); gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident())); gl.drawArrays(gl.TRIANGLES,0,inst.count); renderEffects(gl, program);
}
