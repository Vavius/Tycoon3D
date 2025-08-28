// Shared math helpers extracted from main.js
// Provides minimal matrix & transform helpers for 4x4 matrices (column-major arrays of length 16)

export function perspective(fovy, aspect, near, far){
  const f = 1/Math.tan(fovy/2); const nf = 1/(near-far);
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,(2*far*near)*nf,0];
}
export function ident(){ return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
export function mul(a,b){ const r=new Array(16).fill(0); for(let i=0;i<4;i++) for(let j=0;j<4;j++) for(let k=0;k<4;k++) r[i*4+j]+=a[i*4+k]*b[k*4+j]; return r; }
export function translate(x,y,z){ const m=ident(); m[12]=x; m[13]=y; m[14]=z; return m; }
export function scale(x,y,z){ return [x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]; }
export function rotY(a){ const c=Math.cos(a),s=Math.sin(a); return [c,0,s,0, 0,1,0,0, -s,0,c,0, 0,0,0,1]; }
export function rotX(a){ const c=Math.cos(a),s=Math.sin(a); return [1,0,0,0, 0,c,-s,0, 0,s,c,0, 0,0,0,1]; }
