// Utilidad compartida: lee el JSON del hook desde stdin y emite la decisión PreToolUse.
export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

export function respond(verdict) {
  if (verdict.decision === 'deny') {
    process.stderr.write(`[sushimon-guard] Bloqueado: ${verdict.reason}\n`);
    process.exit(2);
  }
  if (verdict.decision === 'ask') {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: `[sushimon-guard] ${verdict.reason}`,
        },
      }),
    );
  }
  process.exit(0);
}
