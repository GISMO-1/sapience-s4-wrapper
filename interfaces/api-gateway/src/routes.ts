import { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "./config";
import { requestPurchaseOrder } from "./clients/procurement";
import { fetchInventory } from "./clients/supplychain";
import { requestInvoiceReview } from "./clients/finance";

const intentSchema = z.object({
  text: z.string().min(1)
});

const assistResponseSchema = z.object({
  plan: z.string(),
  tool_calls: z.array(
    z.object({
      endpoint: z.string(),
      payload: z.record(z.unknown())
    })
  )
});

function detectIntent(text: string): { intent: string; action: string } {
  const lowered = text.toLowerCase();
  if (lowered.includes("order") || lowered.includes("po")) {
    return { intent: "procurement.po.request", action: "requestPurchaseOrder" };
  }
  if (lowered.includes("inventory") || lowered.includes("stock")) {
    return { intent: "supplychain.inventory.lookup", action: "fetchInventory" };
  }
  if (lowered.includes("invoice")) {
    return { intent: "finance.invoice.review", action: "requestInvoiceReview" };
  }
  return { intent: "unknown", action: "noop" };
}

async function proxyRequest(request: any, reply: any, baseUrl: string, path: string) {
  const targetUrl = `${baseUrl}${path}`;
  const response = await fetch(targetUrl, {
    method: request.method,
    headers: { "content-type": request.headers["content-type"] ?? "application/json" },
    body: request.body ? JSON.stringify(request.body) : undefined
  });
  const data = await response.text();
  const contentType = response.headers.get("content-type");
  if (contentType) {
    reply.header("content-type", contentType);
  }
  reply.code(response.status).send(data);
}

async function handleIntent(text: string, traceId: unknown) {
  const { intent, action } = detectIntent(text);

  let result: unknown = { message: "No action taken" };

  if (action === "requestPurchaseOrder") {
    result = await requestPurchaseOrder(config.procurementUrl, { sku: "AUTO-ITEM", quantity: 10 });
  } else if (action === "fetchInventory") {
    result = await fetchInventory(config.supplychainUrl, "AUTO-ITEM");
  } else if (action === "requestInvoiceReview") {
    result = await requestInvoiceReview(config.financeUrl, { invoiceId: "AUTO-INV", amount: 1000 });
  }

  return {
    intent,
    action,
    result,
    traceId
  };
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/intent", async (request) => {
    const body = intentSchema.parse(request.body);
    return handleIntent(body.text, request.headers["x-trace-id"] ?? null);
  });

  app.post("/v1/assist", async (request) => {
    const body = intentSchema.parse(request.body);
    const response = await fetch(`${config.aiServiceUrl}/v1/assist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = assistResponseSchema.parse(await response.json());
    const toolCall = payload.tool_calls[0];

    if (config.executeToolCalls && toolCall?.endpoint === "/v1/intent") {
      const text = typeof toolCall.payload.text === "string" ? toolCall.payload.text : body.text;
      const executed = await handleIntent(text, request.headers["x-trace-id"] ?? null);
      return { ...payload, executed };
    }

    return payload;
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
