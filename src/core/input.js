export class Input {
  constructor(){
    this.keys = {};
    const capture = ['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyP'];
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
    window.addEventListener('blur', () => { // avoid stuck keys when window loses focus while pressed
      this.keys = {};
    });
  }
  isDown(code){ return !!this.keys[code]; }
}
