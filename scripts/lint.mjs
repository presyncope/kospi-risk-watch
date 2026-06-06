import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['apps', 'packages', 'scripts', 'tests'];
const forbiddenAdvice = [/\bbuy\b/i, /\bsell\b/i, /매수/, /매도/, /position\s*siz(e|ing)?/i, /포지션\s*사이즈/];
const allowedFiles = new Set(['packages/core/src/policy.js', 'packages/core/src/public-diagnostics.js', 'apps/web/index.html', 'scripts/lint.mjs']);

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
      if (!allowedFiles.has(file)) {
        for (const pattern of forbiddenAdvice) {
          if (pattern.test(text)) {
            console.error(`Potential advice wording in ${file}: ${pattern}`);
            failures += 1;
          }
        }
      }
    }
  } catch {
    // root may not exist yet
  }
}

if (failures > 0) process.exit(1);
console.log('lint passed');
