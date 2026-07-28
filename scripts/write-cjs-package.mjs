import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'dist', 'cjs', 'package.json');

writeFileSync(target, `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
