import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import { createPolicyEvaluator, InMemoryRateLimiter } from "../src/policy-code/evaluator";
import type { PolicyDecisionResult } from "../src/policy-code/types";
import type { Intent } from "../src/intent/intent-model";
import { policyDocumentSchema } from "../src/policy-code/schema";
import { createPolicyLoader } from "../src/policy-code/loader";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const requestPurchaseOrder = vi.fn();
const fetchInventory = vi.fn();
const requestInvoiceReview = vi.fn();

vi.mock("../src/clients/procurement", () => ({ requestPurchaseOrder }));
vi.mock("../src/clients/supplychain", () => ({ fetchInventory }));
vi.mock("../src/clients/finance", () => ({ requestInvoiceReview }));

const policyData = {
  version: "v1",
  defaults: {
    confidenceThreshold: 0.6,
    execution: { autoRequires: ["WARN"] }
  },
  rules: [
    {
      id: "b-rule",
      enabled: true,
      priority: 5,
      appliesTo: { intentTypes: ["CREATE_PO"] },
      constraints: [{ type: "SKU_BLOCKLIST", params: { skus: ["BAD-SKU"] } }],
      decision: "DENY",
      reason: "Blocked SKU.",
      tags: ["compliance"]
    },
    {
      id: "a-rule",
      enabled: true,
      priority: 10,
      appliesTo: { intentTypes: ["CREATE_PO"] },
      constraints: [{ type: "CONFIDENCE_MIN", params: { min: 0.4 } }],
      decision: "WARN",
      reason: "Low confidence.",
      tags: ["ops"]
    }
  ]
};

const policyLoader = {
  getSnapshot: () => ({
    policy: policyData,
    info: { version: "v1", hash: "hash-1", loadedAt: "now", path: "policies" },
    source: "loaded" as const
  }),
  reload: () => ({
    policy: policyData,
    info: { version: "v1", hash: "hash-1", loadedAt: "now", path: "policies" },
    source: "loaded" as const
  })
};

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
  delete process.env.POLICY_PATH;
});

test("policy schema validates YAML document", () => {
  expect(() => policyDocumentSchema.parse(policyData)).not.toThrow();
});

test("policy loader parses YAML and returns metadata", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "policy-test-"));
  const policyPath = path.join(tempDir, "policies.v1.yaml");
  writeFileSync(
    policyPath,
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.6\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  process.env.POLICY_PATH = policyPath;
  const loader = createPolicyLoader({ handleSignals: false });
  const snapshot = loader.getSnapshot();

  expect(snapshot.policy?.version).toBe("v1");
  expect(snapshot.info.hash).toBeDefined();
  expect(snapshot.info.path).toBe(policyPath);
});

test("policy evaluator orders rules deterministically and resolves decisions", () => {
  const evaluator = createPolicyEvaluator({ loader: policyLoader });
  const intent: Intent = {
    intentType: "CREATE_PO",
    entities: { sku: "BAD-SKU" },
    confidence: 0.3,
    rawText: "create PO"
  };
  const decision = evaluator.evaluate(intent, { executionMode: "manual", traceId: "trace-1" });

  expect(decision.matchedRules.map((rule) => rule.ruleId)).toEqual([
    "__default_confidence_threshold",
    "a-rule",
    "b-rule"
  ]);
  expect(decision.final).toBe("DENY");
});

test("rate limiter triggers deterministically", () => {
  let now = 0;
  const limiter = new InMemoryRateLimiter(() => now);
  const evaluator = createPolicyEvaluator({ loader: policyLoader, limiter, now: () => now });
  const intent: Intent = {
    intentType: "CREATE_PO",
    entities: { sku: "SKU-1" },
    confidence: 0.9,
    rawText: "create PO"
  };

  const policyWithRateLimit = {
    ...policyData,
    rules: [
      {
        id: "limit",
        enabled: true,
        priority: 5,
        appliesTo: { intentTypes: ["CREATE_PO"] },
        constraints: [{ type: "RATE_LIMIT", params: { windowSeconds: 60, max: 2 } }],
        decision: "WARN",
        reason: "Too many requests.",
        tags: ["ops"]
      }
    ]
  };

  const rateLoader = {
    getSnapshot: () => ({
      policy: policyWithRateLimit,
      info: { version: "v1", hash: "hash-2", loadedAt: "now", path: "policies" },
      source: "loaded" as const
    }),
    reload: () => ({
      policy: policyWithRateLimit,
      info: { version: "v1", hash: "hash-2", loadedAt: "now", path: "policies" },
      source: "loaded" as const
    })
  };

  const rateEvaluator = createPolicyEvaluator({ loader: rateLoader, limiter, now: () => now });

  now = 1;
  rateEvaluator.evaluate(intent, { executionMode: "manual", traceId: "trace-2" });
  now = 2;
  rateEvaluator.evaluate(intent, { executionMode: "manual", traceId: "trace-3" });
  now = 3;
  const decision = rateEvaluator.evaluate(intent, { executionMode: "manual", traceId: "trace-4" });

  expect(decision.matchedRules.some((rule) => rule.ruleId === "limit")).toBe(true);
  expect(decision.final).toBe("WARN");
});

test("policy explain endpoint returns policy metadata", async () => {
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
  expect(payload.decision.final).toBeDefined();
  expect(payload.policy.hash).toBeDefined();

  await app.close();
});

test("policy decision persistence is invoked", async () => {
  const policyStoreModule = await import("../src/policy/policy-store");
  const policyStoreSpy = vi.spyOn(policyStoreModule, "createPolicyStore");
  const savePolicyDecision = vi.fn(async (_traceId: string, decision: PolicyDecisionResult) => ({
    id: "id",
    traceId: "trace-persist",
    policyHash: decision.policy.hash,
    decision: decision.final,
    matchedRuleIds: decision.matchedRules.map((rule) => rule.ruleId),
    reasons: decision.reasons,
    categories: decision.categories,
    risk: decision.risk,
    createdAt: new Date()
  }));

  policyStoreSpy.mockReturnValue({
    savePolicyDecision,
    getPolicyByTraceId: vi.fn(async () => null)
  });

  const app = await buildApp();

  await app.inject({
    method: "POST",
    url: "/v1/intent",
    headers: { "content-type": "application/json", "x-trace-id": "trace-persist" },
    payload: { text: "create a PO" }
  });

  expect(savePolicyDecision).toHaveBeenCalled();

  await app.close();
});
