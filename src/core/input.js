export class Input {
  constructor(){
    this.keys = {};
  const capture = ['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyP'];
    const clear = ()=>{ this.keys = {}; };
    window.addEventListener('keydown', e => {
      const k = e.code || e.key;
      this.keys[k] = true; // primary by code
      this.keys[e.key] = true; // legacy (case-sensitive letters)
      if(capture.includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      const k = e.code || e.key;
      this.keys[k] = false;
      this.keys[e.key] = false;
      if(capture.includes(k)) e.preventDefault();
    });
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', ()=>{ if(document.hidden) clear(); });
    window.addEventListener('contextmenu', ()=>{ // right-click menu can swallow keyup
      clear();
    });
  }
  isDown(code){ return !!this.keys[code]; }
}
