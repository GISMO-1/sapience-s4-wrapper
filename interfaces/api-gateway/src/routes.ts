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

const promoteRequestSchema = z.object({
  runId: z.string().min(1),
  approvedBy: z.string().min(1),
  reason: z.string().min(1).optional(),
  rationale: z.string().min(10),
  acceptedRiskScore: z.number(),
  notes: z.string().optional()
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

    lifecycleStore.registerDraft({
      hash: candidate.info.hash,
      source: candidate.source,
      ref: candidate.ref ?? null
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
      ref: run.candidate.ref ?? null
    });

    return { traceId, run };
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

  app.post("/v1/policy/promote", async (request, reply) => {
    const traceId = getTraceIdFromRequest(request);
    const parsed = promoteRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { message: "Invalid promotion payload", traceId };
    }
    const body = parsed.data;
    const run = await replayStore.getRun(body.runId);
    if (!run) {
      reply.code(404);
      return { message: "Replay run not found", traceId };
    }
    const results = await replayStore.getResults(run.id, { limit: run.limit, offset: 0 });
    const impact = calculatePolicyImpact(results, config.policyImpact);
    if (impact.blocked) {
      reply.code(409);
      return { message: "Promotion blocked by impact guardrails.", traceId, impact };
    }

    const approval = {
      approvedBy: body.approvedBy,
      approvedAt: new Date().toISOString(),
      reason: body.reason ?? body.rationale,
      rationale: body.rationale,
      acceptedRiskScore: body.acceptedRiskScore,
      notes: body.notes,
      runId: run.id
    };

    const parentPolicyHash = policyEvaluator.getPolicySnapshot().info.hash;
    const drift = buildPolicyDriftSummary(results);
    await lineageStore.createLineage({
      policyHash: run.candidatePolicyHash,
      parentPolicyHash: parentPolicyHash === run.candidatePolicyHash ? null : parentPolicyHash,
      promotedBy: approval.approvedBy,
      promotedAt: approval.approvedAt,
      rationale: body.rationale,
      acceptedRiskScore: body.acceptedRiskScore,
      source: "replay",
      drift
    });

    const promoted = lifecycleStore.promotePolicy({
      hash: run.candidatePolicyHash,
      source: run.candidatePolicySource,
      ref: run.candidatePolicyRef ?? null,
      approval
    });

    return {
      traceId,
      promoted,
      impact
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
