/**
 * Structured reason codes.
 *
 * Every recommendation, rejection and refusal Taloe shows a user is rendered
 * from one of these codes. UI copy is a lookup on the code, never free-form
 * narration, so no model output can invent a reason a gate did not actually
 * produce (PRD 11.8).
 */

export const SELECTION_REASONS = [
  "BETTER_EFFECTIVE_EXPOSURE",
  "LOWER_PRICE_IMPACT",
  "LOWER_TOTAL_COST",
  "WITHIN_USER_DEVIATION",
  "ONLY_QUALIFYING_ROUTE",
  "FRESHER_QUOTE",
  "SIMULATION_PASSED",
] as const;

export const REJECTION_REASONS = [
  "EXCEEDS_USER_DEVIATION",
  "EXCEEDS_PRICE_IMPACT_POLICY",
  "QUOTE_EXPIRED",
  "QUOTE_TTL_INSUFFICIENT",
  "SIMULATION_FAILED",
  "SIMULATION_REQUIRED_BUT_UNAVAILABLE",
  "ISSUER_MAPPING_UNSUPPORTED",
  "NORMALIZATION_SEMANTICS_UNKNOWN",
  "AMBIGUOUS_UNDERLYING",
  "INVALID_TOKEN_CONTRACT",
  "PAUSED_OR_HALTED",
  "OUTSIDE_TRADING_HOURS",
  "INSUFFICIENT_LIQUIDITY",
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_GAS",
  "NON_POSITIVE_OUTPUT",
  "UNKNOWN_EXECUTION_MODE",
  "UNSUPPORTED_EXECUTION_MODE",
  "APPROVAL_PATH_UNSUPPORTED",
  "RFQ_FAILED",
  "API_BUSINESS_ERROR",
  "COMPLIANCE_BLOCKED",
  "CONTRADICTORY_SPONSOR_DATA",
  "WORSE_EFFECTIVE_EXPOSURE",
] as const;

export const DECISION_REASONS = [
  "NO_CANDIDATES_DISCOVERED",
  "ALL_CANDIDATES_REJECTED",
  "REFERENCE_CONTEXT_UNAVAILABLE",
  "NO_COMPARABLE_CANDIDATE",
  "SPONSOR_API_UNAVAILABLE",
  "ALREADY_HOLDS_TARGET_EXPOSURE",
  /** The query does not resolve to any company/ticker Taloe recognises. */
  "UNDERLYING_NOT_RECOGNIZED",
  /** The query matches more than one distinct company; user must disambiguate. */
  "UNDERLYING_MATCH_AMBIGUOUS",
] as const;

export type SelectionReason = (typeof SELECTION_REASONS)[number];
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export type DecisionReason = (typeof DECISION_REASONS)[number];
export type ReasonCode = SelectionReason | RejectionReason | DecisionReason;

/**
 * User-facing copy per code.
 *
 * Deliberately plain language: the primary path must not require the user to
 * understand RFQ, AMM or token-to-share mechanics (PRD 8.1).
 */
const REASON_COPY: Record<ReasonCode, string> = {
  BETTER_EFFECTIVE_EXPOSURE: "Gives you more NVIDIA-equivalent exposure for the same spend.",
  LOWER_PRICE_IMPACT: "Moves the price less when your order goes through.",
  LOWER_TOTAL_COST: "Costs less once fees are included.",
  WITHIN_USER_DEVIATION: "Priced within the limit you set.",
  ONLY_QUALIFYING_ROUTE: "The only route that passed every check.",
  FRESHER_QUOTE: "Its price is newer, so it is less likely to expire before you sign.",
  SIMULATION_PASSED: "We ran the transaction against the chain first and it went through.",

  EXCEEDS_USER_DEVIATION: "Priced further from the reference than the limit you set.",
  EXCEEDS_PRICE_IMPACT_POLICY: "Your order would move this market too much.",
  QUOTE_EXPIRED: "The price expired before it could be used.",
  QUOTE_TTL_INSUFFICIENT: "The price would expire before the trade could finish.",
  SIMULATION_FAILED: "A test run of this transaction failed, so we did not offer it.",
  SIMULATION_REQUIRED_BUT_UNAVAILABLE: "We could not test this transaction before signing.",
  ISSUER_MAPPING_UNSUPPORTED: "We cannot confirm what this token represents, so we left it out.",
  NORMALIZATION_SEMANTICS_UNKNOWN:
    "We cannot confirm how much of the company this token stands for, so we will not compare it.",
  AMBIGUOUS_UNDERLYING: "More than one company matches. Pick the one you meant.",
  INVALID_TOKEN_CONTRACT: "This token's contract address did not validate.",
  PAUSED_OR_HALTED: "Trading in this token is paused right now.",
  OUTSIDE_TRADING_HOURS: "This token cannot be traded while its market is closed.",
  INSUFFICIENT_LIQUIDITY: "There is not enough available to fill an order this size.",
  INSUFFICIENT_BALANCE: "Your wallet does not hold enough USDT for this.",
  INSUFFICIENT_GAS: "Your wallet does not hold enough BNB to pay for the transaction.",
  NON_POSITIVE_OUTPUT: "This route would return nothing.",
  UNKNOWN_EXECUTION_MODE: "This route uses a settlement method we do not recognise.",
  UNSUPPORTED_EXECUTION_MODE: "This route uses a settlement method Taloe does not support yet.",
  APPROVAL_PATH_UNSUPPORTED: "We could not work out the approval this route needs.",
  RFQ_FAILED: "The market maker did not fill this order.",
  API_BUSINESS_ERROR: "The data provider returned an error for this route.",
  COMPLIANCE_BLOCKED: "This route is not available in your region.",
  CONTRADICTORY_SPONSOR_DATA: "The data we received about this token disagreed with itself.",
  WORSE_EFFECTIVE_EXPOSURE: "A different route gives you more exposure for the same spend.",

  NO_CANDIDATES_DISCOVERED: "We found no tokenized version of this company on BNB Smart Chain.",
  ALL_CANDIDATES_REJECTED: "We found routes, but none of them met your conditions.",
  REFERENCE_CONTEXT_UNAVAILABLE:
    "We could not get a trustworthy reference price, so we will not recommend a trade.",
  NO_COMPARABLE_CANDIDATE: "We could not compare the available tokens safely.",
  SPONSOR_API_UNAVAILABLE: "Market data is temporarily unavailable.",
  ALREADY_HOLDS_TARGET_EXPOSURE: "You already hold the exposure you asked for.",
  UNDERLYING_NOT_RECOGNIZED: "Taloe doesn't recognise that company or ticker.",
  UNDERLYING_MATCH_AMBIGUOUS: "More than one company matches what you typed.",
};

/**
 * Copy for a reason code. `subject` substitutes the company name into codes
 * written against a placeholder, so the user reads their own ticker back.
 */
export function explainReason(code: ReasonCode, subject?: string): string {
  const copy = REASON_COPY[code];
  if (!subject) return copy;
  return copy.replace("NVIDIA-equivalent", `${subject}-equivalent`);
}

export function isRejectionReason(code: string): code is RejectionReason {
  return (REJECTION_REASONS as readonly string[]).includes(code);
}
