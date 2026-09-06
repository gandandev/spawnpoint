/* AppleSkin-style food HUD, anchored by the actual 26.2 Hud.renderFood call.
 * The server supplies saturation/exhaustion and effective item components.
 * This is a browser implementation, not a Fabric loader or full AppleSkin port.
 */
(() => {
  const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const validItem = item => item === null || (item && Number.isInteger(item.nutrition)
    && finite(item.nutrition, 0, 2147483647) && finite(item.saturation, 0, 3.4028234663852886e38)
    && typeof item.canAlwaysEat === 'boolean');
  function model(food, nativeLevel) {
    if (!food || !Number.isInteger(food.level) || !finite(food.level, 0, 20)
      || !finite(food.saturation, 0, 20) || !finite(food.exhaustion, 0, 40)
      || !validItem(food.mainHand) || !validItem(food.offHand) || food.level !== nativeLevel) return null;
    const edible = item => item && (food.level < 20 || item.canAlwaysEat);
    const held = edible(food.mainHand) ? food.mainHand : edible(food.offHand) ? food.offHand : null;
    const saturation = Math.min(food.level, food.saturation);
    const levelAfter = Math.min(20, food.level + (held?.nutrition || 0));
    return { level: food.level, saturation, exhaustion: Math.min(1, food.exhaustion / 4),
      levelAfter, saturationAfter: Math.min(levelAfter, saturation + (held?.saturation || 0)) };
  }
  // Simulate vanilla food exhaustion while resting. Batch tiny saturation
  // increments so valid custom food cannot cause an unbounded render loop.
  function naturalHealth(level, saturation, exhaustion) {
    let health = 0;
    for (let step = 0; level >= 18 && step < 100; step++) {
      while (exhaustion > 4) {
        exhaustion = Math.fround(exhaustion - 4);
        if (saturation > 0) saturation = Math.max(0, Math.fround(saturation - 1));
        else level--;
      }
      if (level >= 20 && saturation > 1.1754943508222875e-38) {
        const amount = Math.min(saturation, 6);
        const count = Math.max(1, Math.ceil((4.000000476837158 - exhaustion) / amount));
        health += amount / 6 * count;
        exhaustion = Math.fround(exhaustion + amount * count);
      } else if (level >= 18) {
        health++;
        exhaustion = Math.fround(exhaustion + 6);
      }
    }
    return health;
  }
  function healthModel(food, nativeHealth) {
    const values = model(food, food?.level);
    if (!values || !finite(food.health, 0, 2048) || !finite(food.maxHealth, 1, 2048)
      || Math.ceil(food.health) !== nativeHealth || food.health >= food.maxHealth
      || food.healthPredictionSafe !== true || typeof food.naturalRegeneration !== 'boolean') return null;
    const edible = item => item && (food.level < 20 || item.canAlwaysEat);
    const held = edible(food.mainHand) ? food.mainHand : edible(food.offHand) ? food.offHand : null;
    if (!held || held.predictable !== true || !finite(held.regeneration, 0, 2147483647)) return null;
    // Avoid attributing healing already underway to the food being held.
    if (food.level >= 18 && held.regeneration === 0) return null;
    const gain = held.regeneration + (food.naturalRegeneration
      ? naturalHealth(values.levelAfter, values.saturationAfter, food.exhaustion) : 0);
    return gain > 0 ? { health: food.health, after: Math.min(food.maxHealth, food.health + gain) } : null;
  }
  window.spawnpointFoodHudModel = model;
  window.spawnpointFoodHealthModel = healthModel;
  window.createSpawnpointFoodHud = state => {
    const root = document.createElement('canvas');
    root.id = 'spawnpoint-food-hud';
    root.width = 81; root.height = 12;
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:20;image-rendering:pixelated';
    document.body.appendChild(root);
    const hearts = document.createElement('canvas');
    hearts.id = 'spawnpoint-food-health';
    hearts.setAttribute('aria-hidden', 'true');
    hearts.style.cssText = root.style.cssText;
    document.body.appendChild(hearts);
    const heartContext = hearts.getContext('2d');
    const tooltip = document.createElement('div');
    tooltip.id = 'spawnpoint-food-tooltip';
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:20;color:#fff;background:rgba(16,0,16,.95);border:1px solid #502080;font-family:Galmuri11,monospace;white-space:nowrap';
    const tooltipBars = [];
    const tooltipLabels = [];
    for (let row = 0; row < 2; row++) {
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
      const label = document.createElement('span');
      const bar = document.createElement('canvas');
      bar.width = 81; bar.height = 9;
      line.append(label, bar); tooltip.appendChild(line);
      tooltipLabels.push(label); tooltipBars.push(bar);
    }
    document.body.appendChild(tooltip);
    const context = root.getContext('2d');
    const icons = new Image(); icons.src = '/game/food-hud/appleskin-icons.png';
    const full = new Image(); full.src = '/game/food-hud/food_full.png';
    const half = new Image(); half.src = '/game/food-hud/food_half.png';
    const heartFull = new Image(); heartFull.src = '/game/food-hud/heart_full.png';
    const heartHalf = new Image(); heartHalf.src = '/game/food-hud/heart_half.png';
    let food = null, received = -Infinity, rendered = -Infinity, heartRendered = -Infinity;
    let hovered = null, tooltipRendered = -Infinity, guiWidth = 0, gameCanvas;
    const hide = () => { root.style.display = hearts.style.display = tooltip.style.display = 'none'; hovered = null; };
    const hideFood = () => { root.style.display = 'none'; };
    const hideHealth = () => { hearts.style.display = 'none'; };
    const hideTooltip = () => { tooltip.style.display = 'none'; };
    function geometry(width) {
      gameCanvas ||= document.querySelector('canvas._eaglercraftX_canvas_element');
      if (!gameCanvas?.width || !finite(width, 1, 32768)) return null;
      const rect = gameCanvas.getBoundingClientRect();
      const pixel = rect.width / gameCanvas.width * Math.max(1, Math.round(gameCanvas.width / width));
      return pixel > 0 ? { rect, pixel } : null;
    }
    const hudVisible = () => !document.hidden && window.__eaglerWorldReady
      && (!state.screen || /ChatScreen$/.test(state.screen)) && performance.now() - received <= 1000;
    function saturation(value, start, alpha) {
      context.globalAlpha = alpha;
      for (let i = Math.floor(start / 2); i < Math.ceil(value / 2); i++) {
        const part = value / 2 - i;
        const u = part >= 1 ? 27 : part > .5 ? 18 : part > .25 ? 9 : 0;
        context.drawImage(icons, u, 0, 9, 9, 72 - i * 8, 0, 9, 9);
      }
    }
    // Poll freshness separately: F1, creative, mounts and leaving the world stop
    // the native food renderer, so a previous overlay must not stay on screen.
    const timer = setInterval(() => {
      if (document.hidden || !window.__eaglerWorldReady) return hide();
      const now = performance.now();
      if (now - rendered > 250 || now - received > 1000) hideFood();
      if (now - heartRendered > 250 || now - received > 1000) hideHealth();
      if (now - tooltipRendered > 100) hideTooltip();
    }, 50);
    window.addEventListener('pagehide', () => { clearInterval(timer); hide(); }, { once: true });
    return {
      hide,
      update(value) { food = value; received = performance.now(); if (!food) hide(); },
      guiWidth(width) { guiWidth = width; },
      foodHovered(nutrition, saturation) {
        hovered = Number.isInteger(nutrition) && finite(nutrition, 0, 2147483647)
          && finite(saturation, 0, 3.4028234663852886e38) ? { nutrition, saturation, time: performance.now() } : null;
        if (!hovered) hideTooltip();
      },
      tooltipRendered(x, y, width, height) {
        try {
          const item = hovered; hovered = null;
          const geo = geometry(guiWidth);
          if (!item || performance.now() - item.time > 100 || !geo || document.hidden
            || !window.__eaglerWorldReady || !state.screen || ![x, y, width, height].every(n => finite(n, 0, 32768))) return hideTooltip();
          const { rect, pixel } = geo;
          tooltip.style.fontSize = `${9 * pixel}px`;
          tooltip.style.lineHeight = `${12 * pixel}px`;
          tooltip.style.padding = `${3 * pixel}px`;
          tooltip.style.borderWidth = `${pixel}px`;
          for (let row = 0; row < 2; row++) {
            const value = row ? item.saturation : item.nutrition;
            tooltipLabels[row].textContent = `${row ? '포화도' : '허기'} +${Number(value.toFixed(2))}`;
            const bar = tooltipBars[row];
            bar.style.width = `${81 * pixel}px`; bar.style.height = `${9 * pixel}px`;
            bar.style.marginLeft = `${6 * pixel}px`; bar.style.imageRendering = 'pixelated';
            const ctx = bar.getContext('2d');
            if (!ctx) return hideTooltip();
            ctx.clearRect(0, 0, 81, 9); ctx.imageSmoothingEnabled = false;
            for (let i = 0; i < Math.ceil(Math.min(20, value) / 2); i++) {
              const part = value / 2 - i;
              if (row) ctx.drawImage(icons, part >= 1 ? 27 : part > .5 ? 18 : part > .25 ? 9 : 0, 0, 9, 9, i * 8, 0, 9, 9);
              else ctx.drawImage(part >= 1 ? full : half, i * 8, 0, 9, 9);
            }
          }
          tooltip.style.display = 'block';
          const size = tooltip.getBoundingClientRect();
          const left = Math.max(rect.left, Math.min(rect.right - size.width, rect.left + (x - 3) * pixel));
          const below = rect.top + (y + height + 6) * pixel;
          const top = below + size.height <= rect.bottom ? below : Math.max(rect.top, rect.top + (y - 6) * pixel - size.height);
          tooltip.style.left = `${left}px`; tooltip.style.top = `${top}px`;
          tooltipRendered = performance.now();
        } catch { hideTooltip(); }
      },
      heartsRendered(left, top, rowHeight, nativeHealth) {
        try {
          const values = healthModel(food, nativeHealth);
          const geo = geometry((left + 91) * 2);
          if (!values || !geo || !hudVisible() || !heartContext || !heartFull.naturalWidth || !heartHalf.naturalWidth
            || !finite(top, 0, 32768) || !finite(rowHeight, 3, 11)) return hideHealth();
          const last = Math.ceil(values.after / 2);
          const rows = Math.ceil(last / 10);
          const height = 9 + (rows - 1) * rowHeight;
          if (hearts.width !== 81) hearts.width = 81;
          if (hearts.height !== height) hearts.height = height;
          const { rect, pixel } = geo;
          hearts.style.left = `${rect.left + left * pixel}px`;
          hearts.style.top = `${rect.top + (top - (rows - 1) * rowHeight) * pixel}px`;
          hearts.style.width = `${81 * pixel}px`; hearts.style.height = `${height * pixel}px`;
          heartContext.clearRect(0, 0, 81, height); heartContext.imageSmoothingEnabled = false;
          heartContext.globalAlpha = .35 + .3 * (1 + Math.sin(performance.now() / 180)) / 2;
          for (let i = Math.floor(nativeHealth / 2); i < last; i++) {
            const skip = i * 2 < nativeHealth ? 4 : 0;
            const sprite = Math.ceil(values.after) >= i * 2 + 2 ? heartFull : heartHalf;
            heartContext.drawImage(sprite, skip, 0, 9 - skip, 9, i % 10 * 8 + skip,
              (rows - 1 - Math.floor(i / 10)) * rowHeight, 9 - skip, 9);
          }
          hearts.style.display = 'block'; heartRendered = performance.now();
        } catch { hideHealth(); }
      },
      render(right, top, nativeLevel) {
        try {
          const now = performance.now();
          const values = model(food, nativeLevel);
          if (!context || !values || !icons.complete || !icons.naturalWidth || document.hidden
            || !hudVisible() || !finite(right, 92, 32768) || !finite(top, 0, 32768)) return hideFood();
          const geo = geometry((right - 91) * 2);
          if (!geo) return hideFood();
          const { rect, pixel } = geo;
          root.style.left = `${rect.left + (right - 81) * pixel}px`;
          root.style.top = `${rect.top + top * pixel}px`;
          root.style.width = `${81 * pixel}px`;
          root.style.height = `${12 * pixel}px`;
          context.clearRect(0, 0, 81, 12);
          context.imageSmoothingEnabled = false;
          const flash = .35 + .3 * (1 + Math.sin(now / 180)) / 2;
          if (full.complete && full.naturalWidth && half.complete && half.naturalWidth) {
            context.globalAlpha = flash;
            for (let i = Math.floor(values.level / 2); i < Math.ceil(values.levelAfter / 2); i++) {
              const sprite = values.levelAfter >= i * 2 + 2 ? full : half;
              // Preserve the already filled half of an odd hunger value.
              const skip = i * 2 < values.level ? 4 : 0;
              context.drawImage(sprite, skip, 0, 9 - skip, 9, 72 - i * 8 + skip, 0, 9 - skip, 9);
            }
          }
          saturation(values.saturation, 0, 1);
          if (values.saturationAfter > values.saturation) saturation(values.saturationAfter, values.saturation, flash);
          context.globalAlpha = .75;
          context.fillStyle = '#8f8f8f';
          context.fillRect(81 - Math.floor(values.exhaustion * 81), 10, Math.floor(values.exhaustion * 81), 1);
          context.globalAlpha = 1;
          rendered = now;
          root.style.display = 'block';
        } catch {
          // A browser overlay must never interrupt the game's WASM render call.
          hideFood();
        }
      },
    };
  };
})();
