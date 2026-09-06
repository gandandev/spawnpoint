/* Browser render-state cache. Keeps draw order and geometry unchanged. */
(() => {
  if (!new URLSearchParams(location.search).has('launch') || !window.WebGL2RenderingContext) return;
  const proto = WebGL2RenderingContext.prototype;
  const contexts = new WeakMap();
  const control = window.__spawnpoint262.renderState = { enabled: true, calls: 0, skipped: 0 };
  function reset(ctx) {
    ctx.values = new Map(); ctx.buffers = new Map(); ctx.indexed = new Map();
    ctx.textures = new Map(); ctx.uniforms = new WeakMap(); ctx.elements = new Map();
    ctx.activeTexture = undefined; ctx.vao = undefined;
  }
  function context(gl) {
    let ctx = contexts.get(gl);
    if (!ctx) {
      ctx = { enabled: control.enabled }; reset(ctx); contexts.set(gl, ctx);
      gl.canvas.addEventListener('webglcontextrestored', () => reset(ctx));
      gl.canvas.addEventListener('webglcontextlost', () => reset(ctx));
    }
    if (ctx.enabled !== control.enabled) { reset(ctx); ctx.enabled = control.enabled; }
    control.calls++;
    return ctx;
  }
  // Reuse fixed tuples rather than allocating an arguments array on each draw.
  function same(map, key, a, b, c, d) {
    const previous = map.get(key);
    if (previous && previous[0] === a && previous[1] === b && previous[2] === c && previous[3] === d) {
      control.skipped++; return true;
    }
    if (previous) { previous[0] = a; previous[1] = b; previous[2] = c; previous[3] = d; }
    else map.set(key, [a,b,c,d]);
    return false;
  }
  for (const name of ['useProgram','depthFunc','depthMask','cullFace','frontFace','lineWidth','polygonOffset','colorMask','viewport','scissor','blendColor','blendFuncSeparate','blendEquationSeparate']) {
    const original = proto[name];
    proto[name] = function(a,b,c,d) {
      const ctx = context(this);
      if (ctx.enabled && same(ctx.values,name,a,b,c,d)) return;
      return original.call(this,a,b,c,d);
    };
  }
  // These shorter APIs change the same state as their Separate variants.
  const blendFunc = proto.blendFunc, blendEquation = proto.blendEquation;
  proto.blendFunc = function(src,dst) {
    const ctx = context(this);
    if (ctx.enabled && same(ctx.values,'blendFuncSeparate',src,dst,src,dst)) return;
    return blendFunc.call(this,src,dst);
  };
  proto.blendEquation = function(mode) {
    const ctx = context(this);
    if (ctx.enabled && same(ctx.values,'blendEquationSeparate',mode,mode,undefined,undefined)) return;
    return blendEquation.call(this,mode);
  };
  for (const name of ['enable','disable']) {
    const original = proto[name];
    proto[name] = function(cap) {
      const ctx = context(this);
      if (ctx.enabled && same(ctx.values,cap,name,undefined,undefined,undefined)) return;
      return original.call(this,cap);
    };
  }
  const activeTexture = proto.activeTexture;
  proto.activeTexture = function(unit) {
    const ctx = context(this);
    if (ctx.enabled && ctx.activeTexture === unit) { control.skipped++; return; }
    ctx.activeTexture = unit; return activeTexture.call(this,unit);
  };
  const bindTexture = proto.bindTexture;
  proto.bindTexture = function(target,texture) {
    const ctx = context(this);
    // Until activeTexture is observed, do not assume the currently selected unit.
    if (ctx.enabled && ctx.activeTexture !== undefined) {
      let unit = ctx.textures.get(ctx.activeTexture);
      if (!unit) ctx.textures.set(ctx.activeTexture, unit = new Map());
      if (same(unit,target,texture,undefined,undefined,undefined)) return;
    }
    return bindTexture.call(this,target,texture);
  };
  const bindVertexArray = proto.bindVertexArray;
  proto.bindVertexArray = function(vao) {
    const ctx = context(this);
    if (ctx.enabled && ctx.vao === vao) { control.skipped++; return; }
    ctx.vao = vao; return bindVertexArray.call(this,vao);
  };
  const bindBuffer = proto.bindBuffer;
  proto.bindBuffer = function(target,buffer) {
    const ctx = context(this);
    if (target !== this.ARRAY_BUFFER && target !== this.ELEMENT_ARRAY_BUFFER && target !== this.UNIFORM_BUFFER) return bindBuffer.call(this,target,buffer);
    const map = target === this.ELEMENT_ARRAY_BUFFER ? ctx.elements : ctx.buffers;
    const key = target === this.ELEMENT_ARRAY_BUFFER ? ctx.vao : target;
    if (ctx.enabled && (target !== this.ELEMENT_ARRAY_BUFFER || ctx.vao !== undefined) && same(map,key,buffer,undefined,undefined,undefined)) return;
    return bindBuffer.call(this,target,buffer);
  };
  for (const name of ['bindBufferBase','bindBufferRange']) {
    const original = proto[name];
    proto[name] = function(target,index,buffer,offset,size) {
      const ctx = context(this);
      if (ctx.enabled && target === this.UNIFORM_BUFFER) {
        let bindings = ctx.indexed.get(target);
        if (!bindings) ctx.indexed.set(target, bindings = new Map());
        const current = ctx.buffers.get(target);
        // Indexed binding also changes the generic binding, even if the indexed slot matches.
        const old = bindings.get(index);
        const rangeOffset = name === 'bindBufferBase' ? null : offset;
        const rangeSize = name === 'bindBufferBase' ? null : size;
        if (current?.[0] === buffer && old?.[0] === buffer && old[1] === rangeOffset && old[2] === rangeSize) { control.skipped++; return; }
        bindings.set(index, old || [buffer,rangeOffset,rangeSize]);
        if (old) { old[0]=buffer; old[1]=rangeOffset; old[2]=rangeSize; }
        if (current) current[0]=buffer; else ctx.buffers.set(target,[buffer]);
      }
      return name === 'bindBufferBase' ? original.call(this,target,index,buffer) : original.call(this,target,index,buffer,offset,size);
    };
  }
  const uniform1i = proto.uniform1i;
  proto.uniform1i = function(location,value) {
    const ctx = context(this);
    if (ctx.enabled && location !== null) {
      if (ctx.uniforms.has(location) && ctx.uniforms.get(location) === value) { control.skipped++; return; }
      ctx.uniforms.set(location,value);
    }
    return uniform1i.call(this,location,value);
  };
  const uniform1iv = proto.uniform1iv;
  proto.uniform1iv = function(location,values,offset,length) {
    const ctx = contexts.get(this); if (ctx && location) ctx.uniforms.delete(location);
    return uniform1iv.call(this,location,values,offset,length);
  };
  // Relinking clears uniforms; deletion implicitly unbinds objects. Reset all affected caches.
  for (const name of ['linkProgram','deleteProgram','deleteTexture','deleteBuffer','deleteVertexArray']) {
    const original = proto[name];
    proto[name] = function(object) {
      const ctx = contexts.get(this); if (ctx) reset(ctx);
      return original.call(this,object);
    };
  }
})();
