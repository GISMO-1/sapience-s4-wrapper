export type DriftWindow = { since: string; until: string };

export type DriftMetrics = {
  totalOutcomes: number;
  failureRate: number;
  overrideRate: number;
  qualityScore: number;
  replayAdded: number;
  replayRemoved: number;
};

export type DriftDeltas = {
  failureRateDelta: number;
  overrideRateDelta: number;
  qualityScoreDelta: number;
  replayDelta: number;
};

export type HealthState = "HEALTHY" | "WATCH" | "DEGRADED" | "CRITICAL";

export type DriftReport = {
  policyHash: string;
  recent: { window: DriftWindow; metrics: DriftMetrics };
  baseline: { window: DriftWindow; metrics: DriftMetrics };
  deltas: DriftDeltas;
  health: { state: HealthState; rationale: string[] };
};
