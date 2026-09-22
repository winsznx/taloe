#!/usr/bin/env -S npx tsx
/**
 * Raw evidence probe: one signed request, untouched response body saved
 * (credentials never appear in the body or in our stored headers).
 * Exists because schema-parsed output can hide fields we guessed wrong.
 *
 * Usage: pnpm validate:raw --path /api/v1/dex/market/rwa/platforms [--q key=value ...] [--label name]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { redactHeaders, redactValue } from "@taloe/shared";
import { signRequest } from "@taloe/binance-web3";

import { parseArgs } from "./lib/args";
import { REPO_ROOT, requireCredentials } from "./lib/client";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const path = args.path;
  if (!path) {
    console.error("Usage: pnpm validate:raw --path /api/v1/... [--q k=v ...] [--label x]");
    process.exit(1);
  }
  const query: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--q" && argv[i + 1]) {
      const [k, ...rest] = argv[i + 1]!.split("=");
      if (k) query[k] = rest.join("=");
    }
  }
  const { apiKey, apiSecret, baseUrl } = requireCredentials();
  const signed = signRequest({ apiKey, apiSecret, method: "GET", path, query });
  const started = performance.now();
  const response = await fetch(`${baseUrl}${signed.requestPath.slice("/build".length)}`, { headers: signed.headers });
  const latencyMs = Math.round(performance.now() - started);
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = resolve(REPO_ROOT, "internal", "evidence", "runtime", `raw-${args.label ?? path.split("/").filter(Boolean).slice(-2).join("-")}-${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      redactValue({ observedAt: new Date().toISOString(), method: "GET", path, query, httpStatus: response.status, latencyMs, responseHeaders: redactHeaders(response.headers), body }),
      null,
      2,
    ),
  );
  console.log(`HTTP ${response.status} in ${latencyMs}ms -> ${file}`);
}
void main();
