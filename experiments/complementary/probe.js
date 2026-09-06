import {drawScene} from './scene.js';
const canvas=document.querySelector('canvas');
const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});
const report={programs:{},scope:'Original LOW terrain and shadow, synthetic scene, no final composite'};
const linked={};
window.probeReport=report;
try {
  if(!gl) throw Error('WebGL2 unavailable');
  const pack=await (await fetch('pack.json')).json();
  report.pack=pack.pack; report.sha256=pack.sha256; report.profile=pack.profile;
  report.gpu=gl.getParameter(gl.RENDERER);
  report.limits={drawBuffers:gl.getParameter(gl.MAX_DRAW_BUFFERS),colorAttachments:gl.getParameter(gl.MAX_COLOR_ATTACHMENTS)};
  for(const [name,stages] of Object.entries(pack.programs)) {
    const result=report.programs[name]={};const program=gl.createProgram();
    for(const [stage,source] of Object.entries(stages)) {
      if(stage==='defaults') continue;
      const shader=gl.createShader(stage==='vsh'?gl.VERTEX_SHADER:gl.FRAGMENT_SHADER);
      gl.shaderSource(shader,source);gl.compileShader(shader);
      result[stage]={compiled:gl.getShaderParameter(shader,gl.COMPILE_STATUS),log:gl.getShaderInfoLog(shader)};
      gl.attachShader(program,shader);
    }
    gl.linkProgram(program);result.linked=gl.getProgramParameter(program,gl.LINK_STATUS);result.log=gl.getProgramInfoLog(program);
    if(result.linked) linked[name]=program;
  }
  if(Object.keys(linked).length===2) report.scene=drawScene(gl,linked,pack);
}catch(error){report.error=String(error)}
document.querySelector('#result').textContent=JSON.stringify(report,null,2);
