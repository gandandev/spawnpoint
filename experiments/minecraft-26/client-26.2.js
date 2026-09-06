(() => {
  if (!new URLSearchParams(location.search).has('launch')) return;
  const state = window.__spawnpoint262;
  let foodHud;
  // Canvas handlers prevent the browser's default focus transfer into an iframe.
  window.addEventListener('pointerdown', event => {
    if (event.target instanceof HTMLCanvasElement) window.focus();
  }, true);
  let enteredWorld = false;
  window.__spawnpointBind262 = exports => {
    if (exports['spawnpoint.foodRendered'] && window.createSpawnpointFoodHud) {
      foodHud = window.createSpawnpointFoodHud(state);
      exports['spawnpoint.foodRendered'].value = foodHud.render;
      for (const name of ['heartsRendered', 'foodHovered', 'tooltipRendered', 'guiWidth']) {
        if (exports['spawnpoint.' + name]) exports['spawnpoint.' + name].value = foodHud[name];
      }
      state.foodHook = true;
    }
    exports['spawnpoint.screenChanged'].value = name => {
      window.spawnpoint262Ime?.clear();
      const screen = name || '';
      state.nativeScreens = true;
      state.screen = screen;
      if (screen && !/ChatScreen$/.test(screen)) foodHud?.hide();
      if (!screen && window.__eaglerWorldReady) enteredWorld = true;
      if ((enteredWorld || window.__eaglerWorldReady) && /(?:TitleScreen|JoinMultiplayerScreen)$/.test(screen)) {
        window.parent.postMessage({type:'spawnpoint:return-to-menu',launchId:new URLSearchParams(location.search).get('launch')}, location.origin);
      }
      const canvas = document.querySelector('canvas');
      const scale = state.guiScale || 2;
      window.eaglercraftXOpts.hooks?.screenChanged?.(screen, (canvas?.width || innerWidth) / scale, (canvas?.height || innerHeight) / scale, canvas?.width || innerWidth, canvas?.height || innerHeight, scale);
    };
  };
  const emission = new Map([['torch',14],['copper_torch',14],['lantern',15],['soul_torch',10],['soul_lantern',10],['glowstone',15],['sea_lantern',15],['shroomlight',15],['jack_o_lantern',15],['end_rod',14]]);
  const light = new Float32Array(4);
  state.heldLight = light;
  state.lightShaders = 0;
  const contexts = new WeakMap();
  for (const type of [window.WebGL2RenderingContext]) {
    if (!type) continue;
    const proto = type.prototype;
    const shaderSource = proto.shaderSource;
    proto.shaderSource = function(shader, source) {
      const sample = 'sample_lightmap(Sampler2, UV2)';
      const terrain = source.includes('ChunkPosition') && source.includes('CameraBlockPos');
      const model = source.includes('gl_Position = ProjMat * ModelViewMat * vec4(Position, 1.0);');
      if ((terrain || model) && source.includes(sample) && source.includes('void main() {')) {
        // Model vertices already contain the CPU pose transform and are camera
        // relative, including the inverse view rotation used for first-person hands.
        // Globals is a built-in UBO: GlProgram discovers and binds it even when
        // the original pipeline did not declare it. Keep its complete std140 layout.
        const globals = !terrain && !source.includes('uniform Globals') ? `
layout(std140) uniform Globals {
    ivec3 CameraBlockPos;
    vec3 CameraOffset;
    vec2 ScreenSize;
    float GlintAlpha;
    float GameTime;
    int MenuBlurRadius;
    int UseRgss;
};
` : '';
        const position = terrain ? 'Position + vec3(ChunkPosition)' : 'Position + vec3(CameraBlockPos) - CameraOffset';
        source = source.replace('void main() {', `${globals}uniform vec4 SpawnpointHeldLight;
void main() {
    float heldLevel = max(0.0, SpawnpointHeldLight.w - length(${position} - SpawnpointHeldLight.xyz));
    // Orthographic inventory and GUI previews keep their own lighting.
    ${terrain ? '' : 'heldLevel *= ProjMat[3][3] == 0.0 ? 1.0 : 0.0;'}
`).replaceAll(sample, 'sample_lightmap(Sampler2, ivec2(max(float(UV2.x), heldLevel * 16.0), UV2.y))');
        state.lightShaders++;
      }
      return shaderSource.call(this, shader, source);
    };
    const useProgram = proto.useProgram;
    proto.useProgram = function(program) {
      useProgram.call(this, program);
      let ctx = contexts.get(this);
      if (!ctx) contexts.set(this, ctx = { uniforms: new WeakMap() });
      ctx.program = program;
      if (!program) return;
      if (!ctx.uniforms.has(program)) ctx.uniforms.set(program, {
        location: this.getUniformLocation(program, 'SpawnpointHeldLight'),
        previous: new Float32Array([NaN, NaN, NaN, NaN]),
      });
      const uniform = ctx.uniforms.get(program);
      if (uniform.location !== null && (light[0] !== uniform.previous[0] || light[1] !== uniform.previous[1] || light[2] !== uniform.previous[2] || light[3] !== uniform.previous[3])) {
        this.uniform4fv(uniform.location, light);
        uniform.previous.set(light);
      }
    };
  }
  let pending = false, lastResponse = 0, lastScreen;
  function updateScreen() {
    if (!window.__eaglerWorldReady) return;
    enteredWorld = true;
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const screen = state.nativeScreens ? state.screen : document.pointerLockElement ? '' : 'PauseScreen';
    if (screen === lastScreen) return;
    lastScreen = screen;
    const scale = state.guiScale || 2;
    if (!state.nativeScreens) window.eaglercraftXOpts.hooks?.screenChanged?.(screen, canvas.width / scale, canvas.height / scale, canvas.width, canvas.height, scale);
  }
  document.addEventListener('pointerlockchange', updateScreen);
  setInterval(async () => {
    updateScreen();
    if (pending || document.hidden || !window.__eaglerWorldReady) return;
    pending = true;
    try {
      const response = await fetch('/api/game/locator', { cache: 'no-store' });
      if (!response.ok) throw Error('Player state unavailable');
      const snapshot = await response.json();
      const player = snapshot.clientState;
      foodHud?.update(snapshot.active ? player?.food : null);
      light[3] = 0;
      if (snapshot.active && player && [player.x,player.y,player.z].every(Number.isFinite)) {
        light[0] = player.x; light[1] = player.y; light[2] = player.z;
        light[3] = Math.max(emission.get(player.mainHand?.replace('minecraft:', '')) || 0, emission.get(player.offHand?.replace('minecraft:', '')) || 0);
      }
      lastResponse = performance.now();
    } catch {
      if (performance.now() - lastResponse > 1000) light[3] = 0;
    } finally { pending = false; }
  }, 200);
})();
