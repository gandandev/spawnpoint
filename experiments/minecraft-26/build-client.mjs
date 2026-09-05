import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { source, work } from './common.mjs';
import path from 'node:path';
export async function buildClient() {
  const artifacts = JSON.parse(await fs.readFile(path.join(source, 'artifacts.json'), 'utf8'));
  const artifact = Object.values(artifacts).find(a => a.file === 'client/classes.js');
  let code = await fs.readFile(path.join(work, artifact.file), 'utf8');
  if (createHash('sha256').update(code).digest('hex') !== artifact.sha256) throw new Error('Unknown client build, refusing symbol patches');
  const patch = (before, after) => {
    if (code.split(before).length !== 2) throw new Error(`Client patch anchor changed: ${before.slice(0,80)}`);
    code = code.replace(before, after);
  };
  // Hooks run inside the existing TeaVM thread. They must not invoke suspended Java methods.
  patch('a.lir=AWz(b);return;', 'a.lir=AWz(b);globalThis.spawnpoint26Options?.(a,Bi,CNs,CLF,HRQ,DGD,EN,FHj);return;');
  patch('b=a.eTy;c=a.eSH.hjd.eTb.eSp;', 'b=a.eTy;globalThis.spawnpoint26Client?.(a);c=globalThis.spawnpoint26GuiScale?.(b.e9K,b.e$k)??a.eSH.hjd.eTb.eSp;');
  // TeaVM emits double arithmetic for these float model coordinates. Observed
  // ~1e-8 differences caused thousands of model-bake exceptions on cold load.
  patch('s===d.eTi&&t===d.eTh&&u===d.eTk', 'Math.abs(s-d.eTi)<=1e-6&&Math.abs(t-d.eTh)<=1e-6&&Math.abs(u-d.eTk)<=1e-6');
  patch('d.shaderSource(b,FS(c));', 'd.shaderSource(b,globalThis.spawnpoint26Shader?.(FS(c))??FS(c));');
  patch('c.useProgram(b);return;', 'c.useProgram(b);globalThis.spawnpoint26Program?.(c,b);return;');
  patch('case 0:Ke();c=NZ5(WP);', 'case 0:Ke();globalThis.spawnpoint26Frame?.();c=NZ5(WP);');
  // A muted stream must not be reopened every time the upstream audio stub ends it.
  patch('if(a.fbT===null){a.e8M=f-1|0;if(f<=0){b=b.fKc;$p=9;continue _;}}', 'if(a.fbT===null){if(a.e9B.eSH.h_6.e5V.data[1].eTb.eS_<=0){a.e8M=100;return;}a.e8M=f-1|0;if(f<=0){b=b.fKc;$p=9;continue _;}}');
  await fs.writeFile(path.join(work, 'client/classes-patched.js'), code);
  console.log('Built guarded browser client hooks');
}
if (process.argv[1] === new URL(import.meta.url).pathname) await buildClient();
