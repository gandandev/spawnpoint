import fs from 'node:fs/promises';
import path from 'node:path';
import { work, source, javac, run } from './common.mjs';
const output = path.join(work, 'preview-plugin');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await run(javac, ['-proc:none', '-encoding', 'UTF-8', '-cp', [path.join(work, 'proxy/velocity.jar'), path.join(work, 'proxy/plugins/EaglerXServer.jar')].join(path.delimiter), '-d', output, path.join(source, 'java/PreviewIdentity.java')]);
await fs.writeFile(path.join(output, 'velocity-plugin.json'), JSON.stringify({ id: 'spawnpoint-preview-identity', name: 'Spawnpoint Preview Identity', version: '1.0.0', main: 'dev.spawnpoint.preview.PreviewIdentity', dependencies: [{ id: 'eaglerxserver', optional: false }] }));
await run(path.join(path.dirname(javac), 'jar'), ['--create', '--file', path.join(work, 'PreviewIdentity.jar'), '-C', output, '.']);
