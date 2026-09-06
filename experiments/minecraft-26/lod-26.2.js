(() => {
  if (!new URLSearchParams(location.search).has('launch') || !window.WebGL2RenderingContext) return;
  const state = window.__spawnpoint262.lod = { tiles: 0, vertices: 0, draws: 0, active: false, enabled: true };
  const limit = window.__spawnpoint262.profile === 'tablet' ? 256 : 512;
  let world, cursor = 0, pending = false, revision = 0, geometry = new Float32Array(), frame = 0;
  const tiles = new Map();
  const worker = new Worker('lod-mesh-worker.js');
  worker.onmessage = ({ data }) => {
    if (data.world !== world) return;
    geometry = data.vertices; revision++; state.vertices = geometry.length / 6;
  };
  let database;
  const databaseReady = new Promise(resolve => {
    const request = indexedDB.open('spawnpoint-terrain-lod-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('worlds');
    request.onsuccess = () => { database = request.result; resolve(); };
    request.onerror = () => resolve();
  });
  function build() { worker.postMessage({ world, tiles: [...tiles.values()] }); state.tiles = tiles.size; }
  async function restore(id) {
    await databaseReady;
    if (!database || id !== world) return;
    const request = database.transaction('worlds').objectStore('worlds').get(id);
    request.onsuccess = () => {
      if (id !== world || !Array.isArray(request.result)) return;
      for (const tile of request.result) if (valid(tile) && !tiles.has(`${tile.x},${tile.z}`) && tiles.size < limit) tiles.set(`${tile.x},${tile.z}`, tile);
      build();
    };
  }
  function valid(tile) {
    return Number.isInteger(tile.x) && Number.isInteger(tile.z) && Array.isArray(tile.cells) && tile.cells.length === 32 && tile.cells.every(Number.isFinite);
  }
  setInterval(async () => {
    if (pending || document.hidden || !window.__eaglerWorldReady) return;
    pending = true;
    try {
      const response = await fetch(`/api/game/terrain?cursor=${cursor}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const data = await response.json(); state.active = data.active === true;
      if (!data.world) return;
      if (world !== data.world) { world = data.world; tiles.clear(); geometry = new Float32Array(); revision++; restore(world); }
      cursor = data.cursor || 0;
      let changed = false;
      for (const tile of data.tiles || []) {
        if (!valid(tile)) continue;
        const key = `${tile.x},${tile.z}`, old = tiles.get(key);
        if (!old || tile.cells.some((v, i) => v !== old.cells[i])) { tiles.set(key, tile); changed = true; }
      }
      if (tiles.size > limit) {
        const sorted = [...tiles.values()].sort((a,b) => Math.hypot(a.x*16-data.x,a.z*16-data.z)-Math.hypot(b.x*16-data.x,b.z*16-data.z));
        tiles.clear(); for (const tile of sorted.slice(0,limit)) tiles.set(`${tile.x},${tile.z}`,tile);
      }
      if (changed) {
        build();
        if (database) { const store = database.transaction('worlds','readwrite').objectStore('worlds'); store.clear(); store.put([...tiles.values()], world); }
      }
    } catch { state.active = false; } finally { pending = false; }
  }, 3000);
  function nextFrame() { frame++; requestAnimationFrame(nextFrame); }
  requestAnimationFrame(nextFrame);

  const proto = WebGL2RenderingContext.prototype;
  const original = Object.fromEntries(['shaderSource','attachShader','linkProgram','useProgram','drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced','drawRangeElements'].map(key => [key, proto[key]]));
  const shaders = new WeakMap(), programs = new WeakMap(), contexts = new WeakMap();
  proto.shaderSource = function(shader, source) { shaders.set(shader, source); return original.shaderSource.call(this,shader,source); };
  proto.attachShader = function(program, shader) {
    const source = shaders.get(shader);
    if (source?.includes('ChunkPosition') && source.includes('CameraBlockPos') && source.includes('gl_Position')) programs.set(program,{source});
    return original.attachShader.call(this,program,shader);
  };
  proto.useProgram = function(program) {
    let context = contexts.get(this); if (!context) contexts.set(this,context={ frame:-1, revision:-1 });
    context.program = program;
    return original.useProgram.call(this,program);
  };
  function initialize(gl, source) {
    const blocks = ['Projection','ChunkSection','Globals','Fog'].map(name => {
      const match = source.match(new RegExp('(?:layout\\s*\\([^)]*\\)\\s*)?uniform\\s+'+name+'\\s*\\{[^}]+\\}\\s*;'));
      if (!match) throw Error('LOD uniform block missing: '+name);
      return match[0];
    }).join('\n');
    const vertex = `#version 300 es\nprecision highp float; precision highp int;\n${blocks}\nlayout(location=0) in vec3 LODPosition; layout(location=1) in vec3 LODColor;
      out vec3 color; out float distanceXZ; out float fog; out float nearEnd;
      void main(){ vec3 pos=LODPosition-vec3(CameraBlockPos)+CameraOffset; gl_Position=ProjMat*ModelViewMat*vec4(pos,1.0);
      color=LODColor*clamp(length(FogColor.rgb)*1.2,0.12,1.0); distanceXZ=max(length(pos.xz),abs(pos.y)); nearEnd=FogRenderDistanceEnd;
      fog=max(0.65*(1.0-smoothstep(FogRenderDistanceEnd,FogRenderDistanceEnd*1.5,distanceXZ)),max(smoothstep(FogRenderDistanceEnd, min(512.0,FogRenderDistanceEnd*3.0),length(pos.xz)),smoothstep(FogEnvironmentalStart,FogEnvironmentalEnd,length(pos)))); }`;
    const fragment = `#version 300 es\nprecision highp float; precision highp int;\n${blocks}\nin vec3 color; in float distanceXZ; in float fog; in float nearEnd; out vec4 outColor;
      void main(){ if(distanceXZ<nearEnd-8.0) discard; outColor=vec4(mix(color,FogColor.rgb,fog),1.0); }`;
    const program = gl.createProgram();
    for (const [type, text] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const shader = gl.createShader(type); original.shaderSource.call(gl,shader,text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      original.attachShader.call(gl,program,shader); gl.deleteShader(shader);
    }
    original.linkProgram.call(gl,program); if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    return { program, vao:gl.createVertexArray(), buffer:gl.createBuffer() };
  }
  function draw(gl) {
    const context = contexts.get(gl), native = context?.program, metadata = programs.get(native);
    if (!metadata || context.frame === frame || !state.active || state.enabled === false || !geometry.length || context.failed) return;
    context.frame = frame;
    const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING), buffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    const cull = gl.isEnabled(gl.CULL_FACE), blend = gl.isEnabled(gl.BLEND);
    try {
      if (!context.lod) context.lod = initialize(gl,metadata.source);
      const lod = context.lod;
      if (context.boundNative !== native) {
        for (const name of ['Projection','ChunkSection','Globals','Fog']) {
          const index = gl.getUniformBlockIndex(lod.program,name);
          if (index !== gl.INVALID_INDEX) gl.uniformBlockBinding(lod.program,index,gl.getActiveUniformBlockParameter(native,gl.getUniformBlockIndex(native,name),gl.UNIFORM_BLOCK_BINDING));
        }
        context.boundNative = native;
      }
      original.useProgram.call(gl,lod.program); gl.bindVertexArray(lod.vao); gl.bindBuffer(gl.ARRAY_BUFFER,lod.buffer);
      if (context.revision !== revision) {
        gl.bufferData(gl.ARRAY_BUFFER,geometry,gl.STATIC_DRAW); context.revision = revision;
        for (let i=0;i<2;i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i,3,gl.FLOAT,false,24,i*12); }
      }
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      original.drawArrays.call(gl,gl.TRIANGLES,0,geometry.length/6); state.draws++;
    } catch (error) { context.failed = true; state.error = String(error); console.warn('Distant terrain disabled:',error); }
    finally {
      if (cull) gl.enable(gl.CULL_FACE); if (blend) gl.enable(gl.BLEND);
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER,buffer); original.useProgram.call(gl,native);
    }
  }
  proto.drawElements = function(mode,count,type,offset) { draw(this); return original.drawElements.call(this,mode,count,type,offset); };
  proto.drawArrays = function(mode,first,count) { draw(this); return original.drawArrays.call(this,mode,first,count); };
  proto.drawElementsInstanced = function(mode,count,type,offset,instances) { draw(this); return original.drawElementsInstanced.call(this,mode,count,type,offset,instances); };
  proto.drawArraysInstanced = function(mode,first,count,instances) { draw(this); return original.drawArraysInstanced.call(this,mode,first,count,instances); };
  proto.drawRangeElements = function(mode,start,end,count,type,offset) { draw(this); return original.drawRangeElements.call(this,mode,start,end,count,type,offset); };
})();
