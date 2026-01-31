import path from "node:path";
import { loadPolicyFromSource, PolicySourceError } from "../policy-code/loader";
import type { CandidatePolicySnapshot } from "../policy-code/loader";
import type { ExecutionMode } from "../policy-code/types";
import { defaultDriftWindow, buildPolicyDriftReport } from "../policy-drift/compute";
import { computePolicyImpactReport } from "../policy-impact/compute";
import type { PolicyLifecycleStore } from "../policy-lifecycle/store";
import type { PolicyLineageStore } from "../policy-lineage/store";
import type { PolicyOutcomeStore } from "../policy-outcomes/store";
import type { PolicyReplayStore } from "../policy-replay/replay-store";
import { evaluatePromotionGuardrails } from "../policy-promotion-guardrails/compute";
import type { GuardrailConfig, GuardrailDecision } from "../policy-promotion-guardrails/types";
import type { PolicyPackRegistry } from "./registry";
import type { PolicyPackInstallBundle } from "./types";

export type PolicyPackInstallResult = {
  bundle: PolicyPackInstallBundle;
  candidate: CandidatePolicySnapshot;
  guardrailDecision: GuardrailDecision;
};

function buildPackPolicyPath(packDir: string): string {
  return path.resolve(packDir, "policy.yaml");
}

export async function installPolicyPack(input: {
  name: string;
  registry: PolicyPackRegistry;
  lifecycleStore: PolicyLifecycleStore;
  replayStore: PolicyReplayStore;
  outcomeStore: PolicyOutcomeStore;
  lineageStore?: PolicyLineageStore;
  guardrailConfig: GuardrailConfig;
  executionMode: ExecutionMode;
  now?: Date;
  impactLimit?: number;
}): Promise<PolicyPackInstallResult> {
  const packSummary = input.registry.buildPackSummary(input.name);
  const packDir = input.registry.getPackPath(input.name);
  const policyPath = buildPackPolicyPath(packDir);
  let candidatePolicy: CandidatePolicySnapshot;
  try {
    candidatePolicy = loadPolicyFromSource({ source: "path", ref: policyPath });
  } catch (error) {
    if (error instanceof PolicySourceError) {
      throw error;
    }
    throw error;
  }

  input.lifecycleStore.registerDraft({
    hash: candidatePolicy.info.hash,
    source: "path",
    ref: policyPath
  });

  const now = input.now ?? new Date();
  const windows = defaultDriftWindow(now);

  const currentPolicy = loadPolicyFromSource({ source: "current" });
  const baselineIntents = await input.replayStore.listBaselineIntents({
    since: windows.recent.since,
    until: windows.recent.until,
    limit: input.impactLimit ?? 100
  });

  const impactReport = computePolicyImpactReport({
    currentPolicy,
    candidatePolicy,
    intents: baselineIntents,
    window: { since: windows.recent.since, until: windows.recent.until },
    executionMode: input.executionMode
  });

  const driftReport = await buildPolicyDriftReport({
    policyHash: candidatePolicy.info.hash,
    recentWindow: windows.recent,
    baselineWindow: windows.baseline,
    outcomeStore: input.outcomeStore,
    replayStore: input.replayStore,
    lineageStore: input.lineageStore
  });

  let guardrailDecision = await evaluatePromotionGuardrails({
    policyHash: candidatePolicy.info.hash,
    candidatePolicy,
    currentPolicy,
    outcomeStore: input.outcomeStore,
    replayStore: input.replayStore,
    lineageStore: input.lineageStore,
    config: input.guardrailConfig,
    executionMode: input.executionMode,
    now,
    impactLimit: input.impactLimit
  });

  if (!input.guardrailConfig.enabled) {
    guardrailDecision = { ...guardrailDecision, allowed: true, requiredAcceptance: false, reasons: [] };
  }

  input.lifecycleStore.markSimulated({
    hash: candidatePolicy.info.hash,
    source: "path",
    ref: policyPath
  });

  const bundle: PolicyPackInstallBundle = {
    pack: packSummary,
    candidate: {
      policyHash: candidatePolicy.info.hash,
      source: "path",
      ref: policyPath
    },
    hashes: {
      policyHash: packSummary.policyHash,
      packHash: packSummary.packHash,
      candidatePolicyHash: candidatePolicy.info.hash
    },
    reports: {
      impact: impactReport,
      drift: driftReport,
      guardrail: guardrailDecision
    }
  };

  return { bundle, candidate: candidatePolicy, guardrailDecision };
}
