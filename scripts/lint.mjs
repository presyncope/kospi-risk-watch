import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['apps', 'packages', 'scripts', 'tests'];
// Trade-support wording is intentionally allowed: this is a personal decision-support tool.
// We still rely on packages/core/src/public-diagnostics.js to sanitize *external adapter* text
// (prompt-injection / leaked secrets) at the data boundary — that protection is unchanged.

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

let failures = 0;
for (const root of roots) {
  try {
    for await (const file of walk(root)) {
      if (!/\.(js|mjs|html|css)$/.test(file)) continue;
      const text = await readFile(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        if (/[ \t]+$/.test(line)) {
          console.error(`Trailing whitespace in ${file}:${index + 1}`);
          failures += 1;
        }
      });
    }
  } catch {
    // root may not exist yet
  }
}

if (failures > 0) process.exit(1);
console.log('lint passed');
