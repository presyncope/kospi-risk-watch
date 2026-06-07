import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../../..', import.meta.url));
const defaultEnvPath = join(rootDir, '.env');

function stripInlineComment(value) {
  let quoted = false;
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      if (!quoted) {
        quoted = true;
        quote = char;
      } else if (quote === char) {
        quoted = false;
        quote = '';
      }
    }
    if (!quoted && char === '#' && /\s/.test(value[index - 1] ?? '')) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function unescapeDoubleQuoted(value) {
  return value.replace(/\\([nrt"\\])/g, (_, escaped) => {
    if (escaped === 'n') return '\n';
    if (escaped === 'r') return '\r';
    if (escaped === 't') return '\t';
    return escaped;
  });
}

function normalizeEnvValue(rawValue) {
  const value = stripInlineComment(rawValue.trim());
  if (value.length < 2) return value;

  const first = value[0];
  const last = value[value.length - 1];
  if (first === "'" && last === "'") return value.slice(1, -1);
  if (first === '"' && last === '"') return unescapeDoubleQuoted(value.slice(1, -1));
  return value;
}

export function parseEnvFileContent(content) {
  const parsed = {};
  const lines = content.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const line = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`invalid_env_line:${index + 1}`);
    }

    parsed[match[1]] = normalizeEnvValue(match[2] ?? '');
  });

  return parsed;
}

export function loadEnvFile({ path, env = process.env, override = false } = {}) {
  const envPath = path ?? env.KOSPI_ENV_FILE ?? defaultEnvPath;
  let content;
  try {
    content = readFileSync(envPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { loaded: false, path: envPath, keys: [] };
    throw error;
  }

  const parsed = parseEnvFileContent(content);
  const keys = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (override || env[key] === undefined) {
      env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, path: envPath, keys };
}
