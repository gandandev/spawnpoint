import fs from 'node:fs/promises';
import path from 'node:path';
import { source, work, jars, java, javac, flags, run } from './common.mjs';
const directory = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Pass a new output directory');
await fs.mkdir(directory, { recursive: false });
const plugin = path.join(directory, 'plugin-build');
await fs.mkdir(plugin);
const classpath = [...await jars(path.join(work, 'runtime/versions')), ...await jars(path.join(work, 'runtime/libraries'))].join(path.delimiter);
await run(javac, ['-proc:none', '-encoding', 'UTF-8', '-cp', classpath, '-d', plugin, path.join(source, 'java/FreshSpawn.java')]);
await fs.writeFile(path.join(plugin, 'plugin.yml'), 'name: FreshSpawn\nversion: 1.0.0\nmain: FreshSpawn\napi-version: \'26.2\'\n');
await fs.mkdir(path.join(directory, 'plugins'));
await run(path.join(path.dirname(javac), 'jar'), ['--create', '--file', path.join(directory, 'plugins/FreshSpawn.jar'), '-C', plugin, '.']);
await fs.copyFile(path.join(work, 'runtime/paper-26.2-121.jar'), path.join(directory, 'paper.jar'));
for (const folder of ['cache', 'libraries', 'versions']) {
  await fs.cp(path.join(work, 'runtime', folder), path.join(directory, folder), { recursive: true });
}
await fs.writeFile(path.join(directory, 'eula.txt'), 'eula=true\n');
await fs.writeFile(path.join(directory, 'server.properties'), 'server-ip=127.0.0.1\nserver-port=25585\nonline-mode=false\nlevel-name=world\nview-distance=6\nsimulation-distance=4\nmax-players=0\n');
await run(java, [...flags, '-Xms256M', '-Xmx2G', '-jar', 'paper.jar', '--nogui'], { cwd: directory });
console.log(`Generated fresh terrain in ${directory}/world. Require VERIFIED_FRESH_SPAWN in the log before export.`);
