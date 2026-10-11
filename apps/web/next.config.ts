import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

/**
 * `.env.local`/`.env` live at the monorepo ROOT (shared with `scripts/validate/*`
 * and `scripts/live/*`), not inside `apps/web/`. Next.js's own automatic env
 * loading only ever looks in its own project directory, so without this,
 * `next dev`/`build`/`start` silently never see the root file at all —
 * `TALOE_DATA_MODE` falls through to its zod default (`fixture`) instead of
 * failing loudly, which is exactly the silent-fallback this product promises
 * never to do. Loaded here, at the top of the config file, so it runs before
 * anything else reads `process.env`. Mirrors `scripts/validate/lib/env.ts`'s
 * precedence (`.env` then `.env.local`, first value wins) without importing
 * across the scripts/apps boundary for twenty lines of logic.
 */
function loadRootEnv(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const parse = (path: string): Record<string, string> => {
    if (!existsSync(path)) return {};
    const out: Record<string, string> = {};
    for (const rawLine of readFileSync(path, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  };
  const merged = { ...parse(resolve(repoRoot, ".env")), ...parse(resolve(repoRoot, ".env.local")) };
  for (const [key, value] of Object.entries(merged)) process.env[key] ??= value;
}
loadRootEnv();

const config: NextConfig = {
  // Workspace packages ship TypeScript source rather than a build artifact, so
  // there is no build step between changing a router rule and seeing it here.
  transpilePackages: [
    "@taloe/binance-web3",
    "@taloe/evidence",
    "@taloe/execution",
    "@taloe/router-core",
    "@taloe/session-mark",
    "@taloe/shared",
  ],
  typedRoutes: true,
};

export default config;
