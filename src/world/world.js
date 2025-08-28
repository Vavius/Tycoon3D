// World generation & entity helpers extracted from main.js
import { GOODS } from '../economy/market.js';
import { ident } from '../math/matrix.js';

export const world = { size:64, tiles:[], oases:[], inns:[], caravans:[], houses:[], trees:[], money:400, goods:0, day:0, speed:1, paused:false, cities:[], totalProfit:0, lastTradeProfit:0 };
world.__log = (msg)=>console.log(msg);
world.bandits = [];

// --- Utility sampling (duplicated small helpers kept local) ---
function hash2d(x,z){ return (Math.sin(x*12.9898 + z*78.233)*43758.5453)%1; }
export function baseHeight(x,z){
  const h1 = (Math.sin(x*0.32)+Math.cos(z*0.29))*0.30;
  const h2 = (Math.sin(x*0.06)*Math.cos(z*0.05))*0.25;
  const n = (hash2d(x,z)-0.5)*0.10; return h1 + h2 + n;
}

export function genWorld(){
  const s=world.size; world.tiles=[]; world.oases=[]; world.houses=[]; world.trees=[];
  const chosenCenters=[]; const MIN_OASIS_DIST=10; function farEnough(nx,nz){ for(const c of chosenCenters){ const dx=c.x-nx, dz=c.z-nz; if(dx*dx+dz*dz < MIN_OASIS_DIST*MIN_OASIS_DIST) return false; } return true; }
  for(let z=0; z<s; z++) for(let x=0; x<s; x++){ const h=baseHeight(x,z); world.tiles.push({x,z,h,oasis:false}); }
  for(let i=0;i<s*s;i++){ if(Math.random()<0.0025){ const x=i%s, z=Math.floor(i/s); if(x<3||z<3||x>=s-3||z>=s-3) continue; if(!farEnough(x,z)) continue; chosenCenters.push({x,z}); } }
  if(chosenCenters.length<3){ for(let i=chosenCenters.length;i<3;i++){ let nx, nz, tries=0; do { nx=Math.floor(Math.random()*(s-10))+5; nz=Math.floor(Math.random()*(s-10))+5; tries++; } while(!farEnough(nx,nz)&&tries<120); chosenCenters.push({x:nx,z:nz}); } }
  const radius=3; for(const c of chosenCenters){ world.oases.push(c); for(let dz=-radius; dz<=radius; dz++) for(let dx=-radius; dx<=radius; dx++){ const tx=c.x+dx, tz=c.z+dz; if(tx<0||tz<0||tx>=s||tz>=s) continue; const d=Math.hypot(dx,dz); if(d>radius+0.4) continue; const tile=world.tiles[tz*s+tx]; tile.oasis=true; } }
  for(const c of world.oases){ const houseCount=1+(Math.random()<0.5?1:0); for(let h=0; h<houseCount; h++){ const ang=Math.random()*Math.PI*2; const dist=1.5+Math.random()*1.8; world.houses.push({x:c.x+Math.cos(ang)*dist, z:c.z+Math.sin(ang)*dist}); } const treeCount=3+Math.floor(Math.random()*4); for(let t=0;t<treeCount;t++){ const ang=Math.random()*Math.PI*2; const dist=1+Math.random()*2.5; world.trees.push({x:c.x+Math.cos(ang)*dist, z:c.z+Math.sin(ang)*dist, swayPhase:Math.random()*Math.PI*2}); } }
  world.cities = world.oases.map((o,i)=>({ id:'city'+i, name: randomCityName(), x:o.x, z:o.z, stocks:Object.fromEntries(Object.keys(GOODS).map(k=>[k, GOODS[k].baseStock])), prices:{}, flows:{}, role:null, focus:null, prevPrices:{}, priceHist:{} }));
  const goodsKeys=Object.keys(GOODS);
  const ROLES={ PRODUCER:{label:'Производитель', prodFocus:0.028, consFocus:0.006, prodOther:0.006, consOther:0.010}, CONSUMER:{label:'Потребитель', prodFocus:0.006, consFocus:0.028, prodOther:0.004, consOther:0.016}, HUB:{label:'Хаб', prodFocus:0.014, consFocus:0.014, prodOther:0.010, consOther:0.012}, SCARCE:{label:'Дефицит', prodFocus:0.004, consFocus:0.020, prodOther:0.003, consOther:0.017} }; const roleCycle=['PRODUCER','CONSUMER','HUB','PRODUCER','SCARCE'];
  world.cities.forEach((city, idx)=>{ city.role=roleCycle[idx%roleCycle.length]; city.focus=goodsKeys[idx%goodsKeys.length]; goodsKeys.forEach(gid=>{ city.flows[gid]={prod:0,cons:0}; }); const r=ROLES[city.role]; goodsKeys.forEach(gid=>{ const cap=GOODS[gid].capacity; const focus=gid===city.focus; const prodRate=focus?r.prodFocus:r.prodOther; const consRate=focus?r.consFocus:r.consOther; city.flows[gid].prod=cap*prodRate; city.flows[gid].cons=cap*consRate; }); });
  const targetDeltaRatio=-0.002; goodsKeys.forEach(gid=>{ const cap=GOODS[gid].capacity; let net=0; world.cities.forEach(c=>{ net+=c.flows[gid].prod - c.flows[gid].cons; }); const totalCap=cap*world.cities.length; const desiredNet=totalCap*targetDeltaRatio; if(Math.abs(net)>1e-6){ const scale=desiredNet/net; world.cities.forEach(c=>{ c.flows[gid].prod*=scale; }); } });
}

export function randomCityName(){
  const starts=['Аль','Эль','Ба','Ка','На','Ра','Та','За','Аш','Ис','Оу'];
  const mids=['ра','ри','ру','ша','сса','фра','дара','хан','му','зир','лам','бар','тал'];
  const ends=['ум','ад','ар','ун','им','ах','еш','ор','ет','ам','ур'];
  return (starts[Math.floor(Math.random()*starts.length)]+mids[Math.floor(Math.random()*mids.length)]+(Math.random()<0.7? ends[Math.floor(Math.random()*ends.length)] : '')).replace(/(.)(.+)/,(m,a,b)=>a+b);
}

let caravanId=1; function makeFaceSeed(){ const eyes=["^ ^","• •","- -","o o","x x"][Math.floor(Math.random()*5)]; const mouth=["_","~","ᵕ","д","︿"][Math.floor(Math.random()*5)]; return eyes+mouth; }
export function newCaravan(){ const oasis=world.oases[Math.floor(Math.random()*world.oases.length)]; const c={ id:caravanId++, x:oasis.x, z:oasis.z, camels:2, guardReliability:0.55, goods:0, target:null, timer:0, state:'idle', hydration:1, dehydrateTimer:0, faces:[], start:{x:oasis.x,z:oasis.z}, progress:0, speed:(3+Math.random()*1.5), yaw:0, camelTrail:[], cargo:{ spice:{qty:0,avg:0}, cloth:{qty:0,avg:0}, ore:{qty:0,avg:0} } }; c.faces.push(makeFaceSeed()); c.camelTrail=[{offset:0,x:c.x,z:c.z,y:sampleHeight(c.x,c.z),yaw:0,phase:Math.random()*Math.PI*2}]; world.caravans.push(c); return c; }

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
  place(0.85, 0.95, 0, 0.35,0.7,0.35, colorBody); place(1.05, 1.25, 0, 0.35,0.35,0.35, colorHead);
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
  for(const c of world.caravans){ if(!c.camelTrail) c.camelTrail=[]; while(c.camelTrail.length < c.camels) c.camelTrail.push({offset:c.camelTrail.length*CAMEL_SPACING, x:c.x, z:c.z, y:sampleHeight(c.x,c.z), yaw:c.yaw, phase:Math.random()*Math.PI*2}); if(c.state==='travel' && c.path){ for(const camel of c.camelTrail){ const targetDist=Math.max(0,c.t - camel.offset); const pts=c.path; let j=1; while(j<pts.length && pts[j].dist < targetDist) j++; const a=pts[Math.max(0,j-1)], b=pts[Math.min(pts.length-1,j)]; if(!a||!b){ camel.x=c.x; camel.z=c.z; camel.y=c.y; camel.yaw=c.yaw; continue; } const span=(b.dist - a.dist)||1; const segT=Math.min(1, Math.max(0,(targetDist - a.dist)/span)); camel.x=a.x + (b.x-a.x)*segT; camel.z=a.z + (b.z-a.z)*segT; camel.y=a.y + (b.y-a.y)*segT; const yawNow=Math.atan2(b.z-a.z, b.x-a.x); const dy=((yawNow - camel.yaw + Math.PI+Math.PI*4)%(Math.PI*2)) - Math.PI; camel.yaw += dy*0.2; } } else { for(const camel of c.camelTrail){ camel.y = sampleHeight(camel.x, camel.z); } } const time=performance.now()/1000; const traveling=(c.state==='travel'); for(let i=0;i<c.camels;i++){ const camel=c.camelTrail[i]; let baseY=(camel.y||0)+0.05; if(traveling){ const bounce=Math.sin(time*8.0 + camel.phase*0.85)*0.025 + Math.sin(time*12.0 + camel.phase*1.37)*0.012; baseY += bounce; } pushCamel(arr, camel.x - world.size/2, (camel.y||0), camel.z - world.size/2, (camel.yaw||0), baseY, traveling?time:0, traveling?camel.phase:0, traveling?1:0); } }
  for(const inn of world.inns){ const h=sampleHeight(inn.x, inn.z); pushBox(arr, inn.x-world.size/2, h+0.2, inn.z-world.size/2, 1.2,1.2,1.2, [0.55,0.46,0.32]); }
  for(const house of world.houses){ const h=sampleHeight(house.x, house.z); pushBox(arr, house.x-world.size/2, h+0.35, house.z-world.size/2, 0.9,0.7,0.9, [0.52,0.43,0.28]); pushBox(arr, house.x-world.size/2, h+0.9, house.z-world.size/2, 0.95,0.25,0.95, [0.4,0.32,0.2]); }
  const time=performance.now()/1000; for(const tree of world.trees){ const baseH=sampleHeight(tree.x, tree.z); const sway=Math.sin(time*0.6 + tree.swayPhase)*0.15; pushBox(arr, tree.x-world.size/2 + sway*0.2, baseH+0.9, tree.z-world.size/2, 0.25,1.8,0.25, [0.35,0.23,0.12]); pushBox(arr, tree.x-world.size/2, baseH+1.9, tree.z-world.size/2, 1.4,0.15,1.4, [0.07,0.35,0.18]); pushBox(arr, tree.x-world.size/2, baseH+2.05, tree.z-world.size/2, 1.0,0.12,1.0, [0.06,0.32,0.16]); pushBox(arr, tree.x-world.size/2, baseH+2.18, tree.z-world.size/2, 0.7,0.1,0.7, [0.05,0.28,0.14]); }
  for(const b of world.bandits){ const h=sampleHeight(b.x,b.z); pushBox(arr, b.x-world.size/2, h+0.15, b.z-world.size/2, 1,0.6,1,[0.3,0.1,0.1]); pushBox(arr, b.x-world.size/2, h+0.9, b.z-world.size/2, 0.4,0.8,0.4,[0.2,0.05,0.05]); }
  const f=new Float32Array(arr); const mesh=makeVAO(gl,f); return {mesh, count:f.length/7};
}

function renderRoutes(gl, program){
  const routeColor=[0.88,0.35,0.06]; for(const c of world.caravans){ if(!c.path || c.path.length<2 || c.state!=='travel') continue; const arr=[]; for(const p of c.path){ const x=p.x - world.size/2; const z=p.z - world.size/2; const y=p.y + 0.15; arr.push(x,y,z, routeColor[0],routeColor[1],routeColor[2], 0.8); } const f=new Float32Array(arr); const vao=gl.createVertexArray(); gl.bindVertexArray(vao); const vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vbo); gl.bufferData(gl.ARRAY_BUFFER,f,gl.DYNAMIC_DRAW); const stride=7*4; gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,stride,3*4); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,stride,6*4); gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident())); gl.drawArrays(gl.LINE_STRIP,0,f.length/7); }
}

function renderEffects(gl, program){
  const nowEffects=[]; if(!world.effects) return; for(const e of world.effects){ e.t += 1/60; const p=e.t/e.dur; if(p>=1){ continue; } else nowEffects.push(e); const arr=[]; const segs=14; const radius=0.2 + p*1.8; const y=sampleHeight(e.x,e.z)+0.3 + p*0.4; for(let i=0;i<segs;i++){ const a0=(i/segs)*Math.PI*2; const a1=((i+1)/segs)*Math.PI*2; const mx=((Math.cos(a0)+Math.cos(a1))*0.5)*radius; const mz=((Math.sin(a0)+Math.sin(a1))*0.5)*radius; pushBox(arr, e.x + mx - world.size/2, y, e.z + mz - world.size/2, 0.12,0.12,0.12,[1.0,0.85,0.3]); } const f=new Float32Array(arr); const vao=gl.createVertexArray(); gl.bindVertexArray(vao); const vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vbo); gl.bufferData(gl.ARRAY_BUFFER,f,gl.DYNAMIC_DRAW); const stride=7*4; gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,stride,3*4); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,stride,6*4); gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident())); gl.drawArrays(gl.TRIANGLES,0,f.length/7); }
  world.effects=nowEffects;
}

export function initWorldGeometry(gl){ buildWorldMesh(gl); buildFarPlane(gl); buildBackgroundMesh(gl); }

export function renderWorldScene(gl, program){
  const wr=worldRender; gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident()));
  if(wr.worldMesh){ gl.bindVertexArray(wr.worldMesh.vao); gl.drawArrays(gl.TRIANGLES,0,wr.worldCount); }
  if(wr.backgroundMesh){ gl.bindVertexArray(wr.backgroundMesh.vao); gl.drawArrays(gl.TRIANGLES,0,wr.backgroundCount); }
  if(wr.farPlane){ gl.bindVertexArray(wr.farPlane.vao); gl.drawArrays(gl.TRIANGLES,0,wr.farPlaneCount); }
  gl.lineWidth(2); renderRoutes(gl, program);
  const inst=buildInstanced(gl); gl.bindVertexArray(inst.mesh.vao); gl.uniformMatrix4fv(gl.getUniformLocation(program,'uModel'),false,new Float32Array(ident())); gl.drawArrays(gl.TRIANGLES,0,inst.count); renderEffects(gl, program);
}
