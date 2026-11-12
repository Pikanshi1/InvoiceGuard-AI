import { describe, expect, it } from "vitest";
import { resolvePolicyThresholds } from "./policy-config";

describe("workspace policy thresholds", () => {
  it("uses backwards-compatible defaults when policies have no recognized config", () => {
    expect(resolvePolicyThresholds([{}, { oldRule: true }, null])).toEqual({ approvalLimit: 100000, poTolerancePercent: 5 });
  });

  it("combines enabled policy values using the most restrictive threshold", () => {
    expect(resolvePolicyThresholds([
      { approvalLimit: 75000, poTolerancePercent: 4 },
      { approvalLimit: 50000, poTolerancePercent: 2 },
      { approvalLimit: 90000, poTolerancePercent: 3 }
    ])).toEqual({ approvalLimit: 50000, poTolerancePercent: 2 });
  });

  it("ignores malformed legacy values without disabling valid configured rules", () => {
    expect(resolvePolicyThresholds([
      { approvalLimit: "5000", poTolerancePercent: 110 },
      { approvalLimit: 25000, poTolerancePercent: 0 }
    ])).toEqual({ approvalLimit: 25000, poTolerancePercent: 0 });
  });
});
