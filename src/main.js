import { createGLContext, createProgram } from './engine/gl.js';
import { GameLoop } from './core/loop.js';
import { Input } from './core/input.js';

// === Minimal low-poly tycoon prototype ===
// Systems: Camera, World grid (desert + oasis), Entities (Caravans, Camels, Inns), Economy loop, Random events, UI, Simple low-poly rendering.

const canvas = document.getElementById('glCanvas');
const gl = createGLContext(canvas);

// Utility math -------------------------------------------------
function perspective(fovy, aspect, near, far){
  const f = 1/Math.tan(fovy/2); const nf = 1/(near-far);
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,(2*far*near)*nf,0];
}
function mul(a,b){ const r=new Array(16).fill(0); for(let i=0;i<4;i++) for(let j=0;j<4;j++) for(let k=0;k<4;k++) r[i*4+j]+=a[i*4+k]*b[k*4+j]; return r; }
function ident(){ return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function translate(x,y,z){ const m=ident(); m[12]=x; m[13]=y; m[14]=z; return m; }
function scale(x,y,z){ return [x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]; }
function rotY(a){ const c=Math.cos(a),s=Math.sin(a); return [c,0,s,0, 0,1,0,0, -s,0,c,0, 0,0,0,1]; }
function rotX(a){ const c=Math.cos(a),s=Math.sin(a); return [1,0,0,0, 0,c,-s,0, 0,s,c,0, 0,0,0,1]; }
// Deterministic terrain height helpers for seamless core/background
function hash2d(x,z){ return (Math.sin(x*12.9898 + z*78.233)*43758.5453)%1; }
function baseHeight(x,z){
  const h1 = (Math.sin(x*0.32)+Math.cos(z*0.29))*0.30;
  const h2 = (Math.sin(x*0.06)*Math.cos(z*0.05))*0.25;
  const n = (hash2d(x,z)-0.5)*0.10; // subtle noise
  return h1 + h2 + n;
}

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

// Spacing constants
const CAMEL_SPACING = 2.2; // increased distance along path between camels
const CAMEL_MAX = 6;

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

// Composite camel model (multi-box) ----------------------------------
function pushCamel(arr, x,y,z, yaw, baseY, t=0, phase=0, gaitAmp=1){
  const colorBody=[0.78,0.6,0.28];
  const colorLeg=[0.65,0.5,0.23];
  const colorHead=[0.82,0.68,0.36];
  const cosY=Math.cos(yaw), sinY=Math.sin(yaw);
  function place(lx,ly,lz, sx,sy,sz, col){
    const wx = x + (lx*cosY - lz*sinY);
    const wz = z + (lx*sinY + lz*cosY);
    pushBox(arr, wx, baseY+ly, wz, sx, sy, sz, col, yaw);
  }
  // body + humps
  place(0, 0.55, 0, 1.4,0.8,0.6, colorBody);
  place(-0.25, 1.05, 0, 0.5,0.5,0.45, colorBody);
  place(0.35, 1.00, 0, 0.55,0.55,0.48, colorBody);
  // neck & head
  place(0.85, 0.95, 0, 0.35,0.7,0.35, colorBody);
  place(1.05, 1.25, 0, 0.35,0.35,0.35, colorHead);
  // legs with diagonal gait
  const legH=0.7; const speed=9.5; const waveA=Math.sin(t*speed + phase); const waveB=Math.sin(t*speed + phase + Math.PI);
  function leg(lx,lz,isA){ const w=isA?waveA:waveB; const lift=gaitAmp * Math.max(0,w)*0.15; place(lx, legH/2 + lift, lz, 0.25, legH, 0.25, colorLeg); }
  leg(-0.5,-0.18,true);  // back-right A
  leg(0.1, 0.18,true);   // front-left A
  leg(-0.5, 0.18,false); // back-left B
  leg(0.1,-0.18,false);  // front-right B
}

// World generation --------------------------------------------
const world = { size:64, tiles:[], oases:[], inns:[], caravans:[], houses:[], trees:[], money:200, goods:0, day:0, speed:1, paused:false };
world.bandits = [];
function genWorld(){
  const s=world.size; world.tiles=[]; world.oases=[]; world.houses=[]; world.trees=[];
  // base height & mark all tiles
  const chosenCenters=[];
  const MIN_OASIS_DIST = 10; // минимальная дистанция между центрами оазисов (в тайлах)
  function farEnough(nx,nz){
    for(const c of chosenCenters){ const dx=c.x-nx, dz=c.z-nz; if(dx*dx+dz*dz < MIN_OASIS_DIST*MIN_OASIS_DIST) return false; }
    return true;
  }
  for(let z=0; z<s; z++) for(let x=0; x<s; x++){
    const h = baseHeight(x,z);
    world.tiles.push({x,z,h,oasis:false});
  }
  // pick sparse oasis centers (fewer)
  for(let i=0;i< s*s; i++){
    if(Math.random()<0.0025){
      const x=i% s, z=Math.floor(i/s); if(x<3||z<3||x>=s-3||z>=s-3) continue; if(!farEnough(x,z)) continue;
      chosenCenters.push({x,z});
    }
  }
  if(chosenCenters.length<3){
    for(let i=chosenCenters.length;i<3;i++){
      let tries=0; let nx, nz; do {
        nx=Math.floor(Math.random()*(s-10))+5; nz=Math.floor(Math.random()*(s-10))+5; tries++;
      } while(!farEnough(nx,nz) && tries<120);
      chosenCenters.push({x:nx,z:nz});
    }
  }
  // expand each center into larger oasis radius (patchy)
  const radius=3;
  for(const c of chosenCenters){
    world.oases.push(c);
    for(let dz=-radius; dz<=radius; dz++) for(let dx=-radius; dx<=radius; dx++){
      const tx=c.x+dx, tz=c.z+dz; if(tx<0||tz<0||tx>=s||tz>=s) continue; const d=Math.hypot(dx,dz); if(d>radius+0.4) continue;
      const tile = world.tiles[tz*s + tx]; tile.oasis=true;
    }
  }
  // populate houses & trees near each center
  for(const c of world.oases){
    // houses: 1-2 per oasis
    const houseCount = 1 + (Math.random()<0.5?1:0);
    for(let h=0; h<houseCount; h++){
      const ang = Math.random()*Math.PI*2; const dist=1.5+Math.random()*1.8;
      world.houses.push({x:c.x + Math.cos(ang)*dist, z:c.z + Math.sin(ang)*dist});
    }
    // trees (palms) 3-6
    const treeCount = 3 + Math.floor(Math.random()*4);
    for(let t=0;t<treeCount;t++){
      const ang=Math.random()*Math.PI*2; const dist=1 + Math.random()*2.5;
      world.trees.push({x:c.x + Math.cos(ang)*dist, z:c.z + Math.sin(ang)*dist, swayPhase:Math.random()*Math.PI*2});
    }
  }
}
genWorld();

// Entities -----------------------------------------------------
let caravanId=1;
function makeFaceSeed(){
  const eyes = ["^ ^","• •","- -","o o","x x"][Math.floor(Math.random()*5)];
  const mouth = ["_","~","ᵕ","д","︿"][Math.floor(Math.random()*5)];
  return eyes+mouth;
}
function newCaravan(){
  const oasis = world.oases[Math.floor(Math.random()*world.oases.length)];
  const c = { id:caravanId++, x:oasis.x, z:oasis.z, camels:1, guardReliability:0.55, goods:0, target:null, timer:0, state:'idle', hydration:1, dehydrateTimer:0, faces:[], start:{x:oasis.x,z:oasis.z}, progress:0, speed:(3+Math.random()*1.5), yaw:0, camelTrail:[] };
  c.faces.push(makeFaceSeed());
  c.camelTrail = [{offset:0, x:c.x, z:c.z, y:sampleHeight(c.x,c.z), yaw:0, phase:Math.random()*Math.PI*2}];
  world.caravans.push(c); log(`Караван #${c.id} создан: 1 верблюд (${c.faces[0]}) и подозрительный охранник.`);
}
newCaravan();

// Economy & events --------------------------------------------
const events = [];
function log(msg){ const el=document.getElementById('log'); const div=document.createElement('div'); div.className='entry'; div.textContent=`[${(world.day/24).toFixed(1)}d] ${msg}`; el.appendChild(div); el.scrollTop=el.scrollHeight; }
const logMsg = log; // alias for older calls
function randomEvent(){
  // Weighted random misfortune & fortune
  const r=Math.random();
  if(r<0.12){ // sandstorm
    const loss = Math.floor(world.goods*0.35); world.goods=Math.max(0,world.goods-loss); log(`Песчаная буря: минус ${loss} товаров.`);
  } else if(r<0.20 && world.caravans.length>1){
    const c = world.caravans[Math.floor(Math.random()*world.caravans.length)];
    if(c.camels>0){ c.camels--; c.faces.pop(); log(`Верблюд каравана #${c.id} решил что с него хватит и лёг.`); }
  } else if(r<0.26){
    const bonus= Math.floor(40+Math.random()*140); world.money+=bonus; log(`Случайная ярмарка принесла ${bonus}.`);
  } else if(r<0.31 && world.caravans.length>0){
    const c = world.caravans[Math.floor(Math.random()*world.caravans.length)];
    if(Math.random()>c.guardReliability){ log(`Охранник каравана #${c.id}: "я устал, я ухожу"`); c.guardReliability=0.1; }
  } else if(r<0.36){
    // find thirsty caravan
    const c = world.caravans.find(c=>c.hydration<0.4);
    if(c){ c.camels=Math.max(0,c.camels-1); c.faces.pop(); log(`Забыл напоить верблюда в караване #${c.id}. Он лёг.`); }
  } else if(r<0.41){
    // spawn bandit camp near edge
    if(world.bandits.length<6){
      const edge=Math.random()<0.5 ? 2 : world.size-3; const along=Math.floor(Math.random()*(world.size-10))+5;
      const bx = Math.random()<0.5? edge:along; const bz = Math.random()<0.5? along:edge;
      world.bandits.push({x:bx, z:bz, raidTimer: 20+Math.random()*25});
      log('Появился лагерь бандитов.');
    }
  }
}

// Caravan behavior --------------------------------------------
// Arrival effects ----------------------------------------------------
world.effects = [];
function spawnArrivalEffect(x,z){ world.effects.push({x,z,t:0,dur:0.9}); }

function pickTarget(c){
  const from = {x:c.x,z:c.z};
  let oasis = world.oases[Math.floor(Math.random()*world.oases.length)];
  if(world.oases.length>1){
    let tries=0; while(tries<12){
      const dx=oasis.x-from.x, dz=oasis.z-from.z; if((dx*dx+dz*dz) > 9) break; // require >3 tiles distance
      oasis = world.oases[Math.floor(Math.random()*world.oases.length)]; tries++;
    }
// (sky already initialized above)
  }
  // define control midpoint with lateral offset for curvature
  const mid = {x:(from.x+oasis.x)/2, z:(from.z+oasis.z)/2};
  const dx=oasis.x-from.x, dz=oasis.z-from.z; const len=Math.hypot(dx,dz);
  if(len>0){ const nx=-dz/len, nz=dx/len; const lateral = (Math.random()*0.4+0.2)*len; mid.x += nx*lateral*(Math.random()<0.5?1:-1); mid.z += nz*lateral*(Math.random()<0.5?1:-1); }
  // Build path points (quadratic bezier discretized) for smoother travel & easier route drawing
  const steps=36; const pts=[]; let dist=0; let last=null; for(let i=0;i<=steps;i++){ const t=i/steps; const a=1-t; const px=a*a*from.x + 2*a*t*mid.x + t*t*oasis.x; const pz=a*a*from.z + 2*a*t*mid.z + t*t*oasis.z; const py=sampleHeight(px, pz); if(last){ dist += Math.hypot(px-last.x,pz-last.z); }
    const node={x:px,z:pz,y:py,dist}; pts.push(node); last=node; }
  c.path=pts; c.pathLen=dist; c.t=0; c.state='travel'; }

function updateCaravan(c,dt){
  if(c.state==='idle'){
    if(Math.random()<0.02){ pickTarget(c); }
  } else if(c.state==='travel'){
  const speed = 3 + c.camels*0.1; c.t += speed*dt; if(c.t>=c.pathLen){ c.x=c.path[c.path.length-1].x; c.z=c.path[c.path.length-1].z; c.y= c.path[c.path.length-1].y; c.state='trade'; c.tradeTimer=1+Math.random()*1.5; logMsg('Caravan trading goods.'); spawnArrivalEffect(c.x,c.z); if(typeof playArrivalChime==='function') playArrivalChime(); }
    else {
      // find segment
      const pts=c.path; let i=1; while(i<pts.length && pts[i].dist < c.t) i++; const a=pts[i-1], b=pts[i]; const segT=(c.t-a.dist)/(b.dist-a.dist); c.x=a.x + (b.x-a.x)*segT; c.z=a.z + (b.z-a.z)*segT; c.y=a.y + (b.y-a.y)*segT; c.yaw = Math.atan2(b.z - a.z, b.x - a.x); }
  } else if(c.state==='trade'){
    c.tradeTimer -= dt; if(c.tradeTimer<=0){ world.money += 30 + c.camels*5; world.goods += 5 + Math.floor(Math.random()*5); c.state='idle'; logMsg('Trade complete. +goods +money'); }
  }
}

function updateBandits(dt){
  for(const b of world.bandits){
    b.raidTimer -= dt*world.speed;
    if(b.raidTimer<=0 && world.caravans.length){
      // pick nearest caravan
      let target=null, best=1e9; for(const c of world.caravans){ const d=Math.hypot(c.x-b.x, c.z-b.z); if(d<best){ best=d; target=c; } }
      if(target && Math.random()<0.6){
        const loss = Math.min(world.goods, Math.ceil(10+Math.random()*30)); world.goods-=loss; log(`Бандиты атаковали с лагеря: украли ${loss}.`);
      } else {
        log('Бандиты попытались атаковать, но караваны ушли.');
      }
      b.raidTimer = 35+Math.random()*30;
    }
  }
}

// Rendering data ----------------------------------------------
let worldMesh=null; let worldCount=0;
let farPlane=null; let farPlaneCount=0;
let backgroundMesh=null; let backgroundCount=0;
function buildWorldMesh(){
  const arr=[]; const step=2; const s=world.size;
  for(let z=0; z<s; z+=step){
    for(let x=0; x<s; x+=step){
      // Use center tile height (or average) for block
      let hAcc=0, oasisFlag=false, samples=0;
      for(let dz=0; dz<step; dz++) for(let dx=0; dx<step; dx++){
        const tx=x+dx, tz=z+dz; if(tx>=s||tz>=s) continue; const tile=world.tiles[tz*s+tx]; hAcc+=tile.h; samples++; if(tile.oasis) oasisFlag=true; }
      const baseH=(hAcc/(samples||1));
      const wx = x + step*0.5 - s/2;
      const wz = z + step*0.5 - s/2;
      // desert / oasis colors similar spectrum as background
      const desertCol=[0.70+Math.random()*0.03,0.60+Math.random()*0.03,0.44+Math.random()*0.03];
      const oasisCol=[0.12,0.42+Math.random()*0.1,0.24];
      const col = oasisFlag?oasisCol:desertCol;
      pushBox(arr, wx, baseH-0.6, wz, step, 1+baseH*0.35, step, col);
      if(oasisFlag){ // small water patch
        pushBox(arr, wx, baseH-0.15, wz, step*0.55, 0.12, step*0.55, [0.05,0.25,0.15]);
      }
    }
  }
  const f = new Float32Array(arr); worldMesh = makeVAO(f); worldCount = f.length/7; }
// Large distant flat sand plane to hide edges
function buildFarPlane(){
  const S=2000; // size
  const y=-1.2; // below terrain base
  const c=[0.74,0.63,0.46];
  // two triangles positions only -> expand to 7 floats (pos,color,shade)
  const verts=[
    -S,y,-S, c[0],c[1],c[2],0.9,  S,y,-S, c[0],c[1],c[2],0.9,  S,y, S, c[0],c[1],c[2],0.9,
    -S,y,-S, c[0],c[1],c[2],0.9,  S,y, S, c[0],c[1],c[2],0.9, -S,y, S, c[0],c[1],c[2],0.9
  ];
  const f=new Float32Array(verts); farPlane=makeVAO(f); farPlaneCount=f.length/7;
}
buildFarPlane();
// Low-res surrounding 8 chunks (ring) for background
function buildBackgroundMesh(){
  const arr=[]; const s=world.size; const step=2;
  for(let ox=-1; ox<=1; ox++) for(let oz=-1; oz<=1; oz++){
    if(ox===0 && oz===0) continue;
    for(let z=0; z<s; z+=step){
      for(let x=0; x<s; x+=step){
        const gx = x + ox*s; const gz = z + oz*s;
        const h = baseHeight(gx, gz);
        const wx = gx - s/2; const wz = gz - s/2;
        const seed = hash2d(gx, gz);
        const baseColor=[0.70+seed*0.05,0.60+seed*0.05,0.44+seed*0.04];
        pushBox(arr, wx+step*0.5, h-0.6, wz+step*0.5, step, 1+h*0.35, step, baseColor);
      }
    }
  }
  const f=new Float32Array(arr); backgroundMesh=makeVAO(f); backgroundCount=f.length/7;
}
buildBackgroundMesh();
// Height sampling helpers (tile coordinate space 0..size)
function getTile(x,z){ if(x<0||z<0||x>=world.size||z>=world.size) return {h:0}; return world.tiles[z*world.size + x]; }
function sampleHeight(tx,tz){
  const maxC = world.size - 2;
  const fx = Math.min(Math.max(tx,0), maxC+0.9999);
  const fz = Math.min(Math.max(tz,0), maxC+0.9999);
  const x = Math.floor(fx), z = Math.floor(fz);
  const lx = fx - x, lz = fz - z;
  const h00=getTile(x,z).h, h10=getTile(x+1,z).h, h01=getTile(x,z+1).h, h11=getTile(x+1,z+1).h;
  const h0 = h00 + (h10-h00)*lx;
  const h1 = h01 + (h11-h01)*lx;
  const h = h0 + (h1-h0)*lz;
  return 1.2*h - 0.05;
}

function makeVAO(floatData){
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, floatData, gl.STATIC_DRAW);
  const stride = 7*4; // 7 floats
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,stride,3*4);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,stride,6*4);
  return {vao, vbo};
}

buildWorldMesh();

// Simple camel + inn instances built per frame (few so fine) ----
let instMesh=null; let instCount=0;
function buildInstanced(){
  const arr=[]; // caravans camels
  for(const c of world.caravans){
    // ensure trail length matches camels
    if(!c.camelTrail) c.camelTrail=[];
  while(c.camelTrail.length < c.camels) c.camelTrail.push({offset:c.camelTrail.length*CAMEL_SPACING, x:c.x, z:c.z, y:sampleHeight(c.x,c.z), yaw:c.yaw, phase:Math.random()*Math.PI*2});
    // update per-camel positions along path if traveling
    if(c.state==='travel' && c.path){
      for(const camel of c.camelTrail){
        const targetDist = Math.max(0, c.t - camel.offset);
        const pts=c.path; let j=1; while(j<pts.length && pts[j].dist < targetDist) j++; const a=pts[Math.max(0,j-1)], b=pts[Math.min(pts.length-1,j)];
        if(!a||!b){ camel.x=c.x; camel.z=c.z; camel.y=c.y; camel.yaw=c.yaw; continue; }
        const span = (b.dist - a.dist)||1; const segT = Math.min(1, Math.max(0,(targetDist - a.dist)/span));
        camel.x = a.x + (b.x-a.x)*segT; camel.z = a.z + (b.z-a.z)*segT; camel.y = a.y + (b.y-a.y)*segT; const yawNow=Math.atan2(b.z-a.z, b.x-a.x);
        // smooth yaw interpolation
        const dy = ((yawNow - camel.yaw + Math.PI+Math.PI*4)%(Math.PI*2)) - Math.PI; camel.yaw += dy*0.2; // easing
      }
    } else {
      // idle / trade: keep them on terrain height
      for(const camel of c.camelTrail){ camel.y = sampleHeight(camel.x, camel.z); }
    }
    const time = performance.now()/1000; const traveling = (c.state==='travel');
    for(let i=0;i<c.camels;i++){
      const camel = c.camelTrail[i];
      let baseY = (camel.y||0) + 0.05;
      if(traveling){
        const bounce = Math.sin(time*8.0 + camel.phase*0.85)*0.025 + Math.sin(time*12.0 + camel.phase*1.37)*0.012;
        baseY += bounce;
      }
      pushCamel(arr, camel.x - world.size/2, (camel.y||0), camel.z - world.size/2, (camel.yaw||0), baseY, traveling?time:0, traveling?camel.phase:0, traveling?1:0);
    }
  }
  // inns
  for(const inn of world.inns){
    const h = sampleHeight(inn.x, inn.z);
    pushBox(arr, inn.x-world.size/2, h+0.2, inn.z-world.size/2, 1.2,1.2,1.2, [0.55,0.46,0.32]);
  }
  // houses (simple box + roof)
  for(const house of world.houses){
    const h=sampleHeight(house.x, house.z);
    pushBox(arr, house.x-world.size/2, h+0.35, house.z-world.size/2, 0.9,0.7,0.9, [0.52,0.43,0.28]);
    pushBox(arr, house.x-world.size/2, h+0.9, house.z-world.size/2, 0.95,0.25,0.95, [0.4,0.32,0.2]);
  }
  // trees (palm: trunk + leaves cluster)
  const time=performance.now()/1000;
  for(const tree of world.trees){
    const baseH = sampleHeight(tree.x, tree.z);
    const sway = Math.sin(time*0.6 + tree.swayPhase)*0.15;
    // trunk (slight lean with sway)
    pushBox(arr, tree.x-world.size/2 + sway*0.2, baseH+0.9, tree.z-world.size/2, 0.25,1.8,0.25, [0.35,0.23,0.12]);
    // leaves (three layers)
    pushBox(arr, tree.x-world.size/2, baseH+1.9, tree.z-world.size/2, 1.4,0.15,1.4, [0.07,0.35,0.18]);
    pushBox(arr, tree.x-world.size/2, baseH+2.05, tree.z-world.size/2, 1.0,0.12,1.0, [0.06,0.32,0.16]);
    pushBox(arr, tree.x-world.size/2, baseH+2.18, tree.z-world.size/2, 0.7,0.1,0.7, [0.05,0.28,0.14]);
  }
  // bandits
  for(const b of world.bandits){
    const h = sampleHeight(b.x, b.z);
    pushBox(arr, b.x-world.size/2, h+0.15, b.z-world.size/2, 1,0.6,1,[0.3,0.1,0.1]);
    pushBox(arr, b.x-world.size/2, h+0.9, b.z-world.size/2, 0.4,0.8,0.4,[0.2,0.05,0.05]);
  }
  const f = new Float32Array(arr); instMesh = makeVAO(f); instCount = f.length/7; return {mesh:instMesh, count:instCount};
}

// Route geometry (simple short segments along path) -----------
// Route rendering now as smooth line strips
function renderRoutes(){
  const routeColor = [0.88,0.35,0.06]; // warm orange
  for(const c of world.caravans){
    if(!c.path || c.path.length<2 || c.state!=='travel') continue;
    const arr=[];
    for(const p of c.path){
      const x = p.x - world.size/2;
      const z = p.z - world.size/2;
  const y = p.y + 0.15; // slight lift over ground after corrected sampling
      // position + color + shade
      arr.push(x,y,z, routeColor[0],routeColor[1],routeColor[2], 0.8);
    }
    const f = new Float32Array(arr);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, f, gl.DYNAMIC_DRAW);
    const stride=7*4; gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,stride,3*4);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,stride,6*4);
    gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident()));
    gl.drawArrays(gl.LINE_STRIP,0,f.length/7);
  }
}

// Effects rendering (arrival rings)
function renderEffects(){
  const nowEffects=[]; // keep survivors
  if(!world.effects) return; 
  for(const e of world.effects){
    e.t += 1/60; // approximate (could pass dt)
    const p = e.t / e.dur; if(p>=1) continue; nowEffects.push(e);
    const arr=[]; const ringSegs=14; const radius = 0.2 + p*1.8; const y = sampleHeight(e.x,e.z)+0.3 + p*0.4;
    for(let i=0;i<ringSegs;i++){
      const a0 = (i/ringSegs)*Math.PI*2; const a1=((i+1)/ringSegs)*Math.PI*2;
      const mx = ((Math.cos(a0)+Math.cos(a1))*0.5)*radius; const mz=((Math.sin(a0)+Math.sin(a1))*0.5)*radius;
      // thin upright marker segment
      pushBox(arr, e.x + mx - world.size/2, y, e.z + mz - world.size/2, 0.12,0.12,0.12,[1.0,0.85,0.3]);
    }
    const f=new Float32Array(arr); const vao=gl.createVertexArray(); gl.bindVertexArray(vao); const vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vbo); gl.bufferData(gl.ARRAY_BUFFER,f,gl.DYNAMIC_DRAW);
    const stride=7*4; gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,stride,3*4); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,stride,6*4);
    gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident())); gl.drawArrays(gl.TRIANGLES,0,f.length/7);
  }
  world.effects = nowEffects;
}

// Input & UI ---------------------------------------------------
const input = new Input();
function resize(){ canvas.width=window.innerWidth; canvas.height=window.innerHeight; gl.viewport(0,0,canvas.width,canvas.height); }
window.addEventListener('resize', resize); resize();
document.getElementById('buyCamel').onclick=()=>{ if(world.money>=50){
  // find caravan with least camels under cap
  let target=null; for(const c of world.caravans){ if(c.camels < CAMEL_MAX && (!target || c.camels < target.camels)) target=c; }
  if(!target){ log('Нельзя купить: все караваны заполнены (лимит '+CAMEL_MAX+').'); return; }
  world.money-=50; target.camels++; target.faces.push(makeFaceSeed());
  // add camel trail entry
  target.camelTrail.push({offset:(target.camelTrail.length)*CAMEL_SPACING, x:target.x, z:target.z, y:sampleHeight(target.x,target.z), yaw:target.yaw, phase:Math.random()*Math.PI*2});
  log(`Куплен верблюд. Караван #${target.id}: ${target.camels}.`);} };
document.getElementById('buyCaravan').onclick=()=>{ if(world.money>=300){ world.money-=300; newCaravan(); }};
document.getElementById('buildInn').onclick=()=>{ if(world.money>=200){ world.money-=200; const oasis=world.oases[Math.floor(Math.random()*world.oases.length)]; world.inns.push({x:oasis.x,z:oasis.z}); log(`Построен караван-сарай.`);} };

function updateUI(){
  const avgHyd = world.caravans.length? (world.caravans.reduce((a,c)=>a+c.hydration,0)/world.caravans.length)*100:0;
  document.getElementById('stats').innerHTML = `Money: ${Math.floor(world.money)}<br/>Goods store: ${world.goods}<br/>Caravans: ${world.caravans.length}<br/>Camels total: ${world.caravans.reduce((a,c)=>a+c.camels,0)}<br/>Avg hydration: ${avgHyd.toFixed(0)}%<br/>Inns: ${world.inns.length}<br/>Day: ${(world.day/24).toFixed(1)}<br/>${world.paused?'<b>PAUSED</b>':''}`;
  // Buttons enable
  document.getElementById('buyCamel').disabled = world.money<50;
  document.getElementById('buyCaravan').disabled = world.money<300;
  document.getElementById('buildInn').disabled = world.money<200;
  // Legend
  const legend = document.getElementById('legend');
  legend.innerHTML = ''+
    `<div class="row"><div class="sw" style="background:#cfa968"></div><span>Пустыня</span></div>`+
    `<div class="row"><div class="sw" style="background:#1e5f38"></div><span>Оазис</span></div>`+
    `<div class="row"><div class="sw" style="background:#e15a10"></div><span>Маршрут</span></div>`+
    `<div class="row"><div class="sw" style="background:#b48a60"></div><span>Караван (${world.caravans.length})</span></div>`+
    `<div class="row"><div class="sw" style="background:#8c7a6a"></div><span>Инн (${world.inns.length})</span></div>`+
    `<div class="row"><div class="sw" style="background:#46221a"></div><span>Бандиты (${world.bandits.length})</span></div>`;
}

// Game loop ----------------------------------------------------
const loop = new GameLoop();
let perf=0, evtTimer=15; let pWas=false; // for pause toggle debounce
loop.onUpdate(dt=>{
  if((input.keys['p']||input.keys['P']) && !pWas){ world.paused=!world.paused; log(world.paused? 'Пауза.' : 'Продолжаем.'); }
  pWas = (input.keys['p']||input.keys['P']);
  if(world.paused){ updateUI(); return; }
  const mult = input.keys[' ']?2:1; dt*=mult;
  // camera movement
  // Orbit camera planar movement: W/S forward/back, A/D strafe, arrows rotate/tilt, wheel for zoom
  // Use code-based lookup (prevents Shift sticking / layout issues)
  const forward = input.isDown('KeyW'); const back=input.isDown('KeyS');
  // Fix swapped A/D directions by keeping semantic mapping (A = left, D = right)
  const left=input.isDown('KeyA'); const right=input.isDown('KeyD');
  const run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
  const arrowL=input.isDown('ArrowLeft'); const arrowR=input.isDown('ArrowRight'); const arrowU=input.isDown('ArrowUp'); const arrowD=input.isDown('ArrowDown');
  const moveSpeed = (run?1.8:1) * dt; // scaling for acceleration-based motion
  if(arrowL) orbit.yaw -= dt*0.6; // align with mouse direction (right arrow turns right)
  if(arrowR) orbit.yaw += dt*0.6;
  if(arrowU) { orbit.pitch += dt*0.6; orbit.pitch=Math.max(orbit.minPitch, Math.min(orbit.maxPitch, orbit.pitch)); }
  if(arrowD) { orbit.pitch -= dt*0.6; orbit.pitch=Math.max(orbit.minPitch, Math.min(orbit.maxPitch, orbit.pitch)); }
  // derive forward on ground
  // derive camera position to get forward-to-center vector
  const cy=Math.cos(orbit.yaw), sy=Math.sin(orbit.yaw); const cp=Math.cos(orbit.pitch), sp=Math.sin(orbit.pitch);
  const camX = orbit.center.x + orbit.dist * sy * cp;
  const camZ = orbit.center.z + orbit.dist * (-cy) * cp;
  // forward on ground from camera looking toward center
  let fdx = (orbit.center.x - camX); let fdz = (orbit.center.z - camZ); const fl=Math.hypot(fdx,fdz)||1; fdx/=fl; fdz/=fl;
  const rdx = fdz; const rdz = -fdx;
  let ax=0,az=0; if(forward){ax+=fdx; az+=fdz;} if(back){ax-=fdx; az-=fdz;} // strafe (fixed inversion)
  if(left){ax+=rdx; az+=rdz;} if(right){ax-=rdx; az-=rdz;}
  const al=Math.hypot(ax,az); if(al>0){ ax/=al; az/=al; }
  camVel.x += ax*camAccel*moveSpeed; camVel.z += az*camAccel*moveSpeed;
  camVel.x -= camVel.x*camFriction*dt; camVel.z -= camVel.z*camFriction*dt;
  orbit.center.x += camVel.x*dt; orbit.center.z += camVel.z*dt;
  const half=world.size/2 - 4; orbit.center.x=Math.max(-half, Math.min(half, orbit.center.x)); orbit.center.z=Math.max(-half, Math.min(half, orbit.center.z));

  perf+=dt; world.day += dt*0.25 * world.speed; // 4s per hour
  for(const c of world.caravans) updateCaravan(c, dt);
  updateBandits(dt);
  // Hydration system: drain, refill, camel death
  for(const c of world.caravans){
    if(c.state==='stranded') continue;
    const travelMul = (c.state==='travel')?1.0:0.4; // traveling dehydrates faster
    c.hydration -= dt*0.02 * travelMul * (1 + (c.camels*0.02));
    // Refill near oasis (faster if inn also present)
    let nearOasis=false; for(const o of world.oases){ if(Math.hypot(c.x-o.x, c.z-o.z) < 3.6){ nearOasis=true; break; } }
    let nearInn=false; for(const inn of world.inns){ if(Math.hypot(c.x-inn.x, c.z-inn.z) < 4.2){ nearInn=true; break; } }
    if(nearOasis){ c.hydration += dt * (nearInn?0.6:0.35); }
    if(c.hydration>1) c.hydration=1; if(c.hydration<0) c.hydration=0;
    if(c.hydration===0 && c.camels>0 && c.state==='travel'){
      c.dehydrateTimer += dt;
      if(c.dehydrateTimer>=6){
        c.dehydrateTimer=0; c.camels--; c.faces.pop();
        log(`Верблюд каравана #${c.id} погиб от жажды.`);
        if(c.camels===0){ c.state='stranded'; log(`Караван #${c.id} обезвожен и застрял.`); }
      }
    } else {
      c.dehydrateTimer=0;
    }
  }
  evtTimer -= dt; if(evtTimer<=0){ randomEvent(); evtTimer = 10 + Math.random()*15; }
  // Game over check
  if(world.caravans.every(c=>c.camels===0) && world.money<300){ log('GAME OVER: пешком по пескам.'); world.paused=true; }
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
  // world
  gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident()));
  gl.bindVertexArray(worldMesh.vao); gl.drawArrays(gl.TRIANGLES,0,worldCount);
  // background ring
  if(backgroundMesh){ gl.bindVertexArray(backgroundMesh.vao); gl.drawArrays(gl.TRIANGLES,0,backgroundCount); }
  // far plane
  gl.bindVertexArray(farPlane.vao); gl.drawArrays(gl.TRIANGLES,0,farPlaneCount);
  // routes as curves
  gl.lineWidth(2);
  renderRoutes();
  // dynamic entities
  const inst=buildInstanced(); gl.bindVertexArray(inst.mesh.vao); gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident())); gl.drawArrays(gl.TRIANGLES,0,inst.count);
  // effects
  renderEffects();
  // bandits simple markers
  if(world.bandits.length){
    const arr=[]; for(const b of world.bandits){ pushBox(arr, b.x-world.size/2, 0.15, b.z-world.size/2, 0.9,0.4,0.9,[0.28,0.12,0.08]); pushBox(arr, b.x-world.size/2,0.55,b.z-world.size/2,0.25,0.5,0.25,[0.4,0.18,0.12]); }
    const f=new Float32Array(arr); const m=makeVAO(f); gl.bindVertexArray(m.vao); gl.drawArrays(gl.TRIANGLES,0,f.length/7);
  }
});
loop.start();

log('Добро пожаловать в пустыню. Начинаем торговлю.');

// Simple quiet single-line desert melody (no drones, no polyphony) -----------------
try {
  const AC = window.AudioContext || window.webkitAudioContext; const actx = new AC(); let started=false;
  const master = actx.createGain(); master.gain.value=0.18; master.connect(actx.destination);
  window.__audio={actx, master, muted:false};
  // Very light space (single feedback delay)
  const delay = actx.createDelay(); delay.delayTime.value=0.28; const fb=actx.createGain(); fb.gain.value=0.25; delay.connect(fb).connect(delay); delay.connect(master);
  function note(freq, dur){
    const o=actx.createOscillator(); o.type='sine';
    const g=actx.createGain(); const t=actx.currentTime; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.9,t+0.02); g.gain.linearRampToValueAtTime(0.7,t+0.08); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    const filt=actx.createBiquadFilter(); filt.type='lowpass'; filt.frequency.value=freq*3; filt.Q.value=0.5;
    o.frequency.value=freq; o.connect(filt).connect(g); g.connect(master); g.connect(delay); o.start(t); o.stop(t+dur+0.1);
  }
  const root=196; // G3
  const scale=[0,2,3,5,7,10]; // G minor-ish pentatonic with added 10
  // Base melodic pattern (semitone offsets)
  const phrase=[0,2,3,5,3,2,0,5,7,5,3,2];
  function freqFromSemi(semi){ return root*Math.pow(2, semi/12); }
  function startMusic(){ if(started) return; started=true; let idx=0; function step(){
      const semi = phrase[idx % phrase.length] + (Math.random()<0.15?12:0); // rare octave jump
      const f = freqFromSemi(semi);
      const dur = 0.9 + Math.random()*0.4; // slight variation
      note(f,dur);
      idx++;
      const gap = 650 + Math.random()*250; // ms
      setTimeout(step, gap);
    } step(); }
  window.addEventListener('click', startMusic, {once:true});
  // Sound toggle button
  const btn=document.getElementById('toggleSound');
  if(btn){
    btn.addEventListener('click', ()=>{
      const a=window.__audio; if(!a) return; a.muted=!a.muted; master.gain.value = a.muted?0:0.18; btn.textContent = a.muted? 'Unmute' : 'Mute';
    });
  }
  // arrival chime
  window.playArrivalChime = function(){
    const t=actx.currentTime; const g=actx.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.6,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.6); g.connect(master);
    const o1=actx.createOscillator(); o1.type='triangle'; o1.frequency.setValueAtTime(392,t); // G4
    const o2=actx.createOscillator(); o2.type='sine'; o2.frequency.setValueAtTime(523.25,t); // C5
    o1.connect(g); o2.connect(g); o1.start(t); o2.start(t); o1.stop(t+0.6); o2.stop(t+0.6);
  };
} catch(e){ }
