import { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "./config";
import { requestPurchaseOrder } from "./clients/procurement";
import { fetchInventory } from "./clients/supplychain";
import { requestInvoiceReview } from "./clients/finance";
import { intentSchema, parseIntent } from "./intent-model";
import { getDb } from "./db";
import { MemoryIntentStore, PostgresIntentStore } from "./intent-store";
import { logger } from "./logger";
import { TraceAwareRequest } from "./trace";

const intentRequestSchema = z.object({
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

async function proxyRequest(request: TraceAwareRequest, reply: any, baseUrl: string, path: string) {
  const targetUrl = `${baseUrl}${path}`;
  const traceId = request.traceId ?? "unknown";
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

function buildIntentStore() {
  const db = getDb();
  return db ? new PostgresIntentStore(db) : new MemoryIntentStore();
}

async function handleIntent(text: string, traceId: string, triggeredBy: string, executionMode: string) {
  const parsedIntent = intentSchema.parse(parseIntent(text));
  if (parsedIntent.confidence < 0.6) {
    logger.warn({ traceId, eventType: "intent.ambiguous" }, "Intent rejected");
    return {
      ambiguous: true,
      intentType: parsedIntent.intentType,
      confidence: parsedIntent.confidence,
      guidance: "Please provide more detail (SKU, quantity, or invoice id).",
      traceId
    };
  }

  const store = buildIntentStore();
  await store.saveIntent(traceId, text, parsedIntent, triggeredBy, executionMode);

  const action = parsedIntent.intentType;

  let result: unknown = { message: "No action taken" };

  if (action === "CREATE_PO") {
    result = await requestPurchaseOrder(config.procurementUrl, { sku: "AUTO-ITEM", quantity: 10 }, traceId);
  } else if (action === "CHECK_INVENTORY") {
    result = await fetchInventory(config.supplychainUrl, "AUTO-ITEM", traceId);
  } else if (action === "REVIEW_INVOICE") {
    result = await requestInvoiceReview(
      config.financeUrl,
      { invoiceId: "AUTO-INV", amount: 1000 },
      traceId
    );
  }

  logger.info(
    { traceId, eventType: "intent.executed", intentType: parsedIntent.intentType },
    "Intent executed"
  );

  return {
    ambiguous: false,
    intent: parsedIntent,
    intentType: parsedIntent.intentType,
    action,
    result,
    traceId
  };
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/intent", async (request, reply) => {
    const body = intentRequestSchema.parse(request.body);
    const traceId = (request as TraceAwareRequest).traceId ?? "unknown";
    logger.info({ traceId, eventType: "intent.received" }, "Intent received");
    const result = await handleIntent(body.text, traceId, "gateway:/v1/intent", config.executionMode);
    if (result.ambiguous) {
      reply.code(422);
    }
    return result;
  });

  app.post("/v1/assist", async (request) => {
    const body = intentRequestSchema.parse(request.body);
    const traceId = (request as TraceAwareRequest).traceId ?? "unknown";
    const response = await fetch(`${config.aiServiceUrl}/v1/assist`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-trace-id": traceId },
      body: JSON.stringify(body)
    });
    const payload = assistResponseSchema.parse(await response.json());
    const toolCall = payload.tool_calls[0];

    if (config.executionMode === "auto" && toolCall?.endpoint === "/v1/intent") {
      const text = typeof toolCall.payload.text === "string" ? toolCall.payload.text : body.text;
      const executed = await handleIntent(text, traceId, "gateway:/v1/assist", config.executionMode);
      return { ...payload, executed, traceId };
    }

    return { ...payload, traceId };
  });

  app.post("/v1/assist/replay/:traceId", async (request) => {
    const traceId = request.params as { traceId: string };
    const store = buildIntentStore();
    const intent = await store.getIntentByTraceId(traceId.traceId);
    if (!intent) {
      return { traceId: traceId.traceId, message: "No stored intent found." };
    }
    logger.info({ traceId: traceId.traceId, eventType: "intent.replay" }, "Replaying intent");
    return handleIntent(intent.rawText, traceId.traceId, "gateway:/v1/assist/replay", config.executionMode);
  });

  app.get("/v1/explain/:traceId", async (request, reply) => {
    const params = request.params as { traceId: string };
    const response = await fetch(`${config.aiServiceUrl}/v1/explain/${params.traceId}`, {
      headers: { "x-trace-id": params.traceId }
    });
    const data = await response.json();
    reply.code(response.status).send(data);
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
