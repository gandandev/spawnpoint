(() => {
  if (!new URLSearchParams(location.search).has('launch')) return;
  const state = window.__spawnpoint262;
  // Original Minecraft ASCII atlas, digits 0..9, one bit per solid pixel.
  const digits = [[14,17,25,21,19,17,14,0],[4,6,4,4,4,4,31,0],[14,17,16,12,2,17,31,0],[14,17,16,12,16,17,14,0],[24,20,18,17,31,16,16,0],[31,1,15,16,16,17,14,0],[12,2,1,15,17,17,14,0],[31,17,16,8,4,4,4,0],[14,17,17,14,17,17,14,0],[14,17,17,30,16,8,6,0]];
  let xp, context, info, canvas, lastXp = -Infinity, lastLevel, frames = 0, start = performance.now();
  function elements() {
    if (!document.body) return false;
    if (!xp) {
      xp = document.createElement('canvas');
      xp.id = 'spawnpoint-experience';
      xp.style.cssText = 'position:fixed;pointer-events:none;z-index:15;image-rendering:pixelated;display:none';
      context = xp.getContext('2d');
      info = document.createElement('div');
      info.id = 'spawnpoint-performance';
      info.style.cssText = 'position:fixed;left:8px;top:7px;z-index:15;pointer-events:none;color:white;font:14px Galmuri11,monospace;text-shadow:1px 1px #000;white-space:nowrap;display:none';
      document.body.append(xp, info);
    }
    canvas ||= document.querySelector('canvas._eaglercraftX_canvas_element');
    return !!canvas && !!context;
  }
  window.spawnpointExperienceRendered = (level, width, height) => {
    if (!elements() || !Number.isInteger(level) || level < 1 || !width || !height) return false;
    if (state.portalHidden || document.hidden) { xp.style.display = 'none'; return true; }
    const text = String(level);
    if (lastLevel !== level) {
      xp.width = text.length * 6 + 1; xp.height = 10;
      function draw(dx, dy, color) {
        context.fillStyle = color;
        [...text].forEach((char, index) => digits[Number(char)].forEach((row, y) => {
          for (let x = 0; x < 5; x++) if (row & (1 << x)) context.fillRect(1 + index * 6 + x + dx, 1 + y + dy, 1, 1);
        }));
      }
      draw(1, 0, '#000'); draw(-1, 0, '#000'); draw(0, 1, '#000'); draw(0, -1, '#000'); draw(0, 0, '#80ff20');
      lastLevel = level;
    }
    const rect = canvas.getBoundingClientRect();
    const pixel = rect.width / width;
    xp.style.width = xp.width * pixel + 'px'; xp.style.height = xp.height * pixel + 'px';
    xp.style.left = rect.left + (width - xp.width) / 2 * pixel + 'px';
    xp.style.top = rect.top + (height - 36) * rect.height / height + 'px';
    xp.style.display = 'block';
    lastXp = performance.now();
    return true;
  };
  function frame(now) {
    if (elements()) {
      const active = !document.hidden && !state.portalHidden && window.__eaglerWorldReady;
      if (!active || now - lastXp > 150) xp.style.display = 'none';
      if (active && state.frameRendered) frames++;
      state.frameRendered = false;
      if (now - start >= 1000) {
        state.fps = Math.round(frames * 1000 / (now - start)); frames = 0; start = now;
      }
      const position = state.position;
      info.style.display = active && position && now - position.time < 1500 ? 'block' : 'none';
      if (position) info.textContent = `${state.fps || 0}fps | ${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)}`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
