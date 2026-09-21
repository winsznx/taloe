/**
 * Evidence capture for the live validation harness.
 *
 * Two outputs per run, kept deliberately separate:
 *
 *  - a raw NDJSON artifact under internal/evidence/runtime/, one line per
 *    sponsor call, credentials already stripped by the client's own
 *    redaction (see @taloe/shared redactHeaders);
 *  - a normalized markdown summary printed to stdout and optionally saved,
 *    for pasting straight into CLAIM_LEDGER.md / SPONSOR_FINDINGS.md.
 *
 * Every capture is labelled with an observation date, and nothing this
 * module writes may be quoted as evidence until it has actually run against
 * live credentials — synthetic/fixture runs never pass through here.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { ApiObservation } from "@taloe/binance-web3";
import { redactValue } from "@taloe/shared";

import { REPO_ROOT } from "./client";

const RUNTIME_DIR = resolve(REPO_ROOT, "internal", "evidence", "runtime");

export interface CaptureContext {
  readonly command: string;
  readonly startedAt: string;
}

export function beginCapture(command: string): CaptureContext {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  return { command, startedAt: new Date().toISOString() };
}

/** Append every observation from one run as NDJSON, secrets already redacted upstream. */
export function writeObservations(context: CaptureContext, observations: readonly ApiObservation[]): string {
  const filePath = resolve(RUNTIME_DIR, `${context.command}-${fileStamp(context.startedAt)}.ndjson`);
  const lines = observations.map((observation) => JSON.stringify(redactValue(observation)));
  appendFileSync(filePath, lines.map((line) => `${line}\n`).join(""), "utf8");
  return filePath;
}

/** Append an arbitrary structured artifact (a decoded response body, etc). */
export function writeArtifact(context: CaptureContext, label: string, data: unknown): string {
  const filePath = resolve(RUNTIME_DIR, `${context.command}-${label}-${fileStamp(context.startedAt)}.json`);
  appendFileSync(filePath, JSON.stringify(redactValue(data), null, 2), "utf8");
  return filePath;
}

export function printObservationTable(observations: readonly ApiObservation[]): void {
  if (observations.length === 0) {
    console.log("(no requests were made)");
    return;
  }
  console.log(
    [
      "endpoint".padEnd(50),
      "http".padEnd(6),
      "code".padEnd(8),
      "ms".padEnd(6),
      "outcome",
    ].join(" | "),
  );
  console.log("-".repeat(90));
  for (const observation of observations) {
    console.log(
      [
        observation.endpoint.padEnd(50),
        String(observation.httpStatus ?? "-").padEnd(6),
        String(observation.businessCode ?? "-").padEnd(8),
        String(observation.latencyMs).padEnd(6),
        observation.outcome,
      ].join(" | "),
    );
  }
}

function fileStamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}
