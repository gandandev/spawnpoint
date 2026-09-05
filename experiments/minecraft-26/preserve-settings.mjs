import fs from 'node:fs/promises';
export async function preserveSettings(legacyFile, modernFile) {
  const old = new Map((await fs.readFile(legacyFile,'utf8')).split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
  const keep = ['motd','max-players','difficulty','gamemode','force-gamemode','view-distance','player-idle-timeout','pvp','allow-flight','hardcore','allow-nether','generate-structures','spawn-animals','spawn-monsters','spawn-npcs','white-list','enable-command-block','spawn-protection'];
  for (const [key,values] of [['difficulty',['peaceful','easy','normal','hard']],['gamemode',['survival','creative','adventure','spectator']]]) if (/^\d$/.test(old.get(key)||'')) old.set(key,values[Number(old.get(key))]);
  let current = await fs.readFile(modernFile,'utf8');
  for(const key of keep) if(old.has(key)) {
    const pattern = new RegExp('^'+key+'=.*$','m');
    current = pattern.test(current) ? current.replace(pattern,key+'='+old.get(key)) : current+'\n'+key+'='+old.get(key)+'\n';
  }
  await fs.writeFile(modernFile,current);
}
