import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
const source = readFileSync('experiments/minecraft-26/render-state-26.2.js','utf8');
function fixture() {
  const calls: [string, ...unknown[]][] = [];
  const listeners: Record<string, () => void> = {};
  class GL {
    ARRAY_BUFFER = 1; ELEMENT_ARRAY_BUFFER = 2; UNIFORM_BUFFER = 3;
    canvas = { addEventListener: (name: string, handler: () => void) => { listeners[name] = handler; } };
    [key: string]: any;
  }
  for (const name of ['useProgram','depthFunc','depthMask','cullFace','frontFace','lineWidth','polygonOffset','colorMask','viewport','scissor','blendColor','blendFuncSeparate','blendEquationSeparate','blendFunc','blendEquation','enable','disable','activeTexture','bindTexture','bindVertexArray','bindBuffer','bindBufferBase','bindBufferRange','uniform1i','uniform1iv','linkProgram','deleteProgram','deleteTexture','deleteBuffer','deleteVertexArray']) {
    GL.prototype[name] = function(...args: unknown[]) { calls.push([name,...args]); };
  }
  const state: any = {};
  vm.runInNewContext(source,{location:{search:'?launch=test'},URLSearchParams,WebGL2RenderingContext:GL,window:{WebGL2RenderingContext:GL,__spawnpoint262:state}});
  return {gl:new GL(),calls,listeners,control:state.renderState};
}
describe('browser render-state cache',()=>{
  it('skips repeated state but preserves each actual transition and blend aliases',()=>{
    const {gl,calls}=fixture();
    gl.enable(10); gl.enable(10); gl.disable(10); gl.enable(10);
    gl.blendFunc(1,2); gl.blendFuncSeparate(1,2,1,2); gl.blendFuncSeparate(1,2,3,4); gl.blendFunc(1,2);
    expect(calls.map(c=>c[0])).toEqual(['enable','disable','enable','blendFunc','blendFuncSeparate','blendFunc']);
  });
  it('isolates texture units and VAO element buffers',()=>{
    const {gl,calls}=fixture(); const texture={}, a={}, b={}, buffer={};
    gl.activeTexture(0);gl.bindTexture(4,texture);gl.bindTexture(4,texture);
    gl.activeTexture(1);gl.bindTexture(4,texture);
    gl.bindVertexArray(a);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);
    gl.bindVertexArray(b);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);
    gl.bindVertexArray(a);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);
    expect(calls.filter(c=>c[0]==='bindTexture')).toHaveLength(2);
    expect(calls.filter(c=>c[0]==='bindBuffer')).toHaveLength(2);
  });
  it('preserves generic binding side effects of indexed uniform bindings',()=>{
    const {gl,calls}=fixture(); const a={},b={};
    gl.bindBufferRange(gl.UNIFORM_BUFFER,0,a,0,256);
    gl.bindBufferRange(gl.UNIFORM_BUFFER,0,a,0,256);
    gl.bindBuffer(gl.UNIFORM_BUFFER,b);
    gl.bindBufferRange(gl.UNIFORM_BUFFER,0,a,0,256);
    gl.bindBuffer(gl.UNIFORM_BUFFER,a);
    gl.bindBufferBase(gl.UNIFORM_BUFFER,0,a);
    expect(calls.map(c=>c[0])).toEqual(['bindBufferRange','bindBuffer','bindBufferRange','bindBufferBase']);
  });
  it('invalidates uniforms on array updates and relinking',()=>{
    const {gl,calls}=fixture();const location={},program={};
    gl.uniform1i(location,0);gl.uniform1i(location,0);
    gl.uniform1iv(location,new Int32Array([1]));gl.uniform1i(location,0);
    gl.linkProgram(program);gl.uniform1i(location,0);
    expect(calls.filter(c=>c[0]==='uniform1i')).toHaveLength(3);
  });
  it('invalidates deleted bindings, restored contexts and A/B switches',()=>{
    const {gl,calls,listeners,control}=fixture();const p={};
    gl.useProgram(p);gl.useProgram(p);gl.deleteProgram(p);gl.useProgram(p);
    listeners.webglcontextrestored();gl.useProgram(p);
    control.enabled=false;gl.useProgram(p);gl.useProgram(p);
    control.enabled=true;gl.useProgram(p);gl.useProgram(p);
    expect(calls.filter(c=>c[0]==='useProgram')).toHaveLength(6);
  });
});
