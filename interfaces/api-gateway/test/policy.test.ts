import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import { createDefaultPolicyEngine } from "../src/policy/default-policy";
import type { Intent } from "../src/intent/intent-model";

const requestPurchaseOrder = vi.fn();
const fetchInventory = vi.fn();
const requestInvoiceReview = vi.fn();

vi.mock("../src/clients/procurement", () => ({ requestPurchaseOrder }));
vi.mock("../src/clients/supplychain", () => ({ fetchInventory }));
vi.mock("../src/clients/finance", () => ({ requestInvoiceReview }));

async function buildApp() {
  const { registerRoutes } = await import("../src/routes");
  const app = Fastify();
  await registerRoutes(app);
  await app.ready();
  return app;
}

afterEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.EXECUTION_MODE;
});

test("default policy allows, warns, and denies based on confidence and risk", () => {
  const engine = createDefaultPolicyEngine({ confidenceThreshold: 0.6 });
  const baseIntent: Intent = {
    intentType: "CREATE_PO",
    entities: {},
    confidence: 0.9,
    rawText: "Create a PO"
  };

  const allowDecision = engine.evaluate(baseIntent, { executionMode: "manual", traceId: "trace-1" });
  expect(allowDecision).toEqual({ decision: "ALLOW", reasons: [] });

  const warnDecision = engine.evaluate({ ...baseIntent, risk: "high" } as Intent & { risk?: string }, {
    executionMode: "auto",
    traceId: "trace-2"
  });
  expect(warnDecision).toEqual({ decision: "WARN", reasons: ["High-risk intent flagged for auto execution."] });

  const denyDecision = engine.evaluate({ ...baseIntent, confidence: 0.2 }, { executionMode: "manual", traceId: "trace-3" });
  expect(denyDecision).toEqual({ decision: "DENY", reasons: ["Intent confidence below policy threshold."] });
});

test("simulation mode does not invoke downstream actions", async () => {
  process.env.EXECUTION_MODE = "simulate";
  const app = await buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/v1/intent",
    headers: { "content-type": "application/json", "x-trace-id": "trace-sim" },
    payload: { text: "create a PO for laptops" }
  });

  expect(response.statusCode).toBe(200);
  expect(requestPurchaseOrder).not.toHaveBeenCalled();
  expect(response.json().result).toEqual({ message: "Simulation mode enabled. No downstream actions executed." });

  await app.close();
});

test("policy explain endpoint returns policy details", async () => {
  process.env.EXECUTION_MODE = "manual";
  const app = await buildApp();
  fetchInventory.mockResolvedValue({ status: "ok" });

  const intentResponse = await app.inject({
    method: "POST",
    url: "/v1/intent",
    headers: { "content-type": "application/json", "x-trace-id": "trace-policy" },
    payload: { text: "check inventory for SKU-1" }
  });
  expect(intentResponse.statusCode).toBe(200);

  const policyResponse = await app.inject({
    method: "GET",
    url: "/v1/policy/explain/trace-policy"
  });

  expect(policyResponse.statusCode).toBe(200);
  const payload = policyResponse.json();
  expect(payload.traceId).toBe("trace-policy");
  expect(payload.decision).toBe("ALLOW");
  expect(payload.reasons).toEqual([]);

  await app.close();
});
