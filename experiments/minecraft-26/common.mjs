import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const source = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(source, '../..');
export const work = path.join(root, 'work/minecraft-26');
export const java = process.env.MC26_JAVA ?? (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java');
export const javac = process.env.MC26_JAVAC ?? (java === 'java' ? 'javac' : path.join(path.dirname(java), 'javac'));
export const flags = ['-Dterminal.jline=false', '-Dterminal.ansi=false', '--enable-native-access=ALL-UNNAMED'];

export async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (${signal ?? code})`)));
  });
}

export async function jars(directory) {
  const paths = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await jars(file));
    else if (entry.isFile() && entry.name.endsWith('.jar')) paths.push(file);
  }
  return paths.sort();
}

export async function compileTools() {
  const classpath = [...await jars(path.join(work, 'runtime/versions')), ...await jars(path.join(work, 'runtime/libraries'))].join(path.delimiter);
  const output = path.join(work, 'tools');
  await fs.mkdir(output, { recursive: true });
  const files = (await fs.readdir(path.join(source, 'java'))).filter(f => f.startsWith('Inventory') && f.endsWith('.java')).map(f => path.join(source, 'java', f));
  await run(javac, ['-encoding', 'UTF-8', '-cp', classpath, '-d', output, ...files]);
  return [classpath, output].join(path.delimiter);
}
