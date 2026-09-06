import {Matrix4, Matrix3, PerspectiveCamera, OrthographicCamera, BoxGeometry, PlaneGeometry} from './three.module.js';

// A deterministic fixture, not captured Minecraft terrain. The original programs
// receive synthetic material/atlas data, plus a real depth-comparison shadow map.
export function drawScene(gl, programs, pack) {
  const W=640,H=400,S=1024;
  const camera=new PerspectiveCamera(55,W/H,.1,128);
  camera.position.set(10,8,13);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const sun=new OrthographicCamera(-16,16,16,-16,.1,80);
  sun.position.set(-12,20,10);sun.lookAt(0,0,0);sun.updateMatrixWorld();
  const identity=new Matrix4();
  const objects=[{geometry:new PlaneGeometry(22,22).rotateX(-Math.PI/2),color:[.5,.7,.35,1]},
    {geometry:new BoxGeometry(3,5,3).translate(0,2.5,0),color:[.75,.55,.3,1]},
    {geometry:new BoxGeometry(2,2,2).translate(-5,1,-2),color:[.4,.55,.8,1]}];
  function texture(internal,w,h,format,type,data=null) {
    const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,data);
    for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);
    for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
    return t;
  }
  const white=texture(gl.RGBA8,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
  const shadow=texture(gl.DEPTH_COMPONENT24,S,S,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_FUNC,gl.LEQUAL);
  const shadowColor=texture(gl.RGBA8,S,S,gl.RGBA,gl.UNSIGNED_BYTE);
  function framebuffer(colors,depth) {
    const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);
    colors.forEach((t,i)=>gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0));
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,depth,0);
    gl.drawBuffers(colors.map((_,i)=>gl.COLOR_ATTACHMENT0+i));
    const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);if(status!==gl.FRAMEBUFFER_COMPLETE)throw Error(`Framebuffer ${status}`);
    return f;
  }
  const shadowFbo=framebuffer([shadowColor],shadow);
  // Raw terrain outputs are shown without Complementary's deferred/composite stages.
  const color=texture(gl.RGBA8,W,H,gl.RGBA,gl.UNSIGNED_BYTE);
  const material=texture(gl.RGBA8,W,H,gl.RGBA,gl.UNSIGNED_BYTE);
  const depth=texture(gl.DEPTH_COMPONENT24,W,H,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT);
  const terrainFbo=framebuffer([color,material],depth);
  function render(program,shadowPass) {
    gl.useProgram(program);
    const view=shadowPass?sun.matrixWorldInverse:camera.matrixWorldInverse;
    const projection=shadowPass?sun.projectionMatrix:camera.projectionMatrix;
    const values={sp_ModelView:view.elements,sp_MVP:new Matrix4().multiplyMatrices(projection,view).elements,
      sp_Projection:projection.elements,sp_NormalMatrix:new Matrix3().getNormalMatrix(view).elements,
      'sp_TextureMatrix[0]':Array.from({length:8},()=>identity.elements).flat(),
      gbufferModelView:camera.matrixWorldInverse.elements,gbufferModelViewInverse:camera.matrixWorld.elements,
      gbufferProjection:camera.projectionMatrix.elements,gbufferProjectionInverse:camera.projectionMatrixInverse.elements,
      shadowModelView:sun.matrixWorldInverse.elements,shadowModelViewInverse:sun.matrixWorld.elements,
      shadowProjection:sun.projectionMatrix.elements,shadowProjectionInverse:sun.projectionMatrixInverse.elements,
      sunAngle:.25,worldTime:6000,worldDay:1,far:128,near:.1,screenBrightness:.5,cloudHeight:192,
      viewWidth:W,viewHeight:H,aspectRatio:W/H,eyeBrightness:[240,240],atlasSize:[1,1],
      skyColor:[.45,.65,.9],fogColor:[.6,.7,.8],cameraPosition:[0,0,0],previousCameraPosition:[0,0,0]};
    for(const [key,value] of Object.entries(pack.programs[shadowPass?'shadow':'gbuffers_terrain'].defaults)) {
      if(!(key in values))values[key]=value==='false'?0:value==='true'?1:Number(value);
    }
    for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++) {
      const u=gl.getActiveUniform(program,i),loc=gl.getUniformLocation(program,u.name),v=values[u.name];
      if(u.type===gl.SAMPLER_2D || u.type===gl.SAMPLER_2D_SHADOW) {
        const unit=u.type===gl.SAMPLER_2D_SHADOW?1:0;gl.activeTexture(gl.TEXTURE0+unit);
        gl.bindTexture(gl.TEXTURE_2D,unit?shadow:white);gl.uniform1i(loc,unit);continue;
      }
      if(v===undefined) continue;
      const calls=new Map([[gl.FLOAT,'uniform1f'],[gl.INT,'uniform1i'],[gl.BOOL,'uniform1i'],[gl.FLOAT_VEC2,'uniform2fv'],[gl.FLOAT_VEC3,'uniform3fv'],[gl.FLOAT_VEC4,'uniform4fv'],[gl.INT_VEC2,'uniform2iv'],[gl.INT_VEC3,'uniform3iv']]);
      if(u.type===gl.FLOAT_MAT4)gl.uniformMatrix4fv(loc,false,v);
      else if(u.type===gl.FLOAT_MAT3)gl.uniformMatrix3fv(loc,false,v);
      else if(calls.has(u.type))gl[calls.get(u.type)](loc,v);
      else throw Error(`Unmapped uniform ${u.name}`);
    }
    for(const object of objects) {
      const g=object.geometry.index?object.geometry.toNonIndexed():object.geometry;
      const vao=gl.createVertexArray();gl.bindVertexArray(vao);
      const buffers=[];
      for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);i++) {
        const a=gl.getActiveAttrib(program,i),loc=gl.getAttribLocation(program,a.name);
        const attr={sp_Vertex:g.attributes.position,sp_Normal:g.attributes.normal,sp_UV0:g.attributes.uv}[a.name];
        if(attr){const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,attr.array,gl.STATIC_DRAW);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,attr.itemSize,gl.FLOAT,false,0,0);}
        else {gl.disableVertexAttribArray(loc);gl.vertexAttrib4fv(loc,a.name==='sp_Color'?object.color:a.name==='sp_UV1'?[1,1,0,1]:a.name==='mc_midTexCoord'?[.5,.5,0,0]:[0,0,0,1]);}
      }
      gl.drawArrays(gl.TRIANGLES,0,g.attributes.position.count);
      buffers.forEach(b=>gl.deleteBuffer(b));gl.deleteVertexArray(vao);
    }
  }
  gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
  gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFbo);gl.viewport(0,0,S,S);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);render(programs.shadow,true);
  const shadowError=gl.getError();
  function terrain(){gl.bindFramebuffer(gl.FRAMEBUFFER,terrainFbo);gl.viewport(0,0,W,H);gl.clearColor(.08,.11,.16,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);render(programs.gbuffers_terrain,false);const pixels=new Uint8Array(W*H*4);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;}
  const withShadow=terrain();const terrainError=gl.getError();
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,terrainFbo);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);
  gl.blitFramebuffer(0,0,W,H,0,0,W,H,gl.COLOR_BUFFER_BIT,gl.NEAREST);
  // Clear only the depth map for an A/B check; render identical geometry again.
  gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFbo);gl.clear(gl.DEPTH_BUFFER_BIT);
  const withoutShadow=terrain();let changed=0,maxDelta=0;
  for(let i=0;i<withShadow.length;i+=4){const d=Math.max(...[0,1,2].map(k=>Math.abs(withShadow[i+k]-withoutShadow[i+k])));if(d>2)changed++;maxDelta=Math.max(maxDelta,d);}
  return {shadowError,terrainError,finalError:gl.getError(),shadowAffectedPixels:changed,maxChannelDelta:maxDelta,width:W,height:H,shadowSize:S,fixture:'3 objects, white 1x1 atlas, raw terrain output; no full pack composition'};
}
