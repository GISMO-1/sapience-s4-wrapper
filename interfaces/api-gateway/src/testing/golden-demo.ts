import Fastify from "fastify";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256 } from "../policy-events/hash";
import type { Intent } from "../intent/intent-model";
import type { ReplayBaselineIntent } from "../policy-replay/types";
import { parseIntent } from "../intent/intent-parser";
import { configureDeterminism, resetDeterminism } from "./determinism";
import { normalizeGoldenSnapshot } from "./normalize";

export type GoldenSeedIntent = {
  traceId: string;
  text: string;
  createdAt: string;
  intentType: Intent["intentType"];
};

export type GoldenSeedOutcome = {
  traceId: string;
  outcomeType: "success" | "failure" | "override" | "rollback";
  severity: number;
  humanOverride: boolean;
  notes: string;
};

export type GoldenDemoSnapshot = {
  manifest: {
    generatedAt: string;
    intents: GoldenSeedIntent[];
    outcomes: GoldenSeedOutcome[];
    windows: {
      intents: { since: string; until: string };
      outcomes: { since: string; until: string };
      drift: { since: string; until: string; baselineSince: string; baselineUntil: string };
      replayReport: { since: string; until: string };
    };
    policies: {
      currentPolicyHash: string;
      currentPolicyPath: string;
      pathPolicyRef: string;
      inlinePolicyYaml: string;
      inlinePolicyHash: string;
      pathPolicyHash: string;
    };
  };
  responses: Record<string, unknown>;
  hashes: Record<string, string>;
  provenanceMarkdown: string;
};

type InjectJsonOptions = {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
};

const DEFAULT_WINDOWS = {
  intents: {
    since: "2024-03-01T00:00:00Z",
    until: "2024-03-15T00:00:00Z"
  },
  outcomes: {
    since: "2024-03-01T00:00:00Z",
    until: "2024-03-15T00:00:00Z"
  },
  drift: {
    since: "2024-03-08T00:00:00Z",
    until: "2024-03-15T00:00:00Z",
    baselineSince: "2024-02-07T00:00:00Z",
    baselineUntil: "2024-03-08T00:00:00Z"
  },
  replayReport: {
    since: "2024-02-01T00:00:00Z",
    until: "2024-03-15T00:00:00Z"
  }
};

const INLINE_POLICY_YAML = `version: "v1"
defaults:
  confidenceThreshold: 0.7
  execution:
    autoRequires: ["WARN"]
rules:
  - id: "inline-max-invoice-amount"
    enabled: true
    priority: 95
    appliesTo:
      intentTypes: ["REVIEW_INVOICE"]
    constraints:
      - type: "MAX_AMOUNT"
        params:
          max: 25000
    decision: "DENY"
    reason: "Inline policy caps invoice auto-review."
    tags: ["finance", "guardrail"]
  - id: "inline-blocked-vendor"
    enabled: true
    priority: 85
    appliesTo:
      intentTypes: ["CREATE_PO"]
    constraints:
      - type: "VENDOR_BLOCKLIST"
        params:
          vendors: ["VENDOR-BLACK"]
    decision: "DENY"
    reason: "Inline policy blocks VENDOR-BLACK."
    tags: ["compliance"]
`;

const GENERATED_AT = "2024-03-05T12:00:00Z";

const INTENT_SEEDS = [
  {
    traceId: "trace-golden-001",
    text: "Create PO for vendor VENDOR-BLUE amount 1200 sku SKU-100 qty 5",
    createdAt: "2024-03-01T00:00:00Z"
  },
  {
    traceId: "trace-golden-002",
    text: "Create PO for vendor VENDOR-RED amount 2500 sku BLOCKED-SKU-1 qty 12",
    createdAt: "2024-03-01T00:10:00Z"
  },
  {
    traceId: "trace-golden-003",
    text: "Check inventory for sku SKU-ALPHA qty 2",
    createdAt: "2024-03-01T00:20:00Z"
  },
  {
    traceId: "trace-golden-004",
    text: "Check inventory for sku BLOCKED-SKU-2",
    createdAt: "2024-03-01T00:30:00Z"
  },
  {
    traceId: "trace-golden-005",
    text: "Review invoice INV-1000 amount 45000",
    createdAt: "2024-03-01T00:40:00Z"
  },
  {
    traceId: "trace-golden-006",
    text: "Review invoice INV-9000 amount 75000",
    createdAt: "2024-03-01T00:50:00Z"
  },
  {
    traceId: "trace-golden-007",
    text: "Create purchase order for vendor VENDOR-GREEN amount 800 sku SKU-777 qty 15",
    createdAt: "2024-03-01T01:00:00Z"
  },
  {
    traceId: "trace-golden-008",
    text: "Check inventory stock for sku SKU-BETA qty 9",
    createdAt: "2024-03-01T01:10:00Z"
  },
  {
    traceId: "trace-golden-009",
    text: "Review invoice INV-333 amount 200",
    createdAt: "2024-03-01T01:20:00Z"
  },
  {
    traceId: "trace-golden-010",
    text: "Create PO for vendor VENDOR-ORANGE amount 300 sku SKU-123 qty 2",
    createdAt: "2024-03-01T01:30:00Z"
  },
  {
    traceId: "trace-golden-011",
    text: "Check inventory for sku SKU-GAMMA qty 20",
    createdAt: "2024-03-01T01:40:00Z"
  },
  {
    traceId: "trace-golden-012",
    text: "Review invoice INV-888 amount 1000",
    createdAt: "2024-03-01T01:50:00Z"
  }
];

const OUTCOME_SEEDS: GoldenSeedOutcome[] = [
  {
    traceId: "trace-golden-001",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    notes: "Golden demo success"
  },
  {
    traceId: "trace-golden-004",
    outcomeType: "failure",
    severity: 4,
    humanOverride: false,
    notes: "Golden demo failure"
  },
  {
    traceId: "trace-golden-006",
    outcomeType: "override",
    severity: 2,
    humanOverride: true,
    notes: "Golden demo override"
  },
  {
    traceId: "trace-golden-010",
    outcomeType: "rollback",
    severity: 3,
    humanOverride: true,
    notes: "Golden demo rollback"
  }
];

function buildManifestIntents(): GoldenSeedIntent[] {
  return INTENT_SEEDS.map((seed) => {
    const parsed = parseIntent(seed.text);
    return {
      traceId: seed.traceId,
      text: seed.text,
      createdAt: seed.createdAt,
      intentType: parsed.intentType
    };
  });
}

async function buildBaselineIntents(): Promise<ReplayBaselineIntent[]> {
  const { createPolicyEvaluator } = await import("../policy-code/evaluator");
  const { policyLoader } = await import("../policy-code/loader");
  policyLoader.reload();
  const evaluator = createPolicyEvaluator();

  return INTENT_SEEDS.map((seed) => {
    const parsed = parseIntent(seed.text);
    const decision = evaluator.evaluate(parsed, {
      executionMode: "manual",
      traceId: seed.traceId
    });
    return {
      traceId: seed.traceId,
      intentType: parsed.intentType,
      intent: parsed,
      createdAt: new Date(seed.createdAt),
      baselineDecision: decision.final,
      baselineMatchedRules: decision.matchedRules.map((rule) => rule.ruleId),
      baselinePolicyHash: decision.policy.hash,
      baselineRisk: decision.risk
    };
  });
}

async function buildApp() {
  const { registerRoutes } = await import("../routes");
  const app = Fastify();
  await registerRoutes(app);
  await app.ready();
  return app;
}

async function injectJson<T>(app: ReturnType<typeof Fastify>, options: InjectJsonOptions): Promise<T> {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    headers: options.headers,
    payload: options.payload
  });
  const payload = response.json();
  if (response.statusCode >= 400) {
    throw new Error(`Request failed (${response.statusCode}) for ${options.method} ${options.url}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

async function injectText(app: ReturnType<typeof Fastify>, options: InjectJsonOptions): Promise<string> {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    headers: options.headers,
    payload: options.payload
  });
  const payload = response.body;
  if (response.statusCode >= 400) {
    throw new Error(`Request failed (${response.statusCode}) for ${options.method} ${options.url}: ${payload}`);
  }
  return payload;
}

function hashResponse(value: unknown): string {
  return sha256(canonicalJson(value));
}

export async function buildGoldenDemoSnapshot(options?: { restoreEnv?: boolean }): Promise<GoldenDemoSnapshot> {
  const previousEnv = { ...process.env };
  process.env.USE_INMEMORY_STORE = "true";
  process.env.EXECUTION_GATING_ENABLED = "true";
  process.env.EXECUTION_MODE = "manual";
  process.env.POLICY_INLINE_ENABLED = "true";

  configureDeterminism({
    start: new Date("2024-03-05T12:00:00Z"),
    stepMs: 0,
    idPrefix: "golden",
    idStart: 0
  });

  const { setPolicyReplayBaselineIntents } = await import("../policy-replay/replay-store");
  const baselineIntents = await buildBaselineIntents();
  setPolicyReplayBaselineIntents(baselineIntents);

  const app = await buildApp();

  try {
    const responses: Record<string, unknown> = {};
    const traceHeader = (traceId: string) => ({ "x-trace-id": traceId, "content-type": "application/json" });

    const policyCurrent = await injectJson<{ hash: string; path: string; version: string; loadedAt: string }>(app, {
      method: "GET",
      url: "/v1/policy/current",
      headers: traceHeader("trace-golden-policy-current")
    });
    responses.policyCurrent = policyCurrent;

    const intentResponses = [];
    for (const seed of INTENT_SEEDS) {
      const response = await injectJson(app, {
        method: "POST",
        url: "/v1/intent",
        headers: traceHeader(seed.traceId),
        payload: { text: seed.text }
      });
      intentResponses.push(response);
    }
    responses.intents = intentResponses;

    const outcomeResponses = [];
    for (const outcome of OUTCOME_SEEDS) {
      const response = await injectJson(app, {
        method: "POST",
        url: "/v1/policy/outcomes",
        headers: traceHeader(`trace-${outcome.traceId}-outcome`),
        payload: {
          traceId: outcome.traceId,
          outcomeType: outcome.outcomeType,
          severity: outcome.severity,
          humanOverride: outcome.humanOverride,
          notes: outcome.notes
        }
      });
      outcomeResponses.push(response);
    }
    responses.outcomes = outcomeResponses;

    const replayResponses: Record<string, unknown> = {};
    const replayRuns: Record<string, string> = {};

    const replayCurrent = await injectJson<{ run: { runId: string } }>(app, {
      method: "POST",
      url: "/v1/policy/replay",
      headers: traceHeader("trace-golden-replay-current"),
      payload: {
        candidatePolicy: { source: "current" },
        filters: {
          since: DEFAULT_WINDOWS.intents.since,
          until: DEFAULT_WINDOWS.intents.until,
          limit: 50
        },
        requestedBy: "golden-demo"
      }
    });
    replayRuns.current = replayCurrent.run.runId;
    replayResponses.current = replayCurrent;

    const replayPath = await injectJson<{ run: { runId: string; candidate: { hash: string } } }>(app, {
      method: "POST",
      url: "/v1/policy/replay",
      headers: traceHeader("trace-golden-replay-path"),
      payload: {
        candidatePolicy: { source: "path", ref: "policies.v1.yaml" },
        filters: {
          since: DEFAULT_WINDOWS.intents.since,
          until: DEFAULT_WINDOWS.intents.until,
          limit: 50
        },
        requestedBy: "golden-demo"
      }
    });
    replayRuns.path = replayPath.run.runId;
    replayResponses.path = replayPath;

    const replayInline = await injectJson<{ run: { runId: string; candidate: { hash: string } } }>(app, {
      method: "POST",
      url: "/v1/policy/replay",
      headers: traceHeader("trace-golden-replay-inline"),
      payload: {
        candidatePolicy: { source: "inline", ref: "golden-inline", yaml: INLINE_POLICY_YAML },
        filters: {
          since: DEFAULT_WINDOWS.intents.since,
          until: DEFAULT_WINDOWS.intents.until,
          limit: 50
        },
        requestedBy: "golden-demo"
      }
    });
    replayRuns.inline = replayInline.run.runId;
    replayResponses.inline = replayInline;

    const reportResponses = {
      current: await injectJson(app, {
        method: "GET",
        url: `/v1/policy/replay/${replayRuns.current}/report?outcomesSince=${encodeURIComponent(
          DEFAULT_WINDOWS.replayReport.since
        )}&outcomesUntil=${encodeURIComponent(DEFAULT_WINDOWS.replayReport.until)}`,
        headers: traceHeader("trace-golden-replay-report-current")
      }),
      path: await injectJson(app, {
        method: "GET",
        url: `/v1/policy/replay/${replayRuns.path}/report?outcomesSince=${encodeURIComponent(
          DEFAULT_WINDOWS.replayReport.since
        )}&outcomesUntil=${encodeURIComponent(DEFAULT_WINDOWS.replayReport.until)}`,
        headers: traceHeader("trace-golden-replay-report-path")
      }),
      inline: await injectJson(app, {
        method: "GET",
        url: `/v1/policy/replay/${replayRuns.inline}/report?outcomesSince=${encodeURIComponent(
          DEFAULT_WINDOWS.replayReport.since
        )}&outcomesUntil=${encodeURIComponent(DEFAULT_WINDOWS.replayReport.until)}`,
        headers: traceHeader("trace-golden-replay-report-inline")
      })
    };

    responses.replay = {
      runs: replayResponses,
      reports: reportResponses
    };

    const inlinePolicyHash = (replayInline.run as { candidate?: { hash?: string } }).candidate?.hash ?? "unknown";
    const pathPolicyHash = (replayPath.run as { candidate?: { hash?: string } }).candidate?.hash ?? "unknown";

    const guardrailCheck = await injectJson(app, {
      method: "GET",
      url: `/v1/policy/promote/check?policyHash=${encodeURIComponent(inlinePolicyHash)}`,
      headers: traceHeader("trace-golden-promote-check")
    });
    responses.promotionGuardrails = guardrailCheck;

    const promoteCurrent = await injectJson(app, {
      method: "POST",
      url: "/v1/policy/promote",
      headers: traceHeader("trace-golden-promote-current"),
      payload: {
        policyHash: policyCurrent.hash,
        reviewer: "golden-operator",
        rationale: "Golden demo promotion for baseline policy.",
        acceptedRisk: 0.4,
        force: true
      }
    });
    responses.promoteCurrent = promoteCurrent;

    const promoteInline = await injectJson(app, {
      method: "POST",
      url: "/v1/policy/promote",
      headers: traceHeader("trace-golden-promote-inline"),
      payload: {
        policyHash: inlinePolicyHash,
        reviewer: "golden-operator",
        rationale: "Golden demo promotion for inline candidate.",
        acceptedRisk: 0.9,
        force: true
      }
    });
    responses.promoteInline = promoteInline;

    const rollbackResponse = await injectJson(app, {
      method: "POST",
      url: "/v1/policy/rollback",
      headers: traceHeader("trace-golden-rollback"),
      payload: {
        targetPolicyHash: policyCurrent.hash,
        actor: "golden-operator",
        rationale: "Rollback to baseline policy after inline promotion."
      }
    });
    responses.rollback = rollbackResponse;

    const reconcileResponse = await injectJson(app, {
      method: "GET",
      url: `/v1/policy/reconcile?fromPolicyHash=${encodeURIComponent(inlinePolicyHash)}&toPolicyHash=${encodeURIComponent(
        policyCurrent.hash
      )}`,
      headers: traceHeader("trace-golden-reconcile")
    });
    responses.reconcile = reconcileResponse;

    const policyImpact = await injectJson(app, {
      method: "POST",
      url: "/v1/policy/impact",
      headers: traceHeader("trace-golden-impact"),
      payload: {
        candidatePolicy: INLINE_POLICY_YAML,
        since: DEFAULT_WINDOWS.intents.since,
        until: DEFAULT_WINDOWS.intents.until,
        limit: 50
      }
    });
    responses.policyImpact = policyImpact;

    const policyQuality = await injectJson(app, {
      method: "GET",
      url: `/v1/policy/quality?policyHash=${encodeURIComponent(policyCurrent.hash)}&since=${encodeURIComponent(
        DEFAULT_WINDOWS.outcomes.since
      )}&until=${encodeURIComponent(DEFAULT_WINDOWS.outcomes.until)}`,
      headers: traceHeader("trace-golden-quality")
    });
    responses.policyQuality = policyQuality;

    const policyDrift = await injectJson(app, {
      method: "GET",
      url: `/v1/policy/drift?policyHash=${encodeURIComponent(policyCurrent.hash)}&since=${encodeURIComponent(
        DEFAULT_WINDOWS.drift.since
      )}&until=${encodeURIComponent(DEFAULT_WINDOWS.drift.until)}&baselineSince=${encodeURIComponent(
        DEFAULT_WINDOWS.drift.baselineSince
      )}&baselineUntil=${encodeURIComponent(DEFAULT_WINDOWS.drift.baselineUntil)}`,
      headers: traceHeader("trace-golden-drift")
    });
    responses.policyDrift = policyDrift;

    const policyEvents = await injectJson(app, {
      method: "GET",
      url: `/v1/policy/events?policyHash=${encodeURIComponent(policyCurrent.hash)}&since=${encodeURIComponent(
        DEFAULT_WINDOWS.intents.since
      )}&until=${encodeURIComponent(DEFAULT_WINDOWS.replayReport.until)}`,
      headers: traceHeader("trace-golden-events")
    });
    responses.policyEvents = policyEvents;

    const policyVerify = await injectJson(app, {
      method: "GET",
      url: `/v1/policy/verify?policyHash=${encodeURIComponent(policyCurrent.hash)}&since=${encodeURIComponent(
        DEFAULT_WINDOWS.intents.since
      )}&until=${encodeURIComponent(DEFAULT_WINDOWS.replayReport.until)}&baselineSince=${encodeURIComponent(
        DEFAULT_WINDOWS.drift.baselineSince
      )}&baselineUntil=${encodeURIComponent(DEFAULT_WINDOWS.drift.baselineUntil)}&qualitySince=${encodeURIComponent(
        DEFAULT_WINDOWS.outcomes.since
      )}&qualityUntil=${encodeURIComponent(DEFAULT_WINDOWS.outcomes.until)}`,
      headers: traceHeader("trace-golden-verify")
    });
    responses.policyVerify = policyVerify;

    const policyCounterfactual = await injectJson(app, {
      method: "POST",
      url: "/v1/policy/counterfactual",
      headers: traceHeader("trace-golden-counterfactual"),
      payload: {
        policyHash: policyCurrent.hash,
        compareToPolicyHash: inlinePolicyHash,
        since: DEFAULT_WINDOWS.intents.since,
        until: DEFAULT_WINDOWS.replayReport.until,
        limit: 50
      }
    });
    responses.policyCounterfactual = policyCounterfactual;

    const policyBlastRadius = await injectJson(app, {
      method: "GET",
      url: `/v1/policy/blast-radius?policyHash=${encodeURIComponent(policyCurrent.hash)}&since=${encodeURIComponent(
        DEFAULT_WINDOWS.intents.since
      )}&until=${encodeURIComponent(DEFAULT_WINDOWS.replayReport.until)}&limit=50`,
      headers: traceHeader("trace-golden-blast-radius")
    });
    responses.policyBlastRadius = policyBlastRadius;

    const policyProvenance = await injectJson(app, {
      method: "GET",
      url: `/v1/policy/provenance?policyHash=${encodeURIComponent(
        policyCurrent.hash
      )}&counterfactualSince=${encodeURIComponent(DEFAULT_WINDOWS.intents.since)}&counterfactualUntil=${encodeURIComponent(
        DEFAULT_WINDOWS.replayReport.until
      )}&counterfactualCompareToPolicyHash=${encodeURIComponent(inlinePolicyHash)}&counterfactualLimit=50`,
      headers: traceHeader("trace-golden-provenance")
    });
    responses.policyProvenance = policyProvenance;

    const policyProvenanceMarkdown = await injectText(app, {
      method: "GET",
      url: `/v1/policy/provenance?policyHash=${encodeURIComponent(
        policyCurrent.hash
      )}&format=md&counterfactualSince=${encodeURIComponent(DEFAULT_WINDOWS.intents.since)}&counterfactualUntil=${encodeURIComponent(
        DEFAULT_WINDOWS.replayReport.until
      )}&counterfactualCompareToPolicyHash=${encodeURIComponent(inlinePolicyHash)}&counterfactualLimit=50`,
      headers: traceHeader("trace-golden-provenance-md")
    });
    responses.policyProvenanceMarkdown = policyProvenanceMarkdown;

    const manifestIntents = buildManifestIntents();
    const manifestOutcomes = OUTCOME_SEEDS.slice();

    const snapshot: GoldenDemoSnapshot = {
      manifest: {
        generatedAt: GENERATED_AT,
        intents: manifestIntents,
        outcomes: manifestOutcomes,
        windows: DEFAULT_WINDOWS,
        policies: {
          currentPolicyHash: policyCurrent.hash,
          currentPolicyPath: policyCurrent.path,
          pathPolicyRef: "policies.v1.yaml",
          inlinePolicyYaml: INLINE_POLICY_YAML,
          inlinePolicyHash,
          pathPolicyHash
        }
      },
      responses,
      hashes: {
        replayReportCurrent: hashResponse(reportResponses.current),
        replayReportPath: hashResponse(reportResponses.path),
        replayReportInline: hashResponse(reportResponses.inline),
        policyImpact: hashResponse(policyImpact),
        policyQuality: hashResponse(policyQuality),
        policyDrift: hashResponse(policyDrift),
        policyEvents: hashResponse(policyEvents),
        policyVerify: hashResponse(policyVerify),
        policyCounterfactual: hashResponse(policyCounterfactual),
        policyBlastRadius: hashResponse(policyBlastRadius),
        policyProvenance: hashResponse(policyProvenance),
        promoteCurrent: hashResponse(promoteCurrent),
        promoteInline: hashResponse(promoteInline),
        rollback: hashResponse(rollbackResponse),
        reconcile: hashResponse(reconcileResponse)
      },
      provenanceMarkdown: policyProvenanceMarkdown
    };

    return normalizeGoldenSnapshot(snapshot);
  } finally {
    await app.close();
    setPolicyReplayBaselineIntents(null);
    resetDeterminism();
    if (options?.restoreEnv) {
      process.env = previousEnv;
    }
  }
}

export function writeGoldenArtifacts(snapshot: GoldenDemoSnapshot, baseDir: string): void {
  mkdirSync(baseDir, { recursive: true });
  const jsonPath = path.join(baseDir, "golden-demo.json");
  const mdPath = path.join(baseDir, "golden-demo.md");

  writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");

  const intentRows = snapshot.manifest.intents
    .map((intent) => `| ${intent.traceId} | ${intent.intentType} | ${intent.createdAt} | ${intent.text} |`)
    .join("\n");
  const outcomeRows = snapshot.manifest.outcomes
    .map((outcome) => `| ${outcome.traceId} | ${outcome.outcomeType} | ${outcome.severity} | ${outcome.notes} |`)
    .join("\n");
  const hashRows = Object.entries(snapshot.hashes)
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join("\n");

  const markdown = `# Golden Demo Snapshot

Generated at: \`${snapshot.manifest.generatedAt}\`

## Seeded intents
| Trace ID | Intent Type | Created At | Text |
| --- | --- | --- | --- |
${intentRows}

## Seeded outcomes
| Trace ID | Outcome | Severity | Notes |
| --- | --- | --- | --- |
${outcomeRows}

## Policy hashes
| Item | Hash |
| --- | --- |
| Current policy | ${snapshot.manifest.policies.currentPolicyHash} |
| Inline candidate | ${snapshot.manifest.policies.inlinePolicyHash} |
| Path candidate | ${snapshot.manifest.policies.pathPolicyHash} |

## Report hashes
| Report | SHA256 |
| --- | --- |
${hashRows}
`;

  writeFileSync(mdPath, `${markdown}\n`, "utf-8");
}
