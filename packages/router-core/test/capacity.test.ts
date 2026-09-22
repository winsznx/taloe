import { describe, expect, it } from "vitest";

import { compareCapacity, deriveSafeCapacity } from "../src/capacity";

const obs = (ticketUsd: number, deviationBps: number | null, quoted = true) => ({ ticketUsd, deviationBps, quoted });

describe("deriveSafeCapacity", () => {
  it("brackets the boundary between the last safe ticket and the first breach", () => {
    const c = deriveSafeCapacity([obs(100, 10), obs(1000, 60), obs(2000, 161)], 150);
    expect(c).toMatchObject({ status: "BOUNDED", safeUpToUsd: 1000, breachedAtUsd: 2000 });
  });

  it("gives a different bracket for a tighter threshold from the same quotes", () => {
    const o = [obs(100, 10), obs(1000, 60), obs(2000, 161)];
    expect(deriveSafeCapacity(o, 50)).toMatchObject({ safeUpToUsd: 100, breachedAtUsd: 1000 });
  });

  it("reports a lower bound only when nothing tested ever breached", () => {
    const c = deriveSafeCapacity([obs(100, 5), obs(10000, 20)], 50);
    expect(c).toMatchObject({ status: "AT_LEAST_MAX_TESTED", safeUpToUsd: 10000, breachedAtUsd: null });
  });

  it("is BELOW_SMALLEST_TESTED when the first ticket already breaches", () => {
    expect(deriveSafeCapacity([obs(5.1, 90)], 50)).toMatchObject({ status: "BELOW_SMALLEST_TESTED", safeUpToUsd: null });
  });

  it("uses absolute deviation so a favourable outlier is not treated as safe by sign", () => {
    expect(deriveSafeCapacity([obs(100, -200)], 150).status).toBe("BELOW_SMALLEST_TESTED");
  });

  it("does not turn a missing quote into a breach", () => {
    const c = deriveSafeCapacity([obs(100, 5), obs(500, null, false)], 150);
    expect(c.status).toBe("UNKNOWN");
    expect(c.endedBy).toBe("QUOTE_UNAVAILABLE");
    expect(c.safeUpToUsd).toBe(100);
  });

  it("does not turn an uncomputable deviation into safety", () => {
    expect(deriveSafeCapacity([obs(100, null)], 150).status).toBe("UNKNOWN");
  });

  it("ignores an in-range point after a breach (noise must not resurrect capacity)", () => {
    const c = deriveSafeCapacity([obs(100, 5), obs(500, 300), obs(1000, 5)], 150);
    expect(c).toMatchObject({ safeUpToUsd: 100, breachedAtUsd: 500 });
  });

  it("is unknown with no observations", () => {
    expect(deriveSafeCapacity([], 100).status).toBe("UNKNOWN");
  });
});

describe("compareCapacity", () => {
  const cap = (o: ReturnType<typeof obs>[]) => deriveSafeCapacity(o, 150);
  it("orders disjoint brackets", () => {
    const shallow = cap([obs(100, 5), obs(2000, 161)]);
    const deep = cap([obs(100, 5), obs(2000, 8), obs(10000, 12)]);
    expect(compareCapacity(deep, shallow)).toBe("A_LARGER");
    expect(compareCapacity(shallow, deep)).toBe("B_LARGER");
  });
  it("refuses to order overlapping brackets", () => {
    const a = cap([obs(100, 5), obs(1000, 200)]);
    const b = cap([obs(100, 5), obs(500, 5), obs(1000, 200)]);
    expect(compareCapacity(a, b)).toBe("NO_DIFFERENCE");
  });
  it("is incomparable when either side is unknown", () => {
    expect(compareCapacity(cap([]), cap([obs(100, 5)]))).toBe("INCOMPARABLE");
  });
});
