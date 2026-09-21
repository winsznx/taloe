/**
 * Asset-aware amount conversion.
 *
 * Correction (build report V1 review): nothing in Taloe may assume a fixed
 * decimals count for any token. BEP-20 USDT on BSC happens to use 18
 * decimals, but that is a fact about one specific contract, not a rule about
 * "the spend token" or "a token" in general — other funding assets, other
 * wrapper tokens, and USDT on other chains do not share it. A hardcoded `18`
 * anywhere in a conversion path is a latent bug waiting for the first asset
 * that does not use it.
 *
 * `AssetMetadata` is the only place decimals may come from at a call site.
 * `HumanAmount` is a human-typed decimal string (what a user types into a
 * form) and is meaningless without an `AssetMetadata` to convert it against —
 * pairing the two in every function signature below makes it structurally
 * awkward to smuggle a bare number through the conversion path.
 */

import { fromBaseUnits, fromDecimalString, toBaseUnits, toDecimalString } from "./money";

/** Identity and precision of one token, resolved from a real source. */
export interface AssetMetadata {
  readonly symbol: string;
  readonly contractAddress: string;
  readonly decimals: number;
  readonly chainId: string;
  /** Where this metadata came from — a fixture, a live token-list call, etc. */
  readonly provenance: string;
}

/** A decimal amount as a human typed it, not yet tied to base units. */
export interface HumanAmount {
  readonly decimalString: string;
}

export class AssetAmountError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AssetAmountError";
  }
}

/** Convert a human-typed amount into base units, using the asset's OWN decimals. */
export function toBaseUnitAmount(human: HumanAmount, asset: AssetMetadata): string {
  let fixed: bigint;
  try {
    fixed = fromDecimalString(human.decimalString);
  } catch (cause) {
    throw new AssetAmountError(
      `"${human.decimalString}" is not a decimal amount Taloe can read`,
      { cause },
    );
  }
  if (fixed <= 0n) {
    throw new AssetAmountError("amount must be greater than zero");
  }
  return toBaseUnits(fixed, asset.decimals);
}

/** Convert base units back into a human decimal string, using the asset's OWN decimals. */
export function fromBaseUnitAmount(baseUnits: string, asset: AssetMetadata): HumanAmount {
  if (!/^-?\d+$/.test(baseUnits)) {
    throw new AssetAmountError(`"${baseUnits}" is not a base-unit integer string`);
  }
  return { decimalString: toDecimalString(fromBaseUnits(baseUnits, asset.decimals)) };
}
