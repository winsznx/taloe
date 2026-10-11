/**
 * Outcome-level copy for the route decision surfaces.
 *
 * Per-reason-code copy already lives in `@taloe/shared` (`explainReason`) and
 * is structured/generated, never free-form (PRD 11.8). This module adds only
 * the outcome-level heading/summary wrapping those reasons — still fixed
 * copy, not narration.
 */

import type { DecisionOutcome } from "@taloe/shared";

export const OUTCOME_HEADING: Readonly<Record<DecisionOutcome, string>> = {
  ACT: "We found a route",
  NO_ACTION: "You already have this",
  REFUSE: "We won't execute this",
  UNKNOWN: "We can't tell yet",
  MANUAL_REVIEW: "Tell us which one you mean",
};

export const OUTCOME_SUMMARY: Readonly<Record<DecisionOutcome, string>> = {
  ACT: "This route met every check Taloe runs, including your execution limit.",
  NO_ACTION: "Your wallet already holds the exposure this request asked for, so there is nothing to buy.",
  REFUSE:
    "Taloe found candidates, but every one of them failed a check that actually matters: an expired price, a failed simulation, or a route priced outside your limit. Refusing is the correct outcome here, not an error.",
  UNKNOWN:
    "Taloe couldn't establish enough trustworthy information to compare routes safely, so it isn't recommending one.",
  MANUAL_REVIEW: "More than one company matches what you typed. Pick the one you meant.",
};
