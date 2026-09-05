(() => {
  const state = window.__prototype26;
  const emission = new Map([['torch',14],['copper_torch',14],['lantern',15],['soul_torch',10],['soul_lantern',10]]);
  const light = new Float32Array(4);
  const frames = new Float64Array(8192);
  let count = 0, last = 0, recording = false, configured = false;
  const uniforms = new WeakMap();
  state.lighting = true;
  state.light = light;
  state.shadersPatched = 0;
  function level(stack) {
    if (!stack || stack.e2U <= 0) return 0;
    const id = stack.hOc?.fTF?.eUf;
    return id?.e1L?.eSr === 'minecraft' ? emission.get(id.eXs?.eSr) || 0 : 0;
  }
  window.spawnpoint26Frame = () => {
    if (!configured && state.client) { state.applyViewDistance?.(); configured = true; }
    const player = state.client?.eSD;
    const inventory = player?.eUN;
    light[3] = 0;
    if (state.lighting && inventory) {
      const main = inventory.eXM?.gYF?.hA0?.data[inventory.fej];
      const off = inventory.fPU?.fte?.e5V?.data[1]; // EquipmentSlot.OFFHAND ordinal 1.
      light[0] = player.eSR.eSu;
      light[1] = player.eSR.eSy + player.eY4;
      light[2] = player.eSR.eSv;
      light[3] = Math.max(level(main), level(off));
    }
    if (recording && player && !document.hidden) {
      const now = performance.now();
      if (last) frames[count++ % frames.length] = now - last;
      last = now;
    } else last = 0;
  };
  state.startMeasurement = () => { count = 0; last = 0; recording = true; };
  state.stopMeasurement = () => {
    recording = false;
    const data = Array.from(frames.subarray(0, Math.min(count, frames.length))).sort((a,b)=>a-b);
    const total = data.reduce((a,b)=>a+b,0);
    return { frames:data.length, seconds:total/1000, fps:1000*data.length/total,
      p95Ms:data[Math.floor(data.length*.95)], p99Ms:data[Math.floor(data.length*.99)],
      maxMs:data.at(-1), pausesOver100Ms:data.filter(t=>t>100).length,
      canvas:[document.querySelector('canvas')?.width,document.querySelector('canvas')?.height] };
  };
  window.spawnpoint26Shader = text => {
    // Terrain only. The original UV light remains the minimum, preserving skylight and placed torches.
    const anchor = 'vertexColor = Color * sample_lightmap(Sampler2, UV2);';
    if (!text.includes('uniform ChunkSection') || !text.includes(anchor)) return text;
    state.shadersPatched++;
    return text.replace('void main() {', 'uniform vec4 SpawnpointHeldLight;\nvoid main() {').replace(anchor, `
    float heldLevel = max(0.0, SpawnpointHeldLight.w - length(Position + vec3(ChunkPosition) - SpawnpointHeldLight.xyz));
    ivec2 litUV = ivec2(max(float(UV2.x), heldLevel * 16.0), UV2.y);
    vertexColor = Color * sample_lightmap(Sampler2, litUV);`);
  };
  window.spawnpoint26Program = (gl, program) => {
    if (!program) return;
    let location = uniforms.get(program);
    if (location === undefined) { location = gl.getUniformLocation(program, 'SpawnpointHeldLight'); uniforms.set(program, location); }
    if (location !== null) gl.uniform4fv(location, light);
  };
})();
