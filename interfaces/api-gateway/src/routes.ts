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

const intentStore = createIntentStore();
const policyStore = createPolicyStore();
const policyEvaluator = createPolicyEvaluator();
const replayStore = createPolicyReplayStore();
const replayEngine = createPolicyReplayEngine(replayStore);

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

async function handleIntent(parsed: Intent, traceId: string) {
  const { intent, action } = mapIntentToAction(parsed.intentType);
  const executionMode = (config.executionMode ?? "manual") as ExecutionMode;
  const policyDecision = policyEvaluator.evaluate(parsed, { executionMode, traceId });
  await policyStore.savePolicyDecision(traceId, policyDecision);
  await intentStore.saveIntent(parsed, traceId);

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
      plan: {
        intent,
        action
      }
    };
  } else if (action === "requestPurchaseOrder") {
    result = await requestPurchaseOrder(config.procurementUrl, { sku: "AUTO-ITEM", quantity: 10 }, traceId);
  } else if (action === "fetchInventory") {
    result = await fetchInventory(config.supplychainUrl, "AUTO-ITEM", traceId);
  } else if (action === "requestInvoiceReview") {
    result = await requestInvoiceReview(
      config.financeUrl,
      { invoiceId: "AUTO-INV", amount: 1000 },
      traceId
    );
  }

  return {
    intent,
    action,
    result,
    traceId,
    parsedIntent: parsed,
    policy: policyDecision,
    executionMode
  };
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/intent", async (request) => {
    const body = intentSchema.parse(request.body);
    const traceId = getTraceIdFromRequest(request);
    const parsed = parseIntent(body.text);
    return handleIntent(parsed, traceId);
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
      const executed = await handleIntent(parseIntent(text), traceId);
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
    const run = await replayStore.getRun(runId);
    if (!run) {
      reply.code(404);
      return { message: "Replay run not found", traceId };
    }
    const results = await replayStore.getResults(runId, { limit: run.limit, offset: 0 });
    const report = buildReport(run, results);
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
