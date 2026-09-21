import "server-only";

/**
 * Server-side configuration.
 *
 * Importing `server-only` means a build fails loudly if any of this is ever
 * pulled into a client bundle. The Binance API secret must never leave the
 * server (PRD 15.1), and a lint rule is weaker than a build error.
 *
 * The data mode is explicit and has no fallback: if live mode is configured and
 * credentials are missing, startup fails rather than quietly serving fixtures.
 * A product that silently degrades to canned data makes every demo and every
 * measurement worthless (DECISIONS.md D-013).
 */

import { z } from "zod";

const envSchema = z.object({
  BINANCE_WEB3_API_KEY: z.string().min(1).optional(),
  BINANCE_WEB3_API_SECRET: z.string().min(1).optional(),
  BINANCE_WEB3_BASE_URL: z.string().url().default("https://web3.binance.com/build"),
  BINANCE_WEB3_RECV_WINDOW_MS: z.coerce.number().int().min(1000).max(60_000).default(5000),
  TALOE_DATA_MODE: z.enum(["live", "fixture"]).default("fixture"),
  TALOE_BINANCE_CHAIN_ID: z.string().default("56"),
  TALOE_BSC_RPC_URL: z.string().url().default("https://bsc-dataseed.bnbchain.org"),
  TALOE_QUOTE_MIN_REMAINING_MS: z.coerce.number().int().positive().default(8000),
  TALOE_DEFAULT_MAX_DEVIATION_BPS: z.coerce.number().int().positive().default(150),
});

export type DataMode = "live" | "fixture";

export interface ServerConfig {
  readonly dataMode: DataMode;
  readonly binanceChainId: string;
  readonly bscRpcUrl: string;
  readonly quoteMinRemainingMs: number;
  readonly defaultMaxDeviationBps: number;
  /** Present only in live mode. */
  readonly binance: {
    readonly apiKey: string;
    readonly apiSecret: string;
    readonly baseUrl: string;
    readonly recvWindowMs: number;
  } | null;
}

let cached: ServerConfig | null = null;

export function getServerConfig(): ServerConfig {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment:\n${parsed.error.issues
        .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  const env = parsed.data;

  if (env.TALOE_DATA_MODE === "live" && (!env.BINANCE_WEB3_API_KEY || !env.BINANCE_WEB3_API_SECRET)) {
    throw new Error(
      "TALOE_DATA_MODE=live requires BINANCE_WEB3_API_KEY and BINANCE_WEB3_API_SECRET. " +
        "Taloe does not fall back to fixtures when live credentials are missing.",
    );
  }

  cached = {
    dataMode: env.TALOE_DATA_MODE,
    binanceChainId: env.TALOE_BINANCE_CHAIN_ID,
    bscRpcUrl: env.TALOE_BSC_RPC_URL,
    quoteMinRemainingMs: env.TALOE_QUOTE_MIN_REMAINING_MS,
    defaultMaxDeviationBps: env.TALOE_DEFAULT_MAX_DEVIATION_BPS,
    binance:
      env.BINANCE_WEB3_API_KEY && env.BINANCE_WEB3_API_SECRET
        ? {
            apiKey: env.BINANCE_WEB3_API_KEY,
            apiSecret: env.BINANCE_WEB3_API_SECRET,
            baseUrl: env.BINANCE_WEB3_BASE_URL,
            recvWindowMs: env.BINANCE_WEB3_RECV_WINDOW_MS,
          }
        : null,
  };
  return cached;
}

/**
 * Safe to send to the browser. Contains no credential material, and is checked
 * against that by test rather than by convention.
 */
export function getPublicConfig(): {
  dataMode: DataMode;
  binanceChainId: string;
  defaultMaxDeviationBps: number;
} {
  const config = getServerConfig();
  return {
    dataMode: config.dataMode,
    binanceChainId: config.binanceChainId,
    defaultMaxDeviationBps: config.defaultMaxDeviationBps,
  };
}
