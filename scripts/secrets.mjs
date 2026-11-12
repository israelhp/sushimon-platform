// Detección de secretos por patrones (defensa en profundidad; CI debe sumar gitleaks u otro escáner dedicado).
export const RULES = [
  {
    name: 'Bloque de clave privada',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'Clave Stripe/secret live', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'Anthropic/OpenAI API key', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/ },
  {
    name: 'JWT (posible service_role de Supabase)',
    re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: 'URL de base de datos con credenciales',
    re: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{3,}@(?!localhost|127\.0\.0\.1)[^\s/]+/,
  },
  {
    name: 'Asignación de secreto literal',
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"](?!env\()[^'"\s$<{][^'"]{11,}['"]/i,
  },
];

export function scanText(text) {
  const findings = [];
  text.split('\n').forEach((line, i) => {
    if (line.length > 2000) return; // minificados/base64: fuera de alcance
    for (const rule of RULES)
      if (rule.re.test(line)) findings.push({ line: i + 1, rule: rule.name });
  });
  return findings;
}

export const IGNORED = [
  /^pnpm-lock\.yaml$/,
  /^docs\/references\//,
  /^\.specify\//,
  /(^|\/)secrets(\.test)?\.mjs$/,
  /\.(png|jpe?g|webp|ico|woff2?)$/,
];
