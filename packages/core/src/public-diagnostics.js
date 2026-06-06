const RAW_UNSAFE_PUBLIC_DIAGNOSTIC = /(secret|token|password|passwd|private[_ -]?key|api[_ -]?key|credential|authorization|auth[_ -]?key|bearer\s+|https?:\/\/|localhost|127\.0\.0\.1|\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|(?:[A-Za-z0-9-]+\.)+(?:local|internal|lan|corp|prod|dev|test)(?::\d+)?\b|\bat\s+[^\n]+:\d+:\d+)/i;
const NORMALIZED_UNSAFE_PUBLIC_DIAGNOSTIC = /(secret|token|password|passwd|private\s*key|api\s*key|credential|authorization|auth\s*key|bearer|buy|sell|매수|매도|position\s*siz(e|ing)?|포지션\s*사이즈|ignore\s+(the\s+)?(all\s+)?(previous\s+)?instructions|system\s+prompt|developer\s+message|override\s+instructions)/i;
const COMPACT_UNSAFE_PUBLIC_DIAGNOSTIC = /(secret|token|password|passwd|privatekey|apikey|credential|authorization|authkey|bearer|buy|sell|positionsiz(e|ing)?|ignore(the)?(all)?(previous)?instructions|systemprompt|developermessage|overrideinstructions)/i;

function normalizedDiagnosticText(text) {
  return text.normalize('NFKC').replace(/[\s._-]+/g, ' ').trim();
}

function compactDiagnosticText(text) {
  return normalizedDiagnosticText(text).replace(/\s+/g, '');
}

function isUnsafePublicDiagnosticText(text) {
  if (RAW_UNSAFE_PUBLIC_DIAGNOSTIC.test(text)) return true;
  const normalized = normalizedDiagnosticText(text);
  if (NORMALIZED_UNSAFE_PUBLIC_DIAGNOSTIC.test(normalized)) return true;
  return COMPACT_UNSAFE_PUBLIC_DIAGNOSTIC.test(compactDiagnosticText(text));
}

function collectDiagnosticStrings(value, output = []) {
  if (value == null) return output;
  if (typeof value === 'string') {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDiagnosticStrings(item, output);
    return output;
  }
  if (typeof value === 'object') {
    for (const nested of Object.values(value)) collectDiagnosticStrings(nested, output);
  }
  return output;
}

export function hasUnsafePublicDiagnostics(...values) {
  return values.flatMap((value) => collectDiagnosticStrings(value)).some(isUnsafePublicDiagnosticText);
}

export function sanitizePublicDiagnosticText(text, fallback = null, { maxLength = 240 } = {}) {
  if (text == null) return null;
  if (typeof text !== 'string') return fallback;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) return fallback;
  if (isUnsafePublicDiagnosticText(trimmed)) return fallback;
  return trimmed;
}
