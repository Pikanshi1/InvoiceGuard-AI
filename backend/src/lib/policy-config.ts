import { DEFAULT_APPROVAL_LIMIT, DEFAULT_PO_TOLERANCE_PERCENT } from "./policy";

export type PolicyThresholds = {
  approvalLimit: number;
  poTolerancePercent: number;
};

function getObjectConfig(config: unknown): Record<string, unknown> | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  return config as Record<string, unknown>;
}

export function resolvePolicyThresholds(configurations: unknown[]): PolicyThresholds {
  const approvalLimits: number[] = [];
  const poTolerances: number[] = [];

  for (const configuration of configurations) {
    const config = getObjectConfig(configuration);
    if (!config) continue;
    if (typeof config.approvalLimit === "number" && Number.isFinite(config.approvalLimit) && config.approvalLimit > 0) {
      approvalLimits.push(config.approvalLimit);
    }
    if (typeof config.poTolerancePercent === "number" && Number.isFinite(config.poTolerancePercent) && config.poTolerancePercent >= 0 && config.poTolerancePercent <= 100) {
      poTolerances.push(config.poTolerancePercent);
    }
  }

  return {
    approvalLimit: approvalLimits.length ? Math.min(...approvalLimits) : DEFAULT_APPROVAL_LIMIT,
    poTolerancePercent: poTolerances.length ? Math.min(...poTolerances) : DEFAULT_PO_TOLERANCE_PERCENT
  };
}
