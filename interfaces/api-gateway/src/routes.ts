import { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "./config";
import { requestPurchaseOrder } from "./clients/procurement";
import { fetchInventory } from "./clients/supplychain";
import { requestInvoiceReview } from "./clients/finance";
import { getTraceIdFromRequest } from "./trace/trace";
import { parseIntent } from "./intent/intent-parser";
import { createIntentStore } from "./intent/intent-store";
import { Intent } from "./intent/intent-model";

const intentStore = createIntentStore();

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

  let result: unknown = { message: "No action taken" };

  if (action === "requestPurchaseOrder") {
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

  await intentStore.saveIntent(parsed, traceId);

  return {
    intent,
    action,
    result,
    traceId,
    parsedIntent: parsed
  };
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/intent", async (request, reply) => {
    const body = intentSchema.parse(request.body);
    const traceId = getTraceIdFromRequest(request);
    const parsed = parseIntent(body.text);
    if (parsed.confidence < 0.6) {
      reply.code(400);
      return {
        message:
          "Intent confidence too low. Provide a request for purchase orders, inventory checks, or invoice reviews.",
        traceId
      };
    }
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
