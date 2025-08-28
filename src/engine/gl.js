export function createGLContext(canvas){
  const gl = canvas.getContext('webgl2');
  if(!gl) throw new Error('WebGL2 not supported');
  return gl;
}

export function compileShader(gl, type, source){
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('Shader compile failed: '+info+'\n'+source);
  }
  return s;
}

export function createProgram(gl, vsSource, fsSource){
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
    const info = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('Program link failed: '+info);
  }
  return p;
}
