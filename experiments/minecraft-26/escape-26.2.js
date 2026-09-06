(() => {
  if (!new URLSearchParams(location.search).has('launch')) return;
  const state = window.__spawnpoint262;
  let locked = !!document.pointerLockElement, closing = false, held = false, timer;
  function key(type) {
    const event = new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
    Object.defineProperty(event, '__spawnpointEscape', { value: true });
    (document.querySelector('canvas._eaglercraftX_canvas_element') || document).dispatchEvent(event);
  }
  function restore() {
    if (!closing || held || state.screen || state.portalHidden || document.hidden) return;
    const canvas = document.querySelector('canvas._eaglercraftX_canvas_element');
    if (!canvas) return;
    closing = false;
    canvas.focus();
    if (document.pointerLockElement !== canvas) {
      try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* A click can restore a browser-denied lock. */ }
    }
  }
  state.restoreAfterEscape = restore;
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.__spawnpointEscape || !state.screen || state.portalHidden) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    closing = true; held = true;
    key('keydown');
  }, true);
  window.addEventListener('keyup', event => {
    if (event.key !== 'Escape' || event.__spawnpointEscape || !closing) return;
    event.preventDefault(); event.stopImmediatePropagation();
    held = false;
    key('keyup');
    setTimeout(restore, 0);
  }, true);
  document.addEventListener('pointerlockchange', () => {
    const wasLocked = locked;
    locked = !!document.pointerLockElement;
    clearTimeout(timer);
    if (!wasLocked || locked || closing || state.screen || state.portalHidden || document.hidden) return;
    // Browsers consume the first Escape while releasing pointer lock.
    // Give the native menu event one frame, then supply it only if still absent.
    timer = setTimeout(() => {
      if (!document.pointerLockElement && !state.screen && !state.portalHidden && !document.hidden && document.hasFocus()) {
        key('keydown'); key('keyup');
      }
    }, 80);
  });
})();
