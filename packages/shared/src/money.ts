/**
 * Exact decimal arithmetic on token base units.
 *
 * Taloe compares execution outcomes that differ by single basis points. Binary
 * floating point is not acceptable anywhere a user-visible amount or a routing
 * comparison is produced, so every quantity crosses module boundaries as a
 * base-unit integer string plus its decimals.
 */

const SCALE = 1_000_000_000_000_000_000n; // 1e18, the internal fixed-point unit

/** A value carried at 1e18 fixed point. Construct only through this module. */
export type Fixed = bigint;

export const FIXED_ONE: Fixed = SCALE;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

function assertIntegerString(value: string, label: string): void {
  if (!/^-?\d+$/.test(value)) {
    throw new AmountError(`${label} must be an integer string, received "${value}"`);
  }
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new AmountError(`decimals must be an integer in [0, 36], received ${decimals}`);
  }
}

/** Parse a base-unit integer string into 1e18 fixed point. */
export function fromBaseUnits(baseUnits: string, decimals: number): Fixed {
  assertIntegerString(baseUnits, "baseUnits");
  assertDecimals(decimals);
  return (BigInt(baseUnits) * SCALE) / 10n ** BigInt(decimals);
}

/** Render a 1e18 fixed-point value back to a base-unit integer string. */
export function toBaseUnits(value: Fixed, decimals: number): string {
  assertDecimals(decimals);
  return ((value * 10n ** BigInt(decimals)) / SCALE).toString();
}

/**
 * Parse a human decimal string ("123.45", "0.0001") into 1e18 fixed point.
 *
 * Digits beyond 18 decimal places are rejected rather than silently truncated:
 * a routing input we cannot represent exactly is a bug, not a rounding event.
 */
export function fromDecimalString(input: string): Fixed {
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new AmountError(`not a decimal number: "${input}"`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > 18) {
    throw new AmountError(`more than 18 decimal places is not representable: "${input}"`);
  }
  const padded = fraction.padEnd(18, "0");
  const magnitude = BigInt(whole) * SCALE + BigInt(padded === "" ? "0" : padded);
  return negative ? -magnitude : magnitude;
}

/** Render 1e18 fixed point as a plain decimal string with no trailing zeros. */
export function toDecimalString(value: Fixed, maxFractionDigits = 18): string {
  assertDecimals(maxFractionDigits);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / SCALE;
  const fraction = (magnitude % SCALE).toString().padStart(18, "0").slice(0, maxFractionDigits);
  const trimmedFraction = fraction.replace(/0+$/, "");
  const body = trimmedFraction === "" ? whole.toString() : `${whole}.${trimmedFraction}`;
  return negative && magnitude !== 0n ? `-${body}` : body;
}

export function mul(a: Fixed, b: Fixed): Fixed {
  return (a * b) / SCALE;
}

export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) {
    throw new AmountError("division by zero");
  }
  return (a * SCALE) / b;
}

/**
 * Signed deviation of `observed` from `reference`, in basis points.
 *
 * Returns null when there is no usable reference. A missing reference must
 * propagate as "unknown" and never collapse to 0 bps, which would read as a
 * perfect match and let an uncomparable route pass a deviation gate.
 */
export function deviationBps(observed: Fixed, reference: Fixed): number | null {
  if (reference <= 0n) return null;
  const ratio = div(observed - reference, reference);
  return Number((ratio * 10_000n) / SCALE);
}

/** Convert a basis-point count to 1e18 fixed point (150 bps -> 0.015). */
export function bpsToFixed(bps: number): Fixed {
  if (!Number.isFinite(bps)) {
    throw new AmountError(`bps must be finite, received ${bps}`);
  }
  return (BigInt(Math.round(bps)) * SCALE) / 10_000n;
}
