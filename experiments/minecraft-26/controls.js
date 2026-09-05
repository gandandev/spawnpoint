(() => {
  const touch = (navigator.maxTouchPoints > 0 && matchMedia('(pointer:coarse)').matches) || new URLSearchParams(location.search).get('touch') === '1';
  if (!touch) return;
  let locked = null;
  const held = new Map(), gestures = new Map();
  const mouseButtons = new Set();
  const canvas = () => document.querySelector('#game canvas');
  const controls = document.createElement('div');
  document.body.append(controls);
  function keyboard(code, keyCode, key, down) {
    (canvas() || window).dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, keyCode, which: keyCode, key, bubbles: true, cancelable: true }));
  }
  function mouse(type, button, x, y, dx = 0, dy = 0) {
    const target = canvas();
    if (!target) return;
    if (type === 'mousedown') mouseButtons.add(button);
    if (type === 'mouseup') mouseButtons.delete(button);
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button,
      buttons: (mouseButtons.has(0) ? 1 : 0) | (mouseButtons.has(2) ? 2 : 0),
      clientX: x, clientY: y, movementX: dx, movementY: dy });
    Object.defineProperties(event, { movementX: { value: dx }, movementY: { value: dy } });
    target.dispatchEvent(event);
  }
  function releaseAll() {
    for (const action of held.values()) action(false);
    for (const gesture of gestures.values()) if (!gesture.look) mouse('mouseup', 0, gesture.x, gesture.y);
    held.clear(); gestures.clear();
  }
  function setLock(element) {
    releaseAll(); locked = element;
    controls.querySelectorAll('[data-gameplay]').forEach(button => { button.hidden = !locked; });
    document.dispatchEvent(new Event('pointerlockchange'));
  }
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
  Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: () => setLock(null) });
  Object.defineProperty(Element.prototype, 'requestPointerLock', { configurable: true, value() { setLock(this); return Promise.resolve(); } });
  function button(label, action, left, bottom, gameplay = true) {
    const node = document.createElement('button');
    node.textContent = label; node.setAttribute('aria-label', label);
    if (gameplay) { node.dataset.gameplay = ''; node.hidden = !locked; }
    node.style.cssText = `position:fixed;${left < 0 ? 'right' : 'left'}:${Math.abs(left)}px;bottom:${bottom}px;width:52px;height:46px;z-index:20;touch-action:none;background:#222b;color:white;border:1px solid #fff8;border-radius:8px;font:14px system-ui;user-select:none`;
    node.addEventListener('pointerdown', event => {
      event.preventDefault(); node.setPointerCapture(event.pointerId);
      held.set(event.pointerId, action); action(true);
    });
    const release = event => { const action = held.get(event.pointerId); if (action) { action(false); held.delete(event.pointerId); } };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) node.addEventListener(type, release);
    controls.append(node);
  }
  for (const [label, code, keyCode, key, left, bottom] of [
    ['W', 'KeyW', 87, 'w', 70, 134], ['A', 'KeyA', 65, 'a', 12, 82],
    ['S', 'KeyS', 83, 's', 70, 82], ['D', 'KeyD', 68, 'd', 128, 82],
    ['점프', 'Space', 32, ' ', -70, 134],
    ['웅크림', 'ShiftLeft', 16, 'Shift', 12, 186],
  ]) button(label, down => keyboard(code, keyCode, key, down), left, bottom);
  button('ESC', down => keyboard('Escape', 27, 'Escape', down), -12, 238, false);
  button('가방', down => keyboard('KeyE', 69, 'e', down), -70, 238, false);
  for (const [label, id, left] of [['공격', 0, -128], ['사용', 2, -12]])
    button(label, down => mouse(down ? 'mousedown' : 'mouseup', id, innerWidth / 2, innerHeight / 2), left, 82);
  // The hotbar stays accessible even at a reduced render resolution.
  for (let slot = 1; slot <= 9; slot++) button(String(slot), down => keyboard(`Digit${slot}`, 48 + slot, String(slot), down), 12 + (slot - 1) * 56, 20);
  document.addEventListener('pointerdown', event => {
    if (event.target !== canvas() || event.pointerType === 'mouse') return;
    event.preventDefault(); event.target.setPointerCapture(event.pointerId);
    gestures.set(event.pointerId, { x: event.clientX, y: event.clientY, look: !!locked });
    if (!locked) mouse('mousedown', 0, event.clientX, event.clientY);
  }, { capture: true });
  document.addEventListener('pointermove', event => {
    const previous = gestures.get(event.pointerId); if (!previous) return;
    event.preventDefault();
    mouse('mousemove', 0, event.clientX, event.clientY,
      previous.look ? (event.clientX - previous.x) * 1.5 : 0,
      previous.look ? (event.clientY - previous.y) * 1.5 : 0);
    previous.x = event.clientX; previous.y = event.clientY;
  }, { capture: true });
  function endGesture(event) {
    const previous = gestures.get(event.pointerId); if (!previous) return;
    event.preventDefault();
    if (!previous.look) mouse('mouseup', 0, event.clientX, event.clientY);
    gestures.delete(event.pointerId);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(type, endGesture, { capture: true });
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
  const style = document.createElement('style');
  style.textContent = '#game canvas{touch-action:none!important}'; document.head.append(style);
})();
