import { createGLContext, createProgram } from './engine/gl.js';
import { GameLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { GOODS, strategy, computePrice, updateCityPrices, caravanAutoTrade, recalcWorldGoods, applyCityFlows } from './economy/market.js';
import { world, genWorld, newCaravan, sampleHeight, CAMEL_MAX, CAMEL_SPACING, makeFaceForUI, baseHeight, worldRender, initWorldGeometry, renderWorldScene } from './world/world.js';
import { initWindowButtons, updateUI } from './ui/ui.js';
import { t, localizeStaticDOM } from './core/i18n.js';
import { initProgression, attachLevelUpHelper, awardXP } from './core/progression.js';
import { applyAllUpgradeEffects } from './core/upgrades.js';
import { perspective, ident, mul, translate, scale, rotY, rotX } from './math/matrix.js';
import DesertAmbientAudio from './audio.js';

// === Minimal low-poly tycoon prototype ===
// Systems: Camera, World grid (desert + oasis), Entities (Caravans, Camels), Economy loop, Random events, UI, Simple low-poly rendering.

const canvas = document.getElementById('glCanvas');
const gl = createGLContext(canvas);

// Math & terrain helpers imported from modules

// Camera (orbit) ---------------------------------------------- (with inertia) reduced zoom range
const orbit = { center:{x:0,y:0,z:0}, dist:12, minDist:7, maxDist:30, yaw:0.85, pitch:0.65, minPitch:0.15, maxPitch:1.25 };
let dragging=false, lastX=0,lastY=0;
const camVel={x:0,z:0}; const camAccel=55; const camFriction=6;
canvas.addEventListener('mousedown', e=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; });
window.addEventListener('mouseup', ()=> dragging=false);
window.addEventListener('mousemove', e=>{
  if(!dragging) return; const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
  // Invert previously inverted axes so that moving mouse right rotates view right and up moves view up.
  orbit.yaw += dx*0.004; // was subtracting -> inverted
  orbit.pitch += dy*0.004; // previously subtracting produced inverted vertical look
  orbit.pitch=Math.max(orbit.minPitch, Math.min(orbit.maxPitch, orbit.pitch));
});
window.addEventListener('wheel', e=>{ orbit.dist += e.deltaY*0.05; orbit.dist=Math.max(orbit.minDist, Math.min(orbit.maxDist, orbit.dist)); });
function viewMatrix(){
  const cy=Math.cos(orbit.yaw), sy=Math.sin(orbit.yaw); const cp=Math.cos(orbit.pitch), sp=Math.sin(orbit.pitch);
  const x = orbit.center.x + orbit.dist * sy * cp;
  const y = orbit.center.y + orbit.dist * sp;
  const z = orbit.center.z + orbit.dist * (-cy) * cp;
  // build lookAt toward center
  const fx = orbit.center.x - x; const fy = orbit.center.y - y; const fz = orbit.center.z - z; const fl = Math.hypot(fx,fy,fz); const fxl=fx/fl,fyl=fy/fl,fzl=fz/fl;
  const upx=0, upy=1, upz=0; // right = f x up
  let rx = fyl*upz - fzl*upy; let ry = fzl*upx - fxl*upz; let rz = fxl*upy - fyl*upx; const rl=Math.hypot(rx,ry,rz); rx/=rl; ry/=rl; rz/=rl;
  // recompute orthonormal up
  const ux = ry*fzl - rz*fyl; const uy = rz*fxl - rx*fzl; const uz = rx*fyl - ry*fxl;
  return [
    rx, ux, -fxl, 0,
    ry, uy, -fyl, 0,
    rz, uz, -fzl, 0,
    -(rx*x + ry*y + rz*z), -(ux*x + uy*y + uz*z), (fxl*x + fyl*y + fzl*z), 1
  ];
}

// Shaders ------------------------------------------------------
const vs = `#version 300 es\nlayout(location=0) in vec3 aPos; layout(location=1) in vec3 aColor; layout(location=2) in float aShade;\nuniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel; out vec3 vColor; out float vShade; out float vDepth;\nvoid main(){ vColor=aColor; vShade=aShade; vec4 wp = uModel * vec4(aPos,1.0); vec4 vp = uView * wp; vDepth = length(vp.xyz); gl_Position = uProj * vp; }`;
const fs = `#version 300 es\nprecision highp float; in vec3 vColor; in float vShade; in float vDepth;\nuniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;\nuniform vec3 uSunDir; uniform float uDayLight;\nout vec4 outColor;\nvoid main(){\n  float a = 0.85 + vShade*0.15;\n  vec3 col = vColor * a;\n  // Lightened night ambient and softer transition\n  vec3 nightCol = vec3(0.16,0.18,0.21); vec3 dayCol = vec3(1.00,0.98,0.92);\n  vec3 amb = mix(nightCol, dayCol, uDayLight);\n  float warm = exp(-pow(max(uSunDir.y,0.0)*8.0,1.2));\n  col *= amb;\n  // extra warm tint near sunrise/sunset\n  col += warm * vec3(1.10,0.60,0.30) * 0.26;\n  float night = 1.0 - uDayLight;\n  float distF = clamp((vDepth-15.0)/70.0,0.0,1.0);\n  // Reduced night distance darkening (0.35 vs 0.55)\n  col *= (1.0 - night*distF*0.35);\n  // Reduced desaturation at night (0.25 vs 0.35)\n  col = mix(col, vec3(dot(col, vec3(0.333))), night*0.25);\n  float f = clamp((vDepth - uFogNear)/(uFogFar - uFogNear),0.0,1.0); col = mix(col, uFogColor, f);\n  outColor = vec4(col,1.0); }`;
const program = createProgram(gl, vs, fs);

// Advanced sky (sun + stars rotating with camera)
const skyFS = `#version 300 es\nprecision highp float;\nin vec2 vPos; out vec4 outColor;\nuniform float uDay; uniform float uYaw; uniform float uPitch; uniform vec3 uSunDir; uniform float uTime;\nfloat hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }\nmat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }\nmat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,-s, 0.0,s,c); }\nvec3 tonemap(vec3 c){ return c/(c+vec3(1.0)); }\nvoid main(){\n  vec3 dir = normalize(vec3(vPos.x, vPos.y*0.6, 1.0));\n  dir = rotY(uYaw) * rotX(-uPitch) * dir;\n  float sunDot = clamp(dot(dir, normalize(uSunDir)), -1.0, 1.0);\n  float sunElev = uSunDir.y;\n  float up = clamp(dir.y*0.5+0.5,0.0,1.0);\n  vec3 topDay = vec3(0.35,0.62,0.95); vec3 botDay = vec3(0.96,0.80,0.58);\n  vec3 topNight = vec3(0.04,0.05,0.10); vec3 botNight = vec3(0.08,0.07,0.09);\n  float horizonBand = exp(-pow(max(sunElev,0.0)*14.0,1.2)); float warm = horizonBand * smoothstep(0.0,0.18,sunElev);\n  vec3 warmTop=vec3(0.95,0.45,0.25), warmBot=vec3(1.05,0.60,0.32);\n  float nightF = smoothstep(-0.02,-0.20,sunElev);\n  vec3 top = mix(topDay, topNight, nightF); vec3 bot = mix(botDay, botNight, nightF*0.9);\n  top = mix(top, warmTop, warm); bot = mix(bot, warmBot, warm*0.9);\n  vec3 col = mix(bot, top, pow(up,1.1));\n  float sunDisk = smoothstep(0.02,0.0, acos(sunDot));\n  float glow = smoothstep(-0.25,1.0,sunDot) * smoothstep(-0.9,0.4,dir.y);\n  vec3 sunColor = mix(vec3(1.3,0.9,0.55), vec3(1.05,0.55,0.25), clamp(1.0-sunElev*5.0,0.0,1.0));\n  col += sunColor * (sunDisk*1.4 + glow*0.32);\n  if(nightF>0.02){\n    float az = atan(dir.z, dir.x); float el = asin(clamp(dir.y,-1.0,1.0));\n    vec2 uv = vec2((az+3.14159265)/6.28318, (el+1.5707963)/3.14159265);\n    vec2 grid = uv * vec2(256.0,128.0); vec2 cell = floor(grid); vec2 frac = fract(grid);\n    float h = hash(cell); float starProb = step(0.995, h); vec2 d = frac - 0.5; float r = length(d)*2.2; float shape = smoothstep(0.6,0.0,r);\n    float tw = sin(uTime*3.0 + h*60.0)*0.5+0.5; float mag = mix(0.4,1.0, hash(cell+vec2(11.7,5.3)));\n    float horizonFade = smoothstep(0.0,0.12, abs(dir.y)); float sunFade = 1.0 - smoothstep(0.0,0.28, sunDot);\n    float starVis = starProb * shape * nightF * horizonFade * sunFade; vec3 starCol = mix(vec3(1.0,0.95,0.85), vec3(0.75,0.85,1.0), hash(cell+vec2(7.7,3.1)));\n    col += starCol * starVis * mag * (0.55 + 0.45*tw);\n  }\n  col = mix(col, col*0.35, pow(1.0-up,4.0)*(1.0-nightF*0.65));\n  outColor = vec4(tonemap(col),1.0); }`;
let skyProgram, skyVAO, skyDayLoc, skyYawLoc, skyPitchLoc, skySunLoc, skyTimeLoc;
function initSky(){
  const skyVS = `#version 300 es\nlayout(location=0) in vec2 aPos; out vec2 vPos; void main(){ vPos=aPos; gl_Position=vec4(aPos,0.0,1.0); }`;
  skyProgram = createProgram(gl, skyVS, skyFS);
  skyDayLoc = gl.getUniformLocation(skyProgram,'uDay');
  skyYawLoc = gl.getUniformLocation(skyProgram,'uYaw');
  skyPitchLoc = gl.getUniformLocation(skyProgram,'uPitch');
  skySunLoc = gl.getUniformLocation(skyProgram,'uSunDir');
  skyTimeLoc = gl.getUniformLocation(skyProgram,'uTime');
  const verts = new Float32Array([-1,-1, 3,-1, -1,3]);
  skyVAO = gl.createVertexArray(); gl.bindVertexArray(skyVAO);
  const vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.bindVertexArray(null);
}
initSky();

// Spacing constants now imported from world module

// Geometry builders -------------------------------------------
function pushBox(arr, x,y,z, sx,sy,sz, color, yaw=0){
  // 12 triangles (36 verts) low poly shading using single shade value per face
  const faces = [ // nx,ny,nz,   vertices local
    [0,1,0,  -1,1,-1, 1,1,-1, 1,1,1,  -1,1,-1, 1,1,1, -1,1,1], // top
    [0,-1,0, -1,-1,-1,-1,-1,1, 1,-1,1,  -1,-1,-1, 1,-1,1, 1,-1,-1], // bottom
    [0,0,1,  -1,-1,1, -1,1,1, 1,1,1,  -1,-1,1, 1,1,1, 1,-1,1], // front
    [0,0,-1, -1,-1,-1, 1,-1,-1, 1,1,-1,  -1,-1,-1, 1,1,-1, -1,1,-1], // back
    [1,0,0,  1,-1,-1, 1,-1,1, 1,1,1,  1,-1,-1, 1,1,1, 1,1,-1], // right
    [-1,0,0, -1,-1,-1, -1,1,-1, -1,1,1, -1,-1,-1, -1,1,1, -1,-1,1] // left
  ];
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  for(const f of faces){
    const nx=f[0],ny=f[1],nz=f[2]; const shade = 0.5 + 0.5*Math.max(0,(ny*0.9 + nz*0.1 + nx*0.2));
    for(let i=3;i<f.length;i+=3){
      // local unscaled coords
      const lx = f[i]*0.5*sx; const ly = f[i+1]*0.5*sy; const lz = f[i+2]*0.5*sz;
      const rx = lx * cosY - lz * sinY; // rotate around Y
      const rz = lx * sinY + lz * cosY;
      const vx = x + rx; const vy = y + ly; const vz = z + rz;
      arr.push(vx,vy,vz, color[0],color[1],color[2], shade);
    }
  }
}


genWorld();
// Progression setup
initProgression(world);
world.__awardXP = (xp)=>{ awardXP(world, xp); };
attachLevelUpHelper(world);
// geometry buffers
initWorldGeometry(gl);
// Initial caravan
newCaravan();
// Ensure upgrade effects applied after initial caravan spawn
applyAllUpgradeEffects(world);

// Adjust initial camera to show starting town(s) and first caravan
// World rendering shifts logical coordinates by -world.size/2, so convert.
if(world.cities.length && world.caravans.length){
  const cityA = world.cities[0];
  // Prefer a different second point (either second unlocked city or the caravan) to widen framing
  const second = (world.cities[1] && !world.cities[1].locked) ? world.cities[1] : world.caravans[0];
  const ax = cityA.x - world.size/2, az = cityA.z - world.size/2;
  const bx = second.x - world.size/2, bz = second.z - world.size/2;
  // Midpoint between the two reference points
  orbit.center.x = (ax + bx) * 0.5;
  orbit.center.z = (az + bz) * 0.5;
  // Distance scaled to fit both points comfortably
  const span = Math.hypot(ax - bx, az - bz);
  const desiredDist = Math.min(orbit.maxDist-2, Math.max(orbit.minDist+1.5, span * 1.4 + 8));
  orbit.dist = desiredDist;
  // Yaw so that we look roughly from southwest (gives nice depth) toward scene center
  // (Only override if using default yaw to avoid clobbering user customizations on reload.)
  if(Math.abs(orbit.yaw - 0.85) < 0.01){
    orbit.yaw = 0.95; // slight angle
  }
}

// Economy & events --------------------------------------------
const events = [];
function log(msg, cls){ const el=document.getElementById('log'); if(!el) return; const div=document.createElement('div'); div.className='entry'+(cls?(' '+cls):''); const totalHours=world.day; const day=Math.floor(totalHours/24)+1; const hour=Math.floor(totalHours%24); const minute=Math.floor((totalHours-Math.floor(totalHours))*60); const pad=v=>v.toString().padStart(2,'0'); div.textContent=`[D${day} ${pad(hour)}:${pad(minute)}] ${msg}`; el.appendChild(div); el.scrollTop=el.scrollHeight; }
world.__uiLog = log;
const logMsg = log; // alias for older calls
function randomEvent(){
  const r=Math.random();
  if(r<0.10){ // sandstorm redistributes / destroys some cargo
  let total = world.caravans.reduce((a,c)=>a + (c.cargo?Object.values(c.cargo).reduce((x,y)=>x+(y.qty||0),0):0),0);
    if(total>0){
      const loss = Math.floor(total*0.18);
      let remaining=loss;
      while(remaining>0){
        const c = world.caravans[Math.floor(Math.random()*world.caravans.length)];
  const goodsKeys = Object.keys(GOODS).filter(g=>c.cargo[g].qty>0);
  if(!goodsKeys.length){ continue; }
  const gk = goodsKeys[Math.floor(Math.random()*goodsKeys.length)];
  c.cargo[gk].qty--; if(c.cargo[gk].qty<0) c.cargo[gk].qty=0; remaining--; if(remaining<=0) break;
      }
      recalcWorldGoods(world);
  log(t('events.stormLost',{loss}));
    }
  } else if(r<0.16){
    const bonus= Math.floor(40+Math.random()*110); world.money+=bonus; log(t('events.fair',{bonus}));
  } else if(r<0.22 && world.caravans.length>0){
    const c = world.caravans[Math.floor(Math.random()*world.caravans.length)];
  // (Camel loss moved to per‑caravan travel handling; keep placeholder in case we add random event variants later.)
  }
}
// randomCityName handled in world module


// Caravan behavior --------------------------------------------
// Arrival effects ----------------------------------------------------
world.effects = [];
function spawnArrivalEffect(x,z){ world.effects.push({x,z,t:0,dur:0.9}); }

function pickTarget(c){
  // pick a city different from current position (closest oasis) with random choice for now
  const availableCities = world.cities.filter(ct=>!ct.locked);
  const curCity = availableCities.reduce((best,city)=>{ const d=Math.hypot(city.x-c.x, city.z-c.z); return d<best.d? {d, city}:best; }, {d:1e9, city:null}).city;
  let targetCity = curCity;
  let tries=0; while((targetCity===curCity || !targetCity) && tries<12){ targetCity = availableCities[Math.floor(Math.random()*availableCities.length)]; tries++; }
  const from = {x:c.x,z:c.z}; const oasis = {x:targetCity.x, z:targetCity.z};
  const mid = {x:(from.x+oasis.x)/2, z:(from.z+oasis.z)/2};
  const dx=oasis.x-from.x, dz=oasis.z-from.z; const len=Math.hypot(dx,dz);
  if(len>0){ const nx=-dz/len, nz=dx/len; const lateral = (Math.random()*0.35+0.15)*len; mid.x += nx*lateral*(Math.random()<0.5?1:-1); mid.z += nz*lateral*(Math.random()<0.5?1:-1); }
  const steps=36; const pts=[]; let dist=0; let last=null; for(let i=0;i<=steps;i++){ const t=i/steps; const a=1-t; const px=a*a*from.x + 2*a*t*mid.x + t*t*oasis.x; const pz=a*a*from.z + 2*a*t*mid.z + t*t*oasis.z; const py=sampleHeight(px, pz); if(last){ dist += Math.hypot(px-last.x,pz-last.z); }
    const node={x:px,z:pz,y:py,dist}; pts.push(node); last=node; }
  c.path=pts; c.pathLen=dist; c.t=0; c.state='travel'; c.destCity = targetCity.id; }

function updateCaravan(c,dt){
  // Track distance moved this frame for XP
  let prevX=c.x, prevZ=c.z;
  if(c.state==='idle'){
    if(Math.random()<0.02){ pickTarget(c); }
  } else if(c.state==='travel'){
    const base = 3 + Math.pow(c.camels,0.82)*0.35; const speedBonus = world.player?.upgradeStats?.speedBonus||0; const speed = base * (1+speedBonus); c.t += speed*dt; if(c.t>=c.pathLen){ c.x=c.path[c.path.length-1].x; c.z=c.path[c.path.length-1].z; c.y= c.path[c.path.length-1].y; c.state='trade'; c.tradeTimer=1.2+Math.random()*0.8; spawnArrivalEffect(c.x,c.z); if(typeof playArrivalChime==='function') playArrivalChime(); }
    else {
      // find segment
      const pts=c.path; let i=1; while(i<pts.length && pts[i].dist < c.t) i++; const a=pts[i-1], b=pts[i]; const segT=(c.t-a.dist)/(b.dist-a.dist); c.x=a.x + (b.x-a.x)*segT; c.z=a.z + (b.z-a.z)*segT; c.y=a.y + (b.y-a.y)*segT; c.yaw = Math.atan2(b.z - a.z, b.x - a.x); }
      if(speedBonus>0 && Math.random()<0.18*speedBonus){ world.effects.push({x:c.x, z:c.z, t:0, dur:0.6, kind:'sand'}); }
  } else if(c.state==='trade'){
    c.tradeTimer -= dt; if(c.tradeTimer<=0){
      // perform auto trading based on thresholds at the city reached
  const city = world.cities.find(ct=>ct.id===c.destCity && !ct.locked) || world.cities.filter(ct=>!ct.locked).reduce((best,ct)=>{ const d=Math.hypot(ct.x-c.x, ct.z-c.z); return d<best.d?{d,city:ct}:best; }, {d:1e9, city:null}).city;
      if(city){ caravanAutoTrade(c, city, world); recalcWorldGoods(world); }
  c.state='idle';
    }
  }
  // Award distance XP (only when actually moved)
  const dx=c.x - prevX, dz=c.z - prevZ; const dist=Math.hypot(dx,dz);
  if(dist>0 && world.player){
    // Increased distance XP: 1 XP per 6 units (previously 1 per 30)
    const xpGain = dist/6;
    if(world.__awardXP){ world.__awardXP(xpGain); }
    // Camel loss chance (very small per movement frame) scaled by mitigation upgrade.
    // Base rate chosen so that with continuous travel a multi‑camel caravan loses a camel roughly every few in‑game days without mitigation.
    const mitig = world.player?.upgradeStats?.camelLossMitigation||0; // each camelCare level reduces by 15%
    const camelLossChance = 0.0009 * (1 - mitig); // tuned small probability per update when moving
    if(c.camels>1 && Math.random()<camelLossChance){
      c.camels--; c.faces.pop();
      log(t('events.camelLost',{id:c.id, name:(c.name||('#'+c.id))}));
      world.effects.push({x:c.x, z:c.z, t:0, dur:0.9, kind:'camelLoss'});
    }
  }
}

function updateBandits(dt){
  for(const b of world.bandits){
    b.raidTimer -= dt*world.speed;
    if(b.raidTimer<=0 && world.caravans.length){
      // pick nearest caravan
      let target=null, best=1e9; for(const c of world.caravans){ const d=Math.hypot(c.x-b.x, c.z-b.z); if(d<best){ best=d; target=c; } }
      if(target && Math.random()<0.6){
  let loss = Math.min(world.goods, Math.ceil(10+Math.random()*30));
        if(loss<1) loss=1; // always some risk
        world.goods-=loss; log(t('events.banditsSteal',{loss}));
      } else {
  log(t('events.banditsFail'));
      }
      b.raidTimer = 35+Math.random()*30;
    }
  }
}

// Rendering setup already initialized via initWorldGeometry()


// Input & UI ---------------------------------------------------
const input = new Input();
function resize(){ canvas.width=window.innerWidth; canvas.height=window.innerHeight; gl.viewport(0,0,canvas.width,canvas.height); }
window.addEventListener('resize', resize); resize();
// buildInn feature removed


initWindowButtons();

// ------------------------------------------------------------
// Game loop (reintroduced after refactor)
// ------------------------------------------------------------
const loop = new GameLoop();
// Reset motion when focus lost to avoid drift
function resetMotion(){ camVel.x=0; camVel.z=0; }
window.addEventListener('blur', ()=>{ resetMotion(); });
document.addEventListener('visibilitychange', ()=>{ if(document.hidden){ resetMotion(); } });
loop.onUpdate(dt=>{
  if(world.paused) return; // skip sim but still render
  // keyboard camera movement (WASD + arrows)
  const boost = (input.isDown('ShiftLeft')||input.isDown('ShiftRight'))?2.5:1;
  const moveBase = 8 * boost * orbit.dist/12;
  let mx=0,mz=0;
  // Corrected: forward is positive mz
  if(input.isDown('KeyW')||input.isDown('ArrowUp')) mz+=1;
  if(input.isDown('KeyS')||input.isDown('ArrowDown')) mz-=1;
  if(input.isDown('KeyA')||input.isDown('ArrowLeft')) mx+=1;
  if(input.isDown('KeyD')||input.isDown('ArrowRight')) mx-=1;
  // Inertial camera movement
  if(mx||mz){
    const len=Math.hypot(mx,mz); if(len>0){ mx/=len; mz/=len; }
    const yaw=orbit.yaw;
    // Forward vector points from camera toward center on ground plane: (-sin(yaw), 0, cos(yaw))
    const fwdX = -Math.sin(yaw), fwdZ = Math.cos(yaw);
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    const dirx = rightX*mx + fwdX*mz;
    const dirz = rightZ*mx + fwdZ*mz;
    camVel.x += dirx * camAccel * moveBase * dt * 0.12;
    camVel.z += dirz * camAccel * moveBase * dt * 0.12;
  }
  // Friction / damping
  camVel.x -= camVel.x * camFriction * dt;
  camVel.z -= camVel.z * camFriction * dt;
  // Clamp max speed
  const vLen=Math.hypot(camVel.x, camVel.z); const vMax=moveBase*1.6; if(vLen>vMax){ camVel.x*=vMax/vLen; camVel.z*=vMax/vLen; }
  orbit.center.x += camVel.x * dt;
  orbit.center.z += camVel.z * dt;
  // Clamp camera center within world horizontal bounds
  const halfBound = world.size*0.5 - 2; // small margin
  if(orbit.center.x > halfBound) orbit.center.x = halfBound;
  else if(orbit.center.x < -halfBound) orbit.center.x = -halfBound;
  if(orbit.center.z > halfBound) orbit.center.z = halfBound;
  else if(orbit.center.z < -halfBound) orbit.center.z = -halfBound;
  // pause toggle
  if(input.isDown('KeyP')){ world.paused = !world.paused; input.keys['KeyP']=false; }
  // Unified in‑game hours progression. Previously city flows used dt*speed (4x faster)
  // than world.day (dt*speed*0.25) causing an initial rapid stock/price swing.
  const hoursDelta = dt * world.speed * 0.25; // in‑game hours advanced this frame
  world.day += hoursDelta; // day counter in hours (24 = full day)
  applyCityFlows(world, hoursDelta); // keep flows consistent with visual day speed
  // caravans
  for(const c of world.caravans){ updateCaravan(c, dt * world.speed); }
  // bandits
  updateBandits(dt);
  // random events (low chance per second)
  if(Math.random()<0.0025) randomEvent();
  // UI refresh (throttled cheap enough)
  updateUI();
});

loop.onRender(()=>{
  // Sky pass
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  if(skyProgram){
    gl.useProgram(skyProgram); gl.bindVertexArray(skyVAO);
    // Compute sun direction (simple east-west arc). dayFrac 0..1 -> angle
    const dayFrac = (world.day/24)%1; // 0 sunrise
  const ang = dayFrac * Math.PI * 2.0; // full rotation (continuous), stars/night handled by elevation
    // Sun moves in a tilted vertical circle (y elevation from sin)
    const sunY = Math.sin(ang);
    const sunX = Math.cos(ang);
    const sunDir = new Float32Array([sunX, sunY, 0]);
    gl.uniform1f(skyDayLoc, world.day);
    gl.uniform1f(skyYawLoc, orbit.yaw);
    gl.uniform1f(skyPitchLoc, orbit.pitch);
    gl.uniform3fv(skySunLoc, sunDir);
    if(skyTimeLoc) gl.uniform1f(skyTimeLoc, performance.now()/1000);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  // Scene pass
  gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.useProgram(program);
  const proj=perspective(Math.PI/3, canvas.width/canvas.height, 0.1, 120);
  const view=viewMatrix();
  gl.uniformMatrix4fv(gl.getUniformLocation(program,'uProj'),false,new Float32Array(proj));
  gl.uniformMatrix4fv(gl.getUniformLocation(program,'uView'),false,new Float32Array(view));
  // Lighting / time-of-day values
  const cycle = (world.day/24)%1;
  const angFull = cycle * Math.PI * 2.0;
  const sunElev = Math.max(0, Math.sin(angFull));
  const dayLight = Math.pow(sunElev,0.55);
  gl.uniform3f(gl.getUniformLocation(program,'uSunDir'), Math.cos(angFull), Math.sin(angFull), 0);
  gl.uniform1f(gl.getUniformLocation(program,'uDayLight'), dayLight);
  // Dynamic fog: color & distances depend on dayLight + low-sun warm tint
  const nightFactor = 1 - dayLight;
  const warmFactor = Math.max(0, Math.exp(-Math.max(sunElev,0)*6.0) - 0.10); // peaks near sunrise/sunset
  const dayFog = [0.78,0.74,0.68];
  const nightFog = [0.18,0.20,0.26];
  let fogR = nightFog[0] + (dayFog[0]-nightFog[0]) * dayLight;
  let fogG = nightFog[1] + (dayFog[1]-nightFog[1]) * dayLight;
  let fogB = nightFog[2] + (dayFog[2]-nightFog[2]) * dayLight;
  // Warm tint (slight orange) when sun just above horizon
  fogR += warmFactor * 0.25; fogG += warmFactor * 0.10; fogB += warmFactor * -0.05;
  fogR = Math.min(1, Math.max(0,fogR)); fogG = Math.min(1, Math.max(0,fogG)); fogB = Math.min(1, Math.max(0,fogB));
  const fogNear = 32 + dayLight * 8 - warmFactor*2; // pull slightly closer in warm haze
  const fogFar = 80 + dayLight * 15 - warmFactor*3;
  gl.uniform3f(gl.getUniformLocation(program,'uFogColor'), fogR, fogG, fogB);
  gl.uniform1f(gl.getUniformLocation(program,'uFogNear'), fogNear);
  gl.uniform1f(gl.getUniformLocation(program,'uFogFar'), fogFar);
  renderWorldScene(gl, program);
});
loop.start();

localizeStaticDOM();
log(t('welcome'));

// Ambient desert audio integration -------------------------------------------
const ambientAudio = new DesertAmbientAudio({ seed: 'tycoon', tempo: 64, masterGainDb: -10, root: 'A' });
ambientAudio.onready = () => { /* ready to start on gesture */ };
ambientAudio.onerror = (e)=> { console.warn('Audio error', e); };
// Start on first user gesture
const gestureStart = () => { ambientAudio.start(); window.removeEventListener('click', gestureStart); window.removeEventListener('keydown', gestureStart); };
window.addEventListener('click', gestureStart, { once: true });
window.addEventListener('keydown', gestureStart, { once: true });

// UI toggle button reuse
const btn = document.getElementById('toggleSound');
if (btn) {
  btn.addEventListener('click', () => {
    if (!ambientAudio.started) { ambientAudio.start(); btn.textContent = t('btn.mute'); return; }
    if (ambientAudio._muted) { ambientAudio.mute(false); btn.textContent = t('btn.mute'); }
    else { ambientAudio.mute(true); btn.textContent = t('btn.unmute'); }
  });
}


// Arrival chime using same audio context (lightweight dyad)
window.playArrivalChime = function() {
  const actx = ambientAudio.context; if (!actx || actx.state !== 'running') return;
  const t = actx.currentTime; const g = actx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  g.connect(ambientAudio.masterGain);
  const osc1 = actx.createOscillator(); osc1.type = 'triangle'; osc1.frequency.setValueAtTime(440, t); // A4
  const osc2 = actx.createOscillator(); osc2.type = 'sine'; osc2.frequency.setValueAtTime(659.25, t); // E5 (fifth)
  osc1.connect(g); osc2.connect(g); osc1.start(t); osc2.start(t); osc1.stop(t + 0.7); osc2.stop(t + 0.7);
};
