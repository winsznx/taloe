/**
 * Minimal .env loader for standalone validation scripts.
 *
 * The Next.js app loads its own env via Next's tooling; these scripts run
 * outside that, so they load `.env.local` then `.env` (first value wins,
 * matching Next's own precedence) with a small hand-rolled parser rather than
 * adding a dependency for ten lines of logic.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(repoRoot: string): void {
  const merged = {
    ...parseEnvFile(resolve(repoRoot, ".env")),
    ...parseEnvFile(resolve(repoRoot, ".env.local")),
  };
  for (const [key, value] of Object.entries(merged)) {
    process.env[key] ??= value;
  }
}
