export class GameLoop {
  constructor(){
    this.last = performance.now();
    this._running = false;
    this._updateHandlers = [];
    this._renderHandlers = [];
  }
  onUpdate(fn){ this._updateHandlers.push(fn); }
  onRender(fn){ this._renderHandlers.push(fn); }
  start(){ if(this._running) return; this._running = true; requestAnimationFrame(this._tick.bind(this)); }
  stop(){ this._running = false; }
  _tick(now){
    if(!this._running) return;
    const dt = (now - this.last)/1000;
    this.last = now;
    for(const fn of this._updateHandlers) fn(dt);
    for(const fn of this._renderHandlers) fn();
    requestAnimationFrame(this._tick.bind(this));
  }
}
