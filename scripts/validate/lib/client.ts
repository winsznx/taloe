/**
 * Construct the same `BinanceWeb3Client` the product uses, for standalone
 * validation scripts. Deliberately imports from `@taloe/binance-web3` rather
 * than reimplementing signing, so what these scripts observe is exactly what
 * the product would observe — no separate, drifting "test client."
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  BinanceWeb3Client,
  RwaService,
  TokenService,
  TradingService,
  TransactionService,
  WalletService,
} from "@taloe/binance-web3";

import { loadEnv } from "./env";
import type { ApiObservation } from "@taloe/binance-web3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

export function requireCredentials(): { apiKey: string; apiSecret: string; baseUrl: string; chainId: string } {
  loadEnv(REPO_ROOT);
  const apiKey = process.env.BINANCE_WEB3_API_KEY;
  const apiSecret = process.env.BINANCE_WEB3_API_SECRET;
  const baseUrl = process.env.BINANCE_WEB3_BASE_URL ?? "https://web3.binance.com/build";
  const chainId = process.env.TALOE_BINANCE_CHAIN_ID ?? "56";

  if (!apiKey || !apiSecret) {
    console.error(
      "BLOCKED_CREDENTIALS: BINANCE_WEB3_API_KEY and BINANCE_WEB3_API_SECRET are not set.\n" +
        "Copy .env.example to .env.local and fill them in from " +
        "https://web3.binance.com/en/dev-portal/project before running validation scripts.",
    );
    process.exit(1);
  }
  return { apiKey, apiSecret, baseUrl, chainId };
}

export interface ValidationServices {
  readonly rwa: RwaService;
  readonly token: TokenService;
  readonly trading: TradingService;
  readonly transaction: TransactionService;
  readonly wallet: WalletService;
  readonly chainId: string;
  readonly observations: ApiObservation[];
}

export function buildServices(): ValidationServices {
  const { apiKey, apiSecret, baseUrl, chainId } = requireCredentials();
  const observations: ApiObservation[] = [];
  const client = new BinanceWeb3Client({
    apiKey,
    apiSecret,
    baseUrl,
    onObservation: (observation) => observations.push(observation),
  });
  return {
    rwa: new RwaService(client),
    token: new TokenService(client),
    trading: new TradingService(client),
    transaction: new TransactionService(client),
    wallet: new WalletService(client),
    chainId,
    observations,
  };
}

export { REPO_ROOT };
