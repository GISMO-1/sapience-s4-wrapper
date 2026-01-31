import { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "./config";
import { requestPurchaseOrder } from "./clients/procurement";
import { fetchInventory } from "./clients/supplychain";
import { requestInvoiceReview } from "./clients/finance";
import { getTraceIdFromRequest } from "./trace/trace";
import { parseIntent } from "./intent/intent-parser";
import { createIntentStore } from "./intent/intent-store";
import { Intent, intentTypeSchema } from "./intent/intent-model";
import { createPolicyEvaluator } from "./policy-code/evaluator";
import { loadPolicyFromSource, PolicySourceError } from "./policy-code/loader";
import type { CandidatePolicySnapshot, CandidatePolicyRequest } from "./policy-code/loader";
import { createPolicyStore } from "./policy/policy-store";
import type { ExecutionMode, PolicyInfo } from "./policy-code/types";
import { buildPolicyExplainResponse } from "./policy-code/explain";
import { createPolicyReplayStore } from "./policy-replay/replay-store";
import { createPolicyReplayEngine } from "./policy-replay/replay-engine";
import { buildReport } from "./policy-replay/report";
import { calculatePolicyImpact } from "./policy-lifecycle/impact";
import { createPolicyLifecycleStore } from "./policy-lifecycle/store";
import { buildPolicyDriftSummary } from "./policy-lineage/drift";
import { createPolicyLineageStore } from "./policy-lineage/store";
import { createPolicyOutcomeStore } from "./policy-outcomes/store";
import type { PolicyOutcomeRecord } from "./policy-outcomes/types";
import { calculatePolicyQuality } from "./policy-quality/score";
import { buildPolicyDriftReport, defaultDriftWindow } from "./policy-drift/compute";
import { createIntentApprovalStore } from "./intent-approvals/store";
import type { IntentApprovalRecord } from "./intent-approvals/types";
import { computePolicyImpactReport } from "./policy-impact/compute";
import { evaluatePromotionGuardrails } from "./policy-promotion-guardrails/compute";
import type { GuardrailDecision } from "./policy-promotion-guardrails/types";
import { createPolicyGuardrailCheckStore } from "./policy-promotion-guardrails/store";
import { createPolicyPromotionStore } from "./policy-promotions/store";
import { createPolicyApprovalStore } from "./policy-approvals/store";
import { buildPolicyLifecycleTimeline } from "./policy-lifecycle/timeline";
import { buildPolicyEventLog } from "./policy-events/projector";
import { verifyPolicyDeterminism } from "./policy-verifier/verify";
import { buildPolicyProvenanceMarkdown, buildPolicyProvenanceReport } from "./policy-provenance/build";
import { createPolicyPackRegistry, PolicyPackError } from "./policy-packs/registry";
import { installPolicyPack } from "./policy-packs/install";
import { createPolicyRollbackStore } from "./policy-rollback/store";
import { computeRollbackDecision } from "./policy-rollback/compute";
import { buildReconcileReport, resolvePolicyDocumentByHash, resolvePolicyHashesForWindow } from "./policy-rollback/reconcile";
import { logger } from "./logger";

const intentStore = createIntentStore();
const policyStore = createPolicyStore();
const policyEvaluator = createPolicyEvaluator();
const replayStore = createPolicyReplayStore();
const replayEngine = createPolicyReplayEngine(replayStore);
const lifecycleStore = createPolicyLifecycleStore();
const lineageStore = createPolicyLineageStore();
const outcomeStore = createPolicyOutcomeStore();
const approvalStore = createIntentApprovalStore();
const promotionStore = createPolicyPromotionStore();
const guardrailCheckStore = createPolicyGuardrailCheckStore();
const policyApprovalStore = createPolicyApprovalStore();
const policyPackRegistry = createPolicyPackRegistry();
const rollbackStore = createPolicyRollbackStore();

const intentSchema = z.object({
  text: z.string().min(1)
});

const assistResponseSchema = z.object({
  plan: z.string(),
  steps: z.array(
    z.object({
      description: z.string(),
      action: z.string(),
      payload: z.record(z.unknown())
    })
  ),
  tool_calls: z.array(
    z.object({
      endpoint: z.string(),
      payload: z.record(z.unknown())
    })
  )
});

const replayRequestSchema = z.object({
  candidatePolicy: z
    .object({
      source: z.enum(["current", "path", "inline"]).default("current"),
      ref: z.string().optional(),
      yaml: z.string().optional()
    })
    .optional(),
  filters: z
    .object({
      intentTypes: z.array(intentTypeSchema).optional(),
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
      limit: z.number().int().positive().optional()
    })
    .optional(),
  requestedBy: z.string().optional()
});

const replayResultsQuerySchema = z.object({
  changed: z.enum(["true", "false"]).optional(),
  limit: z.string().optional(),
  offset: z.string().optional()
});

const replayRunQuerySchema = z.object({
  limit: z.string().optional()
});

const policyImpactRequestSchema = z.object({
  candidatePolicy: z.union([
    z.string().min(1),
    z.object({
      source: z.enum(["current", "path", "inline"]).default("inline"),
      ref: z.string().optional(),
      yaml: z.string().optional()
    })
  ]),
  since: z.string().datetime(),
  until: z.string().datetime(),
  limit: z.number().int().positive().optional()
});

const legacyPromoteRequestSchema = z.object({
  runId: z.string().min(1),
  approvedBy: z.string().min(1),
  reason: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
  acceptedRiskScore: z.number().optional(),
  notes: z.string().optional(),
  force: z.boolean().optional()
});

const guardrailPromoteRequestSchema = z.object({
  policyHash: z.string().min(1),
  reviewer: z.string().min(1),
  rationale: z.string().min(1).optional(),
  acceptedRisk: z.number().optional(),
  force: z.boolean().optional()
});

const promoteRequestSchema = z.union([legacyPromoteRequestSchema, guardrailPromoteRequestSchema]);

const promotionCheckQuerySchema = z.object({
  policyHash: z.string().min(1)
});

const policyTimelineQuerySchema = z.object({
  policyHash: z.string().min(1)
});

const outcomeRequestSchema = z.object({
  traceId: z.string().min(1),
  outcomeType: z.enum(["success", "failure", "override", "rollback"]),
  severity: z.number().int().min(1).max(5).default(1),
  humanOverride: z.boolean().default(false),
  notes: z.string().optional()
});

const outcomeListQuerySchema = z.object({
  policyHash: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.string().optional()
});

const approvalRequestSchema = z.object({
  role: z.string().min(1),
  actor: z.string().min(1),
  rationale: z.string().min(1)
});

const executeRequestSchema = z.object({
  actor: z.string().min(1).optional(),
  rationale: z.string().min(1).optional()
});

const policyQualityQuerySchema = z.object({
  policyHash: z.string().min(1),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional()
});

const policyDriftQuerySchema = z.object({
  policyHash: z.string().min(1),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  baselineSince: z.string().datetime().optional(),
  baselineUntil: z.string().datetime().optional()
});

const replayReportOutcomeQuerySchema = z.object({
  outcomesSince: z.string().datetime().optional(),
  outcomesUntil: z.string().datetime().optional()
});

const policyEventsQuerySchema = z.object({
  policyHash: z.string().min(1),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.string().optional()
});

const policyVerifyQuerySchema = z.object({
  policyHash: z.string().min(1),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  baselineSince: z.string().datetime().optional(),
  baselineUntil: z.string().datetime().optional(),
  qualitySince: z.string().datetime().optional(),
  qualityUntil: z.string().datetime().optional()
});

const policyPackDownloadQuerySchema = z.object({
  format: z.enum(["json"]).default("json")
});

const policyProvenanceQuerySchema = z.object({
  policyHash: z.string().min(1),
  format: z.enum(["md"]).optional()
});

const rollbackRequestSchema = z.object({
  targetPolicyHash: z.string().min(1),
  actor: z.string().min(1),
  rationale: z.string().min(1),
  dryRun: z.boolean().optional()
});

const policyReconcileQuerySchema = z.union([
  z.object({
    fromPolicyHash: z.string().min(1),
    toPolicyHash: z.string().min(1)
  }),
  z.object({
    since: z.string().datetime(),
    until: z.string().datetime()
  })
]);

function mapIntentToAction(intentType: Intent["intentType"]): { intent: string; action: string } {
  switch (intentType) {
    case "CREATE_PO":
      return { intent: "procurement.po.request", action: "requestPurchaseOrder" };
    case "CHECK_INVENTORY":
      return { intent: "supplychain.inventory.lookup", action: "fetchInventory" };
    case "REVIEW_INVOICE":
      return { intent: "finance.invoice.review", action: "requestInvoiceReview" };
    default:
      return { intent: "unknown", action: "noop" };
  }
}

const DEFAULT_ACTOR = "local-user";
const DEFAULT_MANUAL_RATIONALE =
  "Manual execution approval recorded with placeholder actor. TODO: replace with real auth.";

function buildExecutionPlan(parsed: Intent) {
  const { intent, action } = mapIntentToAction(parsed.intentType);
  return { intent, action };
}

function serializeApproval(approval: IntentApprovalRecord) {
  return {
    id: approval.id,
    traceId: approval.traceId,
    intentId: approval.intentId,
    policyHash: approval.policyHash,
    decisionId: approval.decisionId,
    requiredRole: approval.requiredRole,
    actor: approval.actor,
    rationale: approval.rationale,
    approvedAt: approval.approvedAt.toISOString()
  };
}

function buildDecisionSummary(decision: ReturnType<typeof policyEvaluator.evaluate>) {
  return {
    outcome: decision.final,
    requiredApprovals: decision.requiredApprovals,
    reasons: decision.reasons,
    matchedRuleIds: decision.matchedRules.map((rule) => rule.ruleId)
  };
}

function assertPolicyHashMatch(policyHash: string, snapshot: CandidatePolicySnapshot) {
  if (snapshot.info.hash !== policyHash) {
    throw new PolicySourceError("Resolved policy hash does not match the requested candidate hash.", 409);
  }
}

function resolveCandidatePolicySnapshot(input: {
  policyHash: string;
  source?: "current" | "path" | "inline";
  ref?: string | null;
  inlineYaml?: string | null;
}): CandidatePolicySnapshot {
  const request: CandidatePolicyRequest | null = (() => {
    if (input.source === "inline") {
      if (!input.inlineYaml) {
        throw new PolicySourceError("Inline policy YAML is required for this candidate.", 400);
      }
      return { source: "inline", yaml: input.inlineYaml, ref: input.ref ?? "inline" };
    }
    if (input.source === "path") {
      if (!input.ref) {
        throw new PolicySourceError("Policy path reference is required for this candidate.", 400);
      }
      return { source: "path", ref: input.ref };
    }
    if (input.source === "current") {
      return { source: "current" };
    }
    return null;
  })();

  if (!request) {
    const active = policyEvaluator.getPolicySnapshot();
    if (active.policy && active.info.hash === input.policyHash) {
      const snapshot: CandidatePolicySnapshot = {
        policy: active.policy,
        info: active.info,
        source: "current",
        ref: active.info.path
      };
      return snapshot;
    }
    throw new PolicySourceError("Policy hash is not registered for promotion.", 404);
  }

  const snapshot = loadPolicyFromSource(request);
  assertPolicyHashMatch(input.policyHash, snapshot);
  return snapshot;
}

async function evaluateGuardrailsForCandidate(policyHash: string, candidatePolicy: CandidatePolicySnapshot) {
  const executionMode = (config.executionMode ?? "manual") as ExecutionMode;
  const currentPolicy = loadPolicyFromSource({ source: "current" });
  return evaluatePromotionGuardrails({
    policyHash,
    candidatePolicy,
    currentPolicy,
    outcomeStore,
    replayStore,
    lineageStore,
    config: config.promotionGuardrails,
    executionMode
  });
}

async function evaluateAndStoreDecision(parsed: Intent, traceId: string) {
  const executionMode = (config.executionMode ?? "manual") as ExecutionMode;
  const policyDecision = policyEvaluator.evaluate(parsed, { executionMode, traceId });
  const existing = await policyStore.getPolicyByTraceId(traceId);
  if (
    existing &&
    existing.policyHash === policyDecision.policy.hash &&
    existing.decision === policyDecision.final
  ) {
    return { executionMode, policyDecision, policyRecord: existing };
  }
  const policyRecord = await policyStore.savePolicyDecision(traceId, policyDecision);
  return { executionMode, policyDecision, policyRecord };
}

function serializeOutcome(outcome: PolicyOutcomeRecord) {
  return {
    id: outcome.id,
    traceId: outcome.traceId,
    intentType: outcome.intentType,
    policyHash: outcome.policyHash,
    decision: outcome.decision,
    outcomeType: outcome.outcomeType,
    severity: outcome.severity,
    humanOverride: outcome.humanOverride,
    notes: outcome.notes ?? undefined,
    observedAt: outcome.observedAt.toISOString(),
    createdAt: outcome.createdAt.toISOString()
  };
}

async function proxyRequest(request: any, reply: any, baseUrl: string, path: string) {
  const traceId = getTraceIdFromRequest(request);
  const targetUrl = `${baseUrl}${path}`;
  const response = await fetch(targetUrl, {
    method: request.method,
    headers: {
      "content-type": request.headers["content-type"] ?? "application/json",
      "x-trace-id": traceId
    },
    body: request.body ? JSON.stringify(request.body) : undefined
  });
  const data = await response.text();
  const contentType = response.headers.get("content-type");
  if (contentType) {
    reply.header("content-type", contentType);
  }
  reply.code(response.status).send(data);
}

async function planIntent(parsed: Intent, traceId: string) {
  const plan = buildExecutionPlan(parsed);
  const { executionMode, policyDecision, policyRecord } = await evaluateAndStoreDecision(parsed, traceId);
  await intentStore.saveIntent(parsed, traceId);

  return {
    intent: plan.intent,
    action: plan.action,
    plan,
    traceId,
    parsedIntent: parsed,
    policy: policyDecision,
    policyRecord,
    executionMode
  };
}

async function notifyOrchestrationExecution(traceId: string, decisionId: string, policyHash: string) {
  const payload = {
    traceId,
    decision: {
      policyHash,
      decisionId
    }
  };
  try {
    await fetch(`${config.orchestrationUrl}/v1/intent/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-trace-id": traceId },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    logger.warn({ error, traceId }, "Failed to notify orchestration execution");
  }
}

async function executeIntentAction(input: {
  parsed: Intent;
  traceId: string;
  policyDecision: ReturnType<typeof policyEvaluator.evaluate>;
  executionMode: ExecutionMode;
  policyRecordId: string;
  policyHash: string;
}) {
  const { parsed, traceId, policyDecision, executionMode } = input;
  const plan = buildExecutionPlan(parsed);
  const policySnapshot = policyEvaluator.getPolicySnapshot();
  const autoRequires = policySnapshot.policy?.defaults.execution.autoRequires ?? ["WARN"];
  const autoRequiresWarn = autoRequires.includes("WARN") || autoRequires.includes("ALLOW_ONLY");

  let result: unknown = { message: "No action taken" };

  if (executionMode === "simulate") {
    if (policyDecision.final === "DENY" && !policyDecision.simulationAllowed) {
      result = { message: "Policy denied simulation." };
    } else {
      result = { message: "Simulation mode enabled. No downstream actions executed." };
    }
  } else if (policyDecision.final === "DENY") {
    result = { message: "Policy denied execution." };
  } else if (executionMode === "auto" && policyDecision.final === "WARN" && autoRequiresWarn) {
    result = {
      message: "Policy warning requires manual approval.",
      plan
    };
  } else if (plan.action === "requestPurchaseOrder") {
    result = await requestPurchaseOrder(config.procurementUrl, { sku: "AUTO-ITEM", quantity: 10 }, traceId);
  } else if (plan.action === "fetchInventory") {
    result = await fetchInventory(config.supplychainUrl, "AUTO-ITEM", traceId);
  } else if (plan.action === "requestInvoiceReview") {
    result = await requestInvoiceReview(
      config.financeUrl,
      { invoiceId: "AUTO-INV", amount: 1000 },
      traceId
    );
  }

  await notifyOrchestrationExecution(traceId, input.policyRecordId, input.policyHash);

  return {
    intent: plan.intent,
    action: plan.action,
    result,
    traceId,
    parsedIntent: parsed,
    policy: policyDecision,
    executionMode
  };
}

function findMissingApprovals(input: {
  requiredApprovals: Array<{ role: string }>;
  approvals: IntentApprovalRecord[];
  policyHash: string;
  decisionId: string;
}) {
  const approvedRoles = new Set(
    input.approvals
      .filter(
        (approval) =>
          approval.policyHash === input.policyHash && approval.decisionId === input.decisionId
      )
      .map((approval) => approval.requiredRole)
  );

  return input.requiredApprovals
    .map((approval) => approval.role)
    .filter((role) => !approvedRoles.has(role));
}

async function executeIntentWithGating(input: {
  traceId: string;
  parsedIntent?: Intent;
  actor?: string;
  rationale?: string;
}) {
  const storedIntent = input.parsedIntent
    ? await intentStore.saveIntent(input.parsedIntent, input.traceId)
    : await intentStore.getIntentByTraceId(input.traceId);
  if (!storedIntent) {
    return { status: 404, body: { message: "Intent not found", traceId: input.traceId } };
  }

  const { executionMode, policyDecision, policyRecord } = await evaluateAndStoreDecision(
    storedIntent.intent,
    input.traceId
  );
  const plan = buildExecutionPlan(storedIntent.intent);

  if (config.executionGatingEnabled && policyDecision.requiredApprovals.length > 0) {
    const approvals = await approvalStore.listApprovalsByTraceId(input.traceId);
    const missingApprovals = findMissingApprovals({
      requiredApprovals: policyDecision.requiredApprovals,
      approvals,
      policyHash: policyRecord.policyHash,
      decisionId: policyRecord.id
    });

    if (missingApprovals.length > 0 && executionMode === "auto") {
      return {
        status: 409,
        body: {
          missingApprovals,
          decision: buildDecisionSummary(policyDecision),
          plan
        }
      };
    }

    if (missingApprovals.length > 0 && executionMode === "manual") {
      const actor = input.actor?.trim() || DEFAULT_ACTOR;
      const rationale = input.rationale?.trim() || DEFAULT_MANUAL_RATIONALE;
      await Promise.all(
        missingApprovals.map((role) =>
          approvalStore.recordApproval({
            traceId: input.traceId,
            intentId: storedIntent.id,
            policyHash: policyRecord.policyHash,
            decisionId: policyRecord.id,
            requiredRole: role,
            actor,
            rationale
          })
        )
      );
    }
  }

  const result = await executeIntentAction({
    parsed: storedIntent.intent,
    traceId: input.traceId,
    policyDecision,
    executionMode,
    policyRecordId: policyRecord.id,
    policyHash: policyRecord.policyHash
  });

  return { status: 200, body: result };
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const snapshot = policyEvaluator.getPolicySnapshot();
  lifecycleStore.setActivePolicy({
    hash: snapshot.info.hash,
    version: snapshot.info.version,
    path: snapshot.info.path,
    loadedAt: snapshot.info.loadedAt
  });

  app.post("/v1/intent", async (request) => {
    const body = intentSchema.parse(request.body);
    const traceId = getTraceIdFromRequest(request);
    const parsed = parseIntent(body.text);
    const planned = await planIntent(parsed, traceId);
    if (config.executionGatingEnabled) {
      const { policyRecord, ...response } = planned;
      return response;
    }
    return executeIntentAction({
      parsed,
      traceId,
      policyDecision: planned.policy,
      executionMode: planned.executionMode,
      policyRecordId: planned.policyRecord.id,
      policyHash: planned.policyRecord.policyHash
    });
  });

  app.post("/v1/assist", async (request) => {
    const body = intentSchema.parse(request.body);
    const traceId = getTraceIdFromRequest(request);
    const response = await fetch(`${config.aiServiceUrl}/v1/assist`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-trace-id": traceId },
      body: JSON.stringify(body)
    });
    const payload = assistResponseSchema.parse(await response.json());
    const toolCall = payload.tool_calls[0];

    if (config.executeToolCalls && toolCall?.endpoint === "/v1/intent") {
      const text = typeof toolCall.payload.text === "string" ? toolCall.payload.text : body.text;
      const parsedIntent = parseIntent(text);
      if (config.executionGatingEnabled) {
        const executed = await executeIntentWithGating({ traceId, parsedIntent });
        return { ...payload, executed: executed.body, executedStatus: executed.status };
      }
      const planned = await planIntent(parsedIntent, traceId);
      const executed = await executeIntentAction({
        parsed: parsedIntent,
        traceId,
        policyDecision: planned.policy,
        executionMode: planned.executionMode,
        policyRecordId: planned.policyRecord.id,
        policyHash: planned.policyRecord.policyHash
      });
      return { ...payload, executed };
    }

    return payload;
  });

  app.get("/v1/assist/explain/:traceId", async (request, reply) => {
    const traceId = String((request.params as { traceId: string }).traceId);
    const response = await fetch(`${config.aiServiceUrl}/v1/explain/${traceId}`, {
      headers: { "x-trace-id": traceId }
    });
    const data = await response.text();
    const contentType = response.headers.get("content-type");
    if (contentType) {
      reply.header("content-type", contentType);
    }
    reply.code(response.status).send(data);
  });

  app.get("/v1/intents/:traceId", async (request, reply) => {
    const traceId = String((request.params as { traceId: string }).traceId);
    const stored = await intentStore.getIntentByTraceId(traceId);
    if (!stored) {
      reply.code(404);
      return { message: "Intent not found", traceId };
    }
    return {
      id: stored.id,
      traceId: stored.traceId,
      intent: stored.intent,
      createdAt: stored.createdAt
    };
  });

  app.get("/v1/intent/:traceId/decision", async (request, reply) => {
    const traceId = String((request.params as { traceId: string }).traceId);
    const stored = await intentStore.getIntentByTraceId(traceId);
    if (!stored) {
      reply.code(404);
      return { message: "Intent not found", traceId };
    }

    const executionMode = (config.executionMode ?? "manual") as ExecutionMode;
    const policyDecision = policyEvaluator.evaluate(stored.intent, { executionMode, traceId });
    const plan = buildExecutionPlan(stored.intent);

    return {
      traceId,
      intent: stored.intent,
      policyHash: policyDecision.policy.hash,
      decision: buildDecisionSummary(policyDecision),
      plan
    };
  });

  app.post("/v1/intent/:traceId/approve", async (request, reply) => {
    const traceId = String((request.params as { traceId: string }).traceId);
    const body = approvalRequestSchema.parse(request.body ?? {});
    const storedIntent = await intentStore.getIntentByTraceId(traceId);
    if (!storedIntent) {
      reply.code(404);
      return { message: "Intent not found", traceId };
    }

    const { policyDecision, policyRecord } = await evaluateAndStoreDecision(storedIntent.intent, traceId);
    const requiredRoles = new Set(policyDecision.requiredApprovals.map((approval) => approval.role));
    if (!requiredRoles.has(body.role)) {
      reply.code(400);
      return {
        message: "Approval role not required for the current decision.",
        traceId,
        requiredApprovals: policyDecision.requiredApprovals
      };
    }

    await approvalStore.recordApproval({
      traceId,
      intentId: storedIntent.id,
      policyHash: policyRecord.policyHash,
      decisionId: policyRecord.id,
      requiredRole: body.role,
      actor: body.actor,
      rationale: body.rationale
    });

    const approvals = await approvalStore.listApprovalsByTraceId(traceId);
    return {
      ok: true,
      approvals: approvals.map(serializeApproval)
    };
  });

  app.post("/v1/intent/:traceId/execute", async (request, reply) => {
    const traceId = String((request.params as { traceId: string }).traceId);
    const body = executeRequestSchema.parse(request.body ?? {});
    const executed = await executeIntentWithGating({
      traceId,
      actor: body.actor,
      rationale: body.rationale
    });
    reply.code(executed.status);
    return executed.body;
  });

  app.get("/v1/policy/explain/:traceId", async (request, reply) => {
    const traceId = String((request.params as { traceId: string }).traceId);
    const storedIntent = await intentStore.getIntentByTraceId(traceId);
    if (!storedIntent) {
      reply.code(404);
      return { message: "Intent not found", traceId };
    }
    const policyRecord = await policyStore.getPolicyByTraceId(traceId);
    const executionMode = (config.executionMode ?? "manual") as ExecutionMode;
    if (!policyRecord) {
      reply.code(404);
      return { message: "Policy decision not found", traceId };
    }

    const snapshot = policyEvaluator.getPolicySnapshot();
    const policyInfo: PolicyInfo = {
      version: snapshot.info.version,
      hash: policyRecord.policyHash,
      loadedAt: snapshot.info.hash === policyRecord.policyHash ? snapshot.info.loadedAt : "unknown",
      path: snapshot.info.path
    };

    return buildPolicyExplainResponse({
      traceId,
      intent: storedIntent.intent,
      policyRecord,
      executionMode,
      policyInfo
    });
  });

  app.post("/v1/policy/reload", async (_request, reply) => {
    if (!config.policyReloadEnabled) {
      reply.code(403);
      return { message: "Policy reload disabled." };
    }
    const snapshot = policyEvaluator.reloadPolicy();
    return {
      policy: snapshot.info,
      source: snapshot.source
    };
  });

  app.get("/v1/policy/current", async () => {
    const snapshot = policyEvaluator.getPolicySnapshot();
    return {
      version: snapshot.info.version,
      hash: snapshot.info.hash,
      loadedAt: snapshot.info.loadedAt,
      path: snapshot.info.path
    };
  });

  app.post("/v1/policy/outcomes", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const body = outcomeRequestSchema.parse(request.body ?? {});
    const storedIntent = await intentStore.getIntentByTraceId(body.traceId);
    if (!storedIntent) {
      reply.code(404);
      return { message: "Intent not found", traceId: body.traceId };
    }
    const policyRecord = await policyStore.getPolicyByTraceId(body.traceId);
    if (!policyRecord) {
      reply.code(404);
      return { message: "Policy decision not found", traceId: body.traceId };
    }

    const outcomeRecord = await outcomeStore.recordOutcome({
      traceId: body.traceId,
      intentType: storedIntent.intent.intentType,
      policyHash: policyRecord.policyHash,
      decision: policyRecord.decision,
      outcomeType: body.outcomeType,
      severity: body.severity,
      humanOverride: body.humanOverride,
      notes: body.notes ?? null
    });

    return {
      traceId,
      stored: true,
      outcome: serializeOutcome(outcomeRecord)
    };
  });

  app.get("/v1/policy/outcomes/:traceId", async (request) => {
    const traceId = String((request.params as { traceId: string }).traceId);
    const outcomes = await outcomeStore.getOutcomesByTraceId(traceId);
    return { traceId, outcomes: outcomes.map(serializeOutcome) };
  });

  app.get("/v1/policy/outcomes", async (request) => {
    const traceId = getTraceIdFromRequest(request);
    const query = outcomeListQuerySchema.parse(request.query ?? {});
    const limit =
      query.limit && Number.isFinite(Number(query.limit)) && Number(query.limit) > 0 ? Number(query.limit) : undefined;
    const outcomes = await outcomeStore.listOutcomes({
      policyHash: query.policyHash,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
      limit
    });
    return { traceId, outcomes: outcomes.map(serializeOutcome) };
  });

  app.get("/v1/policy/quality", async (request) => {
    const traceId = getTraceIdFromRequest(request);
    const query = policyQualityQuerySchema.parse(request.query ?? {});
    const since = query.since ? new Date(query.since) : undefined;
    const until = query.until ? new Date(query.until) : undefined;
    const outcomes = await outcomeStore.listOutcomes({
      policyHash: query.policyHash,
      since,
      until
    });
    const metrics = calculatePolicyQuality(outcomes);
    return {
      traceId,
      policyHash: query.policyHash,
      window: {
        since: since ? since.toISOString() : null,
        until: until ? until.toISOString() : null
      },
      metrics
    };
  });

  app.get("/v1/policy/drift", async (request) => {
    const traceId = getTraceIdFromRequest(request);
    const query = policyDriftQuerySchema.parse(request.query ?? {});
    const now = new Date();
    const defaults = defaultDriftWindow(now);
    const recentSince = query.since ? new Date(query.since) : defaults.recent.since;
    const recentUntil = query.until ? new Date(query.until) : defaults.recent.until;
    const baselineUntil = query.baselineUntil ? new Date(query.baselineUntil) : recentSince;
    const baselineSince = query.baselineSince
      ? new Date(query.baselineSince)
      : new Date(baselineUntil.getTime() - 30 * 24 * 60 * 60 * 1000);

    const report = await buildPolicyDriftReport({
      policyHash: query.policyHash,
      recentWindow: { since: recentSince, until: recentUntil },
      baselineWindow: { since: baselineSince, until: baselineUntil },
      outcomeStore,
      replayStore,
      lineageStore
    });

    return { traceId, report };
  });

  app.get("/v1/policy/events", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const parsed = policyEventsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { message: "Invalid policy events request", traceId };
    }
    const { policyHash, since, until, limit } = parsed.data;
    const max = limit && Number.isFinite(Number(limit)) ? Number(limit) : undefined;
    const events = await buildPolicyEventLog({
      policyHash,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      limit: max
    });
    return { traceId, policyHash, events };
  });

  app.get("/v1/policy/verify", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const parsed = policyVerifyQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { message: "Invalid policy verification request", traceId };
    }
    const activeSnapshot = policyEvaluator.getPolicySnapshot();
    const result = await verifyPolicyDeterminism({
      policyHash: parsed.data.policyHash,
      since: parsed.data.since ? new Date(parsed.data.since) : undefined,
      until: parsed.data.until ? new Date(parsed.data.until) : undefined,
      baselineSince: parsed.data.baselineSince ? new Date(parsed.data.baselineSince) : undefined,
      baselineUntil: parsed.data.baselineUntil ? new Date(parsed.data.baselineUntil) : undefined,
      qualitySince: parsed.data.qualitySince ? new Date(parsed.data.qualitySince) : undefined,
      qualityUntil: parsed.data.qualityUntil ? new Date(parsed.data.qualityUntil) : undefined,
      activePolicyHash: activeSnapshot.info.hash
    });
    return { traceId, policyHash: parsed.data.policyHash, ...result };
  });

  app.get("/v1/policy/provenance", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const parsed = policyProvenanceQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { message: "Invalid policy provenance request", traceId };
    }
    const activeSnapshot = policyEvaluator.getPolicySnapshot();
    const report = await buildPolicyProvenanceReport({
      policyHash: parsed.data.policyHash,
      activePolicyHash: activeSnapshot.info.hash,
      lifecycleStore,
      lineageStore,
      replayStore,
      guardrailCheckStore,
      approvalStore: policyApprovalStore,
      outcomeStore,
      rollbackStore,
      policyInfo: activeSnapshot.info
    });

    if (parsed.data.format === "md") {
      reply.type("text/markdown; charset=utf-8");
      return buildPolicyProvenanceMarkdown(report);
    }

    return { traceId, report };
  });

  app.get("/v1/policy/packs", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    try {
      const packs = policyPackRegistry.listPacks();
      return { traceId, packs };
    } catch (error) {
      if (error instanceof PolicyPackError) {
        reply.code(error.statusCode);
        return { message: error.message, traceId };
      }
      throw error;
    }
  });

  app.get("/v1/policy/packs/:name", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const name = String((request.params as { name: string }).name);
    try {
      const pack = policyPackRegistry.getPack(name);
      return { traceId, pack };
    } catch (error) {
      if (error instanceof PolicyPackError) {
        reply.code(error.statusCode);
        return { message: error.message, traceId };
      }
      throw error;
    }
  });

  app.get("/v1/policy/packs/:name/download", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const name = String((request.params as { name: string }).name);
    const parsed = policyPackDownloadQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { message: "Invalid download format.", traceId };
    }
    try {
      const download = policyPackRegistry.downloadPack(name);
      if (parsed.data.format === "json") {
        reply.type("application/json; charset=utf-8");
        reply.header("content-disposition", `attachment; filename=\"${download.filename}\"`);
        return download.payload;
      }
      reply.code(400);
      return { message: "Unsupported download format.", traceId };
    } catch (error) {
      if (error instanceof PolicyPackError) {
        reply.code(error.statusCode);
        return { message: error.message, traceId };
      }
      throw error;
    }
  });

  app.post("/v1/policy/packs/:name/install", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const name = String((request.params as { name: string }).name);
    try {
      const result = await installPolicyPack({
        name,
        registry: policyPackRegistry,
        lifecycleStore,
        replayStore,
        outcomeStore,
        lineageStore,
        guardrailConfig: config.promotionGuardrails,
        executionMode: (config.executionMode ?? "manual") as ExecutionMode
      });
      return { traceId, bundle: result.bundle };
    } catch (error) {
      if (error instanceof PolicyPackError) {
        reply.code(error.statusCode);
        return { message: error.message, traceId };
      }
      if (error instanceof PolicySourceError) {
        reply.code(error.statusCode);
        return { message: error.message, traceId };
      }
      throw error;
    }
  });

  app.post("/v1/policy/replay", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const body = replayRequestSchema.parse(request.body ?? {});
    const candidateRequest = body.candidatePolicy ?? { source: "current" };

    let candidate;
    try {
      candidate = loadPolicyFromSource(candidateRequest);
    } catch (error) {
      if (error instanceof PolicySourceError) {
        reply.code(error.statusCode);
        return { message: error.message, traceId };
      }
      throw error;
    }

    const inlineYaml = candidateRequest.source === "inline" ? candidateRequest.yaml ?? null : null;
    lifecycleStore.registerDraft({
      hash: candidate.info.hash,
      source: candidate.source,
      ref: candidate.ref ?? null,
      inlineYaml
    });

    const filters = body.filters
      ? {
          intentTypes: body.filters.intentTypes,
          since: body.filters.since ? new Date(body.filters.since) : undefined,
          until: body.filters.until ? new Date(body.filters.until) : undefined,
          limit: body.filters.limit
        }
      : undefined;

    const executionMode = (config.executionMode ?? "manual") as ExecutionMode;
    const run = await replayEngine.runReplay({
      candidate,
      filters,
      requestedBy: body.requestedBy,
      executionMode
    });

    lifecycleStore.markSimulated({
      hash: run.candidate.hash,
      source: run.candidate.source,
      ref: run.candidate.ref ?? null,
      inlineYaml
    });

    return { traceId, run };
  });

  app.post("/v1/policy/impact", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const body = policyImpactRequestSchema.parse(request.body ?? {});
    const candidateRequest =
      typeof body.candidatePolicy === "string"
        ? { source: "inline" as const, yaml: body.candidatePolicy, ref: "inline" }
        : body.candidatePolicy;

    let candidate;
    let currentPolicy;
    try {
      candidate = loadPolicyFromSource(candidateRequest);
      currentPolicy = loadPolicyFromSource({ source: "current" });
    } catch (error) {
      if (error instanceof PolicySourceError) {
        reply.code(error.statusCode);
        return { message: error.message, traceId };
      }
      throw error;
    }

    const since = new Date(body.since);
    const until = new Date(body.until);
    const intents = await replayStore.listBaselineIntents({
      since,
      until,
      limit: body.limit
    });
    const executionMode = (config.executionMode ?? "manual") as ExecutionMode;
    const report = computePolicyImpactReport({
      currentPolicy,
      candidatePolicy: candidate,
      intents,
      window: { since, until },
      executionMode
    });

    return { traceId, ...report };
  });

  app.get("/v1/policy/replay/:runId", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const runId = String((request.params as { runId: string }).runId);
    const query = replayRunQuerySchema.parse(request.query ?? {});
    const limit = query.limit && Number.isFinite(Number(query.limit)) ? Number(query.limit) : undefined;
    const run = await replayEngine.getRunSummary(runId, { limit });
    if (!run) {
      reply.code(404);
      return { message: "Replay run not found", traceId };
    }
    return { traceId, run };
  });

  app.get("/v1/policy/replay/:runId/report", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const runId = String((request.params as { runId: string }).runId);
    const outcomeQuery = replayReportOutcomeQuerySchema.parse(request.query ?? {});
    const run = await replayStore.getRun(runId);
    if (!run) {
      reply.code(404);
      return { message: "Replay run not found", traceId };
    }
    const results = await replayStore.getResults(runId, { limit: run.limit, offset: 0 });
    const now = new Date();
    const since = outcomeQuery.outcomesSince
      ? new Date(outcomeQuery.outcomesSince)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const until = outcomeQuery.outcomesUntil ? new Date(outcomeQuery.outcomesUntil) : now;
    const outcomes = await outcomeStore.listOutcomes({
      policyHash: run.candidatePolicyHash,
      since,
      until
    });
    const outcomeOverlay = {
      policyHash: run.candidatePolicyHash,
      window: {
        since: since.toISOString(),
        until: until.toISOString()
      },
      metrics: calculatePolicyQuality(outcomes)
    };
    const report = buildReport(run, results, outcomeOverlay);
    return { traceId, ...report };
  });

  app.get("/v1/policy/replay/:runId/results", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const runId = String((request.params as { runId: string }).runId);
    const run = await replayStore.getRun(runId);
    if (!run) {
      reply.code(404);
      return { message: "Replay run not found", traceId };
    }

    const query = replayResultsQuerySchema.parse(request.query ?? {});
    const changed = query.changed ? query.changed === "true" : undefined;
    const limit = query.limit && Number.isFinite(Number(query.limit)) ? Number(query.limit) : undefined;
    const offset = query.offset && Number.isFinite(Number(query.offset)) ? Number(query.offset) : undefined;
    const results = await replayEngine.getRunResults(runId, { changed, limit, offset });
    return { traceId, runId, results };
  });

  app.get("/v1/policy/status", async (request) => {
    const traceId = getTraceIdFromRequest(request);
    const activeSnapshot = policyEvaluator.getPolicySnapshot();
    const active = lifecycleStore.setActivePolicy({
      hash: activeSnapshot.info.hash,
      version: activeSnapshot.info.version,
      path: activeSnapshot.info.path,
      loadedAt: activeSnapshot.info.loadedAt
    });

    return {
      traceId,
      active,
      policies: lifecycleStore.listStatuses()
    };
  });

  app.get("/v1/policy/timeline", async (request, reply) => {
    const parsed = policyTimelineQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { message: "Invalid policy timeline request" };
    }
    const { policyHash } = parsed.data;
    const activeSnapshot = policyEvaluator.getPolicySnapshot();
    const activePolicyHash = lifecycleStore.getActivePolicy()?.policyHash ?? activeSnapshot.info.hash;

    const [lineage, activeLineageChain, simulations, guardrailChecks, approvals, rollbacks] = await Promise.all([
      lineageStore.getLineage(policyHash),
      lineageStore.getLineageChain(activePolicyHash),
      replayStore.listRuns({ policyHash, limit: 200 }),
      guardrailCheckStore.listChecks(policyHash),
      policyApprovalStore.listApprovals(policyHash),
      rollbackStore.listRollbacks({ policyHash })
    ]);

    return buildPolicyLifecycleTimeline({
      policyHash,
      activePolicyHash,
      lineage,
      activeLineageChain,
      simulations,
      guardrailChecks,
      approvals,
      rollbacks
    });
  });

  app.get("/v1/policy/lineage/current", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const active = lifecycleStore.getActivePolicy() ?? policyEvaluator.getPolicySnapshot();
    const policyHash = "policyHash" in active ? active.policyHash : active.info.hash;
    const lineage = await lineageStore.getLineageChain(policyHash);
    if (!lineage.length) {
      reply.code(404);
      return { message: "Lineage not found", traceId };
    }
    return { traceId, policyHash, lineage };
  });

  app.get("/v1/policy/lineage/:policyHash", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const policyHash = String((request.params as { policyHash: string }).policyHash);
    const lineage = await lineageStore.getLineageChain(policyHash);
    if (!lineage.length) {
      reply.code(404);
      return { message: "Lineage not found", traceId };
    }
    return { traceId, policyHash, lineage };
  });

  app.post("/v1/policy/rollback", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const parsed = rollbackRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { message: "Invalid rollback request", traceId };
    }

    const { decision, event } = await computeRollbackDecision({
      request: parsed.data,
      lineageStore,
      lifecycleStore,
      rollbackStore,
      evaluator: policyEvaluator
    });

    if (!decision.ok) {
      const notFound = decision.reasons.some((reason) => reason.includes("lineage store"));
      reply.code(notFound ? 404 : 409);
      return { message: "Rollback rejected.", traceId, decision };
    }

    return { traceId, decision, event };
  });

  app.get("/v1/policy/reconcile", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const rawQuery = (request.query ?? {}) as Record<string, unknown>;
    const hasHashQuery = "fromPolicyHash" in rawQuery || "toPolicyHash" in rawQuery;
    const hasWindowQuery = "since" in rawQuery || "until" in rawQuery;

    if (hasHashQuery && hasWindowQuery) {
      reply.code(400);
      return { message: "Provide either policy hashes or a time window, not both.", traceId };
    }

    const parsed = policyReconcileQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      reply.code(400);
      return { message: "Invalid policy reconcile request", traceId };
    }

    const activePolicyHash = lifecycleStore.getActivePolicy()?.policyHash ?? policyEvaluator.getPolicySnapshot().info.hash;
    let fromPolicyHash: string;
    let toPolicyHash: string;

    if ("fromPolicyHash" in parsed.data) {
      fromPolicyHash = parsed.data.fromPolicyHash;
      toPolicyHash = parsed.data.toPolicyHash;
    } else {
      const since = new Date(parsed.data.since);
      const until = new Date(parsed.data.until);
      if (since.getTime() > until.getTime()) {
        reply.code(400);
        return { message: "Invalid policy reconcile request", traceId };
      }
      const resolved = await resolvePolicyHashesForWindow({
        since,
        until,
        activePolicyHash,
        lineageStore,
        rollbackStore
      });
      fromPolicyHash = resolved.fromPolicyHash;
      toPolicyHash = resolved.toPolicyHash;
    }

    try {
      const [fromPolicy, toPolicy] = await Promise.all([
        resolvePolicyDocumentByHash({
          policyHash: fromPolicyHash,
          lifecycleStore,
          evaluator: policyEvaluator,
          policyPackRegistry
        }),
        resolvePolicyDocumentByHash({
          policyHash: toPolicyHash,
          lifecycleStore,
          evaluator: policyEvaluator,
          policyPackRegistry
        })
      ]);

      const report = buildReconcileReport({
        fromPolicyHash,
        toPolicyHash,
        fromPolicy,
        toPolicy
      });

      return { traceId, report };
    } catch (error) {
      reply.code(404);
      return { message: (error as Error).message, traceId };
    }
  });

  app.get("/v1/policy/promote/check", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const parsed = promotionCheckQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { message: "Invalid promotion check request", traceId };
    }
    const { policyHash } = parsed.data;
    const status = lifecycleStore.getStatus(policyHash);
    let candidatePolicy: CandidatePolicySnapshot;
    try {
      candidatePolicy = resolveCandidatePolicySnapshot({
        policyHash,
        source: status?.source,
        ref: status?.ref ?? null,
        inlineYaml: status?.inlineYaml ?? null
      });
    } catch (error) {
      if (error instanceof PolicySourceError) {
        reply.code(error.statusCode);
        return { message: error.message, traceId };
      }
      throw error;
    }

    let decision: GuardrailDecision;
    try {
      decision = await evaluateGuardrailsForCandidate(policyHash, candidatePolicy);
    } catch (error) {
      reply.code(500);
      return { message: "Failed to evaluate promotion guardrails.", traceId };
    }

    if (!config.promotionGuardrails.enabled) {
      decision = { ...decision, allowed: true, requiredAcceptance: false, reasons: [] };
    }

    await guardrailCheckStore.recordCheck({
      policyHash,
      evaluatedAt: decision.snapshot.evaluatedAt,
      actor: "system",
      rationale: "Promotion guardrail check executed.",
      decision
    });

    return { traceId, ...decision };
  });

  app.post("/v1/policy/promote", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const parsed = promoteRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { message: "Invalid promotion payload", traceId };
    }
    const body = parsed.data;
    const isLegacy = "runId" in body;
    const now = new Date();
    const force = Boolean(body.force);

    let policyHash: string;
    let reviewer: string;
    let rationale: string | undefined;
    let acceptedRisk: number | undefined;
    let notes: string | undefined;
    let runId: string;
    let runSource: "replay" | "manual" = "manual";
    let candidatePolicy: CandidatePolicySnapshot;
    let impact;
    let driftResults: Awaited<ReturnType<typeof replayStore.getResults>> = [];

    if (isLegacy) {
      const legacyBody = body;
      const run = await replayStore.getRun(legacyBody.runId);
      if (!run) {
        reply.code(404);
        return { message: "Replay run not found", traceId };
      }
      runId = run.id;
      policyHash = run.candidatePolicyHash;
      reviewer = legacyBody.approvedBy;
      rationale = legacyBody.rationale ?? legacyBody.reason;
      acceptedRisk = legacyBody.acceptedRiskScore;
      notes = legacyBody.notes;
      runSource = "replay";
      driftResults = await replayStore.getResults(run.id, { limit: run.limit, offset: 0 });
      impact = calculatePolicyImpact(driftResults, config.policyImpact);
      if (impact.blocked) {
        reply.code(409);
        return { message: "Promotion blocked by impact guardrails.", traceId, impact };
      }

      const status = lifecycleStore.getStatus(run.candidatePolicyHash);
      try {
        candidatePolicy = resolveCandidatePolicySnapshot({
          policyHash: run.candidatePolicyHash,
          source: run.candidatePolicySource,
          ref: run.candidatePolicyRef ?? null,
          inlineYaml: status?.inlineYaml ?? null
        });
      } catch (error) {
        if (error instanceof PolicySourceError) {
          reply.code(error.statusCode);
          return { message: error.message, traceId };
        }
        throw error;
      }
    } else {
      const guardrailBody = body;
      policyHash = guardrailBody.policyHash;
      reviewer = guardrailBody.reviewer;
      rationale = guardrailBody.rationale;
      acceptedRisk = guardrailBody.acceptedRisk;
      runId = "manual";
      const status = lifecycleStore.getStatus(policyHash);
      try {
        candidatePolicy = resolveCandidatePolicySnapshot({
          policyHash,
          source: status?.source,
          ref: status?.ref ?? null,
          inlineYaml: status?.inlineYaml ?? null
        });
      } catch (error) {
        if (error instanceof PolicySourceError) {
          reply.code(error.statusCode);
          return { message: error.message, traceId };
        }
        throw error;
      }
      const runs = await replayStore.listRuns({ policyHash, limit: 200 });
      const latest = runs.length ? runs[runs.length - 1] : null;
      if (latest) {
        runId = latest.id;
        runSource = "replay";
        driftResults = await replayStore.getResults(latest.id, { limit: latest.limit, offset: 0 });
      }
    }

    if (config.promotionGuardrails.requireRationale) {
      if (!rationale || rationale.trim().length < 10) {
        reply.code(400);
        return { message: "Promotion rationale is required.", traceId };
      }
    }

    if (config.promotionGuardrails.requireAcceptedRisk) {
      if (acceptedRisk === undefined || !Number.isFinite(acceptedRisk)) {
        reply.code(400);
        return { message: "Accepted risk score is required.", traceId };
      }
    }

    let decision: GuardrailDecision | null = null;
    if (config.promotionGuardrails.enabled) {
      try {
        decision = await evaluateGuardrailsForCandidate(policyHash, candidatePolicy);
      } catch (error) {
        reply.code(500);
        return { message: "Failed to evaluate promotion guardrails.", traceId };
      }
      if (!decision.allowed && !force) {
        reply.code(409);
        return { message: "Promotion blocked by promotion guardrails.", traceId, decision };
      }
      if (decision.requiredAcceptance && (acceptedRisk === undefined || !Number.isFinite(acceptedRisk))) {
        reply.code(400);
        return { message: "Accepted risk score is required for promotion.", traceId, decision };
      }
    }

    const approval = {
      approvedBy: reviewer,
      approvedAt: now.toISOString(),
      reason: rationale ?? "Manual promotion.",
      rationale,
      acceptedRiskScore: acceptedRisk,
      notes,
      runId
    };

    await policyApprovalStore.recordApproval({
      policyHash,
      approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt,
      rationale: approval.reason,
      acceptedRiskScore: approval.acceptedRiskScore,
      notes: approval.notes,
      runId: approval.runId
    });

    const parentPolicyHash = policyEvaluator.getPolicySnapshot().info.hash;
    const drift =
      driftResults.length > 0
        ? buildPolicyDriftSummary(driftResults)
        : { constraintsAdded: 0, constraintsRemoved: 0, severityDelta: 0, netRiskScoreChange: 0 };
    await lineageStore.createLineage({
      policyHash,
      parentPolicyHash: parentPolicyHash === policyHash ? null : parentPolicyHash,
      promotedBy: approval.approvedBy,
      promotedAt: approval.approvedAt,
      rationale: rationale ?? "Manual promotion.",
      acceptedRiskScore: acceptedRisk ?? 0,
      source: runSource,
      drift
    });

    const promoted = lifecycleStore.promotePolicy({
      hash: policyHash,
      source: candidatePolicy.source,
      ref: candidatePolicy.ref ?? null,
      approval
    });

    if (decision) {
      await guardrailCheckStore.recordCheck({
        policyHash,
        evaluatedAt: decision.snapshot.evaluatedAt,
        actor: reviewer,
        rationale: rationale ?? "Guardrail check recorded during promotion.",
        decision
      });
      await promotionStore.createPromotion({
        policyHash,
        evaluatedAt: decision.snapshot.evaluatedAt,
        reviewer,
        rationale: rationale ?? "Manual promotion.",
        acceptedRisk: acceptedRisk ?? null,
        forced: force,
        guardrailDecision: decision
      });
    }

    return {
      traceId,
      promoted,
      impact,
      decision
    };
  });

  app.all("/v1/procurement/*", async (request, reply) => {
    await proxyRequest(request, reply, config.procurementUrl, request.url);
  });

  app.all("/v1/supplychain/*", async (request, reply) => {
    await proxyRequest(request, reply, config.supplychainUrl, request.url);
  });

  app.all("/v1/finance/*", async (request, reply) => {
    await proxyRequest(request, reply, config.financeUrl, request.url);
  });

  app.all("/v1/integration/*", async (request, reply) => {
    await proxyRequest(request, reply, config.integrationUrl, request.url);
  });
}
