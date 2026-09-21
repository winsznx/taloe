# Baselines

**Status: specified, not yet implemented or run.**

Baselines exist so Taloe's value is measured against what a reasonable developer would
have built, not against a strawman.

---

## FIRST_RESULT

Take the first safely returned wrapper from RWA search, request its best route, accept
it. No cross-wrapper comparison, no session context.

This is the closest model of the current user workflow described in PRD section 3.

**Expected failure modes:** picks a wrapper whose execution mode the client cannot
drive; picks an issuer that is outside its market hours; accepts an expired quote.

## FIXED_ISSUER

Always prefer one issuer when it is available. Realistic: it is what an integrator
does after their first working path.

**Expected failure modes:** fails entirely when that issuer has no route for the
underlying, or is outside its trading hours.

Implemented as the `FIXED_ISSUER` ablation variant in `packages/router-core/src/policy.ts`.

## PRICE_ONLY

Choose on displayed token price without reference context, session state or wrapper
semantics.

**Expected failure modes:** a displayed price is not an executable route (PRD 11.4);
this baseline should pick routes that cannot fill at size.

## FULL

Taloe. Wrapper semantics, session and reference context, size-specific executable
quotes, execution-mode handling, user constraints, simulation.

---

## What would count as a win

Not only basis points. Per the PRD, any of these is a legitimate result:

- a baseline fails to produce an executable route and Taloe completes
- a baseline selects a paused, halted or non-executable representation
- Taloe rejects a route exceeding the user's deviation limit
- Taloe detects an expired RFQ and recovers
- Taloe picks the only execution mode that works at that moment
- Taloe correctly refuses every candidate

## What would count as a loss

Stated in advance, so it cannot be redefined afterwards:

- `FULL` and `FIXED_ISSUER` select the same route in substantially every case
- differences exist but are inside quote noise
- no underlying supports two comparable wrappers

Any of these triggers PRD section 25.
