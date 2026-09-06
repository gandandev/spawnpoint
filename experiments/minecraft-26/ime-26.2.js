(() => {
  let input = null, preview = null, text = '', caret = null;
  const isNativeInput = element => element?.matches?.('[data-eagler-text-input="true"]');

  function clear() {
    input = null;
    text = '';
    if (preview) preview.hidden = true;
  }

  function render() {
    if (!input || document.activeElement !== input || !text || !caret || document.hidden) {
      if (preview) preview.hidden = true;
      return;
    }
    const canvas = document.querySelector('canvas._eaglercraftX_canvas_element');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const [x, y, width, height] = caret;
    const scaleX = rect.width / width, scaleY = rect.height / height;
    if (!(scaleX > 0 && scaleY > 0)) return;
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'spawnpoint-ime-preedit';
      preview.setAttribute('aria-hidden', 'true');
      preview.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;white-space:pre;overflow:hidden;color:#111;background:#fff;border:1px solid #555;font-family:Galmuri11,sans-serif;text-decoration:underline;line-height:1.25;';
      document.body.appendChild(preview);
    }
    // The native client deliberately commits only compositionend. Paint the
    // browser's preedit beside its real caret, without editing the game draft.
    preview.textContent = text;
    preview.style.fontSize = `${9 * scaleY}px`;
    preview.style.padding = `${2 * scaleY}px ${3 * scaleX}px`;
    preview.style.maxWidth = `${Math.min(rect.width, innerWidth)}px`;
    preview.hidden = false;
    const box = preview.getBoundingClientRect();
    const left = Math.max(0, Math.min(rect.left + x * scaleX, rect.right - box.width, innerWidth - box.width));
    const below = rect.top + (y + 14) * scaleY;
    const top = below + box.height <= Math.min(rect.bottom, innerHeight)
      ? below : Math.max(0, rect.top + (y - 4) * scaleY - box.height);
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  }

  document.addEventListener('compositionstart', event => {
    if (!isNativeInput(event.target)) return;
    input = event.target;
    text = event.data || '';
    render();
  }, true);
  document.addEventListener('compositionupdate', event => {
    if (event.target !== input) return;
    text = event.data || '';
    render();
  }, true);
  document.addEventListener('beforeinput', event => {
    if (!isNativeInput(event.target) || event.inputType !== 'insertCompositionText') return;
    input = event.target;
    text = event.data || '';
    render();
  }, true);
  document.addEventListener('compositionend', event => { if (event.target === input) clear(); }, true);
  document.addEventListener('focusout', event => { if (event.target === input) clear(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  window.addEventListener('blur', clear);
  window.addEventListener('resize', render);

  window.spawnpoint262Ime = {
    clear,
    bind(exports) {
      const hook = exports['spawnpoint.textInputRendered'];
      if (hook) hook.value = (x, y, width, height) => {
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
        caret = [x, y, width, height];
        if (input) {
          try { render(); } catch (_error) { clear(); }
        }
      };
    },
  };
})();
