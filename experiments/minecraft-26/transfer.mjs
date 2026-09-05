import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { compileTools, flags, java, run, work } from './common.mjs';

const { values } = parseArgs({ options: {
  test: { type: 'boolean' },
  'old-world': { type: 'string' },
  'fresh-world': { type: 'string' },
  output: { type: 'string' },
  'verify-player': { type: 'string' },
  expected: { type: 'string' },
} });
if (values['verify-player'] && !values.expected) throw new Error('--verify-player requires --expected EXPORTED_PLAYER_FILE');
if (!values.test && !values['verify-player'] && (!values['old-world'] || !values['fresh-world'] || !values.output)) {
  throw new Error('Use --old-world BACKUP_WORLD --fresh-world NEW_26_WORLD --output NEW_DIRECTORY, or --test');
}
const cp = await compileTools();
if (values['verify-player']) {
  await run(java, [...flags, '-Xmx2G', '-cp', cp, 'InventoryVerify', path.resolve(values.expected), path.resolve(values['verify-player'])], { cwd: work });
} else if (values.test) {
  const directory = await fs.mkdtemp(path.join(work, 'inventory-test-'));
  await run(java, [...flags, '-Xmx2G', '-cp', cp, 'InventoryTransferTest', directory], { cwd: work });
  console.log(`Test evidence: ${directory}`);
} else {
  await run(java, [...flags, '-Xmx2G', '-cp', cp, 'InventoryTransfer',
    path.resolve(values['old-world']), path.resolve(values['fresh-world']), path.resolve(values.output)], { cwd: work });
}
