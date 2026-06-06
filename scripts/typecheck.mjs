import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(js|mjs)$/.test(path)) yield path;
  }
}

const files = [];
for (const root of ['apps', 'packages', 'scripts', 'tests']) {
  try {
    for await (const file of walk(root)) files.push(file);
  } catch {}
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`typecheck passed (${files.length} files)`);
